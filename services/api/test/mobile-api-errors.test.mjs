import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source=readFileSync(new URL('../../../apps/mobile/lib/api.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function client(status,message){
  const exports={};
  vm.runInNewContext(compiled,{exports,console,require:id=>{
    if(id==='./diagnostics')return{reportClientError:()=>{}};
    if(id==='./environment')return{apiBase:'https://example.com/api/v1',apiEnvironment:'production'};
    if(id==='./session')return{sessionGeneration:()=>0,accessToken:()=>null,refreshToken:()=>null};
    if(id==='./learning')return{studyEventId:()=>''};
    throw Error('Unexpected dependency: '+id);
  },uni:{request:options=>options.success({statusCode:status,data:{message}})}});
  return exports;
}
for(const [title,status,message,path,expected] of [
  ['SMS disabled is actionable',503,'短信登录尚未开通，请联系书院','/auth/sms','短信登录尚未开通，请联系书院'],
  ['SMS delivery failure is actionable',503,'短信服务暂不可用，请稍后再试','/auth/sms','短信服务暂不可用，请稍后再试'],
  ['preview account unavailable is actionable',503,'预览测试账号不可用','/auth/sms','预览测试账号不可用'],
  ['unrecognized service errors remain private',503,'private upstream credential detail','/auth/sms','服务暂时繁忙，请稍后重试'],
  ['internal SMS failures remain private',500,'private database query','/auth/sms','服务暂时繁忙，请稍后重试'],
  ['other services do not inherit the SMS exception',503,'短信登录尚未开通，请联系书院','/catalog/home','服务暂时繁忙，请稍后重试'],
  ['object error payload cannot hang the request',400,{internal:'unexpected'},'/catalog/home','操作暂时无法完成'],
  ['numeric error payload is safe',400,42,'/catalog/home','操作暂时无法完成'],
  ['empty validation errors have a fallback',400,[], '/catalog/home','操作暂时无法完成'],
  ['rate limit feedback is preserved',429,'请求频繁，请稍后重试','/auth/sms','请求频繁，请稍后重试'],
])test(title,async()=>{
  await assert.rejects(client(status,message).request(path,{method:'POST',data:{phone:'19900001002'}}),error=>error.message===expected&&error.status===status);
});
