import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
async function run(args, cwd = process.cwd(), env = process.env) {
  await new Promise((ok, fail) => {
    const child = spawn(process.execPath, args, { cwd, env, stdio: 'inherit', windowsHide: true });
    child.on('error', fail);
    child.on('exit', (code) =>
      code === 0 ? ok() : fail(Error(`Static check failed (${code}): ${args[0]}`)),
    );
  });
}
const apiRequire = createRequire(new URL('../../services/api/package.json', import.meta.url));
const adminRequire = createRequire(new URL('../../apps/admin/package.json', import.meta.url));
const tsc = resolve(dirname(apiRequire.resolve('typescript/package.json')), 'bin/tsc');
const max = resolve(dirname(adminRequire.resolve('@umijs/max/package.json')), 'bin/max.js');
try {
  const prisma = resolve(dirname(apiRequire.resolve('prisma/package.json')), 'build/index.js');
  await run([prisma, 'generate'], resolve('services/api'), {
    ...process.env,
    DATABASE_URL:
      process.env.DATABASE_URL ?? 'postgresql://unused:unused@127.0.0.1:1/static_generation_only',
  });
  await run([max, 'setup'], resolve('apps/admin'));
  await run([tsc, '-p', 'services/api/tsconfig.json', '--noEmit']);
  await run([tsc, '-p', 'apps/admin/tsconfig.json', '--noEmit']);
  await run(['scripts/code-quality/mobile.mjs']);
  await run(['scripts/code-quality/syntax.mjs']);
  await run(['scripts/code-quality/references.mjs']);
  await run(['scripts/code-quality/format.mjs']);
  await run(['--test', 'scripts/test/*.test.mjs']);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
