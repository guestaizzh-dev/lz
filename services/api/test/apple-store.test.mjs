import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, generateKeyPairSync } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { appleFact, AppleStoreService } from '../dist/apple-store.js';

const scope='com.academy.test',token=randomUUID(),timestamp=Date.now()-1000;
const transaction={transactionId:'200000123456',originalTransactionId:'200000123456',bundleId:scope,environment:'Sandbox',productId:'academy.course.one',type:'Non-Consumable',quantity:1,appAccountToken:token,inAppOwnershipType:'PURCHASED',purchaseDate:timestamp,signedDate:timestamp+500,currency:'CNY',price:88000};
test('Apple authenticated facts preserve milliunit precision and reject ambiguous scope, owner and money',()=>{
  const fact=appleFact(transaction,scope,'Sandbox');assert.equal(fact.amount,8800n);assert.equal(fact.accountToken,token);assert.equal(fact.revokedAt,null);
  for(const change of [{environment:'Production'},{bundleId:'com.other'},{appAccountToken:'user-id'},{quantity:2},{inAppOwnershipType:'FAMILY_SHARED'},{price:88001},{price:NaN},{price:-1},{currency:'USD'},{purchaseDate:0},{signedDate:timestamp-1},{transactionId:'bad'},{revocationDate:timestamp-1},{revocationPercentage:100001}])assert.throws(()=>appleFact({...transaction,...change},scope,'Sandbox'));
  assert.ok(appleFact({...transaction,revocationDate:timestamp+400,revocationType:'REFUND_FULL'},scope,'Sandbox').revokedAt);
});
test('Apple configuration fails closed; official verifier rejects forged signatures and production sandbox',async()=>{
  const names=['APPLE_IAP_ENABLED','APPLE_ENVIRONMENT','APPLE_BUNDLE_ID','APPLE_KEY_ID','APPLE_ISSUER_ID','APPLE_PRIVATE_KEY_FILE','APPLE_ROOT_CA_FILE','APPLE_APP_ID','NODE_ENV'],previous=Object.fromEntries(names.map(n=>[n,process.env[n]])),dir=await mkdtemp(join(tmpdir(),'academy-apple-'));
  try{
    process.env.APPLE_IAP_ENABLED='false';assert.doesNotThrow(()=>new AppleStoreService().onModuleInit());
    const key=generateKeyPairSync('ec',{namedCurve:'prime256v1'}).privateKey.export({type:'pkcs8',format:'pem'}).toString();await writeFile(join(dir,'key.p8'),key);
    Object.assign(process.env,{APPLE_IAP_ENABLED:'true',APPLE_ENVIRONMENT:'Sandbox',APPLE_BUNDLE_ID:scope,APPLE_KEY_ID:'ABCDEF1234',APPLE_ISSUER_ID:randomUUID(),APPLE_PRIVATE_KEY_FILE:join(dir,'key.p8'),APPLE_ROOT_CA_FILE:resolve('../../infra/apple-root-cas/AppleRootCA-G3.cer'),NODE_ENV:'test'});
    const service=new AppleStoreService();service.onModuleInit();
    const fake=Buffer.from('{"alg":"ES256"}').toString('base64url')+'.'+Buffer.from(JSON.stringify(transaction)).toString('base64url')+'.AAAA';
    await assert.rejects(service.restore(fake,token),/验证失败/);await assert.rejects(service.notification(fake),/签名或环境/);
    process.env.NODE_ENV='production';process.env.APPLE_APP_ID='123456789';assert.throws(()=>new AppleStoreService().onModuleInit(),/环境不安全/);
    process.env.NODE_ENV='test';await writeFile(join(dir,'root.cer'),'invalid');process.env.APPLE_ROOT_CA_FILE=join(dir,'root.cer');assert.throws(()=>new AppleStoreService().onModuleInit(),/环境不安全/);
  }finally{for(const n of names)if(previous[n]===undefined)delete process.env[n];else process.env[n]=previous[n];await rm(dir,{recursive:true,force:true});}
});
test('Apple restore queries current server facts and refuses account transfer and changed original purchase',async()=>{
  const service=new AppleStoreService(),fact=appleFact(transaction,scope,'Sandbox');let queries=0;
  service.decode=async()=>fact;service.latest=async()=>{queries++;return{...fact,revokedAt:new Date(timestamp+600)};};
  await assert.rejects(service.restore('signed',randomUUID()),/属于其他/);assert.equal(queries,0);
  assert.ok((await service.restore('signed',token)).revokedAt);assert.equal(queries,1);
  service.latest=async()=>({...fact,productId:'different'});await assert.rejects(service.restore('signed',token),/原始购买事实/);
});
