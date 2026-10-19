import {phoneLookup} from '../dist/private-data.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomInt} from 'node:crypto';
import {createApp} from '../dist/main.js';
import {Database} from '../dist/database.js';
import {orderAddress} from '../dist/private-data.js';
import {OrdersService} from '../dist/orders.js';
import {passwordHash} from '../dist/auth.js';
import {clearProducts} from './fixture-cleanup.mjs';

if(process.env.NODE_ENV==='production')throw new Error('Test fixtures forbidden in production');
test('pending physical orders reserve inventory once and protect snapshots and owners',async t=>{
  process.env.DEV_OTP_CODE='123456';process.env.ORDER_RESERVATION_PREVIEW='true';
  const db=new Database(),app=await createApp(false),tag='qa-orders-'+randomUUID(),users=[],phones=[],password=randomUUID()+'!A';
  const origin='http://127.0.0.1:5173';process.env.CORS_ORIGINS=origin;
  app.getHttpAdapter().getInstance().set('trust proxy','loopback');await app.listen(0,'127.0.0.1');const base=await app.getUrl(),ip='2001:db8:'+randomInt(1,65535).toString(16)+'::1';
  async function call(path,auth,method='GET',body){const response=await fetch(base+'/api/v1'+path,{method,headers:{Origin:origin,'X-Forwarded-For':ip,'Content-Type':'application/json',...(auth?.accessToken?{Authorization:'Bearer '+auth.accessToken}:auth?{Cookie:auth.cookie,'X-CSRF-Token':auth.csrfToken}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json(),cookies:response.headers.getSetCookie()};}
  async function login(){const phone='198'+String(randomInt(0,100000000)).padStart(8,'0');phones.push(phone);const challenge=await call('/auth/sms',null,'POST',{phone});assert.equal(challenge.status,201);const result=await call('/auth/login',null,'POST',{phone,challengeId:challenge.body.challengeId,code:'123456'});assert.equal(result.status,200);users.push(result.body.user.id);return result.body;}
  async function admin(role){const user=await db.user.create({data:{username:tag+role,nickname:tag,roles:[role],tags:[],passwordHash:await passwordHash(password)}});users.push(user.id);const result=await call('/admin/auth/login',null,'POST',{username:user.username,password});assert.equal(result.status,200);return {cookie:result.cookies.map(row=>row.split(';')[0]).join('; '),csrfToken:result.body.csrfToken};}
  let product,sku,zone;
  try{
    const operator=await admin('OPERATOR'),support=await admin('SUPPORT'),a=await login(),b=await login();
    product=await db.product.create({data:{title:tag,subtitle:'测试',description:'测试',category:'文创',type:'PHYSICAL',cover:'/static/art/books.svg',price:3900,culturalOrigin:'测试',status:'PUBLISHED'}});
    sku=await db.productSku.create({data:{productId:product.id,title:'标准',price:3900,stock:2,active:true}});
    // A unique fixture province avoids changing the user's real shipping rules.
    zone='验证'+randomUUID().slice(0,8);
    const addressBody={recipient:'测试收货人',phone:'19960012345',province:zone,city:'验证市',district:'验证区',detail:'非真实配送地址',isDefault:true};
    const addressA=(await call('/shopping/addresses',a,'POST',addressBody)).body,addressB=(await call('/shopping/addresses',b,'POST',addressBody)).body;
    const quoteBody={addressId:addressA.id,items:[{skuId:sku.id,quantity:2}]};let quote,order;
    await t.test('delivery requires explicit configuration and prevents role/version overrides',async()=>{
      assert.equal((await call('/orders/quote',a,'POST',quoteBody)).status,400);
      assert.equal((await call('/admin/delivery-zones/'+zone,support,'PUT',{fee:800,surcharge:200,enabled:true,expectedVersion:0,reason:'验证'})).status,403);
      assert.equal((await call('/admin/delivery-zones/'+zone,operator,'PUT',{fee:800,surcharge:200,freeAbove:7000,enabled:true,expectedVersion:0,reason:'验证'})).status,200);
      assert.equal((await call('/admin/delivery-zones/'+zone,operator,'PUT',{fee:0,surcharge:0,enabled:true,expectedVersion:0,reason:'旧版本'})).status,409);
      quote=(await call('/orders/quote',a,'POST',quoteBody)).body;assert.equal(quote.subtotal,7800);assert.equal(quote.shipping,200);assert.equal(quote.total,8000);assert.equal(quote.paymentEnabled,false);
      assert.equal((await call('/orders/quote',b,'POST',quoteBody)).status,404);
      assert.equal((await call('/orders/quote',a,'POST',{...quoteBody,items:[...quoteBody.items,...quoteBody.items]})).status,400);
      assert.equal((await call('/orders/quote',a,'POST',{...quoteBody,price:1})).status,400);
    });
    await t.test('quote rejects changed price/address; repeated identical requests reserve once',async()=>{
      const requestId=randomUUID();await db.productSku.update({where:{id:sku.id},data:{price:4000}});
      assert.equal((await call('/orders',a,'POST',{...quoteBody,requestId,quoteId:quote.quoteId})).status,409);assert.equal(await db.order.count({where:{userId:a.user.id}}),0);
      quote=(await call('/orders/quote',a,'POST',quoteBody)).body;
      await call('/shopping/addresses/'+addressA.id,a,'PATCH',{...addressBody,detail:'已编辑'});
      assert.equal((await call('/orders',a,'POST',{...quoteBody,requestId,quoteId:quote.quoteId})).status,409);
      quote=(await call('/orders/quote',a,'POST',quoteBody)).body;
      const creates=await Promise.all([call('/orders',a,'POST',{...quoteBody,requestId,quoteId:quote.quoteId}),call('/orders',a,'POST',{...quoteBody,requestId,quoteId:quote.quoteId})]);assert.deepEqual(creates.map(row=>row.status),[201,201]);assert.equal(creates[0].body.id,creates[1].body.id);order=creates[0].body;
      assert.equal((await db.productSku.findUnique({where:{id:sku.id}})).reserved,2);assert.equal(order.requestHash,undefined);assert.equal(order.userId,undefined);
      const snapshot=(await db.order.findUniqueOrThrow({where:{id:order.id}})).address;assert.equal(snapshot.phone,undefined);assert.equal(orderAddress(snapshot).phone,addressBody.phone);assert.equal('cipher' in order.address,false);
      assert.equal((await call('/orders',a,'POST',{...quoteBody,items:[{skuId:sku.id,quantity:1}],requestId,quoteId:quote.quoteId})).status,409);
      await call('/shopping/addresses/'+addressA.id,a,'PATCH',{...addressBody,detail:'再次修改'});
      assert.equal((await call('/orders/'+order.id,a)).body.address.detail,'已编辑');
      assert.equal((await call('/orders/'+order.id,b)).status,404);assert.equal((await call('/orders/'+order.id+'/cancel',b,'POST',{})).status,404);
      assert.equal((await call('/admin/orders',operator)).status,403);assert.equal((await call('/admin/orders',support)).status,200);
      assert.equal((await call('/orders/'+order.id+'/cancel',a,'POST',{})).body.status,'CLOSED');
      await call('/orders/'+order.id+'/cancel',a,'POST',{});assert.equal((await db.productSku.findUnique({where:{id:sku.id}})).reserved,0);
      const audit=await db.auditLog.findMany({where:{resourceId:order.id,action:'order.close'}});assert.equal(audit.length,1);
    });
    await t.test('competing buyers never oversell and timed closure recovers stock exactly once',async()=>{
      await db.productSku.update({where:{id:sku.id},data:{stock:1}});
      const bodyA={addressId:addressA.id,items:[{skuId:sku.id,quantity:1}]},bodyB={...bodyA,addressId:addressB.id};
      const qa=(await call('/orders/quote',a,'POST',bodyA)).body,qb=(await call('/orders/quote',b,'POST',bodyB)).body;
      const results=await Promise.all([call('/orders',a,'POST',{...bodyA,requestId:randomUUID(),quoteId:qa.quoteId}),call('/orders',b,'POST',{...bodyB,requestId:randomUUID(),quoteId:qb.quoteId})]);assert.deepEqual(results.map(row=>row.status).sort(),[201,409]);
      const won=results.find(row=>row.status===201).body;assert.equal((await db.productSku.findUnique({where:{id:sku.id}})).reserved,1);
      await db.order.update({where:{id:won.id},data:{expiresAt:new Date(Date.now()-1000)}});
      await Promise.all([app.get(OrdersService).expire(),app.get(OrdersService).expire()]);
      assert.equal((await db.order.findUnique({where:{id:won.id}})).status,'CLOSED');assert.equal((await db.productSku.findUnique({where:{id:sku.id}})).reserved,0);
    });
    await t.test('reservation mode is blocked by default and production; closure redacts addresses',async()=>{
      const body={addressId:addressA.id,items:[{skuId:sku.id,quantity:1}]};quote=(await call('/orders/quote',a,'POST',body)).body;
      process.env.ORDER_RESERVATION_PREVIEW='false';assert.equal((await call('/orders',a,'POST',{...body,quoteId:quote.quoteId,requestId:randomUUID()})).status,503);
      process.env.ORDER_RESERVATION_PREVIEW='true';const previous=process.env.NODE_ENV;try{process.env.NODE_ENV='production';assert.equal((await call('/orders',a,'POST',{...body,quoteId:quote.quoteId,requestId:randomUUID()})).status,503);}finally{process.env.NODE_ENV=previous;}
      order=(await call('/orders',a,'POST',{...body,quoteId:quote.quoteId,requestId:randomUUID()})).body;assert.ok(order.id);
      assert.equal((await call('/me/close-account',a,'POST',{confirmation:'确认注销'})).status,201);
      assert.equal((await db.productSku.findUnique({where:{id:sku.id}})).reserved,0);assert.deepEqual((await db.order.findUnique({where:{id:order.id}})).address,{redacted:true});
      assert.equal((await call('/orders/'+order.id,a)).status,401);
    });
  }finally{
    for(const row of await db.order.findMany({where:{userId:{in:users},status:'PENDING'}}))await app.get(OrdersService).cancel(row.userId,row.id);
    await db.order.deleteMany({where:{userId:{in:users}}});if(product){await clearProducts(db,[product.id]);await db.product.delete({where:{id:product.id}});}if(zone)await db.deliveryZone.deleteMany({where:{province:zone}});
    await db.auditLog.deleteMany({where:{actorId:{in:users}}});await db.authSession.deleteMany({where:{userId:{in:users}}});await db.address.deleteMany({where:{userId:{in:users}}});await db.user.deleteMany({where:{id:{in:users}}});await db.otpChallenge.deleteMany({where:{OR:[{phone:{in:phones}},{phoneHash:{in:phones.map(phoneLookup)}}]}});
    await db.rateLimit.deleteMany({where:{OR:phones.flatMap(phone=>[{key:'sms-phone-minute:'+phoneLookup(phone)},{key:'sms-phone-day:'+phoneLookup(phone)}])}});await app.close();await db.$disconnect();
  }
});
