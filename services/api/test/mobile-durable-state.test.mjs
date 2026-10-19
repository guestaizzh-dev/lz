import test from 'node:test';
import assert from 'node:assert/strict';
import {createSessionState} from '../../../apps/mobile/lib/session-state.ts';
import {createStudyQueue} from '../../../apps/mobile/lib/study-queue-state.ts';

function storage(){const data=new Map();return {data,failWrite:false,failRemove:false,read(key){return data.get(key)??null;},write(key,value){if(this.failWrite)throw Error('disk unavailable');data.set(key,value);},remove(key){if(this.failRemove)throw Error('disk unavailable');data.delete(key);}};}
const session=id=>({user:{id,nickname:id,avatar:null,tags:[],roles:['USER']},accessToken:'access-'+id,refreshToken:id.padEnd(43,'x'),expiresIn:900});
test('secure session survives restart and rotation; logout tombstone survives deletion failure',()=>{
  const store=storage();let loggedOut=false,published=null;const marker={read:()=>loggedOut,write:value=>{loggedOut=value;}};
  const state=()=>createSessionState(store,marker,user=>published=user);
  const a=state();a.restore();assert.equal(published,null);a.save(session('a'));const generation=a.generation();
  const rotation=a.rotation(()=> 'request-one');assert.equal(a.rotation(()=> 'different'),rotation);
  const b=state();b.restore();assert.equal(b.user().id,'a');assert.equal(b.rotation(()=> 'different'),rotation);
  a.save({...session('a'),accessToken:'rotated'},true);assert.equal(a.generation(),generation);
  assert.equal(a.rotation(()=> 'next'),'next');
  store.failRemove=true;assert.throws(()=>a.clear());assert.equal(a.user(),null);assert.ok(a.generation()>generation);
  const c=state();c.restore();assert.equal(c.user(),null);assert.ok(loggedOut);
  store.failRemove=false;c.save(session('b'));const d=state();d.restore();assert.equal(d.user().id,'b');
});
test('failed secure commit never publishes new credentials; corrupt records are not silently overwritten',()=>{
  const store=storage();let marker=false,published=null;const state=createSessionState(store,{read:()=>marker,write:value=>{marker=value;}},user=>published=user);
  store.failWrite=true;assert.throws(()=>state.save(session('a')));assert.equal(state.access(),'');assert.equal(published,null);assert.ok(marker);
  store.failWrite=false;marker=false;store.write('session','broken');assert.throws(()=>state.restore());assert.equal(store.read('session'),'broken');
});
const scope=(userId='a',lessonId='lesson',cohortId='')=>({userId,lessonId,cohortId,courseId:'course',releaseId:'release'});
const payload=id=>({eventId:id,positionSeconds:15,elapsedSeconds:15,completed:false,recordedAt:'2026-10-15T01:00:00.000Z',releaseId:'release'});
const progress={positionSeconds:15,watchedSeconds:15,completedAt:null};
test('durable queue survives process restart and lost acknowledgement with identical IDs and payloads',async()=>{
  const store=storage(),actor=()=>({id:'a',generation:1});let now=0,calls=[],notify=[];
  const first=createStudyQueue(store,actor,async event=>{calls.push(structuredClone(event.data));throw Error('response lost');},()=>{},()=>now);
  first.enqueue(scope(),payload('one'));await first.drain();assert.equal(first.status().pending,1);
  now=100000;
  const restored=createStudyQueue(store,actor,async event=>{calls.push(structuredClone(event.data));return progress;},(event,result)=>notify.push({event,result}),()=>now);
  await restored.drain();assert.equal(restored.status().pending,0);assert.deepEqual(calls[0],calls[1]);assert.equal(notify[0].result,progress);
});
test('queue never submits another account or acknowledges an old session into the active screen',async()=>{
  const store=storage();let current={id:'a',generation:1},resolve,acks=0,sent=[];
  const queue=createStudyQueue(store,()=>current,event=>{sent.push(event.userId);return new Promise(r=>resolve=r);},event=>{if(event)acks++;});
  queue.enqueue(scope(),payload('one'));queue.enqueue(scope(),payload('two'));
  const running=queue.drain();current={id:'b',generation:2};resolve(progress);await running;
  assert.deepEqual(sent,['a']);assert.equal(acks,0);assert.equal(queue.status().pending,0);
  current={id:'a',generation:3};assert.equal(queue.status().pending,1);
  assert.throws(()=>queue.enqueue(scope('b'),payload('wrong')));
  const resumed=queue.drain();current={id:'a',generation:4};resolve(progress);await resumed;assert.equal(acks,0);
});
test('terminal permission failure is retained; other chapters continue; explicit retry rechecks authority',async()=>{
  const store=storage();let allowed=false,sent=[];
  const queue=createStudyQueue(store,()=>({id:'a',generation:1}),async event=>{sent.push([event.lessonId,event.cohortId]);if(event.lessonId==='locked'&&!allowed)throw Object.assign(Error('permission changed'),{status:403});return progress;},()=>{});
  queue.enqueue(scope('a','locked','cohort-one'),payload('one'));queue.enqueue(scope('a','open','cohort-two'),payload('two'));
  await queue.drain();assert.deepEqual(sent,[['locked','cohort-one'],['open','cohort-two']]);assert.equal(queue.status().blocked,1);
  await queue.drain();assert.equal(sent.length,2);allowed=true;queue.retry();await queue.drain();assert.equal(queue.status().pending,0);
});
test('failed durable enqueue and failed acknowledgement never silently discard progress',async()=>{
  const store=storage();let calls=0;
  const queue=createStudyQueue(store,()=>({id:'a',generation:1}),async()=>{calls++;store.failRemove=true;return progress;},()=>{});
  store.failWrite=true;assert.throws(()=>queue.enqueue(scope(),payload('one')));store.failWrite=false;
  queue.enqueue(scope(),payload('one'));await queue.drain();assert.equal(queue.status().pending,1);assert.equal(calls,1);
  store.failRemove=false;queue.removeUser('a');assert.equal(queue.status().pending,0);
});
test('local resume stays within course release and cohort; completion remains visible until acknowledged',()=>{
  const store=storage(),queue=createStudyQueue(store,()=>({id:'a',generation:1}),async()=>progress,()=>{});
  queue.enqueue(scope(),{...payload('one'),completed:true});queue.enqueue(scope(),{...payload('two'),positionSeconds:20});
  assert.equal(queue.latest(scope()).positionSeconds,20);assert.equal(queue.latest(scope()).completed,true);
  assert.equal(queue.latest(scope('a','lesson','another-cohort')),null);assert.equal(queue.latest({...scope(),releaseId:'another-release'}),null);
});
test('account deletion during a request cannot resurrect the private queue',async()=>{
  const store=storage();let resolve;const queue=createStudyQueue(store,()=>({id:'a',generation:1}),()=>new Promise(r=>resolve=r),()=>{});
  queue.enqueue(scope(),payload('one'));const running=queue.drain();queue.removeUser('a');resolve(progress);await running;assert.equal(queue.status().pending,0);assert.equal(store.read('study-queue.v1|a'),null);
});
