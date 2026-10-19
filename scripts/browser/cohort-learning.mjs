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
const database='academy_test_cohort_ui_'+Date.now(),target=new URL(source);target.pathname='/'+database;
const pool=new Pool({connectionString:source.toString()}),output=resolve('outputs/cohort-learning-2026-10-12'),checks=[],errors=[],servers=[];
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
  const release=await db.courseRelease.create({data:{courseId:course.id,version:1,title:course.title,descriptionSnapshot:course.description,lessons:{create:{sourceId:randomUUID(),title:'第一章 · 观其妙',position:1,format:'TEXT',body:'道可道，非常道。名可名，非常名。研习提示：从日常经验中体会文字与事物的关系。',durationSeconds:0,trial:false,required:true}}},include:{lessons:true}});
  await db.course.update({where:{id:course.id},data:{publishedReleaseId:release.id}});
  await db.enrollment.create({data:{userId:student.id,courseId:course.id,releaseId:release.id,source:'FREE'}});
  await learning.progress(release.lessons[0].id,student.id,{eventId:randomUUID(),positionSeconds:0,elapsedSeconds:0,completed:true});
  const body={courseId:course.id,startsAt:new Date(Date.now()+day).toISOString(),endsAt:new Date(Date.now()+7*day).toISOString(),enrollDeadline:new Date(Date.now()+day-60000).toISOString(),capacity:10};
  const first=await cohorts.create(req,{...body,title:'道德经共学 · 第一期'}),second=await cohorts.create(req,{...body,title:'道德经共学 · 第二期'});
  await cohorts.state(req,first.id,{expectedVersion:1,state:'OPEN',reason:'共学开放'});await cohorts.state(req,second.id,{expectedVersion:1,state:'OPEN',reason:'共学开放'});
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
  const detail=id=>mobileUrl+'/#/pages/cohort/detail?id='+id;
  async function visitCohort(title){await mobile.goto(mobileUrl+'/#/pages/cohort/index');await mobile.locator('.cohort-card').filter({hasText:title}).click();await mobile.getByText(title,{exact:true}).waitFor();}
  await mobile.goto(detail(first.id));await mobile.getByText('免费报名本期',{exact:true}).click();await mobile.locator('input').nth(0).fill('19900001002');
  const sms=pending(mobile.waitForResponse(r=>r.url().endsWith('/auth/sms')&&r.request().method()==='POST'));await mobile.getByText('获取验证码',{exact:true}).click();assert.equal((await sms).status(),201);
  await mobile.getByText(/秒后重发/).waitFor();await mobile.locator('input').nth(1).fill('123456');await mobile.locator('.consent-touch').click();await mobile.locator('.login-submit').click();await mobile.getByText(first.title,{exact:true}).waitFor();checks.push('从报名进入真实验证码登录后，返回原营期继续报名');
  async function join(){await mobile.getByText('免费报名本期',{exact:true}).click();const joined=pending(mobile.waitForResponse(r=>r.url().endsWith('/join')&&r.request().method()==='POST'));await mobile.getByText('确认报名',{exact:true}).click();assert.equal((await joined).status(),201);await mobile.getByText('已报名 · 等待开营',{exact:true}).waitFor();}
  await join();await mobile.screenshot({path:output+'/app-cohort-registered.png',fullPage:true});checks.push('已持有普通课程权限的学员可报名，并显示等待开营');
  await db.courseCohort.update({where:{id:first.id},data:{startsAt:new Date(Date.now()-60000)}});
  await mobile.goto(mobileUrl+'/#/pages/course/detail?id='+course.id);await mobile.locator('.cohort-link').filter({hasText:second.title}).click();await join();checks.push('同一课程可继续报名第二期，保留两期记录');
  await visitCohort(first.title);await mobile.getByText('开始本期研习',{exact:true}).click();await mobile.getByText('标记本章已读',{exact:true}).waitFor();assert.ok(mobile.url().includes('cohortId='+first.id));assert.equal(await mobile.getByText('课程版本与交付处理 ›',{exact:true}).count(),0);checks.push('本期播放器使用独立进度，不继承普通课程的已读状态');
  await mobile.screenshot({path:output+'/app-cohort-player.png',fullPage:true});const saved=pending(mobile.waitForResponse(r=>r.url().includes('/progress?cohortId=')&&r.request().method()==='POST'));await mobile.getByText('标记本章已读',{exact:true}).click();assert.equal((await saved).status(),201);await mobile.getByText('查看本期研习完成记录 ›',{exact:true}).click();await mobile.getByText(first.title,{exact:true}).waitFor();await mobile.getByText('复制记录编号',{exact:true}).waitFor();await mobile.screenshot({path:output+'/app-cohort-certificate.png',fullPage:true});checks.push('完成本期章节后获得带营期名称的独立研习记录');
  await admin.goto(adminUrl+'/cohorts');await admin.locator('tr').filter({hasText:first.title}).getByRole('button',{name:'学员名单',exact:true}).click();await admin.locator('.ant-drawer-content-wrapper:visible').getByText('1 / 1',{exact:true}).waitFor();await admin.locator('.ant-drawer-content-wrapper:visible').screenshot({path:output+'/admin-cohort-progress.png'});checks.push('Pro学员名单显示实际本期完成进度');
  await visitCohort(second.title);await mobile.getByText('取消本期报名',{exact:true}).click();const cancelled=pending(mobile.waitForResponse(r=>r.url().endsWith('/cancel')&&r.request().method()==='POST'));await mobile.getByText('确认取消',{exact:true}).click();assert.equal((await cancelled).status(),201);await mobile.getByText('免费报名本期',{exact:true}).waitFor();await visitCohort(first.title);await mobile.getByText('查看本期研习完成记录',{exact:true}).waitFor();checks.push('取消第二期后，第一期记录和独立购课保持有效');
  await db.courseCohort.update({where:{id:first.id},data:{endsAt:new Date(Date.now()-1000)}});await visitCohort(first.title);await mobile.getByText('查看本期研习完成记录',{exact:true}).waitFor();assert.equal(await mobile.getByText('开始本期研习',{exact:true}).count(),0);await mobile.getByText('查看本期研习完成记录',{exact:true}).click();await mobile.getByText(first.title,{exact:true}).waitFor();checks.push('结营后学习入口关闭，历史研习完成记录仍可查看');
  assert.equal(errors.length,0,JSON.stringify(errors));
}catch(error){failure=String(error);errors.push(failure);console.error(failure);if(mobile){await mobile.screenshot({path:output+'/app-failure.png',fullPage:true});console.error((await mobile.locator('body').innerText()).slice(-3500));}throw error;
}finally{
  await writeFile(output+'/browser-checks.json',JSON.stringify({checks,errors,status:failure?'failed':'passed',isolatedDatabase:true,adminSessionInjection:true,appRealOtp:true,businessResponsesMocked:false,commercialEvidence:false},null,2));await browser?.close();for(const server of servers)await new Promise(ok=>server.close(ok));await app?.close();await db?.$disconnect();await pool.query('DROP DATABASE "'+database+'" WITH (FORCE)');await pool.end();
}
console.log(JSON.stringify({passed:checks.length,errors}));
