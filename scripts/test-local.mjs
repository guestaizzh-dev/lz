import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const env = { ...process.env, NODE_ENV: 'test' };
if (!env.DATABASE_URL) {
  if (!env.LOCALAPPDATA) throw Error('Set DATABASE_URL to a loopback test PostgreSQL server.');
  const connection = JSON.parse(
    await readFile(
      resolve(env.LOCALAPPDATA, 'daoxue-academy-dev/postgres/connection.json'),
      'utf8',
    ),
  );
  const url = new URL('postgresql://127.0.0.1');
  url.username = connection.user;
  url.password = connection.password;
  url.port = String(connection.port);
  url.pathname = '/' + connection.database;
  env.DATABASE_URL = url.href;
}
const url = new URL(env.DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(url.hostname))
  throw Error('Only a loopback test server is allowed.');
const temp = resolve('.runtime/test-temp');
await mkdir(temp, { recursive: true });
env.TEMP = temp;
env.TMP = temp;
const require = createRequire(new URL('../services/api/package.json', import.meta.url));
async function build(args) {
  await new Promise((ok, fail) => {
    const child = spawn(process.execPath, args, {
      cwd: resolve('services/api'),
      env,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.on('error', fail);
    child.on('exit', (code) => (code === 0 ? ok() : fail(Error('API build failed before tests'))));
  });
}
await build(['scripts/prepare-live.mjs']);
await build([require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.json']);
const child = spawn(
  process.execPath,
  ['--env-file-if-exists=.env', 'test/run-tests.mjs', ...process.argv.slice(2)],
  { cwd: resolve('services/api'), env, stdio: 'inherit', windowsHide: true },
);
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
