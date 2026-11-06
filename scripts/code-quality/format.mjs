import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, relative, extname } from 'node:path';
import * as prettier from 'prettier';

const files = [];
const extensions = new Set([
  '.ts',
  '.tsx',
  '.mjs',
  '.cjs',
  '.uts',
  '.uvue',
  '.css',
  '.less',
  '.json',
]);
const ignored = new Set([
  'node_modules',
  'dist',
  'unpackage',
  'generated',
  'migrations',
  '.git',
  '.hbuilderx',
]);
function walk(folder) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (ignored.has(entry.name) || entry.name.startsWith('.umi')) continue;
    const file = resolve(folder, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (extensions.has(extname(file))) files.push(file);
  }
}
for (const folder of [
  'services/api/src',
  'services/api/test',
  'services/api/scripts',
  'apps/admin/src',
  'apps/admin/config',
  'apps/mobile',
  'scripts',
])
  walk(folder);
for (const name of [
  'package.json',
  'services/api/package.json',
  'services/api/tsconfig.json',
  'apps/admin/package.json',
  'apps/admin/tsconfig.json',
  '.prettierrc.json',
])
  files.push(resolve(name));
const write = process.argv.includes('--write');
const config = await prettier.resolveConfig(resolve('package.json'));
const changed = [];
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  const formatted = await prettier.format(source, {
    ...config,
    filepath: file,
    ...(file.endsWith('.uvue')
      ? { parser: 'vue' }
      : file.endsWith('.uts')
        ? { parser: 'typescript' }
        : {}),
  });
  if (formatted === source) continue;
  changed.push(relative(process.cwd(), file));
  if (write) {
    for (let attempt = 0; ; attempt++) {
      try {
        writeFileSync(file, formatted);
        break;
      } catch (error) {
        if (attempt >= 4 || !['EBUSY', 'EPERM', 'UNKNOWN'].includes(error.code)) throw error;
        await new Promise((done) => setTimeout(done, 100 * (attempt + 1)));
      }
    }
  }
}
console.log(
  `Format ${write ? 'write' : 'check'}: ${files.length} files, ${changed.length} ${write ? 'updated' : 'need formatting'}`,
);
if (!write && changed.length) {
  console.error(changed.join('\n'));
  process.exitCode = 1;
}
