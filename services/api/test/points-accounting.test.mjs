import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Database} from '../dist/database.js';
import {createApp} from '../dist/main.js';
import {changePoints,pointsDay} from '../dist/points-accounting.js';
import {ForumService} from '../dist/forum.js';
import {ProgressionController} from '../dist/progression.js';
if(!new URL(process.env.DATABASE_URL).pathname.startsWith('/academy_test_'))throw Error('Use isolated test/run-tests.mjs');

test('points reversals preserve balance, debt, daily source and confirmed fulfilment',async t=>{
 const db=new Database(),app=await createApp(false);await app.init();
 const user=await db.user.create({data:{nickname:'冲回核对'+randomUUID()}}),other=await db.user.create({data:{nickname:'其他学员'}}),actor=await db.user.create({data:{nickname:'审核人员',roles:['ADMIN']}}),forum=app.get(ForumService);
 const change=(delta,key,source={})=>db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "User" WHERE id=${user.id} FOR UPDATE`;return changePoints(tx,user.id,delta,key,'测试积分来源',{ruleSnapshot:{},...source});});
 const balance=()=>db.pointsAccount.findUniqueOrThrow({where:{userId:user.id}});
 let original;
 try{
 await t.test('same event concurrent retry posts once, payload or account reuse is rejected',async()=>{
  const key=randomUUID(),rows=await Promise.all([change(10n,key),change(10n,key)]);original=rows[0];assert.equal(rows[0].id,rows[1].id);assert.equal((await balance()).balance,10n);
  await assert.rejects(()=>change(11n,key));await assert.rejects(()=>db.$transaction(tx=>changePoints(tx,other.id,10n,key,'跨账户',{ruleSnapshot:{}})));
 });
 await t.test('spent rewards reverse into debt without changing history or inventing negative cash',async()=>{
  await change(-8n,randomUUID());const reversal=await change(-10n,randomUUID(),{reversalOfId:original.id});assert.equal(reversal.delta,-2n);assert.equal(reversal.debtDelta,8n);assert.equal((await balance()).debt,8n);assert.equal((await balance()).balance,0n);
  await assert.rejects(()=>change(-10n,randomUUID(),{reversalOfId:original.id}));assert.equal((await db.pointsLedger.findUniqueOrThrow({where:{id:original.id}})).delta,10n);
 });
 await t.test('new rewards and refunded points repay debt before becoming spendable',async()=>{
  const first=await change(3n,randomUUID());assert.equal(first.delta,0n);assert.equal(first.debtDelta,-3n);assert.equal((await balance()).debt,5n);
  await Promise.all([change(4n,randomUUID()),change(4n,randomUUID())]);assert.equal((await balance()).balance,3n);assert.equal((await balance()).debt,0n);
  const totals=await db.pointsLedger.aggregate({where:{accountId:(await balance()).id},_sum:{delta:true,debtDelta:true}});assert.equal(totals._sum.delta,(await balance()).balance);assert.equal(totals._sum.debtDelta,(await balance()).debt);
 });
 await t.test('frozen balance is protected and failed transactions leave no ledger or debt',async()=>{
  await db.pointsAccount.update({where:{userId:user.id},data:{reserved:2n}});await change(-5n,randomUUID());assert.equal((await balance()).balance,2n);assert.equal((await balance()).reserved,2n);assert.equal((await balance()).debt,4n);
  const before=await balance(),key=randomUUID();await assert.rejects(()=>db.$transaction(async tx=>{await changePoints(tx,user.id,8n,key,'回滚核对',{ruleSnapshot:{}});throw Error('rollback');}));assert.deepEqual(await balance(),before);assert.equal(await db.pointsLedger.count({where:{eventKey:key}}),0);
  const summary=await app.get(ProgressionController).summary({actor:user});assert.equal(summary.available,'0');assert.equal(summary.reserved,'2');assert.equal(summary.debt,'4');
  await db.pointsAccount.update({where:{userId:user.id},data:{reserved:0n}});await change(1n,randomUUID());assert.equal((await balance()).balance,0n);assert.equal((await balance()).debt,1n);await change(1n,randomUUID());assert.equal((await balance()).debt,0n);
 });
 const section=await db.forumSection.findUniqueOrThrow({where:{code:'01-classics'}}),author=await db.user.create({data:{nickname:'投稿者'+randomUUID()}}),threads=[];
 const submit=async()=>{const row=await forum.create(author.id,{requestKey:randomUUID(),sectionId:section.id,title:'研习心得测试',body:'以日常生活中的实践体会经典，独立自动验证投稿。',assetIds:[],tags:[]});threads.push(row.id);await forum.moderation(row.id,{actor},{expectedVersion:row.version,action:'APPROVE',reason:'审核内容有效'});return db.forumThread.findUniqueOrThrow({where:{id:row.id}});};
 await t.test('daily points reward belongs only to its original approved thread',async()=>{
  const first=await submit(),second=await submit();await forum.withdraw(second.id,author.id,{expectedVersion:second.version});assert.equal((await db.pointsAccount.findUniqueOrThrow({where:{userId:author.id}})).balance,3n);
  assert.equal((await db.growthLedger.aggregate({where:{userId:author.id},_sum:{delta:true}}))._sum.delta,5);
  await db.$transaction(tx=>changePoints(tx,author.id,-3n,randomUUID(),'测试已兑换',{ruleSnapshot:{}}));await forum.moderation(first.id,{actor},{expectedVersion:first.version,action:'HIDE',reason:'核对撤回奖励'});
  const account=await db.pointsAccount.findUniqueOrThrow({where:{userId:author.id}});assert.equal(account.balance,0n);assert.equal(account.debt,3n);assert.equal((await db.growthLedger.aggregate({where:{userId:author.id},_sum:{delta:true}}))._sum.delta,0);
 });
 await t.test('restore then review does not reissue withdrawn rewards or replenish the daily allowance',async()=>{
  let row=await db.forumThread.findUniqueOrThrow({where:{id:threads[0]}});await forum.moderation(row.id,{actor},{expectedVersion:row.version,action:'RESTORE',reason:'恢复后重新审核'});row=await db.forumThread.findUniqueOrThrow({where:{id:row.id}});await forum.moderation(row.id,{actor},{expectedVersion:row.version,action:'APPROVE',reason:'重新审核通过'});
  await submit();const account=await db.pointsAccount.findUniqueOrThrow({where:{userId:author.id}});assert.equal(account.balance,0n);assert.equal(account.debt,3n);assert.equal(await db.pointsLedger.count({where:{accountId:account.id,eventKey:{startsWith:'forum.daily:'}}}),1);
  const rows=await app.get(ProgressionController).points({actor:author},{page:1,size:20});assert.ok(rows.items.some(r=>r.delta==='-3'&&r.debtChange==='3'&&r.debtAfter==='3'));
 });
 }finally{await app.close();await db.$disconnect();}
});
