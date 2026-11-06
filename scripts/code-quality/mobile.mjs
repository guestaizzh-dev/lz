import { createRequire } from 'node:module';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(new URL('../../services/api/package.json', import.meta.url));
const ts = require('typescript');
const root = resolve('apps/mobile');
const diagnostics = [];
const files = [];

async function walk(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (['node_modules', 'unpackage', '.git', '.hbuilderx'].includes(entry.name)) continue;
    const path = resolve(folder, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (path.endsWith('.uvue')) files.push(path);
  }
}
export function analyzeMobile(source, file = 'component.uvue') {
  const diagnostics = [];
  const match = /<script\b[^>]*>([\s\S]*?)<\/script>/.exec(source);
  if (!match) return diagnostics;
  const script = match[1];
  const template = source.slice(0, match.index);
  const ast = ts.createSourceFile(file + '.ts', script, ts.ScriptTarget.Latest, true);
  const declarations = [];
  for (const node of ast.statements) {
    if (ts.isImportDeclaration(node) && node.importClause) {
      if (node.importClause.name) declarations.push(node.importClause.name.text);
      const bindings = node.importClause.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        declarations.push(
          ...bindings.elements
            .filter((e) => !e.isTypeOnly && !node.importClause.isTypeOnly)
            .map((e) => e.name.text),
        );
      } else if (bindings) declarations.push(bindings.name.text);
    } else if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        const collect = (name) => {
          if (ts.isIdentifier(name)) declarations.push(name.text);
          else
            for (const element of name.elements)
              if (ts.isBindingElement(element)) collect(element.name);
        };
        collect(declaration.name);
      }
    } else if (ts.isFunctionDeclaration(node) && node.name) declarations.push(node.name.text);
  }
  // Template bindings are uses in script-setup. Native conditional imports are checked by HBuilderX.
  const usedInTemplate = declarations.filter((name) =>
    new RegExp('\\b' + name + '\\b').test(template),
  );
  const virtual = (file + '.quality.ts').replaceAll('\\', '/');
  const content = script + '\nvoid [' + usedInTemplate.join(',') + '];\nexport {};';
  const options = {
    noEmit: true,
    noResolve: true,
    noLib: true,
    noUnusedLocals: true,
    noUnusedParameters: true,
    allowUnreachableCode: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
  };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (path) =>
    path === virtual ? ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true) : undefined;
  const program = ts.createProgram([virtual], options, host);
  if (!program.getSourceFile(virtual)) throw Error('Virtual source was not checked: ' + file);
  const builtinTypes = new Set([
    'Array',
    'ReadonlyArray',
    'Promise',
    'Map',
    'Set',
    'Record',
    'Error',
    'Date',
    'Partial',
    'Pick',
    'Omit',
    'Readonly',
    'ReturnType',
    'InstanceType',
    'NonNullable',
    'Extract',
    'Exclude',
    'Parameters',
    'UTSJSONObject',
    'UTSArray',
    'Element',
    'HTMLIFrameElement',
    'MessageEvent',
    'UniNativeViewElement',
    'UniSwitchChangeEvent',
  ]);
  const references = [];
  const collectTypes = (node) => {
    if (
      ts.isTypeReferenceNode(node) &&
      ts.isIdentifier(node.typeName) &&
      !builtinTypes.has(node.typeName.text)
    )
      references.push(node.typeName);
    ts.forEachChild(node, collectTypes);
  };
  collectTypes(program.getSourceFile(virtual));
  const errors = [
    ...program.getSyntacticDiagnostics(),
    ...program
      .getSemanticDiagnostics()
      .filter(
        (d) =>
          [6133, 6138, 6192, 6196, 6198].includes(d.code) ||
          (d.code === 2304 && references.some((n) => n.getStart() === d.start)),
      ),
  ];
  for (const error of errors) {
    const position = error.file.getLineAndCharacterOfPosition(error.start ?? 0);
    diagnostics.push({
      file: relative(process.cwd(), file).replaceAll('\\', '/'),
      line: position.line + source.slice(0, match.index).split('\n').length,
      code: error.code,
      message: ts.flattenDiagnosticMessageText(error.messageText, '\n'),
    });
  }
  return diagnostics;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await walk(root);
  for (const file of files) diagnostics.push(...analyzeMobile(await readFile(file, 'utf8'), file));
  await mkdir('outputs/code-quality', { recursive: true });
  await writeFile(
    'outputs/code-quality/mobile-static.json',
    JSON.stringify(
      {
        files: files.length,
        diagnostics,
        note: 'Script setup syntax and unused declarations with template references; HBuilderX remains the native type/build gate.',
      },
      null,
      2,
    ),
  );
  for (const d of diagnostics) console.error(`${d.file}:${d.line} TS${d.code} ${d.message}`);
  console.log(
    `Mobile script check: ${files.length} components/pages, ${diagnostics.length} issues`,
  );
  if (diagnostics.length) process.exitCode = 1;
}
