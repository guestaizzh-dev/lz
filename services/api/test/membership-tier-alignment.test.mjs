import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {Database} from '../dist/database.js';
import {membershipContentTier} from '../dist/membership-benefits.js';
import {LearningService} from '../dist/learning.js';
const require=createRequire(new URL('../package.json',import.meta.url)),{Pool}=require('pg');

test('alignment preserves unsold plan identities and prices, and keeps old terms',async()=>{
 const db=new Database(),pool=new Pool({connectionString:process.env.DATABASE_URL}),client=await pool.connect();
 try{
  if(!await db.user.findUnique({where:{username:'admin'}}))await db.user.create({data:{username:'admin',nickname:'隔离管理员',roles:['ADMIN']}});
  const inputs=[{tier:1,title:'会员',price:0},{tier:2,title:'铜卡会员',price:36500},{tier:3,title:'银卡会员',price:99800}],original=[];
  for(const item of inputs){const p=await db.membershipPlan.findUniqueOrThrow({where:{tier_days:{tier:item.tier,days:365}}});const row=await db.membershipPlan.update({where:{id:p.id},data:{title:item.title,price:item.price,active:false,version:{increment:1}}});original.push(await db.membershipPlan.findUniqueOrThrow({where:{id:row.id}}));}
  const sql=await readFile('../../infra/align-existing-membership-levels.sql','utf8');
  await db.membershipPlan.update({where:{id:original[1].id},data:{active:true}});
  await assert.rejects(()=>client.query(sql));await client.query('ROLLBACK');
  for(let i=0;i<3;i++){const row=await db.membershipPlan.findUniqueOrThrow({where:{id:original[i].id}});assert.equal(row.tier,inputs[i].tier);assert.equal(row.title,inputs[i].title);assert.equal(row.price,inputs[i].price);}
  await db.membershipPlan.update({where:{id:original[1].id},data:{active:false}});
  await client.query(sql);
  for(let i=0;i<3;i++){const row=await db.membershipPlan.findUniqueOrThrow({where:{id:original[i].id}});assert.equal(row.tier,i);assert.equal(row.title,['注册会员','铜牌会员','银牌会员'][i]);assert.equal(row.price,inputs[i].price);assert.equal(row.active,false);assert.equal(await membershipContentTier(row.currentVersionId,db),i);const old=await db.membershipPlanVersion.findUniqueOrThrow({where:{id:original[i].currentVersionId}});assert.equal(old.tier,inputs[i].tier);assert.equal(old.termsSnapshot.title,inputs[i].title);}
  await db.membershipPlan.update({where:{id:original[0].id},data:{active:true}});assert.equal((await new LearningService(db).plans()).some(plan=>plan.id===original[0].id),false);
  await assert.rejects(()=>client.query(sql));await client.query('ROLLBACK');
 }finally{client.release();await pool.end();await db.$disconnect();}
});
