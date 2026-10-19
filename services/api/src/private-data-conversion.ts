import { randomUUID } from 'node:crypto';
import type { Database } from './database.js';
import { decryptPrivate, encryptPrivate, orderAddress, personalAddress, phoneLookup } from './private-data.js';

export type PrivateTable = 'user' | 'address' | 'order';
export type ConversionMode = 'encrypt' | 'restore';

// Each batch commits its data and audit together. Restarting an interrupted run is safe.
export async function convertPrivateBatch(db: Database, actorId: string, table: PrivateTable, ids: string[], mode: ConversionMode, runId: string, backupReference: string) {
  if (!ids.length || ids.length > 100) throw new Error('Conversion batch must contain 1–100 records');
  return db.$transaction(async tx => {
    const actor = await tx.user.findUnique({ where: { id: actorId } });
    if (actor?.status !== 'ACTIVE' || !actor.roles.includes('ADMIN')) throw new Error('Conversion requires an active administrator');
    const lock = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext('academy.private-conversion')) AS locked`;
    if (!lock[0]?.locked) throw new Error('Another private-data conversion is running');
    const changed: string[] = [];
    for (const id of [...new Set(ids)].sort()) {
      if (table === 'user') {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id=${id} FOR UPDATE`;
        const row = await tx.user.findUnique({ where: { id } });
        if (!row || row.status === 'DELETED') continue;
        if (mode === 'encrypt' && row.phone) {
          // Mixed records must agree before removing the legacy value.
          if (row.phoneCipher && decryptPrivate(row.phoneCipher) !== row.phone) throw new Error('Conflicting identity values; batch rolled back');
          const phoneHash = phoneLookup(row.phone);
          if (row.phoneHash && row.phoneHash !== phoneHash) throw new Error('Conflicting identity lookup; batch rolled back');
          await tx.user.update({ where: { id }, data: { phone: null, phoneHash, phoneCipher: row.phoneCipher || encryptPrivate(row.phone) } });
        } else if (mode === 'restore' && !row.phone && row.phoneCipher) {
          await tx.user.update({ where: { id }, data: { phone: decryptPrivate(row.phoneCipher) } });
        } else continue;
      } else if (table === 'address') {
        await tx.$queryRaw`SELECT id FROM "Address" WHERE id=${id} FOR UPDATE`;
        const row = await tx.address.findUnique({ where: { id } });
        if (!row) continue;
        const plain = personalAddress(row);
        if (mode === 'encrypt' && (row.recipient || row.phone || row.detail)) {
          for (const field of ['recipient','phone','detail'] as const) {
            if (row[field] && row[field + 'Cipher' as 'recipientCipher' | 'phoneCipher' | 'detailCipher'] && row[field] !== plain[field]) throw new Error('Conflicting address values; batch rolled back');
          }
          await tx.address.update({ where: { id }, data: { recipient: '', phone: '', detail: '', recipientCipher: encryptPrivate(plain.recipient), phoneCipher: encryptPrivate(plain.phone), detailCipher: encryptPrivate(plain.detail) } });
        } else if (mode === 'restore' && (!row.recipient || !row.phone || !row.detail) && row.recipientCipher && row.phoneCipher && row.detailCipher) {
          await tx.address.update({ where: { id }, data: { recipient: plain.recipient, phone: plain.phone, detail: plain.detail } });
        } else continue;
      } else {
        await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${id} FOR UPDATE`;
        const row = await tx.order.findUnique({ where: { id } });
        if (!row) continue;
        const snapshot = row.address as { cipher?: string; redacted?: boolean; recipient?: string; phone?: string; detail?: string };
        if (snapshot.redacted) continue;
        if (mode === 'encrypt' && !snapshot.cipher && (snapshot.recipient || snapshot.phone || snapshot.detail)) {
          await tx.order.update({ where: { id }, data: { address: { cipher: encryptPrivate(JSON.stringify(row.address)) } } });
        } else if (mode === 'restore' && snapshot.cipher) {
          await tx.order.update({ where: { id }, data: { address: orderAddress(row.address) } });
        } else continue;
      }
      changed.push(id);
    }
    if (changed.length) await tx.auditLog.create({ data: { actorId, action: 'private.data.' + mode, resource: table, resourceId: runId, reason: '私人字段兼容转换；备份引用 ' + backupReference, changes: { ids: changed, count: changed.length } } });
    return changed.length;
  }, { timeout: 30000 });
}

export const conversionRunId = () => randomUUID();

export async function scrubLegacyAuthBatch(db: Database, actorId: string, runId: string, backupReference: string) {
  return db.$transaction(async tx => {
    const actor = await tx.user.findUnique({ where: { id: actorId } });
    if (actor?.status !== 'ACTIVE' || !actor.roles.includes('ADMIN')) throw new Error('Conversion requires an active administrator');
    const lock = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext('academy.private-conversion')) AS locked`;
    if (!lock[0]?.locked) throw new Error('Another private-data conversion is running');
    const challenges = await tx.$queryRaw<{ id: string; phone: string }[]>`SELECT id,phone FROM "OtpChallenge" WHERE phone<>'' ORDER BY id LIMIT 100 FOR UPDATE`;
    for (const row of challenges) await tx.otpChallenge.update({ where: { id: row.id }, data: { phone: '', phoneHash: phoneLookup(row.phone) } });
    const counters = await tx.$queryRaw<{ key: string; count: number; expiresAt: Date }[]>`SELECT key,count,"expiresAt" FROM "RateLimit" WHERE key ~ ${'^sms-phone-(minute|day):1[3-9][0-9]{9}$'} ORDER BY key LIMIT 100 FOR UPDATE`;
    for (const row of counters) {
      const offset = row.key.lastIndexOf(':'), key = row.key.slice(0, offset + 1) + phoneLookup(row.key.slice(offset + 1));
      const current = await tx.rateLimit.findUnique({ where: { key } });
      const oldActive = row.expiresAt > new Date(), currentActive = current && current.expiresAt > new Date();
      if (oldActive) await tx.rateLimit.upsert({ where: { key }, create: { key, count: row.count, expiresAt: row.expiresAt }, update: { count: Math.max(row.count, currentActive ? current.count : 0), expiresAt: currentActive && current.expiresAt > row.expiresAt ? current.expiresAt : row.expiresAt } });
      await tx.rateLimit.delete({ where: { key: row.key } });
    }
    const counts = { challenges: challenges.length, counters: counters.length };
    if (counts.challenges || counts.counters) await tx.auditLog.create({ data: { actorId, action: 'private.auth.scrub', resource: 'identity', resourceId: runId, reason: '认证临时字段去明文；备份引用 ' + backupReference, changes: counts } });
    return counts;
  }, { timeout: 30000 });
}
