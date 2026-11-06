import { spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createRequire } from 'node:module';
const ts = createRequire(new URL('../../services/api/package.json', import.meta.url))('typescript');
const adminRequire = createRequire(new URL('../../apps/admin/package.json', import.meta.url));
const toolRequire = createRequire(adminRequire.resolve('@umijs/max'));
const postcss = toolRequire('postcss');
const styles = [];
const scripts = [];
const json = [];
async function walk(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (
      ['node_modules', 'dist', 'generated', 'unpackage', '.git', '.hbuilderx'].includes(
        entry.name,
      ) ||
      entry.name.startsWith('.umi')
    )
      continue;
    const file = resolve(folder, entry.name);
    if (entry.isDirectory()) await walk(file);
    else if (['.mjs', '.cjs'].includes(extname(file))) scripts.push(file);
    else if (extname(file) === '.json') json.push(file);
    else if (['.css', '.uvue'].includes(extname(file))) styles.push(file);
  }
}
for (const folder of [
  'scripts',
  'services/api/test',
  'services/api/scripts',
  'services/api/prisma',
  'apps/mobile',
  'infra',
])
  await walk(resolve(folder));
for (const file of json) {
  const content = await readFile(file, 'utf8');
  if (
    file === resolve('apps/mobile/platformConfig.json') ||
    file.includes(resolve('apps/mobile/.vscode'))
  ) {
    const result = ts.parseConfigFileTextToJson(file, content);
    if (result.error)
      throw Error(file + ': ' + ts.flattenDiagnosticMessageText(result.error.messageText, ' '));
  } else {
    try {
      JSON.parse(content);
    } catch (error) {
      throw Error(file + ': ' + error.message);
    }
  }
}
const failed = [];
for (const file of styles) {
  const content = await readFile(file, 'utf8');
  if (file.endsWith('.uvue')) {
    for (const match of content.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g))
      postcss.parse(match[1], { from: file });
  } else postcss.parse(content, { from: file });
}
let next = 0;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (next < scripts.length) {
      const file = scripts[next++];
      await new Promise((done) => {
        const child = spawn(process.execPath, ['--check', file], {
          windowsHide: true,
          stdio: ['ignore', 'ignore', 'pipe'],
        });
        let output = '';
        child.stderr.on('data', (chunk) => {
          output += chunk;
        });
        child.on('error', (error) => {
          failed.push({ file, error: error.message });
          done();
        });
        child.on('exit', (code) => {
          if (code !== 0) failed.push({ file, error: output.trim() });
          done();
        });
      });
    }
  }),
);
console.log(
  `Syntax: ${scripts.length} Node scripts, ${json.length} JSON files, ${styles.length} CSS/SFC files, ${failed.length} failures`,
);
for (const failure of failed) console.error(failure.file + '\n' + failure.error);
if (failed.length) process.exitCode = 1;
