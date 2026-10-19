import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

// Run with the local API .env. All API writes stay in a disposable database copy.
const require=createRequire(new URL('../../services/api/package.json',import.meta.url));
const {Pool}=require('pg');
const {chromium}=createRequire(process.env.ACADEMY_BROWSER_MODULE+'/package.json')('playwright');
const source=new URL(process.env.DATABASE_URL);
assert.ok(['127.0.0.1','localhost'].includes(source.hostname)&&process.env.NODE_ENV!=='production');
const original=decodeURIComponent(source.pathname.slice(1)),database='academy_test_ui_review_'+Date.now();
assert.match(original,/^[a-zA-Z0-9_]+$/);
const connection=new URL(source);connection.pathname='/postgres';
const control=new Pool({connectionString:connection.toString()});
const output=resolve(process.env.ACADEMY_BROWSER_OUTPUT??'outputs/app-ui-review-2026-10-15');
const checks=[],screens=[],errors=[];
let db,app,browser,server,failure;
await mkdir(output,{recursive:true});
await control.query(`CREATE DATABASE "${database}" TEMPLATE "${original}"`);
source.pathname='/'+database;
Object.assign(process.env,{DATABASE_URL:source.toString(),NODE_ENV:'test',DEV_OTP_CODE:'123456',SMS_ENABLED:'true',PREVIEW_LOGIN_ENABLED:'false',CORS_ORIGINS:'http://127.0.0.1:5173',COURSE_PAYMENT_WORKER_ENABLED:'false',MEMBERSHIP_PAYMENT_WORKER_ENABLED:'false',PRODUCT_PAYMENT_WORKER_ENABLED:'false',BOOKING_PAYMENT_WORKER_ENABLED:'false',COHORT_PAYMENT_WORKER_ENABLED:'false'});
try{
  await new Promise((ok,no)=>{const child=spawn(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{cwd:resolve('services/api'),env:process.env,stdio:'ignore',windowsHide:true});child.on('error',no);child.on('exit',code=>code===0?ok():no(Error('Isolated migration failed')));});
  const {createApp}=await import('../../services/api/dist/main.js');
  const {Database}=await import('../../services/api/dist/database.js');
  const {phoneLookup}=await import('../../services/api/dist/private-data.js');
  db=new Database();app=await createApp(false);await app.listen(0,'127.0.0.1');
  const api=(await app.getUrl())+'/api/v1';
  const web=resolve('apps/mobile/unpackage/dist/build/web');
  server=createServer(async(req,res)=>{try{
    const path=resolve(web,'.'+decodeURIComponent(new URL(req.url,'http://local').pathname));
    if(path!==web&&!path.startsWith(web+sep)){res.writeHead(403).end();return;}
    const file=path===web?resolve(web,'index.html'):path;
    res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.ttf':'font/ttf','.otf':'font/otf'})[extname(file)]??'application/octet-stream');
    res.end(await readFile(file));
  }catch{res.writeHead(404).end();}});
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  const base='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,channel:'msedge'});
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
  const responses=[];
  await page.route('**/api/v1/**',async route=>{
    const req=route.request(),url=new URL(req.url());
    const cors={'access-control-allow-origin':base,'access-control-allow-credentials':'true','access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,POST,PATCH,PUT,DELETE,OPTIONS'};
    if(req.method()==='OPTIONS'){await route.fulfill({status:204,headers:cors});return;}
    const headers={...req.headers(),origin:'http://127.0.0.1:5173'};delete headers.host;
    const response=await page.request.fetch(api+url.pathname.replace('/api/v1','')+url.search,{method:req.method(),headers,data:req.postData()??undefined});
    responses.push({path:url.pathname,status:response.status()});
    await route.fulfill({response,headers:{...response.headers(),...cors}});
  });
  async function nav(path){await page.goto(base+'/#/'+path);await page.waitForTimeout(350);await page.waitForFunction(()=>![...document.querySelectorAll('.state-title')].some(e=>e.textContent==='正在整理内容'),{timeout:12000});await page.evaluate(()=>document.fonts.ready);}
  await nav('pages/auth/login');
  await page.screenshot({path:output+'/auth-login.png',animations:'disabled'});
  screens.push({path:'pages/auth/login',mode:'login',http:[]});
  await page.locator('input').nth(0).fill('19900001002');
  await page.locator('.send-code').click();await page.getByText(/秒后重发/).waitFor();
  await page.locator('input').nth(1).fill('123456');await page.locator('.consent-touch').click();await page.locator('.login-submit').click();
  await page.locator('.login-submit').waitFor({state:'hidden'});checks.push('真实验证码登录，操作仅落隔离数据库');
  const student=await db.user.findFirstOrThrow({where:{phoneHash:phoneLookup('19900001002')}});
  const course=await db.course.findFirstOrThrow({where:{status:'PUBLISHED',publishedReleaseId:{not:null}}});
  const article=await db.article.findFirstOrThrow({where:{status:'PUBLISHED'}});
  const teacher=await db.teacher.findFirstOrThrow({where:{status:'PUBLISHED'}});
  const product=await db.product.findFirstOrThrow({where:{status:'PUBLISHED'}});
  const event=await db.event.findFirst({where:{status:'PUBLISHED',price:0}});
  const plan=await db.membershipPlan.findFirst({where:{active:true}});
  const thread=await db.forumThread.findFirst();
  const section=await db.forumSection.findFirst();
  const room=await db.liveRoom.findFirst();const live=await db.liveSession.findFirst();
  const order=await db.order.findFirst({where:{userId:student.id}});
  const admin=await db.user.findFirstOrThrow({where:{roles:{has:'ADMIN'}}});
  const req={actor:admin,permissions:[],requestId:randomUUID()};
  const {CohortsService}=await import('../../services/api/dist/cohorts.js');
  const cohorts=app.get(CohortsService),day=86400000;
  const cohort=await cohorts.create(req,{courseId:course.id,title:'道德经七日共读 · 秋日营',startsAt:new Date(Date.now()+day*3).toISOString(),endsAt:new Date(Date.now()+day*10).toISOString(),enrollDeadline:new Date(Date.now()+day*2).toISOString(),capacity:30,price:0});
  await cohorts.state(req,cohort.id,{state:'OPEN',expectedVersion:cohort.version,reason:'隔离界面走查'});
  let registration=null,bookingTicket=null;
  if(event){
    const {BookingsService}=await import('../../services/api/dist/bookings.js');
    const bookings=app.get(BookingsService);
    await db.event.update({where:{id:event.id},data:{startsAt:new Date(Date.now()+day),endsAt:new Date(Date.now()+day*4),capacity:100}});
    const session=await bookings.createSession(req,event.id,{startsAt:new Date(Date.now()+day*2).toISOString(),endsAt:new Date(Date.now()+day*2+3600000).toISOString(),publicOpenAt:new Date(Date.now()-60000).toISOString(),cancelDeadline:new Date(Date.now()+day).toISOString(),location:'书院共读室',capacity:20,ticketTitle:'共读席位',perUserLimit:2});
    bookingTicket=await db.eventTicketType.findFirstOrThrow({where:{sessionId:session.id}});
    registration=await bookings.register({actor:student,permissions:[],requestId:randomUUID()},{ticketTypeId:bookingTicket.id,requestKey:randomUUID(),quantity:1,name:'研习学员',phone:'19900001002',contactConsent:true});
  }
  const sku=await db.productSku.findFirst({where:{productId:product.id}});
  const nil='00000000-0000-4000-8000-000000000000';
  const queries={
    'article/detail':'id='+article.id,'teacher/detail':'id='+teacher.id,'product/detail':'id='+product.id,
    'event/detail':'id='+(event?.id??nil),'course/purchase':'courseId='+course.id,'membership/purchase':'planId='+(plan?.id??nil),
    'order/confirm':'type=product&skuId='+(sku?.id??nil)+'&quantity=1',
    'community/detail':'id='+(thread?.id??nil),'community/editor':'sectionId='+(section?.id??nil),
    'live/detail':'id='+(room?.id??nil),'live/watch':'id='+(live?.id??nil)+'&roomId='+(live?.roomId??nil),
    'order/detail':'id='+(order?.id??nil),'shop/order-detail':'id='+(order?.id??nil),
    'booking/credential':'id='+(registration?.id??nil),'booking/confirm':'eventId='+(event?.id??nil),
    'booking/purchase':bookingTicket?'kind=registration&resourceId='+bookingTicket.id+'&quantity=1':'orderId='+nil,'cohort/purchase':'cohortId='+cohort.id,'cohort/detail':'id='+cohort.id,
    'profile/library':'kind=notes','profile/service':'kind=orders','shared/index':'code=invalid-review-link'
  };
  const config=JSON.parse(await readFile('apps/mobile/pages.json','utf8'));
  for(const entry of config.pages){
    const path=entry.path,short=path.replace('pages/','');
    if(path==='pages/auth/login')continue;
    const query=queries[short]??(short.startsWith('course/')&&!['course/library','course/orders'].includes(short)?'id='+course.id:'');
    const at=responses.length;
    await nav(path+(query?'?'+query:''));
    const state=await page.evaluate(()=>({text:document.querySelector('uni-page')?.innerText??document.body.innerText,width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1}));
    assert.ok(state.text.trim(),path+' rendered blank');assert.equal(state.overflow,false,path+' overflows viewport');
    const name=short.replaceAll('/','-');await page.screenshot({path:output+'/'+name+'.png',animations:'disabled'});
    screens.push({path,mode:state.text.includes('暂时无法打开')?'error-state':'content-or-empty',http:responses.slice(at).filter(r=>r.status>=400)});
  }
  for(const path of ['pages/academy/index','pages/search/index','pages/community/index','pages/shop/orders','pages/profile/library?kind=notes','pages/course/library','pages/profile/index','pages/membership/index']){
    await page.setViewportSize({width:320,height:740});await nav(path);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,path+' narrow overflow');
  }
  checks.push('八类重点页面320px窄屏未产生整页横向溢出');
  for(const path of ['pages/profile/messages','pages/profile/settings','pages/profile/feedback','pages/profile/library?kind=practice','pages/teacher/detail?id='+teacher.id,'pages/course/library']){
    await nav(path);await page.evaluate(()=>{for(const element of document.querySelectorAll('uni-text,uni-button,input,textarea')){const style=getComputedStyle(element),font=parseFloat(style.fontSize),line=parseFloat(style.lineHeight);element.style.fontSize=(font*1.3)+'px';if(Number.isFinite(line))element.style.lineHeight=(line*1.3)+'px';}});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,path+' enlarged text overflow');
    await page.screenshot({path:output+'/large-'+path.split('?')[0].replaceAll('/','-')+'.png',animations:'disabled'});
  }
  checks.push('消息/设置/客服/日志/名师/学习档案320px与130%模拟大字无整页横向溢出（非原生字号验收）');
  // The screenshot complaints, checked through real rendered controls and requests.
  await nav('pages/academy/index');
  await page.setViewportSize({width:320,height:740});
  const rail=page.locator('.chip-scroll .uni-scroll-view').last();
  const scrolled=await rail.evaluate(e=>{e.scrollLeft=1000;return{width:e.clientWidth,content:e.scrollWidth,left:e.scrollLeft};});
  assert.ok(scrolled.content>scrolled.width&&scrolled.left>0,JSON.stringify(scrolled));
  await page.getByText('少儿启蒙',{exact:true}).click();await page.waitForTimeout(350);
  assert.match(responses.at(-1).path,/catalog\/courses/);checks.push('320px学堂分类存在真实横向溢出，可滚动并选择末项');
  await page.screenshot({path:output+'/academy-narrow.png',animations:'disabled'});
  await page.setViewportSize({width:390,height:844});
  await nav('pages/cohort/index');
  assert.equal(await page.locator('.page-title').count(),0);
  const tool=await page.locator('.list-toolbar-action').evaluate(e=>({h:e.getBoundingClientRect().height,bg:getComputedStyle(e).backgroundColor}));
  assert.ok(tool.h>=44&&tool.bg==='rgba(0, 0, 0, 0)',JSON.stringify(tool));
  await page.getByText('看看开放的训练营',{exact:true}).click();await page.waitForTimeout(500);
  assert.match(page.url(),/pages\/academy\/index/);
  assert.equal(await page.locator('.category-item').filter({hasText:'训练营'}).locator('.category-circle-selected').count(),1);
  checks.push('训练营空态直接切换学堂并选中训练营，订单入口无默认白按钮');
  await nav('pages/booking/mine');assert.equal(await page.locator('.page-title').count(),0);
  await page.getByText('订单与售后 ›',{exact:true}).click();await page.waitForTimeout(350);assert.match(page.url(),/booking\/orders/);
  checks.push('预约列表订单入口可用，去除重复大标题');
  await nav('pages/profile/library?kind=practice');await page.locator('.new-entry').click();
  await page.locator('.compose-input textarea').fill('今日读上善若水，记下日常实践与理解。');
  assert.equal(await page.locator('.compose-submit').isVisible(),true);await page.screenshot({path:output+'/journal-editor.png',animations:'disabled'});
  await page.setViewportSize({width:740,height:360});await page.locator('.date-toggle').click();
  const compose=await page.locator('.compose-submit').boundingBox();
  assert.ok(compose&&compose.y>=0&&compose.y+compose.height<=360,'横屏展开日期后保存按钮超出屏幕');
  await page.screenshot({path:output+'/journal-landscape.png',animations:'disabled'});
  const bodyScroll=await page.locator('.compose-body').evaluate(root=>[...root.querySelectorAll('.uni-scroll-view')].map(e=>{e.scrollTop=10000;return{height:e.clientHeight,content:e.scrollHeight,top:e.scrollTop,overflow:getComputedStyle(e).overflowY};}));
  assert.ok(bodyScroll.some(e=>e.top>0&&['auto','scroll'].includes(e.overflow)),'横屏编辑内容必须能滚动到输入框：'+JSON.stringify(bodyScroll));
  const inputBox=await page.locator('.compose-input').boundingBox();
  assert.ok(inputBox&&inputBox.y>=0&&inputBox.y+inputBox.height<=compose.y,'滚动后输入框必须位于保存按钮上方');
  assert.equal(await page.locator('.compose-input textarea').inputValue(),'今日读上善若水，记下日常实践与理解。');
  await page.setViewportSize({width:390,height:844});
  await page.locator('.compose-close').click();checks.push('日志弹窗输入与关闭，编辑按钮保持可见');
  await nav('pages/academy/index');
  await page.route('**/api/v1/catalog/courses?**',r=>r.abort('failed'));
  await page.getByText('经典研习',{exact:true}).click();await page.locator('.state-retry').waitFor();
  assert.equal(await page.getByText('这一类课程正在筹备',{exact:true}).count(),0);
  await page.unroute('**/api/v1/catalog/courses?**');await page.locator('.state-retry').click();
  await page.waitForTimeout(400);assert.equal(await page.locator('.state-retry').count(),0);checks.push('分类网络错误只有重试态，重试后恢复，不混入空态');
  await page.route('**/api/v1/catalog/courses?**',r=>r.fulfill({status:500,contentType:'application/json',body:JSON.stringify({message:'Internal database connection error'})}));
  await page.getByText('实践修行',{exact:true}).click();await page.getByText('服务暂时繁忙，请稍后重试',{exact:true}).waitFor();
  assert.equal(await page.getByText('Internal database connection error',{exact:true}).count(),0);checks.push('服务端故障显示中文反馈，不向用户输出内部错误');
  assert.deepEqual(errors,[]);
}catch(e){failure=e;}
finally{
  await writeFile(output+'/report.json',JSON.stringify({testedAt:new Date().toISOString(),platform:'Edge Web，非原生验收',checks,screens,errors,failure:failure?.stack??null},null,2));
  if(browser)await browser.close();if(server)await new Promise(ok=>server.close(ok));
  if(app)await app.close();if(db)await db.$disconnect();
  await control.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1',[database]);
  await control.query(`DROP DATABASE "${database}"`);await control.end();
}
console.log(JSON.stringify({checks:checks.length,screens:screens.length,errors,failure:failure?.message??null}));
if(failure)throw failure;

