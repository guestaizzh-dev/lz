import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';

const require=createRequire(new URL('../services/api/package.json',import.meta.url));
const {Pool}=require('pg');
const {chromium}=createRequire(process.env.ACADEMY_BROWSER_MODULE+'/package.json')('playwright');
const shopChecks=process.env.ACADEMY_SHOP_UI==='true',root=resolve('.'),output=resolve(shopChecks?'outputs/member-shop-pricing-2026-10-11':'outputs/member-partial-refund-2026-10-11');
const source=new URL(process.env.DATABASE_URL);
if(process.env.NODE_ENV==='production'||!['localhost','127.0.0.1'].includes(source.hostname))throw Error('UI checks require a local database');
const database='academy_test_ui_'+Date.now(),target=new URL(source);target.pathname='/'+database;
const pool=new Pool({connectionString:source.toString()});
await pool.query('CREATE DATABASE "'+database+'"');
Object.assign(process.env,{DATABASE_URL:target.toString(),NODE_ENV:'test',PREVIEW_LOGIN_ENABLED:'false',SMS_ENABLED:'false',MEMBERSHIP_SALES_ENABLED:'false',MEMBERSHIP_PAYMENT_WORKER_ENABLED:'false',COURSE_PAYMENT_WORKER_ENABLED:'false',PRODUCT_PAYMENT_WORKER_ENABLED:'false',MEDIA_DIR:resolve('work/member-ui-media-'+database)});
const results=[],servers=[],browserErrors=[];let app,db,browser,admin,mobile;
const run=args=>new Promise((ok,fail)=>{const child=spawn(process.execPath,args,{cwd:resolve('services/api'),env:process.env,stdio:'ignore',windowsHide:true});child.on('error',fail);child.on('exit',code=>code===0?ok():fail(Error('Migration failed')));});
async function serve(folder){const server=createServer(async(req,res)=>{try{let path=resolve(folder,'.'+decodeURIComponent(new URL(req.url,'http://local').pathname));if(!path.startsWith(folder+sep))path=resolve(folder,'index.html');let data;try{data=await readFile(path);}catch{path=resolve(folder,'index.html');data=await readFile(path);}res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.jpg':'image/jpeg'})[extname(path)]??'application/octet-stream');res.end(data);}catch{res.writeHead(500).end();}});await new Promise(ok=>server.listen(0,'127.0.0.1',ok));servers.push(server);return'http://127.0.0.1:'+server.address().port;}
try{
  await run(['node_modules/prisma/build/index.js','migrate','deploy']);
  const {createApp}=await import('../services/api/dist/main.js'),{Database}=await import('../services/api/dist/database.js'),{AuthService}=await import('../services/api/dist/auth.js'),{PaymentChannels}=await import('../services/api/dist/payment-channels.js'),{MembershipSalesService}=await import('../services/api/dist/membership-sales.js');
  db=new Database();app=await createApp(false);await app.listen(0,'127.0.0.1');const base=(await app.getUrl())+'/api/v1',auth=app.get(AuthService),channels=app.get(PaymentChannels),sales=app.get(MembershipSalesService);
  const identity={appid:'isolated-browser-app',mchid:'1900000001'},receipts=new Map();
  const adapter={identity:()=>identity,availability:()=>({enabled:true,reason:''}),prepay:async()=>'',query:async no=>receipts.get(no),refund:async(tx,ref,amount,total,no)=>({...identity,out_trade_no:no,transaction_id:tx,out_refund_no:ref,refund_id:'browser-ref-'+randomUUID(),status:'SUCCESS',success_time:new Date().toISOString(),amount:{refund:amount,total,currency:'CNY'}})};
  channels.resolve=()=>adapter;channels.choices=()=>[{channel:'WECHAT_APP',provider:'wxpay',label:'微信',enabled:true,reason:''}];process.env.MEMBERSHIP_SALES_ENABLED='true';
  async function session(role){const user=await db.user.create({data:{nickname:role==='USER'?'退款流程验证学员':'退款流程验证财务',roles:[role]}}),c=auth.credentials(),csrfToken=randomUUID();await db.authSession.create({data:{userId:user.id,kind:role==='USER'?'APP':'ADMIN',accessHash:c.accessHash,refreshHash:c.refreshHash,accessExpiresAt:c.accessExpiresAt,expiresAt:new Date(Date.now()+86400000),csrfToken}});return{user,csrfToken,access:c.access,headers:role==='USER'?{authorization:'Bearer '+c.access}:{cookie:'daoxue_access='+c.access,'x-csrf-token':csrfToken}};}
  const student=await session('USER'),finance=await session(shopChecks?'ADMIN':'FINANCE'),plan=await db.membershipPlan.findFirstOrThrow({where:{tier:1,days:30,active:true}}),quote=await sales.quote(plan.id,'ANDROID',student.user.id),order=await sales.checkout(student.user.id,{planId:plan.id,platform:'ANDROID',channel:'WECHAT_APP',quoteHash:quote.quoteHash,requestKey:randomUUID()});
  await sales.prepay(order.id,student.user.id);const receipt={...identity,out_trade_no:order.orderNo,trade_type:'APP',trade_state:'SUCCESS',transaction_id:'browser-payment-'+randomUUID(),success_time:new Date().toISOString(),amount:{total:Number(order.amount),currency:'CNY'}};receipts.set(order.orderNo,receipt);await sales.confirmPayment(receipt);
  const adminUrl=await serve(resolve('apps/admin/dist')),mobileUrl=await serve(resolve('apps/mobile/unpackage/dist/build/web'));
  browser=await chromium.launch({headless:true,channel:'msedge'});
  admin=await browser.newPage({viewport:{width:1440,height:1100}});mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  for(const [page,session,isMobile] of [[admin,finance,false],[mobile,student,true]]){
    page.setDefaultTimeout(20000);
    page.on('pageerror',error=>browserErrors.push(error.message));
    await page.route('**/api/v1/**',async route=>{
      const cors={'access-control-allow-origin':isMobile?mobileUrl:adminUrl,'access-control-allow-credentials':'true','access-control-allow-headers':'authorization,content-type,x-csrf-token','access-control-allow-methods':'GET,POST,PATCH,PUT,DELETE,OPTIONS'};
      if(route.request().method()==='OPTIONS'){await route.fulfill({status:204,headers:cors});return;}
      const path=new URL(route.request().url()).pathname.replace('/api/v1','')+new URL(route.request().url()).search;
      if(isMobile&&path==='/auth/sms'){await route.fulfill({headers:cors,json:{challengeId:randomUUID(),retryAfter:60,channel:'TEST'}});return;}
      if(isMobile&&path==='/auth/login'){await route.fulfill({headers:cors,json:{user:{...session.user,avatar:null,tags:[]},accessToken:session.access,refreshToken:'isolated-browser-session',expiresIn:3600}});return;}
      const headers={...route.request().headers(),...session.headers,origin:'http://127.0.0.1:5173'};delete headers.host;
      const response=await page.request.fetch(base+path,{method:route.request().method(),headers,data:route.request().postData()??undefined});await route.fulfill({response,headers:{...response.headers(),...cors}});
    });
  }
  await mobile.goto(mobileUrl+'/#/pages/auth/login?redirect='+encodeURIComponent('/pages/membership/purchase?orderId='+order.id));
  await mobile.locator('input').nth(0).fill('19900001002');await mobile.getByText('获取验证码',{exact:true}).click();await mobile.locator('input').nth(1).fill('123456');await mobile.locator('.consent-touch').click();await mobile.locator('.login-submit').click();
  await mobile.getByText('申请退订与退款核查 ›',{exact:true}).click();await mobile.locator('.compose-input textarea').fill('已经学习一部分，希望协商退订剩余期限');
  const requestResponse=mobile.waitForResponse(r=>r.url().endsWith('/refund')&&r.request().method()==='POST');await mobile.getByText('提交申请',{exact:true}).click();assert.equal((await requestResponse).status(),201);results.push('App申请核查使用真实隔离业务接口');
  await admin.goto(adminUrl+'/membership-orders');await admin.getByRole('button',{name:'查看与处理'}).first().click();await admin.getByRole('button',{name:'提出退款方案'}).click();await admin.getByLabel('经核查拟原路退款金额（元）').fill('10.00');await admin.getByLabel('已核实的处理意见与扣除依据').fill('核查原期限及服务使用，协商退回10元，扣除余下费用，待学员确认');
  const proposalResponse=admin.waitForResponse(r=>r.url().endsWith('/review')&&r.request().method()==='POST');await admin.locator('.ant-modal-footer').getByRole('button',{name:/确/}).click();assert.equal((await proposalResponse).status(),201);await admin.getByText('待学员确认方案',{exact:false}).first().waitFor();
  await admin.screenshot({path:output+'/admin-refund-proposal.png',fullPage:true});results.push('Pro核查金额与扣除依据并提出方案');
  await mobile.getByText('查询支付与退款结果 ›',{exact:true}).click();await mobile.getByText('确认金额并退订',{exact:true}).scrollIntoViewIfNeeded();await mobile.screenshot({path:output+'/app-refund-proposal.png',fullPage:true});
  const refund=await db.refund.findFirstOrThrow({where:{orderId:order.id}});assert.equal(refund.state,'APPROVED');assert.equal(await db.refundTransaction.count({where:{refundId:refund.id}}),0);results.push('学员确认前不发起渠道退款');
  await mobile.getByText('确认金额并退订',{exact:true}).click();const decisionResponse=mobile.waitForResponse(r=>r.url().endsWith('/decision')&&r.request().method()==='POST');await mobile.getByText('确认退订',{exact:true}).click();assert.equal((await decisionResponse).status(),201);assert.ok((await db.refund.findUniqueOrThrow({where:{id:refund.id}})).acceptedAt);results.push('App确认弹窗实际提交金额版本并记录接受');
  await sales.runJobs();assert.equal((await db.refund.findUniqueOrThrow({where:{id:refund.id}})).state,'SUCCEEDED');assert.equal((await db.tradeOrder.findUniqueOrThrow({where:{id:order.id}})).refundedTotal,1000n);results.push('隔离模拟渠道成功后按确认金额记账');
  if(shopChecks){
    await admin.goto(adminUrl+'/memberships');await admin.getByRole('row').filter({hasText:plan.title}).first().getByRole('button',{name:'权益版本',exact:true}).click();await admin.getByRole('button',{name:'调整新售商城权益'}).click();
    await admin.getByLabel('参与商品按原价的百分比计费').fill('90');await admin.getByLabel('减免基础配送费',{exact:true}).click();await admin.getByLabel('免邮所需折后商品金额（元）').fill('0');await admin.getByLabel('调整原因',{exact:true}).fill('隔离验证会员商品折扣与基础免邮');
    const versionResponse=admin.waitForResponse(r=>r.url().endsWith('/commerce')&&r.request().method()==='POST');await admin.locator('.ant-modal-footer').getByRole('button',{name:/确/}).click();assert.equal((await versionResponse).status(),201);results.push('Pro实际表单发布新商城权益版本');
    const province='界面验证'+randomUUID().slice(0,6);await db.deliveryZone.create({data:{province,enabled:true,fee:1200,surcharge:300}});
    const address=await db.address.create({data:{userId:student.user.id,recipient:'隔离验证学员',phone:'19900001002',province,city:'测试市',district:'测试区',detail:'隔离数据库，无实际配送',isDefault:true}});
    await db.membership.create({data:{userId:student.user.id,planId:plan.id,tier:1,source:'ADMIN_COMPENSATION',startsAt:new Date(Date.now()-1000),endsAt:new Date(Date.now()+86400000)}});
    const product=await db.product.create({data:{title:'研习笔记本',subtitle:'手工装订',description:'仅用于界面验证',category:'文创',type:'PHYSICAL',cover:'/static/art/books.svg',price:12900,culturalOrigin:'隔离测试',memberDiscountEligible:true,status:'PUBLISHED',skus:{create:{title:'标准装',price:12900,stock:10,active:true}}},include:{skus:true}});
    await mobile.goto(mobileUrl+'/#/pages/order/confirm?type=product&skuId='+product.skus[0].id+'&quantity=1');await mobile.getByText('会员商品优惠',{exact:true}).waitFor();await mobile.getByText('−¥12.90',{exact:true}).waitFor();await mobile.getByText('合计 ¥119.10',{exact:true}).scrollIntoViewIfNeeded();await mobile.screenshot({path:output+'/app-member-checkout.png',fullPage:true});results.push('App实际报价展示商品优惠、基础免邮、地区附加费和合计');
    const {ProductSalesService}=await import('../services/api/dist/product-sales.js'),products=app.get(ProductSalesService);process.env.PRODUCT_SALES_ENABLED='true';
    const dto={addressId:address.id,platform:'ANDROID',items:[{skuId:product.skus[0].id,quantity:1}]},q=await products.quote(student.user.id,dto),newOrder=await products.checkout(student.user.id,{...dto,channel:'WECHAT_APP',quoteHash:q.quoteHash,requestKey:randomUUID()});
    await admin.goto(adminUrl+'/orders');await admin.getByText('订单与售后',{exact:true}).first().click();await admin.getByText('购买时商品优惠',{exact:true}).waitFor();await admin.locator('.ant-drawer-content-wrapper').screenshot({path:output+'/admin-member-discount.png'});assert.equal(newOrder.discount,'1290');results.push('Pro订单展示与实际保存的会员优惠金额一致');
    await mobile.goto(mobileUrl+'/#/pages/membership/index');await mobile.getByText('参与折扣的实物商品按原价90%计费',{exact:true}).scrollIntoViewIfNeeded();await mobile.getByText('折后商品满¥0.00免基础配送费，地区附加费另计',{exact:true}).waitFor();await mobile.screenshot({path:output+'/app-actual-benefits.png',fullPage:true});results.push('App会员中心展示原授权实际折扣及免邮门槛');
    assert.equal(browserErrors.length,0,JSON.stringify(browserErrors));
  }
}catch(error){
  console.error(JSON.stringify({error:String(error),browserErrors,mobileUrl:mobile?.url(),body:mobile?await mobile.locator('body').innerText():null,adminBody:admin?await admin.locator('body').innerText():null}));
  if(mobile)await mobile.screenshot({path:output+'/app-ui-failure.png',fullPage:true});throw error;
}finally{
  await mkdir(output,{recursive:true});await writeFile(output+'/browser-checks.json',JSON.stringify({checks:results,isolatedDatabase:true,authInjection:true,controlledPaymentAdapter:true,commercialChannelEvidence:false},null,2));
  await browser?.close();for(const server of servers)await new Promise(ok=>server.close(ok));await app?.close();await db?.$disconnect();await pool.query('DROP DATABASE "'+database+'" WITH (FORCE)');await pool.end();
}
console.log(JSON.stringify({passed:results.length}));
