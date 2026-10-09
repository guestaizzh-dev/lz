import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, readlinkSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { pg_ctl as nativePgCtl, initdb as nativeInitdb } from '@embedded-postgres/windows-x64';

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Windows PostgreSQL's native tools need ASCII paths even with a UTF-8 database.
// A task-owned junction gives native binaries an ASCII invocation path.
const alias = join(process.env.LOCALAPPDATA, 'daoxue-academy-dev', 'workspace');
mkdirSync(dirname(alias), { recursive: true });
if (!existsSync(alias)) symlinkSync(root, alias, 'junction');
if (resolve(readlinkSync(alias)).toLowerCase() !== root.toLowerCase()) throw new Error('Development junction belongs to another workspace.');
const pg_ctl = join(alias, relative(root, nativePgCtl));
const initdb = join(alias, relative(root, nativeInitdb));
// Data must have a physical ASCII path: native PostgreSQL resolves junctions.
const runtime = join(dirname(alias), 'postgres');
const data = join(runtime, 'data');
const configPath = join(runtime, 'connection.json');
const action = process.argv[2] ?? 'start';
if (process.platform !== 'win32') throw new Error('This helper is Windows-only. Use infra/compose.yaml on Linux.');
mkdirSync(runtime, { recursive: true });
const opts = { windowsHide: true, encoding: 'utf8', timeout: 60_000, cwd: alias };

if (action === 'stop') {
  if (!existsSync(join(data, 'postmaster.pid'))) {
    console.log('Development PostgreSQL is already stopped.');
  } else {
    await run(pg_ctl, ['-D', data, '-m', 'fast', '-w', 'stop'], opts);
    console.log('Development PostgreSQL stopped.');
  }
} else if (action === 'start') {
  const config = existsSync(configPath)
    ? JSON.parse(readFileSync(configPath, 'utf8'))
    : { port: 55432, user: 'daoxue', password: randomBytes(24).toString('hex'), database: 'daoxue_dev' };
  if (!existsSync(configPath)) writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
  if (!existsSync(join(data, 'PG_VERSION'))) {
    const passwordFile = join(runtime, 'init-password');
    writeFileSync(passwordFile, config.password, { mode: 0o600 });
    try {
      await run(initdb, ['-D', data, '-U', config.user, '--pwfile', passwordFile,
        '--encoding=UTF8', '--locale=C', '--auth=scram-sha-256'], opts);
    } finally { rmSync(passwordFile, { force: true }); }
    writeFileSync(join(data, 'postgresql.auto.conf'), `listen_addresses = '127.0.0.1'\nport = ${config.port}\n`);
  }
  try { await run(pg_ctl, ['-D', data, 'status'], opts); }
  catch { await run(pg_ctl, ['-D', data, '-l', join(runtime, 'server.log'), '-w', 'start'], opts); }
  const { Client } = createRequire(join(root, 'services', 'api', 'package.json'))('pg');
  const client = new Client({ host: '127.0.0.1', port: config.port, user: config.user, password: config.password, database: 'postgres' });
  await client.connect();
  try {
    const result = await client.query("SELECT 1 FROM pg_database WHERE datname = 'daoxue_dev'");
    if (result.rowCount === 0) await client.query('CREATE DATABASE daoxue_dev');
  } finally { await client.end(); }
  const envPath = join(root, 'services', 'api', '.env');
  if (!existsSync(envPath)) writeFileSync(envPath,
    `NODE_ENV=development\nPORT=3000\nDATABASE_URL=postgresql://${config.user}:${config.password}@127.0.0.1:${config.port}/${config.database}\nCORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://127.0.0.1:8765\n`, { mode: 0o600 });
  console.log(`PostgreSQL ready on 127.0.0.1:${config.port}; local environment created (credentials not printed).`);
} else { throw new Error('Use start or stop.'); }
