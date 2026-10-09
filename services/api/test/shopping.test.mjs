import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { createApp } from '../dist/main.js';
import { Database } from '../dist/database.js';
import { passwordHash } from '../dist/auth.js';
import { clearProducts } from './fixture-cleanup.mjs';

if(process.env.NODE_ENV==='production')throw new Error('Test fixtures forbidden in production');
test('shopping HTTP workflows protect ownership, defaults, prices, inventory and audit',async t=>{
  const origin='http://127.0.0.1:5173';process.env.CORS_ORIGINS=origin;process.env.DEV_OTP_CODE='123456';
  const db=new Database(),app=await createApp(false),tag='qa-shopping-'+randomUUID(),users=[],products=[],phones=[],password=randomUUID()+'!A';
  app.getHttpAdapter().getInstance().set('trust proxy','loopback');await app.listen(0,'127.0.0.1');const base=await app.getUrl();const ip='2001:db8:'+randomInt(1,65535).toString(16)+'::1';
  async function call(path,auth,method='GET',body){const result=await fetch(base+'/api/v1'+path,{method,headers:{Origin:origin,'X-Forwarded-For':ip,'Content-Type':'application/json',...(auth?.accessToken?{Authorization:'Bearer '+auth.accessToken}:auth?{Cookie:auth.cookie,'X-CSRF-Token':auth.csrfToken}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:result.status,body:await result.json(),cookies:result.headers.getSetCookie()};}
  async function admin(role){const user=await db.user.create({data:{username:tag+role,nickname:tag,roles:[role],tags:[],passwordHash:await passwordHash(password)}});users.push(user.id);const result=await call('/admin/auth/login',null,'POST',{username:user.username,password});assert.equal(result.status,200);return {cookie:result.cookies.map(row=>row.split(';')[0]).join('; '),csrfToken:result.body.csrfToken};}
  async function login(){const phone='197'+String(randomInt(0,100000000)).padStart(8,'0');phones.push(phone);const challenge=await call('/auth/sms',null,'POST',{phone});assert.equal(challenge.status,201);const result=await call('/auth/login',null,'POST',{phone,challengeId:challenge.body.challengeId,code:'123456'});assert.equal(result.status,200);users.push(result.body.user.id);return result.body;}
  const productBody={title:tag,subtitle:'验证专用',description:'仅供自动化验证',category:'经典典籍',type:'PHYSICAL',cover:'/static/art/books.svg',price:1000,culturalOrigin:'测试，不作为实际来源',featured:false};
  const addressBody={recipient:'测试收货人',phone:'19960012345',province:'浙江省',city:'杭州市',district:'西湖区',detail:'测试街道，仅供验证',isDefault:true};
  try {
    const operator=await admin('OPERATOR'),moderator=await admin('MODERATOR'),support=await admin('SUPPORT'),a=await login(),b=await login();let product,sku;
    await t.test('product review, SKU changes and stock use roles, versions and audit',async()=>{
      assert.equal((await call('/admin/products',a,'POST',productBody)).status,403);
      product=(await call('/admin/products',operator,'POST',productBody)).body;assert.ok(product.id);products.push(product.id);
      assert.equal((await call('/admin/products/'+product.id+'/skus',support,'POST',{title:'精装',price:1200,stock:10,active:true,reason:'配置'})).status,403);
      assert.equal((await call('/admin/products/'+product.id+'/transition',operator,'POST',{action:'submit',expectedVersion:1,reason:'提交'})).status,400);
      sku=(await call('/admin/products/'+product.id+'/skus',operator,'POST',{title:'精装',price:1200,stock:10,active:true,reason:'首次配置'})).body;assert.ok(sku.id);
      assert.equal((await call('/admin/products/'+product.id+'/skus',operator,'POST',{title:'负库存',price:1,stock:-1,active:true,reason:'非法'})).status,400);
      assert.equal((await call('/admin/products/'+product.id+'/skus/'+sku.id,operator,'PATCH',{title:'精装',price:1200,stock:10,active:true,reason:'非法预占',expectedVersion:1,reserved:0})).status,400);
      let result=await call('/admin/products/'+product.id+'/transition',operator,'POST',{action:'submit',expectedVersion:1,reason:'提交'});assert.equal(result.status,201);
      assert.equal((await call('/admin/products/'+product.id+'/transition',operator,'POST',{action:'publish',expectedVersion:2,reason:'越权发布'})).status,403);
      result=await call('/admin/products/'+product.id+'/transition',moderator,'POST',{action:'publish',expectedVersion:2,reason:'通过'});assert.equal(result.status,201);product=result.body;
      const shown=(await call('/catalog/products/'+product.id)).body;assert.equal(shown.skus[0].available,10);assert.equal(shown.skus[0].price,1200);assert.equal(shown.skus[0].reserved,undefined);assert.equal(shown.checkoutEnabled,false);
      const audits=await call('/admin/products/'+product.id+'/audit',operator);assert.equal(audits.status,200);assert.ok(audits.body.some(row=>row.action==='sku.create'));assert.ok(audits.body.some(row=>row.action==='product.publish'));
    });
    await t.test('cart quantity is absolute and idempotent; clients cannot submit prices or other owners',async()=>{
      assert.equal((await call('/shopping/cart')).status,401);
      const writes=await Promise.all([call('/shopping/cart/'+sku.id,a,'PUT',{quantity:2}),call('/shopping/cart/'+sku.id,a,'PUT',{quantity:2})]);assert.deepEqual(writes.map(row=>row.status),[200,200]);assert.equal(writes[0].body.id,writes[1].body.id);
      let cart=(await call('/shopping/cart',a)).body;assert.equal(cart.items.length,1);assert.equal(cart.items[0].quantity,2);assert.equal(cart.total,2400);assert.equal(cart.checkoutEnabled,false);assert.equal(cart.items[0].userId,undefined);
      assert.equal((await call('/shopping/cart/'+sku.id,a,'PUT',{quantity:0})).status,400);
      assert.equal((await call('/shopping/cart/'+sku.id,a,'PUT',{quantity:11})).status,409);
      assert.equal((await call('/shopping/cart/'+sku.id,a,'PUT',{quantity:2,price:1,userId:b.user.id})).status,400);
      assert.equal((await call('/shopping/cart',b)).body.items.length,0);
      assert.equal((await call('/shopping/cart/'+cart.items[0].id,b,'DELETE')).status,404);
      assert.equal((await db.productSku.findUnique({where:{id:sku.id}})).reserved,0);
    });
    await t.test('price and inventory changes remain visible; inactive and archived items cannot be added',async()=>{
      let result=await call('/admin/products/'+product.id+'/skus/'+sku.id,operator,'PATCH',{title:'精装',price:1500,stock:1,active:true,expectedVersion:1,reason:'调价与盘点'});assert.equal(result.status,200);sku=result.body;
      assert.equal((await call('/admin/products/'+product.id+'/skus/'+sku.id,operator,'PATCH',{title:'精装',price:1,stock:1,active:true,expectedVersion:1,reason:'旧版本'})).status,409);
      let cart=(await call('/shopping/cart',a)).body;assert.equal(cart.items[0].sku.price,1500);assert.equal(cart.items[0].available,false);assert.equal(cart.total,0);assert.equal(cart.items[0].unavailableReason,'库存不足');
      assert.equal((await call('/shopping/cart/'+sku.id,a,'PUT',{quantity:1})).status,200);
      result=await call('/admin/products/'+product.id+'/skus/'+sku.id,operator,'PATCH',{title:'精装',price:1500,stock:1,active:false,expectedVersion:sku.version,reason:'停用'});assert.equal(result.status,200);
      assert.equal((await call('/shopping/cart/'+sku.id,a,'PUT',{quantity:1})).status,404);cart=(await call('/shopping/cart',a)).body;assert.equal(cart.items[0].unavailableReason,'规格已停用');
      assert.equal((await call('/admin/products/'+product.id+'/transition',operator,'POST',{action:'archive',expectedVersion:product.version,reason:'下架'})).status,201);
      assert.equal((await call('/catalog/products/'+product.id)).status,404);cart=(await call('/shopping/cart',a)).body;assert.equal(cart.items[0].unavailableReason,'商品已下架');
      assert.equal((await call('/shopping/cart/'+cart.items[0].id,a,'DELETE')).status,200);
    });
    await t.test('concurrent default address saves have exactly one default and enforce user ownership',async()=>{
      assert.equal((await call('/shopping/addresses')).status,401);
      const result=await Promise.all([call('/shopping/addresses',a,'POST',addressBody),call('/shopping/addresses',a,'POST',{...addressBody,detail:'另一测试地址'})]);assert.deepEqual(result.map(row=>row.status),[201,201]);
      let addresses=(await call('/shopping/addresses',a)).body;assert.equal(addresses.length,2);assert.equal(addresses.filter(row=>row.isDefault).length,1);
      assert.equal((await call('/shopping/addresses',b)).body.length,0);
      assert.equal((await call('/shopping/addresses/'+addresses[0].id,b,'PATCH',addressBody)).status,404);
      assert.equal((await call('/shopping/addresses/'+addresses[0].id,b,'DELETE')).status,404);
      assert.equal((await call('/shopping/addresses',a,'POST',{...addressBody,recipient:'   '})).status,400);
      assert.equal((await call('/shopping/addresses',a,'POST',{...addressBody,userId:b.user.id})).status,400);
      const priorDefault=addresses[0];assert.equal(priorDefault.isDefault,true);assert.equal((await call('/shopping/addresses/'+priorDefault.id,a,'DELETE')).status,200);
      addresses=(await call('/shopping/addresses',a)).body;assert.equal(addresses.length,1);assert.equal(addresses[0].isDefault,true);
      const updated=await call('/shopping/addresses/'+addresses[0].id,a,'PATCH',{...addressBody,isDefault:false});assert.equal(updated.status,200);assert.equal(updated.body.isDefault,true);
    });
    await t.test('account closure removes stored delivery information and shopping data',async()=>{
      await db.cartItem.create({data:{userId:a.user.id,skuId:sku.id,quantity:1}});
      assert.equal((await call('/me/close-account',a,'POST',{confirmation:'确认注销'})).status,201);
      assert.equal(await db.address.count({where:{userId:a.user.id}}),0);assert.equal(await db.cartItem.count({where:{userId:a.user.id}}),0);
      assert.equal((await call('/shopping/addresses',a)).status,401);
    });
  } finally {
    const skuIds=(await db.productSku.findMany({where:{productId:{in:products}},select:{id:true}})).map(row=>row.id);
    await clearProducts(db, products);
    await db.product.deleteMany({where:{id:{in:products}}});
    await db.auditLog.deleteMany({where:{OR:[{actorId:{in:users}},{resourceId:{in:[...products,...skuIds]}}]}});
    await db.authSession.deleteMany({where:{userId:{in:users}}});
    await db.user.deleteMany({where:{id:{in:users}}});await db.otpChallenge.deleteMany({where:{phone:{in:phones}}});
    await db.rateLimit.deleteMany({where:{OR:phones.flatMap(phone=>[{key:'sms-phone-minute:'+phone},{key:'sms-phone-day:'+phone}])}});
    await app.close();await db.$disconnect();
  }
});
