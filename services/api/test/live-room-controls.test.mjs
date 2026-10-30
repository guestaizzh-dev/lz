import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function harness(){
 const raw=readFileSync(new URL('../../../apps/mobile/components/NativeRtc.uvue',import.meta.url),'utf8').match(/<script setup[^>]*>([\s\S]*?)<\/script>/)[1];
 const code=ts.transpileModule(raw.replace(/\/\/ #if(?:n)?def[^\n]*|\/\/ #endif/g,'')+'\nexport {refresh,mics,micAction,startSpeaking,bind,consent,video,own};',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const commands=[],requests=[],modals=[],watchers=[],events=[],exports={},props={leaseKey:'lease',mode:'LIVE',height:780,immersive:true,controlsVisible:false,fit:'cover'},user={value:{id:'learner'}};
 let generation=1,micState='',failure=0,now=100000;class Clock extends Date{static now(){return now;}}
 const ref=value=>({value});
 const vue={ref,computed:fn=>({get value(){return fn();}}),watch:(get,fn,options)=>{watchers.push({get,fn});if(options?.immediate)fn();},onMounted(){},onUnmounted(){}};
 const bridge={bindRtc(){},rtcCommand:(_,value)=>commands.push(JSON.parse(value)),rtcState:()=>'{"state":"PLAYING","receiving":true}',closeRtc:()=>commands.push({action:'CLOSE'})};
 async function request(path,options){requests.push({path,data:options?.data});if(failure&&path.endsWith('/refresh'))throw Object.assign(new Error('连接暂时不可用'),{status:failure});if(path==='/live/mics'){
  if(options.data.action==='REQUEST')micState='WAITING';if(options.data.action==='CONNECT')micState='CONNECTED';if(options.data.action==='CANCEL')micState='';
  return{host:false,items:micState?[{id:'mic',state:micState,version:1,priority:0}]:[]};
 }return{appId:1,roomId:'room',userId:'learner',token:'token',role:'VIEWER',publishStreamId:micState==='CONNECTED'?'guest-stream':null,playStreamIds:['teacher-stream']};}
 vm.runInNewContext(code,{exports,Date:Clock,defineProps:()=>props,defineEmits:()=> (...args)=>events.push(args),uni:{showModal:options=>modals.push(options),showToast(){},openAppAuthorizeSetting(){}},require:id=>id==='vue'?vue:id.includes('academy-rtc')?bridge:id.includes('session')?{currentUser:user,sessionGeneration:()=>generation}:{request},setInterval,clearInterval});
 return{mod:exports,props,commands,requests,modals,watchers,events,fail:code=>failure=code,advance:ms=>now+=ms,invite:()=>{micState='APPROVED';},switchAccount:()=>{user.value={id:'other'};generation++;}};
}
test('immersive playback never starts capture or requests permissions while watching',async()=>{
 const h=harness();await h.mod.refresh();h.mod.bind({detail:{element:{}}});await h.mod.mics();
 assert.equal(h.mod.consent.value,false);assert.equal(h.mod.video.value,false);assert.equal(h.modals.length,0);
 assert.equal(h.commands.at(-1).publishConsent,false);assert.equal(h.commands.at(-1).canvasFit,'cover');
 assert.equal(h.requests.filter(r=>r.data?.action==='CONNECT').length,0);
});
test('opening and closing controls keeps the current playback lease and consent',async()=>{
 const h=harness();await h.mod.refresh();h.mod.bind({detail:{element:{}}});const before=h.commands.length;
 h.props.controlsVisible=true;h.props.controlsVisible=false;
 assert.equal(h.commands.length,before);assert.equal(h.commands.some(c=>c.action==='STOP'||c.action==='CLOSE'),false);
});
test('a guest invitation requires explicit confirmation and then uses the original mic flow',async()=>{
 const h=harness();await h.mod.refresh();h.mod.bind({detail:{element:{}}});h.invite();await h.mod.mics();
 h.mod.startSpeaking();await h.modals.at(-1).success({confirm:false});assert.equal(h.mod.consent.value,false);
 h.mod.startSpeaking();await h.modals.at(-1).success({confirm:true});
 assert.equal(h.mod.consent.value,true);assert.equal(h.commands.at(-1).publishConsent,true);assert.equal(h.commands.at(-1).publishStreamId,'guest-stream');
 assert.equal(h.requests.filter(r=>r.data?.action==='CONNECT').length,1);
});
test('full-frame display updates the canvas without replacing the room or granting capture',async()=>{
 const h=harness();await h.mod.refresh();h.mod.bind({detail:{element:{}}});const count=h.requests.length;
 h.props.fit='contain';h.watchers.find(w=>w.get()==='contain').fn();
 assert.equal(h.commands.at(-1).canvasFit,'contain');assert.equal(h.commands.at(-1).publishConsent,false);assert.equal(h.requests.length,count);
});
test('stale confirmation after account switching cannot activate a microphone',async()=>{
 const h=harness();await h.mod.refresh();h.mod.bind({detail:{element:{}}});h.invite();await h.mod.mics();h.mod.startSpeaking();h.switchAccount();await h.modals.at(-1).success({confirm:true});
 assert.equal(h.mod.consent.value,false);assert.equal(h.requests.some(r=>r.data?.action==='CONNECT'),false);
});

test('native viewer retains the connection during a short API outage but stops after the grace window',async()=>{
 const h=harness();await h.mod.refresh();h.mod.bind({detail:{element:{}}});h.fail(503);await h.mod.refresh();
 assert.equal(h.commands.some(c=>c.action==='STOP'),false);assert.equal(h.events.some(e=>e[0]==='error'),false);
 h.advance(61000);await h.mod.refresh();assert.equal(h.commands.at(-1).action,'STOP');assert.ok(h.events.some(e=>e[0]==='error'));
});

test('native viewer authorization revocation stops immediately without waiting for the grace window',async()=>{
 const h=harness();await h.mod.refresh();h.mod.bind({detail:{element:{}}});h.fail(403);await h.mod.refresh();
 assert.equal(h.commands.at(-1).action,'STOP');assert.equal(h.mod.consent.value,false);assert.ok(h.events.some(e=>e[0]==='error'));
});
