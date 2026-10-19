import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Database} from '../dist/database.js';
import {encryptPrivate,decryptPrivate,phoneLookup,personalAddress,orderAddress} from '../dist/private-data.js';
import {convertPrivateBatch,scrubLegacyAuthBatch} from '../dist/private-data-conversion.js';

test('private encryption authenticates its key and payload and exposes only authorized plain fields',()=>{
  const key=process.env.DOMAIN_ENCRYPTION_KEY;
  try {
    process.env.DOMAIN_ENCRYPTION_KEY='ab'.repeat(32);
    const cipher=encryptPrivate('私密地址与手机号');
    assert.equal(decryptPrivate(cipher),'私密地址与手机号');
    assert.notEqual(encryptPrivate('私密地址与手机号'),cipher);
    const parts=cipher.split(':');parts[3]=parts[3][0]==='0'?'1'+parts[3].slice(1):'0'+parts[3].slice(1);
    assert.throws(()=>decryptPrivate(parts.join(':')));
    const lookup=phoneLookup('19900001001');assert.match(lookup,/^[a-f0-9]{64}$/);
    process.env.DOMAIN_ENCRYPTION_KEY='cd'.repeat(32);
    assert.throws(()=>decryptPrivate(cipher));assert.notEqual(phoneLookup('19900001001'),lookup);
    assert.throws(()=>decryptPrivate('v2:invalid'));
  }finally{if(key===undefined)delete process.env.DOMAIN_ENCRYPTION_KEY;else process.env.DOMAIN_ENCRYPTION_KEY=key;}
});

test('legacy data converts in audited batches, repeats safely and restores only recorded rows',async()=>{
  const db=new Database(),users=[],runId=randomUUID(),phone='199'+String(Math.floor(Math.random()*100000000)).padStart(8,'0');
  let address,order;
  try {
    const admin=await db.user.create({data:{username:runId,nickname:'QA',roles:['ADMIN'],tags:[]}});users.push(admin.id);
    const learner=await db.user.create({data:{phone,nickname:'QA',roles:['USER'],tags:[]}});users.push(learner.id);
    const plain={recipient:'测试收货人',phone,province:'浙江省',city:'杭州市',district:'西湖区',detail:'仅用于私密字段回归'};
    address=await db.address.create({data:{...plain,userId:learner.id,isDefault:true}});
    order=await db.order.create({data:{userId:learner.id,requestId:randomUUID(),requestHash:'test',quoteId:'test',address:plain,subtotal:100,shipping:0,total:100,expiresAt:new Date(Date.now()+60000)}});
    await assert.rejects(convertPrivateBatch(db,learner.id,'user',[learner.id],'encrypt',runId,'isolated-test'),/administrator/);
    for(const [table,id] of [['user',learner.id],['address',address.id],['order',order.id]]){
      assert.equal(await convertPrivateBatch(db,admin.id,table,[id],'encrypt',runId,'isolated-test'),1);
      assert.equal(await convertPrivateBatch(db,admin.id,table,[id],'encrypt',runId,'isolated-test'),0);
    }
    let identity=await db.user.findUniqueOrThrow({where:{id:learner.id}});
    assert.equal(identity.phone,null);assert.equal(identity.phoneHash,phoneLookup(phone));assert.equal(decryptPrivate(identity.phoneCipher),phone);
    const safe=personalAddress(await db.address.findUniqueOrThrow({where:{id:address.id}}));assert.equal(safe.phone,phone);assert.equal(safe.phoneCipher,undefined);
    assert.deepEqual(orderAddress((await db.order.findUniqueOrThrow({where:{id:order.id}})).address),plain);
    const audit=await db.auditLog.findMany({where:{resourceId:runId}});assert.equal(audit.length,3);assert.ok(!JSON.stringify(audit).includes(phone));assert.ok(!JSON.stringify(audit).includes(plain.detail));
    for(const [table,id] of [['user',learner.id],['address',address.id],['order',order.id]])assert.equal(await convertPrivateBatch(db,admin.id,table,[id],'restore',runId,'isolated-test'),1);
    assert.equal((await db.user.findUniqueOrThrow({where:{id:learner.id}})).phone,phone);
    assert.equal((await db.address.findUniqueOrThrow({where:{id:address.id}})).detail,plain.detail);
    assert.deepEqual((await db.order.findUniqueOrThrow({where:{id:order.id}})).address,plain);
    const challenge=await db.otpChallenge.create({data:{phone,codeHash:'legacy-code',expiresAt:new Date(Date.now()+300000)}});
    const oldKey='sms-phone-day:'+phone,newKey='sms-phone-day:'+phoneLookup(phone);
    await db.rateLimit.create({data:{key:oldKey,count:4,expiresAt:new Date(Date.now()+60000)}});
    await db.rateLimit.create({data:{key:newKey,count:6,expiresAt:new Date(Date.now()+120000)}});
    const cleaned=await scrubLegacyAuthBatch(db,admin.id,runId,'isolated-test');assert.deepEqual(cleaned,{challenges:1,counters:1});
    const hiddenChallenge=await db.otpChallenge.findUniqueOrThrow({where:{id:challenge.id}});assert.equal(hiddenChallenge.phone,'');assert.equal(hiddenChallenge.phoneHash,phoneLookup(phone));assert.equal(hiddenChallenge.codeHash,'legacy-code');
    assert.equal(await db.rateLimit.findUnique({where:{key:oldKey}}),null);assert.equal((await db.rateLimit.findUniqueOrThrow({where:{key:newKey}})).count,6);
    assert.deepEqual(await scrubLegacyAuthBatch(db,admin.id,runId,'isolated-test'),{challenges:0,counters:0});
    assert.ok(!JSON.stringify(await db.auditLog.findMany({where:{resourceId:runId}})).includes(phone));
    await db.otpChallenge.delete({where:{id:challenge.id}});await db.rateLimit.delete({where:{key:newKey}});
    await db.user.update({where:{id:learner.id},data:{phoneCipher:encryptPrivate('19999999999')}});
    await assert.rejects(convertPrivateBatch(db,admin.id,'user',[learner.id],'encrypt',runId,'isolated-test'),/Conflicting/);
    assert.equal((await db.user.findUniqueOrThrow({where:{id:learner.id}})).phone,phone);
    await db.order.update({where:{id:order.id},data:{address:{redacted:true}}});
    assert.equal(await convertPrivateBatch(db,admin.id,'order',[order.id],'restore',runId,'isolated-test'),0);
  }finally{
    if(order)await db.order.delete({where:{id:order.id}});
    if(address)await db.address.delete({where:{id:address.id}});
    await db.auditLog.deleteMany({where:{actorId:{in:users}}});await db.user.deleteMany({where:{id:{in:users}}});await db.$disconnect();
  }
});
