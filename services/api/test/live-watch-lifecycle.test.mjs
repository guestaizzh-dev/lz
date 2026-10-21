import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source=readFileSync(new URL('../../../apps/mobile/pages/live/watch.uvue',import.meta.url),'utf8').split('<script setup lang="ts">')[1].split('</script>')[0].replace(/^import[^\n]*\n/gm,'');
function screen(request){
  const hooks={},context={console,Math,Date,Promise,ref:value=>({value}),computed:fn=>({get value(){return fn();}}),request,apiBase:'https://example.test/api/v1',assetUrl:v=>v??'',currentUser:{value:{id:'student'}},sessionGeneration:()=>1,needLogin:()=>false,viewWidth:()=>390,studySync:{value:{pending:0}},recordStudy:()=>{},syncStudy:async()=>{},localStudy:()=>null,
    setInterval:()=>1,clearInterval:()=>{},setTimeout:()=>1,clearTimeout:()=>{},uni:{getWindowInfo:()=>({windowHeight:844}),setNavigationBarColor:()=>{}},
    onBackPress:()=>{},onResize:()=>{},onLoad:fn=>hooks.load=fn,onShow:fn=>hooks.show=fn,onHide:fn=>hooks.hide=fn,onUnload:fn=>hooks.unload=fn};
  vm.runInNewContext(ts.transpileModule(source+'\nglobalThis.screen={source,loading,id,roomId,key,load};',{compilerOptions:{module:ts.ModuleKind.None,target:ts.ScriptTarget.ES2022}}).outputText,context);
  return {hooks,state:context.screen};
}
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
test('hide invalidates immediately and returning during an in-flight room load reconnects',async()=>{
  let resolveOld,rooms=0,joins=0;const room={sessions:[{id:'session',title:'测试直播',state:'LIVE'}]};
  const {hooks,state}=screen(async path=>{if(path.includes('/rooms/')){rooms++;if(rooms===1)return new Promise(r=>resolveOld=r);return room;}if(path.endsWith('/join')){joins++;return{key:'new-lease',playerPath:'/player'};}return{};});
  hooks.load({id:'session',roomId:'room'});await flush();assert.equal(rooms,1);
  hooks.hide();hooks.show();resolveOld(room);await flush();
  assert.equal(rooms,2);assert.equal(joins,1);assert.equal(state.source.value,'https://example.test/api/v1/player');assert.equal(state.loading.value,false);
  hooks.unload();assert.equal(state.source.value,'');assert.equal(state.key.value,'');await flush();
});
test('a completed old request never rejoins an unloaded screen',async()=>{
  let resolveOld,joins=0;const {hooks,state}=screen(path=>path.includes('/rooms/')?new Promise(r=>resolveOld=r):(joins++,Promise.resolve({})));
  hooks.load({id:'session',roomId:'room'});await flush();hooks.unload();resolveOld({sessions:[]});await flush();assert.equal(joins,0);assert.equal(state.source.value,'');
});

test('reconnecting waits for old lease exit before joining a new RTC lease',async()=>{
  let leaveDone,rooms=0,joins=0;
  const {state}=screen(path=>{if(path.endsWith('/leave'))return new Promise(r=>leaveDone=r);if(path.includes('/rooms/')){rooms++;return Promise.resolve({sessions:[{id:'session',state:'LIVE'}]});}if(path.endsWith('/join')){joins++;return Promise.resolve({key:'new',playerPath:'/player'});}return Promise.resolve({});});
  state.id.value='session';state.roomId.value='room';state.key.value='old';state.source.value='old-source';const reconnect=state.load();await flush();assert.equal(state.source.value,'');assert.equal(rooms,0);assert.equal(joins,0);leaveDone({});await reconnect;assert.equal(joins,1);assert.equal(state.key.value,'new');
});

test('fast foreground return also waits for the lease exit started by hide',async()=>{
  let leaveDone,joins=0;
  const {hooks,state}=screen(path=>{if(path.endsWith('/leave'))return new Promise(r=>leaveDone=r);if(path.includes('/rooms/'))return Promise.resolve({sessions:[{id:'session',state:'LIVE'}]});if(path.endsWith('/join')){joins++;return Promise.resolve({key:'new',playerPath:'/player'});}return Promise.resolve({});});
  state.id.value='session';state.roomId.value='room';state.key.value='old';state.source.value='old-source';hooks.hide();hooks.show();await flush();assert.equal(joins,0);leaveDone({});await flush();assert.equal(joins,1);assert.equal(state.key.value,'new');
});
