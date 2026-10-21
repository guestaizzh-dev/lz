import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const code=ts.transpileModule(readFileSync(new URL('../../../apps/mobile/lib/diagnostics.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
test('client reporting is private, bounded, non-recursive and never blocks the caller',()=>{
  const exports={},sent=[];let token='',offline=false,hold=false;
  vm.runInNewContext(code,{exports,Math,Date,Error,getCurrentPages:()=>[{route:'pages/live/watch'}],require:id=>id==='./session'?{accessToken:()=>token}:{apiBase:'https://example.test/api/v1'},uni:{getAppBaseInfo:()=>({appVersion:'0.3.16'}),request:options=>{if(offline)throw Error('offline');sent.push(options);if(!hold)options.complete();}}});
  exports.reportClientError('RUNTIME',new Error('secret token and phone'));assert.equal(sent.length,0);token='private-bearer';hold=true;
  exports.reportClientError('RUNTIME',new Error('secret token and phone'));exports.reportClientError('RUNTIME',new Error('duplicate'));assert.equal(sent.length,1);sent[0].complete();hold=false;
  assert.equal(sent[0].data.errorType,'Error');assert.ok(!JSON.stringify(sent[0].data).includes('secret'));assert.match(sent[0].data.fingerprint,/^[a-f0-9]{8}$/);
  offline=true;assert.doesNotThrow(()=>exports.reportClientError('RUNTIME','offline'));offline=false;
  for(let i=0;i<20;i++)exports.reportClientError('RUNTIME','test');assert.equal(sent.length,4);
});
