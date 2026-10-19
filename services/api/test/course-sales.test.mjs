import {phoneLookup} from '../dist/private-data.js';
import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {createCipheriv,generateKeyPairSync,randomBytes,randomInt,randomUUID,sign,verify} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createApp} from '../dist/main.js';
import {Database} from '../dist/database.js';
import {passwordHash} from '../dist/auth.js';
import {CourseSalesService} from '../dist/course-sales.js';
import {alipayCents} from '../dist/alipay.js';
import {clearCourses,clearPlans} from './fixture-cleanup.mjs';

if(process.env.NODE_ENV==='production')throw new Error('Fixtures forbidden in production');
test('course sales: signed payment protocol, real HTTP, PostgreSQL and delivery ownership',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'academy-course-sales-')),merchant=generateKeyPairSync('rsa',{modulusLength:2048}),provider=generateKeyPairSync('rsa',{modulusLength:2048}),key=randomBytes(16).toString('hex');
  await writeFile(join(dir,'merchant.pem'),merchant.privateKey.export({type:'pkcs8',format:'pem'}));
  await writeFile(join(dir,'public-keys.json'),JSON.stringify({PUB_KEY_ID_TEST:provider.publicKey.export({type:'spki',format:'pem'})}));
  Object.assign(process.env,{COURSE_WECHAT_ENABLED:'true',COURSE_PAYMENT_WORKER_ENABLED:'false',WECHAT_PAY_APP_ID:'wxAcademyTest',WECHAT_PAY_MCH_ID:'1900000001',WECHAT_PAY_SERIAL:'TESTSERIAL',WECHAT_PAY_API_V3_KEY:key,WECHAT_PAY_PRIVATE_KEY_FILE:join(dir,'merchant.pem'),WECHAT_PAY_PUBLIC_KEYS_FILE:join(dir,'public-keys.json'),PUBLIC_API_URL:'https://academy.example/api/v1',CORS_ORIGINS:'http://127.0.0.1:5173',DEV_OTP_CODE:'123456',MEDIA_DIR:dir});
  const realFetch=globalThis.fetch,transactions=new Map(),receipts=new Map(),refundTransactions=new Map();let corruptResponse=false,networkFailure=false,prepayCalls=0,providerCalls=0;
  const alipayKey=generateKeyPairSync('rsa',{modulusLength:2048}),alipayOld=generateKeyPairSync('rsa',{modulusLength:2048}),aliTrades=new Map(),aliRefunds=new Map();let aliInvalid=false,aliSigning=alipayKey.privateKey,aliFailure=false;
  await writeFile(join(dir,'alipay-keys.json'),JSON.stringify({active:'current',keys:{current:alipayKey.publicKey.export({type:'spki',format:'pem'}),previous:alipayOld.publicKey.export({type:'spki',format:'pem'})}}));
  Object.assign(process.env,{COURSE_ALIPAY_ENABLED:'false',ALIPAY_APP_ID:'2021000000000001',ALIPAY_SELLER_ID:'2088000000000001',ALIPAY_PRIVATE_KEY_FILE:join(dir,'merchant.pem'),ALIPAY_PUBLIC_KEYS_FILE:join(dir,'alipay-keys.json')});
  const urllib=(await import(pathToFileURL(createRequire(import.meta.resolve('alipay-sdk')).resolve('urllib').replace(/([/\\])commonjs([/\\])/,'$1esm$2')).href)).default;
  mock.method(urllib,'request',async(url,options)=>{
    assert.ok(String(url).startsWith('https://openapi.alipay.com/gateway.do'));
    if(aliFailure)throw new Error('Simulated connection loss');
    const params={...Object.fromEntries(new URL(url).searchParams),...options.data},signature=params.sign;delete params.sign;
    assert.equal(params.app_id,'2021000000000001');
    assert.ok(verify('RSA-SHA256',Buffer.from(Object.keys(params).sort().map(k=>k+'='+params[k]).join('&')),merchant.publicKey,Buffer.from(signature,'base64')));
    const biz=JSON.parse(params.biz_content),method=params.method;let result;
    if(method==='alipay.trade.query')result=aliTrades.get(biz.out_trade_no)??{code:'40004',sub_code:'ACQ.TRADE_NOT_EXIST'};
    else if(method==='alipay.trade.close'){const row=aliTrades.get(biz.out_trade_no);if(row)row.trade_status='TRADE_CLOSED';result={code:'10000',out_trade_no:biz.out_trade_no};}
    else if(method==='alipay.trade.refund'){
      const trade=[...aliTrades.values()].find(r=>r.trade_no===biz.trade_no);assert.ok(trade);
      if(!aliRefunds.has(biz.out_request_no))aliRefunds.set(biz.out_request_no,{code:'10000',trade_no:trade.trade_no,out_trade_no:trade.out_trade_no,out_request_no:biz.out_request_no,refund_amount:biz.refund_amount,refund_status:'REFUND_SUCCESS',gmt_refund_pay:new Date(Date.now()+8*3600000).toISOString().slice(0,19).replace('T',' ')});
      result={code:'10000',trade_no:trade.trade_no,out_trade_no:trade.out_trade_no,refund_fee:biz.refund_amount,fund_change:'Y'};
    }else if(method==='alipay.trade.fastpay.refund.query')result=aliRefunds.get(biz.out_request_no)??{code:'40004',sub_code:'ACQ.TRADE_NOT_EXIST'};
    else throw Error('Unexpected Alipay method '+method);
    const raw=JSON.stringify(result),signValue=aliInvalid?'invalid':sign('RSA-SHA256',Buffer.from(raw),aliSigning).toString('base64');
    return{status:200,headers:{},data:'{"'+method.replaceAll('.','_')+'_response":'+raw+',"sign":'+JSON.stringify(signValue)+'}'};
  });
  function response(data,status=200){const body=JSON.stringify(data),timestamp=String(Math.floor(Date.now()/1000)),nonce=randomBytes(8).toString('hex'),signature=sign('RSA-SHA256',Buffer.from(timestamp+'\n'+nonce+'\n'+body+'\n'),provider.privateKey).toString('base64');return new Response(body,{status,headers:{'Content-Type':'application/json','Wechatpay-Serial':'PUB_KEY_ID_TEST','Wechatpay-Timestamp':timestamp,'Wechatpay-Nonce':nonce,'Wechatpay-Signature':corruptResponse?'invalid':signature}});}
  mock.method(globalThis,'fetch',async(url,options={})=>{
    if(!String(url).startsWith('https://api.mch.weixin.qq.com/'))return realFetch(url,options);
    providerCalls++;
    if(networkFailure)throw new TypeError('Simulated provider connection loss');
    const target=new URL(url),body=options.body??'',auth=options.headers.Authorization,values=Object.fromEntries([...auth.matchAll(/(\w+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
    assert.equal(values.mchid,'1900000001');assert.ok(verify('RSA-SHA256',Buffer.from(options.method+'\n'+target.pathname+target.search+'\n'+values.timestamp+'\n'+values.nonce_str+'\n'+body+'\n'),merchant.publicKey,Buffer.from(values.signature,'base64')));
    if(target.pathname==='/v3/pay/transactions/app'){prepayCalls++;const request=JSON.parse(body);assert.equal(request.appid,'wxAcademyTest');assert.equal(request.notify_url,'https://academy.example/api/v1/payments/wechat/notify');const current=transactions.get(request.out_trade_no);if(!current)transactions.set(request.out_trade_no,{appid:request.appid,mchid:request.mchid,out_trade_no:request.out_trade_no,trade_type:'APP',trade_state:'NOTPAY',amount:request.amount});return response({prepay_id:'prepay-'+request.out_trade_no});}
    if(target.pathname.endsWith('/close')){const orderNo=target.pathname.split('/').at(-2),current=transactions.get(orderNo);if(current?.trade_state==='SUCCESS')return response({code:'ORDERPAID'},400);if(current)current.trade_state='CLOSED';const signed=response('');return new Response(null,{status:204,headers:{...Object.fromEntries(signed.headers),'wechatpay-signature':sign('RSA-SHA256',Buffer.from(signed.headers.get('Wechatpay-Timestamp')+'\n'+signed.headers.get('Wechatpay-Nonce')+'\n\n'),provider.privateKey).toString('base64')}});}
    if(target.pathname.startsWith('/v3/pay/transactions/out-trade-no/')){const orderNo=target.pathname.split('/').at(-1);return transactions.has(orderNo)?response(transactions.get(orderNo)):response({code:'ORDER_NOT_EXIST'},404);}
    if(target.pathname==='/v3/refund/domestic/refunds'){const request=JSON.parse(body),original=receipts.get(request.transaction_id);assert.ok(original);let result=refundTransactions.get(request.out_refund_no);if(!result){result={mchid:'1900000001',out_trade_no:original.out_trade_no,transaction_id:original.transaction_id,out_refund_no:request.out_refund_no,refund_id:'RF'+randomUUID(),status:'SUCCESS',success_time:new Date().toISOString(),amount:request.amount};refundTransactions.set(request.out_refund_no,result);}return response(result);}
    if(target.pathname.startsWith('/v3/refund/domestic/refunds/')){const result=refundTransactions.get(target.pathname.split('/').at(-1));return result?response(result):response({code:'RESOURCE_NOT_EXISTS'},404);}
    throw new Error('Unexpected payment endpoint '+target.pathname);
  });
  const db=new Database(),app=await createApp(false);app.useLogger(['error']);app.getHttpAdapter().getInstance().set('trust proxy','loopback');await app.listen(0,'127.0.0.1');const base=await app.getUrl(),prefix='qa-course-sales-'+randomUUID(),ip='2001:db8:'+randomInt(1,65535).toString(16)+'::1',users=[],courses=[],teachers=[],assets=[],plans=[],phones=[],eventIds=[],password=randomUUID()+'!A';
  async function call(path,auth,method='GET',body){const res=await fetch(base+'/api/v1'+path,{method,headers:{Origin:'http://127.0.0.1:5173','X-Forwarded-For':ip,'Content-Type':'application/json',...(auth?.accessToken?{Authorization:'Bearer '+auth.accessToken}:auth?{Cookie:auth.cookie,'X-CSRF-Token':auth.csrfToken}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const text=await res.text();return{status:res.status,body:text?JSON.parse(text):null,cookies:res.headers.getSetCookie()};}
  async function admin(role){const user=await db.user.create({data:{username:prefix+role,nickname:prefix+role,roles:[role],tags:[],passwordHash:await passwordHash(password)}});users.push(user.id);const result=await call('/admin/auth/login',null,'POST',{username:user.username,password});assert.equal(result.status,200);return{user,cookie:result.cookies.map(c=>c.split(';')[0]).join('; '),csrfToken:result.body.csrfToken};}
  async function login(){const phone='198'+String(randomInt(0,100000000)).padStart(8,'0');phones.push(phone);const challenge=await call('/auth/sms',null,'POST',{phone});assert.equal(challenge.status,201);const result=await call('/auth/login',null,'POST',{phone,challengeId:challenge.body.challengeId,code:'123456'});assert.equal(result.status,200);users.push(result.body.user.id);return result.body;}
  let root,finance,support,a,b,asset,teacher;
  async function course(mixed=false){const result=await call('/admin/courses',root,'POST',{title:prefix+'视频课'+courses.length,subtitle:'真实流程测试',description:'仅用于集成测试，不对外售卖',category:'经典研习',format:'VIDEO',cover:'/static/art/books.svg',price:8800,teacherId:teacher.id,membershipTier:null,accessDays:null,refundPolicy:'付款后7日且未开始付费章节可申请退课',tags:[],featured:false,chapters:[...(mixed?[{title:'原文导读',format:'TEXT',body:'上善若水，水善利万物而不争。',mediaId:null,durationSeconds:0,trial:true,required:false}]:[]),{title:'免费试听',format:'VIDEO',body:'',mediaId:asset.id,durationSeconds:120,trial:true,required:false},{title:'付费课件',format:'VIDEO',body:'',mediaId:asset.id,durationSeconds:120,trial:false,required:true}]});assert.equal(result.status,201,JSON.stringify(result.body));courses.push(result.body.id);const submit=await call('/admin/courses/'+result.body.id+'/transition',root,'POST',{action:'submit',expectedVersion:result.body.version,reason:'测试提交'});assert.equal(submit.status,201);const publish=await call('/admin/courses/'+result.body.id+'/transition',root,'POST',{action:'publish',expectedVersion:submit.body.version,reason:'测试发布'});assert.equal(publish.status,201,JSON.stringify(publish.body));return publish.body;}
  async function order(courseId,auth=a){const q=await call('/commerce/courses/'+courseId+'/quote?platform=ANDROID',auth);assert.equal(q.status,200,JSON.stringify(q.body));const created=await call('/commerce/course-orders',auth,'POST',{courseId,platform:'ANDROID',requestKey:randomUUID(),quoteHash:q.body.quoteHash});assert.equal(created.status,201,JSON.stringify(created.body));return created.body;}
  async function prepay(row,auth=a){const result=await call('/commerce/course-orders/'+row.id+'/payment',auth,'POST',{});assert.equal(result.status,201,JSON.stringify(result.body));const sdk=JSON.parse(result.body.orderInfo);assert.ok(verify('RSA-SHA256',Buffer.from(sdk.appid+'\n'+sdk.timestamp+'\n'+sdk.noncestr+'\n'+sdk.prepayid+'\n'),merchant.publicKey,Buffer.from(sdk.sign,'base64')));return result.body;}
  function paid(row,amount=Number(row.amount)){const current=transactions.get(row.orderNo);assert.ok(current);Object.assign(current,{trade_state:'SUCCESS',transaction_id:'TX'+randomUUID(),success_time:new Date().toISOString(),amount:{total:amount,currency:'CNY'}});receipts.set(current.transaction_id,{...current});return{...current};}
  function callback(data,type='TRANSACTION.SUCCESS'){const id=prefix+randomUUID();eventIds.push(id);const nonce=randomBytes(6).toString('hex'),cipher=createCipheriv('aes-256-gcm',Buffer.from(key),Buffer.from(nonce)),aad='transaction';cipher.setAAD(Buffer.from(aad));const ciphertext=Buffer.concat([cipher.update(JSON.stringify(data)),cipher.final(),cipher.getAuthTag()]).toString('base64'),body=JSON.stringify({id,event_type:type,resource:{algorithm:'AEAD_AES_256_GCM',nonce,associated_data:aad,ciphertext}}),timestamp=String(Math.floor(Date.now()/1000)),headerNonce=randomBytes(8).toString('hex');return{body,headers:{'Content-Type':'application/json','Wechatpay-Serial':'PUB_KEY_ID_TEST','Wechatpay-Timestamp':timestamp,'Wechatpay-Nonce':headerNonce,'Wechatpay-Signature':sign('RSA-SHA256',Buffer.from(timestamp+'\n'+headerNonce+'\n'+body+'\n'),provider.privateKey).toString('base64')}};}
  async function sendCallback(packet){return fetch(base+'/api/v1/payments/wechat/notify',{method:'POST',...packet});}
  async function runRefundJobs(){await db.outboxJob.updateMany({where:{kind:'COURSE_REFUND',aggregateId:{in:(await db.refund.findMany({where:{userId:{in:users}}})).map(r=>r.id)}},data:{availableAt:new Date(0)}});await app.get(CourseSalesService).runJobs();}
  try{
    root=await admin('ADMIN');finance=await admin('FINANCE');support=await admin('SUPPORT');a=await login();b=await login();
    teacher=await db.teacher.create({data:{name:prefix,title:'测试教师',bio:'测试简介',expertise:[],status:'PUBLISHED'}});teachers.push(teacher.id);
    const bytes=Buffer.from([0,0,0,20,102,116,121,112,105,115,111,109,0,0,0,0,105,115,111,109]);
    asset=await db.mediaAsset.create({data:{storageKey:randomUUID(),name:prefix+'.mp4',mime:'video/mp4',bytes:bytes.length,uploaderId:root.user.id,status:'READY',visibility:'PRIVATE'}});assets.push(asset.id);await writeFile(join(dir,asset.storageKey),bytes);
    await t.test('M09 coupons: concurrent stock, frozen best quote, cancel and verified refund return',async()=>{
      const c=await course(),couponUser=await login(),other=await login();
      const dto={title:prefix+'课程立减券',discountKind:'FIXED',discountValue:1200,threshold:5000,startsAt:new Date(Date.now()-1000).toISOString(),endsAt:new Date(Date.now()+86400000).toISOString(),totalLimit:1,perUserLimit:1,allowedChannels:['WECHAT_APP'],courseIds:[c.id],active:true,reason:'测试营销课程优惠'};
      assert.equal((await call('/admin/marketing/coupons',support,'POST',dto)).status,403);
      const template=await call('/admin/marketing/coupons',root,'POST',dto);assert.equal(template.status,201,JSON.stringify(template.body));
      const key=randomUUID(),claims=await Promise.all([1,2].map(()=>call('/me/marketing/coupons/'+template.body.id+'/claim',couponUser,'POST',{requestKey:key})));assert.ok(claims.every(x=>x.status===201));assert.equal(claims[0].body.id,claims[1].body.id);
      assert.equal((await call('/me/marketing/coupons/'+template.body.id+'/claim',other,'POST',{requestKey:randomUUID()})).status,409);
      const q=(await call('/commerce/courses/'+c.id+'/quote?platform=ANDROID',couponUser)).body;assert.equal(q.price,'7600');assert.equal(q.discount,'1200');assert.equal((await call('/commerce/courses/'+c.id+'/quote?platform=IOS',couponUser)).body.discount,'0');
      const created=await call('/commerce/course-orders',couponUser,'POST',{courseId:c.id,platform:'ANDROID',requestKey:randomUUID(),quoteHash:q.quoteHash});assert.equal(created.status,201,JSON.stringify(created.body));assert.equal(created.body.amount,'7600');
      const couponId=claims[0].body.id;assert.equal((await db.userCoupon.findUniqueOrThrow({where:{id:couponId}})).state,'LOCKED');
      assert.equal((await call('/commerce/course-orders/'+created.body.id+'/cancel',couponUser,'POST',{})).status,201);assert.equal((await db.userCoupon.findUniqueOrThrow({where:{id:couponId}})).state,'AVAILABLE');
      const relatedCourse=await course();await db.course.updateMany({where:{id:{in:[c.id,relatedCourse.id]}},data:{tags:['购课研习信号']}});
      const row=await order(c.id,couponUser);await prepay(row,couponUser);const receipt=paid(row);assert.equal((await sendCallback(callback(receipt))).status,204);assert.equal((await sendCallback(callback(receipt))).status,204);assert.equal((await db.userCoupon.findUniqueOrThrow({where:{id:couponId}})).state,'USED');const recommendations=(await call('/discovery/recommendations',couponUser)).body;assert.ok(!recommendations.items.some(i=>i.id===c.id));assert.ok(recommendations.items.find(i=>i.id===relatedCourse.id)?.score>0);
      assert.equal((await call('/commerce/course-orders/'+row.id+'/refund',couponUser,'POST',{requestKey:randomUUID(),reason:'测试营销优惠券退款返还'})).status,201);
      const refund=await db.refund.findFirstOrThrow({where:{orderId:row.id}});assert.equal((await call('/admin/course-orders/refunds/'+refund.id+'/review',finance,'POST',{expectedVersion:refund.version,action:'APPROVE',reason:'测试审核返券'})).status,201);await runRefundJobs();assert.equal((await db.userCoupon.findUniqueOrThrow({where:{id:couponId}})).state,'AVAILABLE');assert.equal((await call('/discovery/recommendations',couponUser)).body.items.find(i=>i.id===relatedCourse.id)?.score,0);

    await db.userCoupon.deleteMany({where:{templateId:template.body.id}});await db.couponTemplate.delete({where:{id:template.body.id}});
    });
    await t.test('M09 group purchase: payment waits for two members; failure refunds through original channels',async()=>{
      async function rule(c){const r=await call('/admin/marketing/groups',root,'POST',{courseId:c.id,title:prefix+'两人共学',price:6800,startsAt:new Date(Date.now()-1000).toISOString(),endsAt:new Date(Date.now()+2*86400000).toISOString(),active:true,reason:'测试2人24小时固定规则'});assert.equal(r.status,201,JSON.stringify(r.body));return (await db.promotionOffer.findFirstOrThrow({where:{promotionId:r.body.id}})).id;}
      async function join(c,auth,selection){const q=await call('/commerce/courses/'+c.id+'/quote?platform=ANDROID&'+new URLSearchParams(selection),auth);assert.equal(q.status,200,JSON.stringify(q.body));const r=await call('/commerce/course-orders',auth,'POST',{courseId:c.id,platform:'ANDROID',requestKey:randomUUID(),quoteHash:q.body.quoteHash,...selection});assert.equal(r.status,201,JSON.stringify(r.body));assert.equal(r.body.amount,'6800');return r.body;}
      const c=await course(),first=await login(),second=await login(),extra=await login(),groupOfferId=await rule(c),row=await join(c,first,{groupOfferId});assert.ok(row.group?.id);
      await prepay(row,first);const receipt=paid(row);assert.equal((await sendCallback(callback(receipt))).status,204);assert.equal((await sendCallback(callback(receipt))).status,204);assert.equal(await db.enrollment.count({where:{courseId:c.id}}),0);assert.equal((await db.financeEntry.findFirstOrThrow({where:{journalId:(await db.financeJournal.findFirstOrThrow({where:{orderId:row.id,kind:'COURSE_PAYMENT'}})).id,credit:{gt:0n}}})).accountCode,'COURSE_REFUND_PAYABLE');
      const row2=await join(c,second,{groupId:row.group.id});const thirdQuote=await call('/commerce/courses/'+c.id+'/quote?platform=ANDROID&groupId='+row.group.id,extra);assert.equal((await call('/commerce/course-orders',extra,'POST',{courseId:c.id,platform:'ANDROID',requestKey:randomUUID(),quoteHash:thirdQuote.body.quoteHash,groupId:row.group.id})).status,409);
      await prepay(row2,second);assert.equal((await sendCallback(callback(paid(row2)))).status,204);assert.equal(await db.enrollment.count({where:{courseId:c.id,source:'PURCHASE'}}),2);assert.equal((await db.groupBuy.findUniqueOrThrow({where:{id:row.group.id}})).state,'SUCCEEDED');assert.equal(await db.financeJournal.count({where:{orderId:{in:[row.id,row2.id]},kind:'COURSE_GROUP_DELIVERY'}}),2);
      const c2=await course(),failed=await join(c2,first,{groupOfferId:await rule(c2)});await prepay(failed,first);assert.equal((await sendCallback(callback(paid(failed)))).status,204);await db.groupBuy.update({where:{id:failed.group.id},data:{expiresAt:new Date(0)}});await db.outboxJob.updateMany({where:{aggregateId:failed.group.id},data:{availableAt:new Date(0)}});await app.get(CourseSalesService).runJobs();await runRefundJobs();assert.equal((await db.refund.findFirstOrThrow({where:{orderId:failed.id}})).state,'SUCCEEDED');assert.equal(await db.enrollment.count({where:{courseId:c2.id}}),0);
      const c3=await course(),waiting=await join(c3,first,{groupOfferId:await rule(c3)});await prepay(waiting,first);assert.equal((await sendCallback(callback(paid(waiting)))).status,204);assert.equal((await call('/commerce/course-orders/'+waiting.id+'/refund',first,'POST',{requestKey:randomUUID(),reason:'等待成团期间主动退出'})).status,201);await runRefundJobs();assert.equal((await db.groupBuy.findUniqueOrThrow({where:{id:waiting.group.id}})).state,'FAILED');assert.equal((await db.groupBuyMember.findFirstOrThrow({where:{groupId:waiting.group.id,userId:first.user.id}})).state,'REFUNDED');assert.equal(await db.enrollment.count({where:{courseId:c3.id}}),0);

    });
    let primary,primaryOrder,primaryData;
    await t.test('stored channels fail closed instead of using WeChat and other fulfillment orders remain isolated',async()=>{
      const c=await course(),row=await order(c.id);await prepay(row);
      await db.paymentAttempt.updateMany({where:{orderId:row.id},data:{channel:'ALIPAY_APP'}});const before=providerCalls;
      assert.equal((await call('/commerce/course-orders/'+row.id+'/refresh',a,'POST',{})).status,503);
      assert.equal((await call('/commerce/course-orders/'+row.id+'/cancel',a,'POST',{})).status,503);
      assert.equal((await call('/commerce/course-orders/'+row.id+'/payment',a,'POST',{})).status,503);assert.equal(providerCalls,before);
      assert.equal((await db.tradeOrder.findUniqueOrThrow({where:{id:row.id}})).state,'PENDING');assert.equal(await db.paymentTransaction.count({where:{orderId:row.id}}),0);
      await db.paymentAttempt.updateMany({where:{orderId:row.id},data:{channel:'WECHAT_APP'}});
      await db.tradeOrder.update({where:{id:row.id},data:{kind:'MEMBERSHIP'}});
      assert.equal((await call('/commerce/course-orders/'+row.id,a)).status,404);
      assert.equal((await sendCallback(callback(paid(row)))).status,404);assert.equal(await db.enrollment.count({where:{userId:a.user.id,courseId:c.id}}),0);assert.equal(await db.financeJournal.count({where:{orderId:row.id}}),0);
      await db.tradeOrder.update({where:{id:row.id},data:{kind:'COURSE'}});
    });
    await t.test('mixed purchase quote describes the released lesson formats and all-order filter is optional',async()=>{
      const c=await course(true),q=await call('/commerce/courses/'+c.id+'/quote?platform=WEB',a);
      assert.equal(q.status,200);assert.deepEqual(q.body.contentFormats,['TEXT','VIDEO']);assert.equal(q.body.lessons,3);
      assert.equal((await call('/commerce/course-orders?page=1',a)).status,200);
      for(const state of ['PENDING','COMPLETED','CLOSED'])assert.equal((await call('/commerce/course-orders?state='+state,a)).status,200);
      assert.equal((await call('/commerce/course-orders?state=invalid',a)).status,400);
    });
    await t.test('Alipay exact cents and signed App credentials preserve the selected channel',async()=>{
      for(const value of ['NaN','1e2','0','-1','1.001',1,'1000000.01'])assert.throws(()=>alipayCents(value));
      assert.equal(alipayCents('88.00'),8800);assert.equal(alipayCents('0.01'),1);
      process.env.COURSE_ALIPAY_ENABLED='true';const c=await course(),q=(await call('/commerce/courses/'+c.id+'/quote?platform=ANDROID',a)).body;
      assert.equal(q.channels.find(r=>r.channel==='ALIPAY_APP').enabled,true);
      const created=await call('/commerce/course-orders',a,'POST',{courseId:c.id,platform:'ANDROID',channel:'ALIPAY_APP',requestKey:randomUUID(),quoteHash:q.quoteHash});assert.equal(created.status,201,JSON.stringify(created.body));
      const row=created.body,payment=await call('/commerce/course-orders/'+row.id+'/payment',a,'POST',{});assert.equal(payment.status,201,JSON.stringify(payment.body));assert.equal(payment.body.provider,'alipay');
      const params=Object.fromEntries(new URLSearchParams(payment.body.orderInfo)),sig=params.sign;delete params.sign;
      assert.ok(verify('RSA-SHA256',Buffer.from(Object.keys(params).sort().map(k=>k+'='+params[k]).join('&')),merchant.publicKey,Buffer.from(sig,'base64')));
      const biz=JSON.parse(params.biz_content);assert.equal(biz.product_code,'QUICK_MSECURITY_PAY');assert.equal(biz.total_amount,'88.00');assert.equal(biz.out_trade_no,row.orderNo);assert.equal(params.notify_url,'https://academy.example/api/v1/payments/alipay/notify');
      assert.equal(new Date(biz.time_expire.replace(' ','T')+'+08:00').getTime(),Math.floor(Date.parse(row.expiresAt)/1000)*1000);
      assert.equal((await call('/commerce/course-orders/'+row.id,a)).body.paymentStatus,'CHECK_REQUIRED');
      assert.equal((await call('/commerce/course-orders/'+row.id+'/payment',a,'POST',{})).status,409);
      const query=await call('/commerce/course-orders/'+row.id+'/refresh',a,'POST',{});assert.equal(query.status,201,JSON.stringify(query.body));assert.equal(query.body.canPay,true);
      aliTrades.set(row.orderNo,{code:'10000',out_trade_no:row.orderNo,trade_no:'ALI'+randomUUID(),seller_id:process.env.ALIPAY_SELLER_ID,trade_status:'TRADE_SUCCESS',total_amount:'88.00',send_pay_date:new Date(Date.now()+8*3600000).toISOString().slice(0,19).replace('T',' ')});
      aliInvalid=true;assert.equal((await call('/commerce/course-orders/'+row.id+'/refresh',a,'POST',{})).status,503);aliInvalid=false;assert.equal(await db.enrollment.count({where:{courseId:c.id,userId:a.user.id}}),0);
      aliSigning=alipayOld.privateKey;const confirmed=await call('/commerce/course-orders/'+row.id+'/refresh',a,'POST',{});assert.equal(confirmed.status,201,JSON.stringify(confirmed.body));assert.equal(confirmed.body.access,true);aliSigning=alipayKey.privateKey;
      const transaction=await db.paymentTransaction.findFirstOrThrow({where:{orderId:row.id}});assert.equal(transaction.channel,'ALIPAY_APP');const journal=await db.financeJournal.findFirstOrThrow({where:{orderId:row.id}});assert.equal((await db.financeEntry.findFirstOrThrow({where:{journalId:journal.id,debit:{gt:0}}})).accountCode,'ALIPAY_RECEIVABLE');
      const requested=await call('/commerce/course-orders/'+row.id+'/refund',a,'POST',{requestKey:randomUUID(),reason:'支付宝原路退款测试'});assert.equal(requested.status,201);const refund=requested.body.refunds[0];assert.equal((await call('/admin/course-orders/refunds/'+refund.id+'/review',finance,'POST',{action:'APPROVE',expectedVersion:refund.version,reason:'符合退课规则'})).status,201);
      aliFailure=true;await runRefundJobs();assert.equal((await db.refund.findUniqueOrThrow({where:{id:refund.id}})).state,'REFUNDING');assert.equal((await db.enrollment.findFirstOrThrow({where:{userId:a.user.id,courseId:c.id}})).revokedAt,null);aliFailure=false;
      await runRefundJobs();assert.equal((await db.refund.findUniqueOrThrow({where:{id:refund.id}})).state,'SUCCEEDED');assert.equal((await db.refundTransaction.findFirstOrThrow({where:{refundId:refund.id}})).channel,'ALIPAY_APP');assert.equal((await call('/commerce/course-orders/'+row.id,a)).body.access,false);
      await runRefundJobs();assert.equal(await db.refundTransaction.count({where:{refundId:refund.id}}),1);process.env.COURSE_ALIPAY_ENABLED='false';
    });
    await t.test('Alipay notifications verify identity and rotating pinned keys; dual-channel receipts deliver once and compensate',async()=>{
      process.env.COURSE_ALIPAY_ENABLED='true';const c=await course(),row=await order(c.id);await prepay(row);
      await db.paymentAttempt.create({data:{orderId:row.id,channel:'ALIPAY_APP',requestKey:randomUUID(),state:'PENDING',amount:BigInt(row.amount),currency:'CNY',expiresAt:new Date(row.expiresAt)}});
      function packet(extra={},key=alipayKey.privateKey){
        const notifyId=prefix+randomUUID();eventIds.push(notifyId);
        const data={app_id:process.env.ALIPAY_APP_ID,seller_id:process.env.ALIPAY_SELLER_ID,out_trade_no:row.orderNo,trade_no:'ALI-DUP-'+row.id,trade_status:'TRADE_SUCCESS',total_amount:'88.00',gmt_payment:new Date(Date.now()+8*3600000).toISOString().slice(0,19).replace('T',' '),notify_id:notifyId,sign_type:'RSA2',...extra};
        const signed=Object.keys(data).filter(k=>k!=='sign_type').sort().map(k=>k+'='+data[k]).join('&');
        return new URLSearchParams({...data,sign:sign('RSA-SHA256',Buffer.from(signed),key).toString('base64')}).toString();
      }
      async function notify(body){return fetch(base+'/api/v1/payments/alipay/notify',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});}
      assert.equal((await notify(packet({app_id:'2021000000000002'}))).status,401);assert.equal((await notify(packet({seller_id:'2088000000000002'}))).status,401);assert.equal((await notify(packet({},merchant.privateKey))).status,401);
      assert.equal((await notify(packet()+'&total_amount=0.01')).status,401);assert.equal(await db.paymentTransaction.count({where:{orderId:row.id}}),0);
      assert.equal((await sendCallback(callback(paid(row)))).status,204);const duplicate=packet({},alipayOld.privateKey),results=await Promise.all([notify(duplicate),notify(duplicate)]);assert.ok(results.every(r=>r.status===200),await Promise.all(results.map(r=>r.text())));
      assert.equal(await db.paymentTransaction.count({where:{orderId:row.id,disposition:'ACCEPTED'}}),1);assert.equal(await db.paymentTransaction.count({where:{orderId:row.id,channel:'ALIPAY_APP',disposition:'DUPLICATE'}}),1);assert.equal(await db.enrollment.count({where:{courseId:c.id,userId:a.user.id}}),1);
      aliTrades.set(row.orderNo,{code:'10000',out_trade_no:row.orderNo,trade_no:'ALI-DUP-'+row.id});await runRefundJobs();assert.equal((await db.refund.findFirstOrThrow({where:{orderId:row.id}})).state,'SUCCEEDED');assert.equal((await call('/commerce/course-orders/'+row.id,a)).body.access,true);process.env.COURSE_ALIPAY_ENABLED='false';
    });
    await t.test('published sale quote carries version and policy; platform and ownership gates are enforced',async()=>{
      primary=await course();const q=await call('/commerce/courses/'+primary.id+'/quote?platform=ANDROID',a);assert.equal(q.status,200);assert.equal(q.body.price,'8800');assert.equal(q.body.paymentEnabled,true);assert.equal(q.body.refundDays,7);assert.ok(q.body.releaseId);assert.equal((await call('/commerce/courses/'+primary.id+'/quote?platform=IOS',a)).body.paymentEnabled,false);assert.equal((await call('/commerce/courses/'+primary.id+'/quote?platform=WEB',a)).body.paymentEnabled,false);
      assert.equal((await call('/commerce/course-orders',null,'POST',{})).status,401);assert.equal((await call('/commerce/course-orders',a,'POST',{courseId:primary.id,platform:'IOS',requestKey:randomUUID(),quoteHash:q.body.quoteHash})).status,400);assert.equal((await call('/commerce/course-orders',a,'POST',{courseId:primary.id,platform:'ANDROID',requestKey:randomUUID(),quoteHash:q.body.quoteHash,price:1})).status,400);
    });
    await t.test('demo visibility never authorizes a payment, including an existing pending order',async()=>{
      const demo=await course(),q=(await call('/commerce/courses/'+demo.id+'/quote?platform=ANDROID',a)).body;
      await db.course.update({where:{id:demo.id},data:{isDemo:true}});
      const preview=await call('/commerce/courses/'+demo.id+'/quote?platform=ANDROID',a);
      assert.equal(preview.status,200);assert.equal(preview.body.paymentEnabled,false);
      assert.match(preview.body.unavailableReason,/示例/);
      assert.equal((await call('/commerce/course-orders',a,'POST',{courseId:demo.id,platform:'ANDROID',requestKey:randomUUID(),quoteHash:q.quoteHash})).status,404);
      await db.course.update({where:{id:demo.id},data:{isDemo:false}});
      const pending=await order(demo.id);
      await db.teacher.update({where:{id:teacher.id},data:{isDemo:true}});
      assert.equal((await call('/commerce/course-orders/'+pending.id+'/payment',a,'POST',{})).status,409);
      await db.teacher.update({where:{id:teacher.id},data:{isDemo:false}});
    });
    await t.test('concurrent requests reuse one pending order; changed quote and reused idempotency key conflict',async()=>{
      const quote=(await call('/commerce/courses/'+primary.id+'/quote?platform=ANDROID',a)).body,body={courseId:primary.id,platform:'ANDROID',requestKey:randomUUID(),quoteHash:quote.quoteHash};
      const results=await Promise.all([call('/commerce/course-orders',a,'POST',body),call('/commerce/course-orders',a,'POST',body)]);assert.ok(results.every(r=>r.status===201),JSON.stringify(results));assert.equal(results[0].body.id,results[1].body.id);primaryOrder=results[0].body;assert.equal(primaryOrder.amount,'8800');assert.equal((await call('/commerce/course-orders',a,'POST',{...body,quoteHash:'a'.repeat(64)})).status,409);
      assert.equal((await call('/commerce/course-orders/'+primaryOrder.id,b)).status,404);assert.equal((await call('/commerce/course-orders/'+primaryOrder.id+'/payment',b,'POST',{})).status,404);
    });
    await t.test('prepay request and native SDK payload are RSA signed; pending payment does not grant playback',async()=>{await prepay(primaryOrder);const lessons=(await call('/learning/courses/'+primary.id,a)).body.lessons;assert.equal((await call('/learning/lessons/'+lessons[1].id+'/media',a,'POST',{})).status,403);assert.equal(await db.enrollment.count({where:{courseId:primary.id,userId:a.user.id}}),0);});
    await t.test('forged, stale and modified notifications never grant access',async()=>{
      primaryData=paid(primaryOrder);const packet=callback(primaryData),bad={...packet,headers:{...packet.headers,'Wechatpay-Signature':'WECHATPAY/SIGNTEST/invalid'}};assert.equal((await sendCallback(bad)).status,401);assert.equal((await sendCallback({...packet,body:packet.body+' '})).status,401);assert.equal((await sendCallback({...packet,headers:{...packet.headers,'Wechatpay-Serial':'UNKNOWN'}})).status,401);assert.equal((await sendCallback({...packet,headers:{...packet.headers,'Wechatpay-Timestamp':'1'}})).status,401);assert.equal(await db.enrollment.count({where:{courseId:primary.id,userId:a.user.id}}),0);
      const wrong=callback({...primaryData,appid:'wxAnotherMerchant'});assert.equal((await sendCallback(wrong)).status,400);
    });
    await t.test('concurrent verified callback retries grant exactly once with balanced journal and one notification',async()=>{
      const metricsBefore=(await call('/admin/overview',finance)).body.finance;
      const packet=callback(primaryData);const responses=await Promise.all([sendCallback(packet),sendCallback(packet)]);assert.ok(responses.every(r=>r.status===204),await Promise.all(responses.map(r=>r.text())));assert.equal(await db.paymentTransaction.count({where:{orderId:primaryOrder.id,disposition:'ACCEPTED'}}),1);assert.equal(await db.enrollment.count({where:{courseId:primary.id,userId:a.user.id}}),1);assert.equal(await db.notification.count({where:{eventKey:'course.paid:'+primaryOrder.id}}),1);const detail=(await call('/commerce/course-orders/'+primaryOrder.id,a)).body;assert.equal(detail.access,true);assert.equal(detail.state,'COMPLETED');assert.equal(detail.paidAmount,'8800');const journal=await db.financeJournal.findFirstOrThrow({where:{orderId:primaryOrder.id,kind:'COURSE_PAYMENT'}}),entries=await db.financeEntry.findMany({where:{journalId:journal.id}});assert.equal(entries.reduce((s,r)=>s+r.debit-r.credit,0n),0n);
      const metricsAfter=(await call('/admin/overview',finance)).body.finance;assert.equal(BigInt(metricsAfter.paid)-BigInt(metricsBefore.paid),8800n);assert.equal(metricsAfter.paidOrders-metricsBefore.paidOrders,1);assert.equal(BigInt(metricsAfter.trend.at(-1).paid)-BigInt(metricsBefore.trend.at(-1).paid),8800n);
      assert.equal((await call('/commerce/course-orders',a,'POST',{courseId:primary.id,platform:'ANDROID',requestKey:randomUUID(),quoteHash:(await call('/commerce/courses/'+primary.id+'/quote?platform=ANDROID',a)).body.quoteHash})).status,409);
    });
    await t.test('started paid media makes default refund ineligible; trial does not count as starting paid delivery',async()=>{
      const lessons=(await call('/learning/courses/'+primary.id,a)).body.lessons;assert.equal((await call('/learning/lessons/'+lessons[0].id+'/media',a,'POST',{})).status,201);assert.equal((await call('/commerce/course-orders/'+primaryOrder.id,a)).body.canRefund,true);assert.equal((await call('/learning/lessons/'+lessons[1].id+'/media',a,'POST',{})).status,201);assert.equal((await call('/commerce/course-orders/'+primaryOrder.id,a)).body.canRefund,false);assert.equal((await call('/commerce/course-orders/'+primaryOrder.id+'/refund',a,'POST',{requestKey:randomUUID(),reason:'已经学习的退款测试'})).status,400);const enrolled=await db.enrollment.findUniqueOrThrow({where:{userId_courseId:{userId:a.user.id,courseId:primary.id}}});await db.enrollment.update({where:{id:enrolled.id},data:{source:'ADMIN_COMPENSATION',orderItemId:null,startedAt:null}});assert.equal((await call('/commerce/course-orders/'+primaryOrder.id,a)).body.canRefund,false);assert.equal((await call('/commerce/course-orders/'+primaryOrder.id+'/refund',a,'POST',{requestKey:randomUUID(),reason:'独立授权不能抹去原订单已消费事实'})).status,400);
    });
    await t.test('purchased release and policies survive republishing and withdrawal; public requests remain denied',async()=>{
      const old=(await call('/learning/courses/'+primary.id,a)).body;
      const archived=await call('/admin/courses/'+primary.id+'/transition',root,'POST',{action:'archive',expectedVersion:primary.version,reason:'测试换版'});assert.equal(archived.status,201);
      const revision=await call('/admin/courses/'+primary.id+'/transition',root,'POST',{action:'revise',expectedVersion:archived.body.version,reason:'测试修订'});assert.equal(revision.status,201);
      await db.course.update({where:{id:primary.id},data:{title:prefix+'新版本',accessDays:30,refundPolicy:'新版本退课规则'}});
      const submit=await call('/admin/courses/'+primary.id+'/transition',root,'POST',{action:'submit',expectedVersion:revision.body.version,reason:'新版本提交'});assert.equal(submit.status,201);
      const published=await call('/admin/courses/'+primary.id+'/transition',root,'POST',{action:'publish',expectedVersion:submit.body.version,reason:'新版本发布'});assert.equal(published.status,201);assert.notEqual(published.body.publishedReleaseId,old.releaseId);
      assert.equal((await call('/learning/courses/'+primary.id,a)).body.releaseId,old.releaseId);assert.equal((await call('/catalog/courses/'+primary.id,a)).body.title,old.course.title);assert.equal((await call('/catalog/courses/'+primary.id,b)).body.title,published.body.title);
      await db.course.update({where:{id:primary.id},data:{status:'ARCHIVED',title:prefix+'变更标题',accessDays:30,refundPolicy:'改后的规则'}});const owned=await call('/catalog/courses/'+primary.id,a);assert.equal(owned.status,200);assert.equal(owned.body.title,old.course.title);assert.equal((await call('/catalog/courses/'+primary.id)).status,404);assert.equal((await call('/learning/courses/'+primary.id,a)).body.course.accessDays,null);assert.equal((await call('/learning/courses/'+primary.id,a)).body.course.refundPolicy,old.course.refundPolicy);assert.equal((await call('/learning/lessons/'+old.lessons[1].id+'/media',a,'POST',{})).status,201);
    });
    async function republish(c){
      const archived=await call('/admin/courses/'+c.id+'/transition',root,'POST',{action:'archive',expectedVersion:c.version,reason:'版本补偿测试下架'});assert.equal(archived.status,201);
      const revision=await call('/admin/courses/'+c.id+'/transition',root,'POST',{action:'revise',expectedVersion:archived.body.version,reason:'创建新版'});assert.equal(revision.status,201);
      await db.course.update({where:{id:c.id},data:{title:prefix+'课程新版',accessDays:1}});
      const submitted=await call('/admin/courses/'+c.id+'/transition',root,'POST',{action:'submit',expectedVersion:revision.body.version,reason:'提交新版'});assert.equal(submitted.status,201);
      const published=await call('/admin/courses/'+c.id+'/transition',root,'POST',{action:'publish',expectedVersion:submitted.body.version,reason:'审核新版'});assert.equal(published.status,201);return published.body;
    }
    async function chooseVersion(c,auth,options,target,extra={}){
      return call('/learning/courses/'+c.id+'/versions/choose',auth,'POST',{targetReleaseId:target.releaseId,requestKey:randomUUID(),expectedVersion:options.version,confirmationHash:target.confirmationHash,accepted:true,...extra});
    }
    await t.test('version upgrades require explicit consent, preserve original release, progress and expiry, and support restoring it',async()=>{
      const c=await course(true),row=await order(c.id);await prepay(row);paid(row);await call('/commerce/course-orders/'+row.id+'/refresh',a,'POST',{});
      const old=(await call('/learning/courses/'+c.id,a)).body,expiry=new Date(Date.now()+2*86400000);
      await db.enrollment.updateMany({where:{courseId:c.id,userId:a.user.id},data:{expiresAt:expiry}});
      const ticket=await call('/learning/lessons/'+old.lessons[2].id+'/media',a,'POST',{});assert.equal(ticket.status,201);
      const originalEnrollment=await db.enrollment.findFirstOrThrow({where:{courseId:c.id,userId:a.user.id}});
      const published=await republish(c);assert.equal((await call('/learning/courses/'+c.id,a)).body.releaseId,old.releaseId);
      assert.equal((await call('/learning/courses/'+c.id+'/versions',b)).status,404);
      const options=(await call('/learning/courses/'+c.id+'/versions',a)).body,target=options.choices.find(v=>v.releaseId===published.publishedReleaseId);
      assert.ok(target);assert.equal(options.choices.find(v=>v.original).releaseId,old.releaseId);
      assert.equal((await chooseVersion(c,a,options,target,{accepted:false})).status,400);
      assert.equal((await chooseVersion(c,a,options,target,{confirmationHash:'a'.repeat(64)})).status,409);
      const key=randomUUID(),responses=await Promise.all([chooseVersion(c,a,options,target,{requestKey:key}),chooseVersion(c,a,options,target,{requestKey:key})]);assert.ok(responses.every(r=>r.status===201),JSON.stringify(responses));
      assert.equal(await db.courseVersionChoice.count({where:{userId:a.user.id,requestKey:key}}),1);
      const enrollment=await db.enrollment.findFirstOrThrow({where:{courseId:c.id,userId:a.user.id}});assert.equal(enrollment.releaseId,published.publishedReleaseId);assert.equal(enrollment.expiresAt.getTime(),expiry.getTime());assert.equal(enrollment.startedAt.getTime(),originalEnrollment.startedAt.getTime());
      assert.equal((await call('/commerce/course-orders/'+row.id,a)).body.course.releaseId,old.releaseId);assert.equal((await call('/learning/courses/'+c.id,a)).body.releaseId,published.publishedReleaseId);
      const after=responses[0].body,original=after.choices.find(v=>v.original);assert.equal((await chooseVersion(c,a,options,original)).status,409);
      const restored=await chooseVersion(c,a,after,original);assert.equal(restored.status,201,JSON.stringify(restored.body));assert.equal((await call('/learning/courses/'+c.id,a)).body.releaseId,old.releaseId);
      assert.equal((await fetch(base+'/api/v1'+ticket.body.path)).status,200);assert.equal(await db.courseVersionChoice.count({where:{courseId:c.id}}),2);
    });
    await t.test('stopped delivery denies issued tickets and text, preserves history, and permits compensation refund after paid learning',async()=>{
      const c=await course(true),row=await order(c.id);await prepay(row);paid(row);await call('/commerce/course-orders/'+row.id+'/refresh',a,'POST',{});
      const old=(await call('/learning/courses/'+c.id,a)).body,ticket=(await call('/learning/lessons/'+old.lessons[2].id+'/media',a,'POST',{})).body;
      assert.equal((await call('/commerce/course-orders/'+row.id,a)).body.canRefund,false);
      const newer=await republish(c),dto={action:'WITHDRAW',expectedVersion:1,reason:'授权方撤销此旧版内容，提供替代版或全额退课',replacementReleaseId:newer.publishedReleaseId};
      assert.equal((await call('/admin/course-versions/'+old.releaseId+'/delivery',support,'POST',dto)).status,403);
      const withdrawn=await call('/admin/course-versions/'+old.releaseId+'/delivery',root,'POST',dto);assert.equal(withdrawn.status,201,JSON.stringify(withdrawn.body));
      assert.equal((await call('/admin/course-versions/'+old.releaseId+'/delivery',root,'POST',dto)).status,409);
      const blocked=(await call('/learning/courses/'+c.id,a)).body;assert.equal(blocked.deliveryBlocked,true);assert.ok(blocked.lessons.every(l=>!l.accessible));
      assert.equal((await call('/learning/lessons/'+old.lessons[0].id,a)).status,403);assert.equal((await fetch(base+'/api/v1'+ticket.path)).status,403);
      assert.equal((await call('/commerce/course-orders/'+row.id,a)).body.canRefund,true);
      await app.get(CourseSalesService).runJobs();assert.equal(await db.notification.count({where:{kind:'COURSE_VERSION',userId:a.user.id,resourceId:c.id}}),1);await app.get(CourseSalesService).runJobs();assert.equal(await db.notification.count({where:{kind:'COURSE_VERSION',userId:a.user.id,resourceId:c.id}}),1);
      const requested=await call('/commerce/course-orders/'+row.id+'/refund',a,'POST',{requestKey:randomUUID(),reason:'停止交付，选择退课'});assert.equal(requested.status,201);const refund=requested.body.refunds[0];assert.equal(refund.automatic,false);assert.equal((await db.refund.findUniqueOrThrow({where:{id:refund.id}})).reasonCode,'COURSE_WITHDRAWAL');
      assert.equal((await call('/learning/courses/'+c.id+'/versions',a)).status,409);
      const reviewed=await call('/admin/course-orders/refunds/'+refund.id+'/review',finance,'POST',{action:'APPROVE',expectedVersion:refund.version,reason:'停止交付补偿核实，原路全额退款'});assert.equal(reviewed.status,201,JSON.stringify(reviewed.body));await runRefundJobs();assert.equal((await call('/commerce/course-orders/'+row.id,a)).body.refundedAmount,'8800');
      assert.equal((await db.enrollment.findFirstOrThrow({where:{courseId:c.id,userId:a.user.id}})).releaseId,old.releaseId);
      await db.mediaAsset.update({where:{id:asset.id},data:{status:'DELETED'}});assert.equal((await call('/admin/course-versions/'+old.releaseId+'/delivery',root,'POST',{action:'RESTORE',expectedVersion:2,reason:'尝试恢复不可用课件'})).status,400);await db.mediaAsset.update({where:{id:asset.id},data:{status:'READY'}});
      const restored=await call('/admin/course-versions/'+old.releaseId+'/delivery',root,'POST',{action:'RESTORE',expectedVersion:2,reason:'已复核授权与课件，恢复交付'});assert.equal(restored.status,201);assert.equal((await call('/commerce/course-orders/'+row.id,a)).body.access,false);
    });
    await t.test('withdrawal replacement is optional and reversible, with history retained and no cross-course replacement',async()=>{
      const c=await course(),row=await order(c.id,b);await prepay(row,b);paid(row);await call('/commerce/course-orders/'+row.id+'/refresh',b,'POST',{});
      const newer=await republish(c),other=await course();assert.equal((await call('/admin/course-versions/'+c.publishedReleaseId+'/delivery',root,'POST',{action:'WITHDRAW',expectedVersion:1,reason:'错误跨课替代',replacementReleaseId:other.publishedReleaseId})).status,400);
      assert.equal((await call('/admin/course-versions/'+c.publishedReleaseId+'/delivery',root,'POST',{action:'WITHDRAW',expectedVersion:1,reason:'旧版授权撤销',replacementReleaseId:newer.publishedReleaseId})).status,201);
      const options=(await call('/learning/courses/'+c.id+'/versions',b)).body,target=options.choices.find(v=>v.releaseId===newer.publishedReleaseId),chosen=await chooseVersion(c,b,options,target);assert.equal(chosen.status,201,JSON.stringify(chosen.body));assert.equal((await call('/learning/courses/'+c.id,b)).body.deliveryBlocked,false);assert.equal((await db.courseVersionChoice.findFirstOrThrow({where:{courseId:c.id}})).action,'REPLACEMENT');
      assert.equal((await call('/admin/course-versions/'+c.publishedReleaseId+'/delivery',root,'POST',{action:'RESTORE',expectedVersion:2,reason:'授权恢复'})).status,201);
      const after=(await call('/learning/courses/'+c.id+'/versions',b)).body;assert.equal((await chooseVersion(c,b,after,after.choices.find(v=>v.original))).status,201);assert.equal((await call('/learning/courses/'+c.id,b)).body.releaseId,c.publishedReleaseId);
    });
    await t.test('new grants cannot inherit previous version choices; withdrawal also blocks free enrollment and library playback',async()=>{
      const c=await course(),row=await order(c.id,a);await prepay(row);paid(row);await call('/commerce/course-orders/'+row.id+'/refresh',a,'POST',{});
      const newer=await republish(c),options=(await call('/learning/courses/'+c.id+'/versions',a)).body;
      assert.equal((await chooseVersion(c,a,options,options.choices.find(v=>v.releaseId===newer.publishedReleaseId))).status,201);
      const before=await db.enrollment.findUniqueOrThrow({where:{userId_courseId:{userId:a.user.id,courseId:c.id}}});
      await db.enrollment.update({where:{id:before.id},data:{revokedAt:new Date()}});
      const granted=await call('/admin/courses/'+c.id+'/grant',root,'POST',{userId:a.user.id,reason:'新一期独立补授，不继承上期版本'});assert.equal(granted.status,201,JSON.stringify(granted.body));assert.notEqual(granted.body.grantKey,before.grantKey);assert.ok(granted.body.version>before.version);
      const fresh=(await call('/learning/courses/'+c.id+'/versions',a)).body;assert.equal(fresh.choices.find(v=>v.original).releaseId,newer.publishedReleaseId);assert.equal(fresh.choices.some(v=>v.releaseId===c.publishedReleaseId),false);
      const stopped=await call('/admin/course-versions/'+newer.publishedReleaseId+'/delivery',root,'POST',{action:'WITHDRAW',expectedVersion:1,reason:'测试停止新授权及免费加入'});assert.equal(stopped.status,201);
      await db.course.update({where:{id:c.id},data:{price:0}});assert.equal((await call('/learning/courses/'+c.id+'/enroll',b,'POST',{})).status,400);
      const library=(await call('/learning/library?size=50',a)).body.items.find(v=>v.course.id===c.id);assert.ok(library.deliveryBlocked);assert.ok(library.lessons.every(l=>!l.accessible));
    });
    await t.test('query after client success grants access only from a verified provider result',async()=>{const c=await course(),o=await order(c.id,b);await prepay(o,b);const before=await call('/commerce/course-orders/'+o.id+'/refresh',b,'POST',{});assert.equal(before.body.state,'PENDING');paid(o);const result=await call('/commerce/course-orders/'+o.id+'/refresh',b,'POST',{});assert.equal(result.body.access,true);});
    await t.test('refund request is private and idempotent; support cannot authorize monetary refunds',async()=>{
      const c=await course(),o=await order(c.id,b);await prepay(o,b);paid(o);await call('/commerce/course-orders/'+o.id+'/refresh',b,'POST',{});const request={requestKey:randomUUID(),reason:'课程不适合当前研习计划'};assert.equal((await call('/commerce/course-orders/'+o.id+'/refund',a,'POST',request)).status,404);const submitted=await call('/commerce/course-orders/'+o.id+'/refund',b,'POST',request);assert.equal(submitted.status,201);assert.equal((await call('/commerce/course-orders/'+o.id+'/refund',b,'POST',request)).status,201);assert.equal(submitted.body.refunds.length,1);const refund=submitted.body.refunds[0];assert.equal((await call('/admin/course-orders/refunds/'+refund.id+'/review',support,'POST',{expectedVersion:refund.version,action:'APPROVE',reason:'无权限测试'})).status,403);
      const approval=await call('/admin/course-orders/refunds/'+refund.id+'/review',finance,'POST',{expectedVersion:refund.version,action:'APPROVE',reason:'符合默认退课规则'});assert.equal(approval.status,201,JSON.stringify(approval.body));assert.equal(approval.body.refundedAmount,'0');assert.equal(approval.body.refunds[0].state,'REFUNDING');const lesson=(await call('/learning/courses/'+c.id,b)).body.lessons[1];assert.equal((await call('/learning/lessons/'+lesson.id+'/media',b,'POST',{})).status,403);
      networkFailure=true;await runRefundJobs();assert.equal((await call('/commerce/course-orders/'+o.id,b)).body.refundedAmount,'0');assert.equal((await call('/commerce/course-orders/'+o.id,b)).body.access,true);assert.equal((await db.outboxJob.findUniqueOrThrow({where:{eventKey:'course.refund:'+refund.id}})).state,'READY');networkFailure=false;await runRefundJobs();const final=(await call('/commerce/course-orders/'+o.id,b)).body;assert.equal(final.refundedAmount,'8800');assert.equal(final.access,false);assert.equal(final.refunds[0].state,'SUCCEEDED');assert.equal((await call('/learning/lessons/'+lesson.id+'/media',b,'POST',{})).status,403);await runRefundJobs();assert.equal(await db.refundTransaction.count({where:{refundId:refund.id}}),1);
    });
    await t.test('refund success cannot revoke a replacement manual grant; wrong refund amount cannot be confirmed',async()=>{
      const c=await course(),o=await order(c.id,a);await prepay(o);paid(o);await call('/commerce/course-orders/'+o.id+'/refresh',a,'POST',{});let result=await call('/commerce/course-orders/'+o.id+'/refund',a,'POST',{requestKey:randomUUID(),reason:'退款授权隔离测试'});const refund=result.body.refunds[0];await call('/admin/course-orders/refunds/'+refund.id+'/review',finance,'POST',{expectedVersion:refund.version,action:'APPROVE',reason:'符合退课规则'});
      const enrolled=await db.enrollment.findUniqueOrThrow({where:{userId_courseId:{userId:a.user.id,courseId:c.id}}});await db.enrollment.update({where:{id:enrolled.id},data:{source:'ADMIN_COMPENSATION',orderItemId:null,grantKey:randomUUID()}});await runRefundJobs();assert.equal((await call('/learning/courses/'+c.id,a)).body.access,'ENROLLED');const confirmed=refundTransactions.get((await db.refund.findUniqueOrThrow({where:{id:refund.id}})).channelRequestKey);assert.equal((await sendCallback(callback({...confirmed,amount:{...confirmed.amount,refund:1}},'REFUND.SUCCESS'))).status,400);
    });
    await t.test('duplicate and incorrect-amount receipts are retained and refunded without extra access or refunding the first payment',async()=>{
      const c=await course(),o=await order(c.id,a);await prepay(o);const first=paid(o);await sendCallback(callback(first));const duplicate={...first,transaction_id:'TX'+randomUUID()};receipts.set(duplicate.transaction_id,duplicate);assert.equal((await sendCallback(callback(duplicate))).status,204);await runRefundJobs();assert.equal((await call('/commerce/course-orders/'+o.id,a)).body.refundedAmount,'0');assert.equal((await call('/learning/courses/'+c.id,a)).body.access,'ENROLLED');assert.equal(await db.paymentTransaction.count({where:{orderId:o.id}}),2);assert.equal((await db.refund.findFirstOrThrow({where:{orderId:o.id}})).state,'SUCCEEDED');
      const c2=await course(),o2=await order(c2.id,a);await prepay(o2);assert.equal((await sendCallback(callback(paid(o2,1)))).status,204);await runRefundJobs();assert.equal(await db.enrollment.count({where:{courseId:c2.id,userId:a.user.id}}),0);assert.equal((await call('/commerce/course-orders/'+o2.id,a)).body.state,'CLOSED');assert.equal((await db.paymentTransaction.findFirstOrThrow({where:{orderId:o2.id}})).disposition,'AMOUNT_MISMATCH');
    });
    await t.test('cancel consults the channel and cannot close an already paid order; delayed closed-order receipt is refunded',async()=>{
      const c=await course(),o=await order(c.id,a);await prepay(o);paid(o);assert.equal((await call('/commerce/course-orders/'+o.id+'/cancel',a,'POST',{})).status,409);assert.equal((await call('/commerce/course-orders/'+o.id,a)).body.access,true);
      const lateCourse=await course(),late=await order(lateCourse.id,a);await prepay(late);assert.equal((await call('/commerce/course-orders/'+late.id+'/cancel',a,'POST',{})).status,201);assert.equal((await sendCallback(callback(paid(late)))).status,204);await runRefundJobs();assert.equal(await db.enrollment.count({where:{courseId:lateCourse.id,userId:a.user.id}}),0);assert.equal((await db.paymentTransaction.findFirstOrThrow({where:{orderId:late.id}})).disposition,'LATE');
    });
    await t.test('unknown network and invalid provider signatures stay pending without granting; retries recover through the original order',async()=>{
      const c=await course(),o=await order(c.id,a);corruptResponse=true;assert.equal((await call('/commerce/course-orders/'+o.id+'/payment',a,'POST',{})).status,503);corruptResponse=false;networkFailure=true;assert.equal((await call('/commerce/course-orders/'+o.id+'/refresh',a,'POST',{})).status,503);networkFailure=false;assert.equal(await db.enrollment.count({where:{courseId:c.id,userId:a.user.id}}),0);paid(o);assert.equal((await call('/commerce/course-orders/'+o.id+'/refresh',a,'POST',{})).body.access,true);
    });
    await t.test('delivery loss and frozen-account late receipts are refunded without granting access',async()=>{
      const c=await course(),o=await order(c.id,a);await prepay(o);await db.mediaAsset.update({where:{id:asset.id},data:{status:'DELETED'}});assert.equal((await sendCallback(callback(paid(o)))).status,204);await runRefundJobs();assert.equal((await db.paymentTransaction.findFirstOrThrow({where:{orderId:o.id}})).disposition,'REFUND_REQUIRED');assert.equal((await db.refund.findFirstOrThrow({where:{orderId:o.id}})).state,'SUCCEEDED');assert.equal(await db.enrollment.count({where:{courseId:c.id,userId:a.user.id}}),0);await db.mediaAsset.update({where:{id:asset.id},data:{status:'READY'}});
      const c2=await course(),o2=await order(c2.id,a);await prepay(o2);await db.user.update({where:{id:a.user.id},data:{status:'FROZEN'}});try{assert.equal((await sendCallback(callback(paid(o2)))).status,204);await runRefundJobs();assert.equal((await db.refund.findFirstOrThrow({where:{orderId:o2.id}})).state,'SUCCEEDED');assert.equal(await db.enrollment.count({where:{courseId:c2.id,userId:a.user.id}}),0);}finally{await db.user.update({where:{id:a.user.id},data:{status:'ACTIVE'}});}
    });
    await t.test('purchase refunds preserve separate membership access and its original period',async()=>{
      const c=await course(),o=await order(c.id,b);await prepay(o,b);paid(o);assert.equal((await call('/commerce/course-orders/'+o.id+'/refresh',b,'POST',{})).body.access,true);
      let plan=await db.membershipPlan.findFirst({where:{tier:1}});if(!plan){plan=await db.membershipPlan.create({data:{title:prefix+'会员',tier:1,days:30,price:100,description:'测试独立会员权限'}});plans.push(plan.id);}
      const member=await db.membership.create({data:{userId:b.user.id,planId:plan.id,tier:1,source:'ADMIN_COMPENSATION',startsAt:new Date(Date.now()-1000),endsAt:new Date(Date.now()+86400000)}});await db.course.update({where:{id:c.id},data:{membershipTier:1}});
      const submitted=await call('/commerce/course-orders/'+o.id+'/refund',b,'POST',{requestKey:randomUUID(),reason:'会员权益不受退课影响'});assert.equal(submitted.status,201);const refund=submitted.body.refunds[0];assert.equal((await call('/admin/course-orders/refunds/'+refund.id+'/review',finance,'POST',{action:'APPROVE',expectedVersion:refund.version,reason:'符合默认规则'})).status,201);await runRefundJobs();assert.equal((await call('/learning/courses/'+c.id,b)).body.access,'MEMBER');assert.equal((await db.membership.findUniqueOrThrow({where:{id:member.id}})).revokedAt,null);await db.membership.update({where:{id:member.id},data:{revokedAt:new Date()}});
    });
    await t.test('durable jobs expire unpaid orders; disabled or incomplete courses cannot collect money',async()=>{
      const c=await course(),o=await order(c.id,a);await db.tradeOrder.update({where:{id:o.id},data:{expiresAt:new Date(0)}});await db.outboxJob.updateMany({where:{aggregateId:o.id},data:{availableAt:new Date(0)}});await app.get(CourseSalesService).runJobs();assert.equal((await call('/commerce/course-orders/'+o.id,a)).body.state,'CLOSED');
      const draftCourse=await course();await db.mediaAsset.update({where:{id:asset.id},data:{status:'DELETED'}});const q=(await call('/commerce/courses/'+draftCourse.id+'/quote?platform=ANDROID',a)).body;assert.equal(q.paymentEnabled,false);assert.equal((await call('/commerce/course-orders',a,'POST',{courseId:draftCourse.id,platform:'ANDROID',requestKey:randomUUID(),quoteHash:q.quoteHash})).status,400);await db.mediaAsset.update({where:{id:asset.id},data:{status:'READY'}});
      process.env.COURSE_WECHAT_ENABLED='false';assert.equal((await call('/commerce/courses/'+draftCourse.id+'/quote?platform=ANDROID',a)).body.paymentEnabled,false);assert.equal((await call('/commerce/course-orders',a,'POST',{courseId:draftCourse.id,platform:'ANDROID',requestKey:randomUUID(),quoteHash:q.quoteHash})).status,503);process.env.COURSE_WECHAT_ENABLED='true';assert.ok(prepayCalls>0);
    });
    await t.test('account closure retains paid facts, requires explicit forfeiture and blocks unsettled refunds',async()=>{
      const closing=await login(),c=await course(),row=await order(c.id,closing);await prepay(row,closing);
      const receipt=paid(row);assert.equal((await sendCallback(callback(receipt))).status,204);
      const status=await call('/me/close-account/status',closing);assert.equal(status.body.paidCourses,1);
      assert.equal((await call('/me/close-account',closing,'POST',{confirmation:'确认注销'})).status,409);
      assert.equal((await call('/commerce/course-orders/'+row.id+'/refund',closing,'POST',{requestKey:randomUUID(),reason:'注销前先处理售后'})).status,201);
      assert.equal((await call('/me/close-account',closing,'POST',{confirmation:'确认注销',forfeitPaidAccess:true})).status,409);
      const refund=await db.refund.findFirstOrThrow({where:{orderId:row.id}});
      assert.equal((await call('/admin/course-orders/refunds/'+refund.id+'/review',finance,'POST',{expectedVersion:refund.version,action:'REJECT',reason:'测试拒绝后明确放弃学习'})).status,201);
      const closed=await call('/me/close-account',closing,'POST',{confirmation:'确认注销',forfeitPaidAccess:true});assert.equal(closed.status,201,JSON.stringify(closed.body));
      assert.equal(closed.body.receiptReference,closing.user.id);
      assert.equal((await call('/auth/me',closing)).status,401);
      assert.equal((await db.user.findUniqueOrThrow({where:{id:closing.user.id}})).status,'DELETED');
      assert.equal(await db.paymentTransaction.count({where:{orderId:row.id}}),1);
      assert.equal(await db.financeJournal.count({where:{orderId:row.id}}),1);
      assert.ok((await db.enrollment.findFirstOrThrow({where:{userId:closing.user.id}})).revokedAt);
      assert.equal((await app.get(CourseSalesService).confirmPayment(receipt)).disposition,'ACCEPTED');
    });
    await t.test('closing an unpaid order preserves late-payment compensation without restoring a deleted account',async()=>{
      const closing=await login(),c=await course(),row=await order(c.id,closing);await prepay(row,closing);
      await db.paymentAttempt.updateMany({where:{orderId:row.id},data:{updatedAt:new Date(Date.now()-60000)}});
      const closed=await call('/me/close-account',closing,'POST',{confirmation:'确认注销'});assert.equal(closed.status,201,JSON.stringify(closed.body));
      const receipt=paid(row);assert.equal((await sendCallback(callback(receipt))).status,204);
      assert.equal((await db.paymentTransaction.findFirstOrThrow({where:{orderId:row.id}})).disposition,'LATE');
      assert.equal(await db.enrollment.count({where:{userId:closing.user.id}}),0);
      await runRefundJobs();assert.equal((await db.refund.findFirstOrThrow({where:{orderId:row.id}})).state,'SUCCEEDED');
      assert.equal((await db.user.findUniqueOrThrow({where:{id:closing.user.id}})).status,'DELETED');
    });
  }finally{
    corruptResponse=false;networkFailure=false;await app.close();mock.restoreAll();
    const releases=await db.courseRelease.findMany({where:{courseId:{in:courses}},select:{id:true}}),offers=await db.saleOffer.findMany({where:{courseReleaseId:{in:releases.map(r=>r.id)}}}),items=await db.tradeOrderItem.findMany({where:{offerId:{in:offers.map(o=>o.id)}}}),orderIds=[...new Set(items.map(i=>i.orderId))],refunds=await db.refund.findMany({where:{orderId:{in:orderIds}}}),refundIds=refunds.map(r=>r.id),journals=await db.financeJournal.findMany({where:{orderId:{in:orderIds}},select:{id:true}});
      const groupItems=await db.tradeOrderItem.findMany({where:{orderId:{in:orderIds}}});const groupMembers=await db.groupBuyMember.findMany({where:{orderItemId:{in:groupItems.map(i=>i.id)}}});await db.groupBuyMember.deleteMany({where:{id:{in:groupMembers.map(m=>m.id)}}});await db.outboxJob.deleteMany({where:{aggregateId:{in:groupMembers.map(m=>m.groupId)}}});await db.groupBuy.deleteMany({where:{id:{in:groupMembers.map(m=>m.groupId)}}});const promotions=await db.promotion.findMany({where:{title:{startsWith:prefix}}});await db.promotionOffer.deleteMany({where:{promotionId:{in:promotions.map(p=>p.id)}}});await db.promotion.deleteMany({where:{id:{in:promotions.map(p=>p.id)}}});
    await db.userCoupon.deleteMany({where:{userId:{in:users}}});await db.couponTemplate.deleteMany({where:{title:{startsWith:prefix}}});
    await db.membership.deleteMany({where:{userId:{in:users}}});await clearPlans(db,plans);await db.membershipPlan.deleteMany({where:{id:{in:plans}}});await db.courseVersionChoice.deleteMany({where:{courseId:{in:courses}}});await db.enrollment.deleteMany({where:{courseId:{in:courses}}});await db.financeEntry.deleteMany({where:{journalId:{in:journals.map(j=>j.id)}}});await db.financeJournal.deleteMany({where:{id:{in:journals.map(j=>j.id)}}});await db.refundTransaction.deleteMany({where:{refundId:{in:refundIds}}});await db.refundItem.deleteMany({where:{refundId:{in:refundIds}}});await db.refund.deleteMany({where:{id:{in:refundIds}}});await db.paymentTransaction.deleteMany({where:{orderId:{in:orderIds}}});await db.paymentAttempt.deleteMany({where:{orderId:{in:orderIds}}});await db.notification.deleteMany({where:{userId:{in:users}}});await db.outboxJob.deleteMany({where:{aggregateId:{in:[...orderIds,...refundIds,...releases.map(r=>r.id)]}}});await db.tradeOrderItem.deleteMany({where:{orderId:{in:orderIds}}});await db.tradeOrder.deleteMany({where:{id:{in:orderIds}}});await db.providerCallback.deleteMany({where:{externalEventId:{in:eventIds}}});
    await clearCourses(db,courses);await db.course.deleteMany({where:{id:{in:courses}}});await db.teacher.deleteMany({where:{id:{in:teachers}}});await db.mediaAsset.deleteMany({where:{id:{in:assets}}});await db.authSession.deleteMany({where:{userId:{in:users}}});await db.auditLog.deleteMany({where:{actorId:{in:users}}});await db.user.deleteMany({where:{id:{in:users}}});await db.otpChallenge.deleteMany({where:{OR:[{phone:{in:phones}},{phoneHash:{in:phones.map(phoneLookup)}}]}});await db.rateLimit.deleteMany({where:{OR:[{key:{contains:prefix}},{key:{contains:ip}},...phones.map(phone=>({key:{endsWith:':'+phoneLookup(phone)}}))]}});await db.$disconnect();await rm(dir,{recursive:true,force:true});
  }
});
