import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveChatService} from '../dist/live-chat.js';
import {routePermission} from '../dist/admin-permissions.js';

function setup({state='LIVE',allowed=true,prior=null,count=0}={}){
 const calls=[],row={id:'session',roomId:'room',hostUserId:'host',state},req={actor:{id:'host',roles:['TEACHER']},authSessionId:'auth'},tx={
  $queryRaw:async()=>[],comment:{findUnique:async()=>prior,count:async()=>count,create:async({data})=>{calls.push(data);return{id:'new',...data};}},auditLog:{create:async({data})=>calls.push(data)},
 };
 const db={$transaction:async fn=>fn(tx)},live={session:async()=>row,hostAllowed:async(_,user)=>{if(!allowed||user!=='host')throw Error('仅本场授权主播可以开播');}},service=new LiveChatService(db,live,{},{});
 return{service,req,calls,row};
}
test('host classroom routes use teaching capabilities, mic management still requires its bound lease',()=>{
 assert.equal(routePermission('GET','/api/v1/admin/live-host/session/messages'),'teaching.read');
 assert.equal(routePermission('POST','/api/v1/admin/live-host/session/messages'),'teaching.write');
 assert.equal(routePermission('POST','/api/v1/admin/live/mics'),'teaching.write');
 assert.equal(routePermission('POST','/api/v1/admin/live/sessions/session/messages/message/review'),'live.review');
});
test('host message is approved only after ownership check and audited in the same transaction',async()=>{
 const h=setup();const r=await h.service.hostSend('session',h.req,{body:'  欢迎共读  ',requestKey:'key'});
 assert.equal(r.reviewState,'APPROVED');assert.equal(h.calls[0].body,'欢迎共读');assert.equal(h.calls[0].authorId,'host');assert.equal(h.calls[1].action,'live.host.message');
});
test('another teacher cannot read classroom messages or impersonate the host',async()=>{
 const h=setup({allowed:false});await assert.rejects(h.service.hostMessages('session',h.req,{size:50}),/仅本场/);await assert.rejects(h.service.hostSend('session',h.req,{body:'hello',requestKey:'key'}),/仅本场/);assert.equal(h.calls.length,0);
});
test('ended or preparing sessions cannot publish new host messages',async()=>{
 for(const state of ['ENDED','PREPARING','CANCELLED']){const h=setup({state});await assert.rejects(h.service.hostSend('session',h.req,{body:'hello',requestKey:'key'}),/不能发言/);assert.equal(h.calls.length,0);}
});
test('host retries return the original receipt and conflicting retry bodies are rejected',async()=>{
 const h=setup({prior:{id:'old',body:'欢迎',reviewState:'APPROVED'}});assert.equal((await h.service.hostSend('session',h.req,{body:'欢迎',requestKey:'key'})).id,'old');assert.equal(h.calls.length,0);await assert.rejects(h.service.hostSend('session',h.req,{body:'不同内容',requestKey:'key'}),/其他发言/);
});
test('host flood and unsupported partial citations do not write a message',async()=>{
 const h=setup({count:12});await assert.rejects(h.service.hostSend('session',h.req,{body:'hi',requestKey:'key'}),/频繁/);await assert.rejects(h.service.hostSend('session',h.req,{body:'hi',requestKey:'key',articleId:'article'}),/直接输入/);assert.equal(h.calls.length,0);
});
