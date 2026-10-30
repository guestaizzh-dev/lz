import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function player(role='VIEWER',options={}){
  const elements=new Map(),handlers={},events={},messages=[],timeouts=new Map();let nextTimer=0,publishes=0,stops=0,plays=0,destroys=0,fetchStatus=200,now=100000;
  class Clock extends Date{static now(){return now;}}
  const element=id=>{
    if(!elements.has(id))elements.set(id,{hidden:true,disabled:false,textContent:'',classList:{add(){},toggle(){}},replaceChildren(){},querySelectorAll:()=>[],append(){}});
    return elements.get(id);
  };
  const credential={role,appId:1,server:'wss://test.invalid',roomId:'room',userId:'user',streamId:'host-stream',playStreamIds:[],token:'token'};
  class Engine{
    setLogConfig(){}
    on(name,callback){events[name]=callback;}
    async loginRoom(){events.roomStateChanged('room','LOGINED');return true;}
    async createZegoStream(){if(options.permissionError)throw Object.assign(new Error('Device unavailable'),{name:options.permissionError});return{playVideo(){}};}
    async startPlayingStream(){plays++;return{};}
    createRemoteStreamView(){return{on(){},play(){},playAudio(){}};}
    startPublishingStream(){publishes++;return true;}
    stopPublishingStream(){stops++;if(options.stopThrows)throw Error('Already stopped');}
    stopPlayingStream(){}
    destroyStream(){}
    logoutRoom(){}
    destroyEngine(){destroys++;}
    renewToken(){}
    mutePublishStreamAudio(){}
    mutePublishStreamVideo(){}
  }
  const parent={postMessage:message=>messages.push(message)},window={parent,top:{},self:{},addEventListener:(name,fn)=>{handlers[name]=fn;}};
  vm.runInNewContext(readFileSync(new URL('../public/live/client.js',import.meta.url),'utf8'),{
    window,location:{hash:'#'+'a'.repeat(43),pathname:'/api/v1/live/player',origin:'https://academy.test'},history:{replaceState(){}},
    document:{body:{classList:{add(){},toggle(){}}},getElementById:element,hidden:false,createElement:()=>element('guest')},
    ZegoExpressEngine:Engine,AbortController,Date:Clock,
    navigator:{mediaDevices:{enumerateDevices:async()=>[]}},
    fetch:async()=>({ok:fetchStatus===200,status:fetchStatus,json:async()=>fetchStatus===200?credential:{message:'Unavailable'}}),
    setTimeout:fn=>{timeouts.set(++nextTimer,fn);return nextTimer;},clearTimeout:id=>timeouts.delete(id),setInterval:()=>1,clearInterval(){},
  });
  const settle=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
  return{settle,events,elements,messages,timeouts,publishes:()=>publishes,stops:()=>stops,plays:()=>plays,destroys:()=>destroys,
    failFetch:code=>fetchStatus=code,advance:ms=>now+=ms,network:name=>handlers[name](),leave:()=>handlers.pagehide(),
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

test('viewer already-live stream is requested without waiting for a room ADD event',async()=>{
  const p=player();await p.settle();assert.equal(p.plays(),1);assert.notEqual(p.messages.at(-1).state,'PLAYING');
});

test('temporary verification 503 keeps the running engine; stale authorization stops it',async()=>{
  const p=player('HOST');await p.settle();p.command('start');await p.settle();p.events.publisherStateUpdate({state:'PUBLISHING'});
  p.failFetch(503);await p.events.tokenWillExpire();assert.equal(p.destroys(),0);assert.equal(p.messages.at(-1).live,true);
  p.advance(61000);await p.events.tokenWillExpire();assert.equal(p.destroys(),1);assert.equal(p.messages.at(-1).live,false);assert.equal(p.messages.at(-1).state,'ERROR');
});

test('revoked authorization immediately stops playback without reconnect retries',async()=>{
  const p=player();await p.settle();p.failFetch(403);await p.events.tokenWillExpire();assert.equal(p.destroys(),1);assert.equal(p.elements.get('retry').hidden,true);assert.equal(p.timeouts.size,0);
});

test('device permission denial, missing hardware and device contention have actionable messages',async()=>{
  for(const [name,text] of [['NotAllowedError','权限被拒绝'],['NotFoundError','未找到'],['NotReadableError','占用']]){
    const p=player('HOST',{permissionError:name});await p.settle();assert.equal(p.messages.at(-1).ready,false);assert.match(p.messages.at(-1).status,new RegExp(text));assert.equal(p.publishes(),0);
  }
});

test('cleanup destroys the engine even when a device stop throws; no publish survives leaving',async()=>{
  const p=player('HOST',{stopThrows:true});await p.settle();p.leave();await p.settle();assert.equal(p.destroys(),1);assert.equal(p.messages.at(-1).ready,false);
});

test('reconnect does not claim playing until SDK confirms and offline is visible',async()=>{
  const p=player();await p.settle();p.events.playerStateUpdate({streamID:'host-stream',state:'PLAYING'});p.network('offline');assert.equal(p.messages.at(-1).playing,false);assert.equal(p.messages.at(-1).state,'CONNECTING');
  p.events.roomStateChanged('room','RECONNECTED');await p.settle();assert.notEqual(p.messages.at(-1).state,'PLAYING');
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
