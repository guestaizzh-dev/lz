import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
// Supply the manifest from an isolated fixture database; mutations must not use the hand-test database.
const fixture=process.argv[2];
assert(fixture?.includes('browser-test'),'Supply an isolated browser-test manifest');
const manifest=JSON.parse(await readFile(resolve(fixture),'utf8'));
const root=new URL('../../',import.meta.url);
const entry=(await readdir(new URL('apps/mobile/unpackage/dist/build/web/assets/',root))).find(name=>/^index-.*\.js$/.test(name));
assert(entry,'Build the App Web preview first');
let script=await readFile(new URL('app-workflows.cjs',import.meta.url),'utf8');
script=script.replaceAll('__WEB_ENTRY__',entry);
script=script.replace(/__FIXTURE_(.+?)__/g,(_,key)=>{assert(manifest.steps[key]?.id,'Missing fixture '+key);return manifest.steps[key].id;});
assert(!script.includes('__FIXTURE_'),'Unresolved fixtures');
await mkdir(new URL('.runtime/',root),{recursive:true});
await writeFile(new URL('.runtime/app-workflows-generated.cjs',root),script);
console.log('Ready: .runtime/app-workflows-generated.cjs');
