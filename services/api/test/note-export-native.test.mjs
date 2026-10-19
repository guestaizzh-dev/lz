import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const root=new URL('../../../apps/mobile/lib/',import.meta.url);
function nativeSource(name){let include=true;return readFileSync(new URL(name,root),'utf8').split('\n').filter(line=>{const platform=line.match(/\/\/ #ifdef (\w+)/)?.[1];if(platform){include=platform==='APP';return false;}if(line.includes('// #endif')){include=true;return false;}return include;}).join('\n');}
function harness(){
  const files=new Map(),currentUser={value:{id:'a'.repeat(8)+'-aaaa-aaaa-aaaa-'+'a'.repeat(12)}},result={filename:'daoxue-notes-20261015123456.md',markdown:'私人笔记😀',counts:{notes:1,favorites:0}};
  let generation=1,shareCallback,writeCallback,writeFail=false,deferWrite=false;const shares=[];
  const fs={mkdirSync(){},readdirSync(folder){return [...files.keys()].filter(p=>p.startsWith(folder+'/')).map(p=>p.slice(folder.length+1));},unlinkSync(path){files.delete(path);},writeFile(options){writeCallback=()=>{if(writeFail)options.fail();else{files.set(options.filePath,options.data);options.success();}};if(!deferWrite)writeCallback();}};
  const uni={env:{CACHE_PATH:'unifile://cache'},getFileSystemManager:()=>fs,shareWithSystem:options=>{shareCallback=options;shares.push(options);}};
  const session={currentUser,sessionGeneration:()=>generation},modules={};
  const load=(name)=>{const exports={};const source=ts.transpileModule(nativeSource(name),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(source,{exports,uni,require:id=>id==='./api'?{request:async()=>result}:id==='./session'?session:modules[id],console});return exports;};
  modules['./note-export-files']=load('note-export-files.ts');const exporter=load('note-export.ts');
  return{files,result,shares,exporter,currentUser,finish:kind=>kind==='success'?shareCallback.success():shareCallback.fail({errCode:kind}),switchUser:()=>{currentUser.value={id:'b'.repeat(8)+'-bbbb-bbbb-bbbb-'+'b'.repeat(12)};generation++;},failWrite:()=>writeFail=true,deferWrite:()=>deferWrite=true,write:()=>writeCallback(),cleanup:()=>modules['./note-export-files'].clearNoteExportFiles(currentUser.value.id)};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('native export writes UTF-8 to a managed per-user file and waits for the system callback',async()=>{
  const h=harness();let done=false;const pending=h.exporter.exportNotes().then(result=>{done=true;return result;});await tick();assert.equal(done,false);assert.equal(h.shares.length,1);assert.equal(h.shares[0].type,'file');const path=h.shares[0].filePaths[0];assert.equal(h.files.get(path),'私人笔记😀');assert.match(path,/academy-notes-a{8}-aaaa-aaaa-aaaa-a{12}\/daoxue-notes-\d{14}-[a-z0-9]+\.md$/);h.finish('success');assert.equal((await pending).state,'shared');h.cleanup();assert.equal(h.files.size,0);
});
test('system cancellation is distinct from failure; both remove the private staging file',async()=>{
  for(const code of [1310600,1310602]){const h=harness(),pending=h.exporter.exportNotes();const rejected=code===1310600?null:assert.rejects(pending,/无法打开系统文件分享/);await tick();h.finish(code);if(rejected)await rejected;else assert.equal((await pending).state,'cancelled');assert.equal(h.files.size,0);}
});
test('disk failure and account change while writing never open another account’s share',async()=>{
  const disk=harness();disk.failWrite();await assert.rejects(disk.exporter.exportNotes(),/存储空间/);assert.equal(disk.shares.length,0);
  const h=harness();h.deferWrite();const pending=h.exporter.exportNotes(),rejected=assert.rejects(pending,/账号已变化/);await tick();h.switchUser();h.write();await rejected;assert.equal(h.shares.length,0);assert.equal(h.files.size,0);
});
test('bad server filenames cannot escape the export directory and empty ranges do not produce a fake file',async()=>{
  const h=harness();h.result.filename='../private.md';await assert.rejects(h.exporter.exportNotes(),/导出文件无效/);assert.equal(h.files.size,0);const empty=harness();empty.result.counts={notes:0,favorites:0};assert.equal((await empty.exporter.exportNotes()).state,'empty');assert.equal(empty.shares.length,0);
});
