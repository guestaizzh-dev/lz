import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../services/api/package.json',import.meta.url));
const ts=require('typescript');
const source=readFileSync(new URL('../../apps/mobile/pages/auth/login.uvue',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const snippet=source.match(/async function send\(\) \{[\s\S]*?\n\}(?=\nwatch\(phone)/)?.[0];
assert.ok(snippet,'Login SMS handler must exist');
const js=ts.transpileModule(snippet,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
function fixture(){
 let pendingResolve,pendingReject;
 const context={phone:{value:'13012345678'},sending:{value:false},countdown:{value:0},error:{value:''},development:{value:false},challengeId:'',timer:null,active:true,request:()=>new Promise((resolve,reject)=>{pendingResolve=resolve;pendingReject=reject;}),setInterval:()=>1,clearInterval:()=>{}};
 vm.createContext(context);vm.runInContext(js,context);
 return {context,resolve:x=>pendingResolve(x),reject:x=>pendingReject(x)};
}
test('SMS response cannot attach an old phone challenge to a newly entered number',async()=>{
 const f=fixture(),pending=f.context.send();f.context.phone.value='13112345678';f.resolve({challengeId:'old',retryAfter:60,channel:'SMS'});await pending;
 assert.equal(f.context.challengeId,'');assert.equal(f.context.countdown.value,0);assert.equal(f.context.sending.value,false);
});
test('SMS failures for an old number do not overwrite the current form',async()=>{
 const f=fixture(),pending=f.context.send();f.context.phone.value='13112345678';f.reject(Error('old error'));await pending;
 assert.equal(f.context.error.value,'');assert.equal(f.context.sending.value,false);
});
test('SMS success for the current phone keeps the server challenge and cooldown',async()=>{
 const f=fixture(),pending=f.context.send();f.resolve({challengeId:'new',retryAfter:60,channel:'SMS'});await pending;
 assert.equal(f.context.challengeId,'new');assert.equal(f.context.countdown.value,60);assert.equal(f.context.sending.value,false);
});
