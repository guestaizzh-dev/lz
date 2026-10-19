import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function client(platform='android'){
  const flags={'WEB':platform==='web','APP':platform!=='web','APP-IOS':platform==='ios'},stack=[true];
  const source=readFileSync(new URL('../../../apps/mobile/lib/social-login.ts',import.meta.url),'utf8').split('\n').filter(line=>{const directive=line.match(/\/\/ #(ifdef|ifndef) (.+)/);if(directive){const matches=directive[2].trim().split(/\s*\|\|\s*/).some(flag=>flags[flag]);stack.push(stack.at(-1)&&(directive[1]==='ifdef'?matches:!matches));return false;}if(line.includes('// #endif')){stack.pop();return false;}return stack.at(-1);}).join('\n');
  let generation=1,installed=['weixin','apple'],enabled=['WECHAT','APPLE'],sdkResult={code:'wechat-code',appleInfo:{authorizationCode:'apple-code',identityToken:'untrusted-token',user:'untrusted-subject'}},error=null,switchAccount=false;const calls=[];
  const request=async(path,options)=>{calls.push({path,options});if(path.endsWith('/providers'))return{items:['WECHAT','APPLE'].map(provider=>({provider,enabled:enabled.includes(provider)}))};if(path.endsWith('/challenge'))return{ticketId:'ticket',state:'one-time-state',expiresAt:'2026-12-31T00:00:00Z'};return{requiresPhone:true,ticketId:'ticket'};};
  const uni={getProvider:o=>o.success({providers:installed.map(id=>({id}))}),login:o=>{if(error)o.fail(error);else{if(switchAccount)generation++;o.success(sdkResult);}}};
  const exports={};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,uni,require:id=>id==='./api'?{request}:{sessionGeneration:()=>generation}});
  return{exports,calls,setInstalled:items=>{installed=items;},setEnabled:items=>{enabled=items;},setError:value=>{error=value;},setResult:value=>{sdkResult=value;},switchAccount:()=>{switchAccount=true;}};
}
test('native login entry requires both configured and installed providers; iOS requires Apple alongside WeChat',async()=>{
  const android=client();assert.deepEqual(Array.from(await android.exports.availableSocialProviders()),['WECHAT','APPLE']);android.setInstalled(['weixin']);assert.deepEqual(Array.from(await android.exports.availableSocialProviders()),['WECHAT']);android.setEnabled([]);assert.equal((await android.exports.availableSocialProviders()).length,0);
  const ios=client('ios');ios.setInstalled(['weixin']);assert.equal((await ios.exports.availableSocialProviders()).length,0);const web=client('web');assert.equal((await web.exports.availableSocialProviders()).length,0);assert.equal(web.calls.length,0);
});
test('native login sends only a fresh provider code and its own challenge; binding uses the authenticated route',async()=>{
  const h=client();await h.exports.authorizeSocial('WECHAT');assert.equal(h.calls.at(-1).options.data.authorizationCode,'wechat-code');assert.deepEqual(Object.keys(h.calls.at(-1).options.data).sort(),['authorizationCode','state','ticketId']);
  await h.exports.authorizeSocial('APPLE',true);assert.equal(h.calls.at(-1).path,'/me/identities/authorize');assert.equal(h.calls.at(-1).options.data.authorizationCode,'apple-code');assert.ok(!JSON.stringify(h.calls).includes('untrusted-subject'));
});
test('native authorization cancellation, missing code and account changes never continue into server login',async()=>{
  const cancelled=client();cancelled.setError({errCode:1310509});await assert.rejects(cancelled.exports.authorizeSocial('WECHAT'),/已取消/);assert.equal(cancelled.calls.length,1);
  const missing=client();missing.setResult({code:''});await assert.rejects(missing.exports.authorizeSocial('WECHAT'),/未获取/);assert.equal(missing.calls.length,1);
  const switched=client();switched.switchAccount();await assert.rejects(switched.exports.authorizeSocial('WECHAT'),/账号已变化/);assert.equal(switched.calls.length,1);
});
