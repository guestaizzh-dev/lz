import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function player(role='VIEWER'){
  const elements=new Map(),handlers={},events={},messages=[],timeouts=new Map();let nextTimer=0,publishes=0,stops=0;
  const element=id=>{
    if(!elements.has(id))elements.set(id,{hidden:true,disabled:false,textContent:'',classList:{add(){},toggle(){}},replaceChildren(){},querySelectorAll:()=>[],append(){}});
    return elements.get(id);
  };
  const credential={role,appId:1,server:'wss://test.invalid',roomId:'room',userId:'user',streamId:'host-stream',playStreamIds:[],token:'token'};
  class Engine{
    setLogConfig(){}
    on(name,callback){events[name]=callback;}
    async loginRoom(){events.roomStateChanged('room','LOGINED');return true;}
    async createZegoStream(){return{playVideo(){}};}
    async startPlayingStream(){return{};}
    createRemoteStreamView(){return{on(){},play(){},playAudio(){}};}
    startPublishingStream(){publishes++;return true;}
    stopPublishingStream(){stops++;}
    stopPlayingStream(){}
    destroyStream(){}
    logoutRoom(){}
    destroyEngine(){}
    renewToken(){}
    mutePublishStreamAudio(){}
    mutePublishStreamVideo(){}
  }
  const parent={postMessage:message=>messages.push(message)},window={parent,top:{},self:{},addEventListener:(name,fn)=>{handlers[name]=fn;}};
  vm.runInNewContext(readFileSync(new URL('../public/live/client.js',import.meta.url),'utf8'),{
    window,location:{hash:'#'+'a'.repeat(43),pathname:'/api/v1/live/player',origin:'https://academy.test'},history:{replaceState(){}},
    document:{body:{classList:{add(){},toggle(){}}},getElementById:element,hidden:false,createElement:()=>element('guest')},
    ZegoExpressEngine:Engine,AbortController,
    fetch:async()=>({ok:true,json:async()=>credential}),
    setTimeout:fn=>{timeouts.set(++nextTimer,fn);return nextTimer;},clearTimeout:id=>timeouts.delete(id),setInterval:()=>1,clearInterval(){},
  });
  const settle=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
  return{settle,events,elements,messages,timeouts,publishes:()=>publishes,stops:()=>stops,
    command:(action,origin='https://academy.test',source=parent)=>handlers.message({origin,source,data:{type:'studio',action}})};
}

test('viewer reports waiting until SDK confirms playback, and reconnecting is not shown as live',async()=>{
  const p=player();await p.settle();assert.equal(p.messages.at(-1).state,'CONNECTED');
  p.events.roomStreamUpdate('room','ADD',[{streamID:'host-stream'}]);await p.settle();
  assert.notEqual(p.messages.at(-1).state,'PLAYING');
  p.events.playerStateUpdate({streamID:'host-stream',state:'PLAYING'});
  assert.equal(p.messages.at(-1).state,'PLAYING');
  p.events.roomStateChanged('room','RECONNECTING');assert.equal(p.messages.at(-1).state,'CONNECTING');
  p.events.playerStateUpdate({streamID:'host-stream',state:'NO_PLAY',errorCode:1});assert.equal(p.messages.at(-1).state,'ERROR');
});

test('host repeated start gestures publish once and SDK acknowledgement clears pending state',async()=>{
  const p=player('HOST');await p.settle();assert.equal(p.messages.at(-1).ready,true);
  p.command('start');p.command('start');await p.settle();assert.equal(p.publishes(),1);assert.equal(p.messages.at(-1).starting,true);
  p.events.publisherStateUpdate({state:'PUBLISHING'});assert.equal(p.messages.at(-1).live,true);assert.equal(p.messages.at(-1).starting,false);
});

test('host start timeout stops the attempt and permits a deliberate retry',async()=>{
  const p=player('HOST');await p.settle();p.command('start');await p.settle();
  assert.equal(p.timeouts.size,1);for(const callback of [...p.timeouts.values()])callback();
  assert.equal(p.stops(),1);assert.equal(p.messages.at(-1).starting,false);assert.equal(p.messages.at(-1).state,'ERROR');
  p.command('start');await p.settle();assert.equal(p.publishes(),2);
});

test('only the parent can control a player and cross-origin parents cannot start publishing',async()=>{
  const p=player('HOST');await p.settle();p.command('start','https://other.test');p.command('start','https://academy.test',{});await p.settle();
  assert.equal(p.publishes(),0);const count=p.messages.length;p.command('state','https://other.test');assert.equal(p.messages.length,count+1);
});
