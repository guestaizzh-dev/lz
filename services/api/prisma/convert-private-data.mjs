import { Database } from '../dist/database.js';
import { convertPrivateBatch, conversionRunId, scrubLegacyAuthBatch } from '../dist/private-data-conversion.js';

const options = Object.fromEntries(process.argv.slice(2).map(arg => {
  const match = /^--(mode|confirm-database|backup-reference|run-id|admin)=(.+)$/.exec(arg);
  if (!match) throw Error('Use --mode=dry-run|encrypt|restore, --confirm-database=NAME, --backup-reference=REF, --run-id=UUID, --admin=USERNAME');
  return [match[1], match[2]];
}));
const mode = options.mode ?? 'dry-run';
if (!['dry-run','encrypt','restore'].includes(mode)) throw Error('Invalid conversion mode');
const target = new URL(process.env.DATABASE_URL ?? ''), name = decodeURIComponent(target.pathname.slice(1));
if (mode !== 'dry-run') {
  if (options['confirm-database'] !== name) throw Error('Database name confirmation does not match');
  if (!options['backup-reference']?.trim()) throw Error('A verified backup reference is required');
  if (!/^[a-fA-F0-9]{64}$/.test(process.env.DOMAIN_ENCRYPTION_KEY ?? '')) throw Error('Use the current explicit DOMAIN_ENCRYPTION_KEY');
}
if (mode === 'restore' && !/^[0-9a-f-]{36}$/i.test(options['run-id'] ?? '')) throw Error('Restoration requires the encryption run id');
const db = new Database();
try {
  const candidates = {
    user: (await db.user.findMany({ where: { phone: { not: null }, status: { not: 'DELETED' } }, select: { id: true } })).map(row => row.id),
    address: (await db.address.findMany({ where: { OR: [{ recipient: { not: '' } }, { phone: { not: '' } }, { detail: { not: '' } }] }, select: { id: true } })).map(row => row.id),
    order: (await db.$queryRaw`SELECT id FROM "Order" WHERE NOT (address ? 'cipher') AND NOT (address ? 'redacted') AND (address ? 'recipient' OR address ? 'phone' OR address ? 'detail')`).map(row => row.id),
  };
  if (mode === 'dry-run') {
    const auth = { challenges: await db.otpChallenge.count({ where: { phone: { not: '' } } }), counters: Number((await db.$queryRaw`SELECT count(*) FROM "RateLimit" WHERE key ~ ${'^sms-phone-(minute|day):1[3-9][0-9]{9}$'}`)[0].count) };
    console.log(JSON.stringify({ database: name, mode, candidates: Object.fromEntries(Object.entries(candidates).map(([table, ids]) => [table, ids.length])), auth }));
  } else {
    const actor = await db.user.findUnique({ where: { username: options.admin ?? 'admin' } });
    if (actor?.status !== 'ACTIVE' || !actor.roles.includes('ADMIN')) throw Error('Active administrator not found');
    const runId = mode === 'restore' ? options['run-id'] : conversionRunId();
    console.log(JSON.stringify({ database: name, mode, runId }));
    if (mode === 'restore') {
      for (const table of Object.keys(candidates)) candidates[table] = [];
      const audits = await db.auditLog.findMany({ where: { resourceId: runId, action: 'private.data.encrypt' }, select: { resource: true, changes: true } });
      if (!audits.length) throw Error('Encryption run has no recorded batches');
      for (const audit of audits) if (Object.hasOwn(candidates, audit.resource)) candidates[audit.resource].push(...audit.changes.ids);
    }
    for (const [table, ids] of Object.entries(candidates)) {
      let count = 0;
      for (let start = 0; start < ids.length; start += 100) count += await convertPrivateBatch(db, actor.id, table, ids.slice(start, start + 100), mode, runId, options['backup-reference']);
      console.log(JSON.stringify({ table, converted: count }));
    }
    if (mode === 'encrypt') {
      const totals = { challenges: 0, counters: 0 };
      let result;
      do { result = await scrubLegacyAuthBatch(db, actor.id, runId, options['backup-reference']); totals.challenges += result.challenges; totals.counters += result.counters; } while (result.challenges || result.counters);
      console.log(JSON.stringify({ auth: totals }));
    }
  }
} finally { await db.$disconnect(); }
