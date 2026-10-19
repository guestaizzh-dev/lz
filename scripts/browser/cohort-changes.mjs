import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';

const require=createRequire(new URL('../../services/api/package.json',import.meta.url)),{Pool}=require('pg'),{chromium}=createRequire(process.env.ACADEMY_BROWSER_MODULE+'/package.json')('playwright');
const source=new URL(process.env.DATABASE_URL);
if(process.env.NODE_ENV==='production'||!['localhost','127.0.0.1'].includes(source.hostname))throw Error('Use a local isolated database');
const database='academy_test_cohort_change_ui_'+Date.now(),target=new URL(source);target.pathname='/'+database;
const pool=new Pool({connectionString:source.toString()}),output=resolve('outputs/cohort-changes-2026-10-12'),checks=[],errors=[],servers=[];
await mkdir(output,{recursive:true});await pool.query('CREATE DATABASE "'+database+'"');
Object.assign(process.env,{DATABASE_URL:target.toString(),NODE_ENV:'test',DEV_OTP_CODE:'123456',PREVIEW_LOGIN_ENABLED:'false',SMS_ENABLED:'true',MEMBERSHIP_PAYMENT_WORKER_ENABLED:'false',COURSE_PAYMENT_WORKER_ENABLED:'false',PRODUCT_PAYMENT_WORKER_ENABLED:'false',CORS_ORIGINS:'http://127.0.0.1:5173',MEDIA_DIR:resolve('work/cohort-ui-media-'+database)});
let db,app,browser,mobile,admin,mobileUrl,failure=null;
async function run(args){await new Promise((ok,fail)=>{const child=spawn(process.execPath,args,{cwd:resolve('services/api'),env:process.env,stdio:'ignore',windowsHide:true});child.on('error',fail);child.on('exit',code=>code===0?ok():fail(Error('Migration failed')));});}
async function serve(folder){const server=createServer(async(req,res)=>{try{let path=resolve(folder,'.'+decodeURIComponent(new URL(req.url,'http://local').pathname));if(!path.startsWith(folder+sep))path=resolve(folder,'index.html');let data;try{data=await readFile(path);}catch{path=resolve(folder,'index.html');data=await readFile(path);}res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.jpg':'image/jpeg'})[extname(path)]??'application/octet-stream');res.end(data);}catch{res.writeHead(500).end();}});await new Promise(ok=>server.listen(0,'127.0.0.1',ok));servers.push(server);return 'http://127.0.0.1:'+server.address().port;}

const pending=p=>{p.catch(()=>{});return p;},day=86400000;
try{
  await run(['node_modules/prisma/build/index.js','migrate','deploy']);
  const {createApp}=await import('../../services/api/dist/main.js'),{Database}=await import('../../services/api/dist/database.js'),{AuthService}=await import('../../services/api/dist/auth.js'),{LearningService}=await import('../../services/api/dist/learning.js'),{CohortsService}=await import('../../services/api/dist/cohorts.js');
  db=new Database();app=await createApp(false);app.getHttpAdapter().getInstance().set('trust proxy','loopback');await app.listen(0,'127.0.0.1');const base=(await app.getUrl())+'/api/v1',auth=app.get(AuthService),cohorts=app.get(CohortsService),learning=app.get(LearningService);
  const operator=await db.user.create({data:{nickname:'书院运营验证',roles:['ADMIN']}}),student=await db.user.create({data:{phone:'19900001002',nickname:'共学体验学员',roles:['USER']}}),credentials=auth.credentials(),csrfToken=randomUUID();
  await db.authSession.create({data:{userId:operator.id,kind:'ADMIN',accessHash:credentials.accessHash,refreshHash:credentials.refreshHash,accessExpiresAt:credentials.accessExpiresAt,expiresAt:new Date(Date.now()+day),csrfToken}});
  const req={actor:operator,permissions:[],requestId:randomUUID()},teacher=await db.teacher.create({data:{name:'书院共学讲师',title:'经典研习',bio:'共读经典，联系日常实践。',expertise:['经典'],status:'PUBLISHED'}});
  const course=await db.course.create({data:{teacherId:teacher.id,title:'道德经共读',subtitle:'以经典观照日常',description:'共读《道德经》，记录每一期的研习所得。',category:'经典研习',format:'VIDEO',cover:'/static/art/books.svg',price:0,tags:[],status:'PUBLISHED'}});
  const release=await db.courseRelease.create({data:{courseId:course.id,version:1,title:course.title,descriptionSnapshot:course.description,lessons:{create:[{sourceId:randomUUID(),title:'第一章 · 观其妙',position:1,format:'TEXT',body:'道可道，非常道。名可名，非常名。研习提示：从日常经验中体会文字与事物的关系。',durationSeconds:0,trial:false,required:true},{sourceId:randomUUID(),title:'第二章 · 知足常乐',position:2,format:'TEXT',body:'知足不辱，知止不殆。联系日常生活，记录节制与知足的体会。',durationSeconds:0,trial:false,required:true}]}},include:{lessons:true}});
  await db.course.update({where:{id:course.id},data:{publishedReleaseId:release.id}});
  await db.enrollment.create({data:{userId:student.id,courseId:course.id,releaseId:release.id,source:'FREE'}});
  await learning.progress(release.lessons[0].id,student.id,{eventId:randomUUID(),positionSeconds:0,elapsedSeconds:0,completed:true});
  const body={courseId:course.id,startsAt:new Date(Date.now()+day).toISOString(),endsAt:new Date(Date.now()+7*day).toISOString(),enrollDeadline:new Date(Date.now()+day-60000).toISOString(),capacity:10};
  const assistant=await db.user.create({data:{nickname:'本期共学助教',roles:['TEACHER']}});
  const first=await cohorts.create(req,{...body,title:'道德经共学 · 第一期'}),second=await cohorts.create(req,{...body,title:'道德经共学 · 第二期'});

  mobileUrl=await serve(resolve('apps/mobile/unpackage/dist/build/web'));const adminUrl=await serve(resolve('apps/admin/dist'));
  browser=await chromium.launch({headless:true,channel:'msedge'});admin=await browser.newPage({viewport:{width:1440,height:1050}});mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  for(const [page,isMobile] of [[admin,false],[mobile,true]]){
    page.setDefaultTimeout(18000);page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/api/v1/**',async route=>{
      const request=route.request(),url=new URL(request.url()),path=url.pathname.replace('/api/v1','')+url.search,cors={'access-control-allow-origin':isMobile?mobileUrl:adminUrl,'access-control-allow-credentials':'true','access-control-allow-headers':'authorization,content-type,x-csrf-token','access-control-allow-methods':'GET,POST,PATCH,PUT,DELETE,OPTIONS'};
      if(request.method()==='OPTIONS'){await route.fulfill({status:204,headers:cors});return;}
      const headers={...request.headers(),origin:'http://127.0.0.1:5173','x-forwarded-for':'2001:db8::'+(isMobile?'1':'2'),...(!isMobile?{cookie:'daoxue_access='+credentials.access,'x-csrf-token':csrfToken}:{})};delete headers.host;
      const response=await page.request.fetch(base+path,{method:request.method(),headers,data:request.postData()??undefined});await route.fulfill({response,headers:{...response.headers(),...cors}});
    });
  }

  await cohorts.state(req,first.id,{expectedVersion:1,state:'OPEN',reason:'开放本期'});await cohorts.state(req,second.id,{expectedVersion:1,state:'OPEN',reason:'开放另一营期'});
  await admin.goto(adminUrl+'/cohorts');let row=admin.locator('tr').filter({hasText:first.title});await row.getByText('延期',{exact:true}).waitFor();
  await mobile.goto(mobileUrl+'/#/pages/cohort/detail?id='+first.id);await mobile.getByText('免费报名本期',{exact:true}).click();await mobile.locator('input').nth(0).fill('19900001002');const sms=pending(mobile.waitForResponse(r=>r.url().endsWith('/auth/sms')&&r.request().method()==='POST'));await mobile.getByText('获取验证码',{exact:true}).click();assert.equal((await sms).status(),201);await mobile.getByText(/秒后重发/).waitFor();await mobile.locator('input').nth(1).fill('123456');await mobile.locator('.consent-touch').click();await mobile.locator('.login-submit').click();await mobile.getByText(first.title,{exact:true}).waitFor();await mobile.getByText('免费报名本期',{exact:true}).click();const joined=pending(mobile.waitForResponse(r=>r.url().endsWith('/join')&&r.request().method()==='POST'));await mobile.getByText('确认报名',{exact:true}).click();assert.equal((await joined).status(),201);await mobile.getByText('已报名 · 等待开营',{exact:true}).waitFor();
  await cohorts.join({actor:student},second.id);
  await admin.reload();row=admin.locator('tr').filter({hasText:first.title});await row.getByText('延期',{exact:true}).click();const modal=admin.locator('.ant-modal:visible');await modal.getByRole('spinbutton').fill('7');await modal.locator('textarea').fill('讲师行程调整，本期整体顺延七天。');const changed=pending(admin.waitForResponse(r=>r.url().endsWith('/postpone')&&r.request().method()==='POST'));await modal.getByRole('button',{name:'确认延期',exact:true}).click();assert.equal((await changed).status(),201);await modal.waitFor({state:'hidden'});await admin.screenshot({path:output+'/admin-cohort-postpone.png',fullPage:true});checks.push('Pro整体延期，预览北京时间与学员通知原因后保存');
  await cohorts.runNoticeJobs();await mobile.goto(mobileUrl+'/#/pages/profile/messages');await mobile.getByText('训练营安排已延期',{exact:true}).click();await mobile.waitForURL(url=>url.hash.includes('/pages/cohort/detail?id='+first.id));await mobile.getByText('确认新的营期安排',{exact:true}).waitFor();await mobile.getByText(/原报名安排/).waitFor();await mobile.screenshot({path:output+'/app-cohort-schedule-pending.png'});checks.push('App延期消息直达原营期，显示新旧安排并要求确认');
  await mobile.getByText('确认新的营期安排',{exact:true}).click();const accepted=pending(mobile.waitForResponse(r=>r.url().endsWith('/accept-schedule')&&r.request().method()==='POST'));await mobile.getByText('确认新安排',{exact:true}).click();assert.equal((await accepted).status(),201);await mobile.getByText('本期作业与老师点评',{exact:true}).waitFor();await mobile.getByText('确认新的营期安排',{exact:true}).waitFor({state:'hidden'});checks.push('App确认最新安排后恢复本期入口');
  await row.getByText('延期',{exact:true}).click();await modal.getByRole('spinbutton').fill('1');await modal.locator('textarea').fill('最终安排再顺延一天，可选择退出本期。');const next=pending(admin.waitForResponse(r=>r.url().endsWith('/postpone')&&r.request().method()==='POST'));await modal.getByRole('button',{name:'确认延期',exact:true}).click();assert.equal((await next).status(),201);await modal.waitFor({state:'hidden'});
  await mobile.goto(mobileUrl+'/#/pages/cohort/index');await mobile.locator('.cohort-card').filter({hasText:first.title}).click();await mobile.getByText('确认新的营期安排',{exact:true}).waitFor();await mobile.getByText('取消本期报名',{exact:true}).click();const withdrew=pending(mobile.waitForResponse(r=>r.url().endsWith('/cancel')&&r.request().method()==='POST'));await mobile.getByText('确认取消',{exact:true}).click();assert.equal((await withdrew).status(),201);await mobile.getByText(/退出时安排/).waitFor();assert.equal((await db.courseCohort.findUniqueOrThrow({where:{id:first.id}})).confirmed,0);checks.push('App拒绝第二次延期并退出，释放一次席位且保留退出时安排');
  const secondRow=admin.locator('tr').filter({hasText:second.title});await secondRow.getByText('取消本期',{exact:true}).click();await modal.locator('textarea').fill('本期安排取消，另行公布共学计划。');const cancelled=pending(admin.waitForResponse(r=>r.url().endsWith('/cancel')&&r.request().method()==='POST'));await modal.getByRole('button',{name:'确认取消本期',exact:true}).click();assert.equal((await cancelled).status(),201);await modal.waitFor({state:'hidden'});await secondRow.getByText('已取消',{exact:true}).waitFor();checks.push('Pro取消整期，关闭报名并释放已报名席位');
  await cohorts.runNoticeJobs();await mobile.goto(mobileUrl+'/#/pages/profile/messages');await mobile.getByText('训练营已取消',{exact:true}).click();await mobile.waitForURL(url=>url.hash.includes('/pages/cohort/detail?id='+second.id));await mobile.getByText('本期已取消',{exact:true}).first().waitFor();assert.equal(await mobile.getByText('免费报名本期',{exact:true}).count(),0);await mobile.screenshot({path:output+'/app-cohort-cancelled.png'});checks.push('App取消通知直达原营期，保留原因和原安排并关闭报名');
  await mobile.goto(mobileUrl+'/#/pages/cohort/index');await mobile.locator('.cohort-card').filter({hasText:second.title}).getByText('本期已取消',{exact:true}).waitFor();await mobile.locator('.cohort-card').filter({hasText:first.title}).getByText('已退出',{exact:true}).waitFor();checks.push('我的训练营区分整期取消与本人退出，历史仍可打开');
  assert.equal(errors.length,0,JSON.stringify(errors));
}catch(error){failure=String(error);errors.push(failure);console.error(failure);if(mobile){await mobile.screenshot({path:output+'/app-failure.png',fullPage:true});console.error((await mobile.locator('body').innerText()).slice(-2500));}if(admin){await admin.screenshot({path:output+'/admin-failure.png',fullPage:true});console.error((await admin.locator('body').innerText()).slice(-2500));}throw error;
}finally{
  await writeFile(output+'/browser-checks.json',JSON.stringify({checks,errors,status:failure?'failed':'passed',isolatedDatabase:true,adminSessionInjection:true,appRealOtp:true,businessResponsesMocked:false,commercialEvidence:false},null,2));await browser?.close();for(const server of servers)await new Promise(ok=>server.close(ok));await app?.close();await db?.$disconnect();await pool.query('DROP DATABASE "'+database+'" WITH (FORCE)');await pool.end();
}
console.log(JSON.stringify({passed:checks.length,errors}));
