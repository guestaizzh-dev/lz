import { createRequire } from 'node:module';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative, dirname, extname } from 'node:path';
const require = createRequire(new URL('../../services/api/package.json', import.meta.url));
const ts = require('typescript');
const root = process.cwd();
const skip = new Set(['node_modules', 'unpackage', 'dist', 'generated', '.git', '.hbuilderx']);
const extensions = ['.ts', '.tsx', '.uvue', '.uts', '.less', '.css'];
const files = new Map();
async function walk(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (skip.has(entry.name) || entry.name.startsWith('.umi')) continue;
    const path = resolve(folder, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (extensions.includes(extname(path))) files.set(path, await readFile(path, 'utf8'));
  }
}
for (const folder of ['services/api/src', 'apps/admin/src', 'apps/admin/config', 'apps/mobile'])
  await walk(resolve(folder));
function localTarget(file, specifier) {
  let base;
  if (specifier.startsWith('@/')) base = resolve('apps/admin/src', specifier.slice(2));
  else if (specifier.startsWith('@root/')) base = resolve('apps/admin', specifier.slice(6));
  else if (specifier.startsWith('.')) base = resolve(dirname(file), specifier);
  else return;
  if (base.endsWith('.js')) base = base.slice(0, -3);
  return [
    base,
    ...extensions.map((ext) => base + ext),
    ...extensions.map((ext) => resolve(base, 'index' + ext)),
  ].find((p) => files.has(p));
}
const edges = new Map();
for (const [file, source] of files) {
  const imports = new Set();
  const ast = ts.createSourceFile(
    file,
    file.endsWith('.uvue')
      ? (/<script\b[^>]*>([\s\S]*?)<\/script>/.exec(source)?.[1] ?? '')
      : source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      imports.add(node.moduleSpecifier.text);
    if (
      ts.isCallExpression(node) &&
      node.arguments.length &&
      ts.isStringLiteral(node.arguments[0]) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    )
      imports.add(node.arguments[0].text);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  for (const match of source.matchAll(/@import\s+['"]([^'"]+)['"]/g)) imports.add(match[1]);
  edges.set(file, [...imports].map((s) => localTarget(file, s)).filter(Boolean));
}
const roots = [
  'services/api/src/main.ts',
  // Explicit operational entry: services/api/prisma/convert-private-data.mjs imports its dist module.
  'services/api/src/private-data-conversion.ts',
  'apps/admin/src/app.tsx',
  'apps/admin/src/access.ts',
  'apps/admin/src/loading.tsx',
  'apps/admin/src/global.less',
  'apps/admin/src/global.style.ts',
  'apps/admin/src/typings.d.ts',
  'apps/mobile/App.uvue',
  'apps/mobile/main.uts',
].map((f) => resolve(f));
for (const file of files.keys())
  if (
    file.includes(resolve('apps/admin/config')) ||
    file.includes(resolve('apps/admin/src/locales')) ||
    file.endsWith('.d.ts') ||
    file.includes(resolve('apps/mobile/uni_modules'))
  )
    roots.push(file);
const pages = JSON.parse(await readFile('apps/mobile/pages.json', 'utf8'));
for (const page of pages.pages) roots.push(resolve('apps/mobile', page.path + '.uvue'));
const routes = await readFile('apps/admin/config/routes.ts', 'utf8');
for (const match of routes.matchAll(/component\s*:\s*['"]\.\/([^'"]+)['"]/g)) {
  const base = resolve('apps/admin/src/pages', match[1]);
  const page = [base + '.tsx', resolve(base, 'index.tsx')].find((p) => files.has(p));
  if (!page) throw Error('Missing admin route component: ' + match[1]);
  roots.push(page);
}
const reached = new Set();
function visit(file) {
  if (reached.has(file)) return;
  reached.add(file);
  for (const dep of edges.get(file) ?? []) visit(dep);
}
roots.forEach(visit);
const unreachable = [...files.keys()]
  .filter((f) => !reached.has(f))
  .map((f) => relative(root, f).replaceAll('\\', '/'));
const report = {
  scanned: files.size,
  reached: reached.size,
  unreachable,
  note: 'Candidates require review for runtime conventions, native conditional compilation and tooling/tests before removal.',
};
await mkdir('outputs/code-quality', { recursive: true });
await writeFile('outputs/code-quality/references.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

if (unreachable.length) process.exitCode = 1;
