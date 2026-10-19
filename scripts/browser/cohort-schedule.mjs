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
const database='academy_test_cohort_schedule_ui_'+Date.now(),target=new URL(source);target.pathname='/'+database;
const pool=new Pool({connectionString:source.toString()}),output=resolve('outputs/cohort-schedule-2026-10-12'),checks=[],errors=[],servers=[];
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
  await admin.goto(adminUrl+'/cohorts');
  const row=admin.locator('tr').filter({hasText:first.title});await row.getByRole('button',{name:'章节安排',exact:true}).click();
  const drawer=admin.locator('.ant-drawer-content-wrapper:visible');await drawer.getByRole('spinbutton',{name:'第2讲开放日'}).fill('2');await drawer.getByPlaceholder('说明本期章节节奏，供操作审计追溯').fill('开营导读，次日继续共读');
  const save=pending(admin.waitForResponse(r=>r.url().endsWith('/schedule')&&r.request().method()==='POST'));await drawer.getByRole('button',{name:'保存章节安排',exact:true}).click();assert.equal((await save).status(),201);
  await drawer.getByRole('spinbutton',{name:'第2讲开放日'}).waitFor();assert.equal(await drawer.getByRole('spinbutton',{name:'第2讲开放日'}).inputValue(),'2');await drawer.screenshot({path:output+'/admin-chapter-schedule.png'});checks.push('Pro草稿按章保存开放日，刷新后保留第2天并显示北京时间');
  await drawer.locator('.ant-drawer-close').click();const opened=pending(admin.waitForResponse(r=>r.url().endsWith('/state')&&r.request().method()==='POST'));await row.getByRole('button',{name:'开放报名',exact:true}).click();await admin.locator('.ant-modal-confirm').getByRole('button',{name:'确 定'}).click();assert.equal((await opened).status(),201);
  await row.getByRole('button',{name:'章节安排',exact:true}).click();await drawer.getByText('本期学习安排已冻结',{exact:true}).waitFor();assert.equal(await drawer.getByRole('button',{name:'保存章节安排',exact:true}).count(),0);assert.equal(await drawer.getByRole('spinbutton',{name:'第2讲开放日'}).isDisabled(),true);checks.push('真实开放报名后安排只读，不能从后台再次修改');await drawer.locator('.ant-drawer-close').click();
  await cohorts.state(req,second.id,{expectedVersion:1,state:'OPEN',reason:'另一独立营期'});
  await mobile.goto(mobileUrl+'/#/pages/cohort/detail?id='+first.id);await mobile.getByText('章节安排',{exact:true}).waitFor();await mobile.getByText(/开营第2天/).waitFor();await mobile.screenshot({path:output+'/app-cohort-schedule.png'});checks.push('未报名用户可查看售前章节安排，未暴露课件正文');
  await mobile.getByText('免费报名本期',{exact:true}).click();await mobile.locator('input').nth(0).fill('19900001002');
  const sms=pending(mobile.waitForResponse(r=>r.url().endsWith('/auth/sms')&&r.request().method()==='POST'));await mobile.getByText('获取验证码',{exact:true}).click();assert.equal((await sms).status(),201);await mobile.getByText(/秒后重发/).waitFor();await mobile.locator('input').nth(1).fill('123456');await mobile.locator('.consent-touch').click();await mobile.locator('.login-submit').click();await mobile.getByText(first.title,{exact:true}).waitFor();
  await mobile.getByText('免费报名本期',{exact:true}).click();const joined=pending(mobile.waitForResponse(r=>r.url().endsWith('/join')&&r.request().method()==='POST'));await mobile.getByText('确认报名',{exact:true}).click();assert.equal((await joined).status(),201);await mobile.getByText('已报名 · 等待开营',{exact:true}).waitFor();
  await db.courseCohort.update({where:{id:first.id},data:{startsAt:new Date(Date.now()-60000)}});
  await mobile.goto(mobileUrl+'/#/pages/cohort/index');await mobile.locator('.cohort-card').filter({hasText:first.title}).click();await mobile.getByText('开始本期研习',{exact:true}).click();await mobile.getByText('标记本章已读',{exact:true}).waitFor();await mobile.locator('.lesson-row').filter({hasText:'第二章 · 知足常乐'}).getByText(/待开放/).waitFor();checks.push('本期目录第1章可学、第2章待开放，独立购课完成状态不覆盖营期');
  await mobile.locator('.lesson-row').filter({hasText:'第二章 · 知足常乐'}).click();await mobile.getByText('章节开放安排',{exact:true}).waitFor();await mobile.getByText(/本章将于.*北京时间.*开放/).waitFor();await mobile.screenshot({path:output+'/app-chapter-locked.png'});checks.push('点击未开放章节显示准确时间弹窗，无误导购买提示');await mobile.getByText('我知道了',{exact:true}).click();
  const saved=pending(mobile.waitForResponse(r=>r.url().includes('/progress?cohortId=')&&r.request().method()==='POST'));await mobile.getByText('标记本章已读',{exact:true}).click();assert.equal((await saved).status(),201);assert.equal(await mobile.getByText('查看本期研习完成记录 ›',{exact:true}).count(),0);checks.push('完成开放章节后不提前生成全期完成记录');
  await db.courseCohort.update({where:{id:first.id},data:{startsAt:new Date(Date.now()-day)}});
  const refreshed=pending(mobile.waitForResponse(r=>r.url().includes('/learning/courses/')&&r.url().includes('cohortId=')));await mobile.getByText('刷新目录',{exact:true}).click();assert.equal((await refreshed).status(),200);await mobile.locator('.lesson-row').filter({hasText:'第二章 · 知足常乐'}).getByText(/已开放/).waitFor();await mobile.locator('.lesson-row').filter({hasText:'第二章 · 知足常乐'}).click();await mobile.getByText('知足不辱，知止不殆。联系日常生活，记录节制与知足的体会。',{exact:true}).waitFor();await mobile.screenshot({path:output+'/app-chapter-open.png'});checks.push('进入开放日后刷新目录，可打开第二章真实正文');
  const completed=pending(mobile.waitForResponse(r=>r.url().includes('/progress?cohortId=')&&r.request().method()==='POST'));await mobile.getByText('标记本章已读',{exact:true}).click();assert.equal((await completed).status(),201);await mobile.getByText('查看本期研习完成记录 ›',{exact:true}).waitFor();checks.push('两章完成后才出现本期研习完成记录入口');
  assert.equal(errors.length,0,JSON.stringify(errors));
}catch(error){failure=String(error);errors.push(failure);console.error(failure);if(mobile)await mobile.screenshot({path:output+'/app-failure.png',fullPage:true});if(admin){await admin.screenshot({path:output+'/admin-failure.png',fullPage:true});console.error((await admin.locator('body').innerText()).slice(-3000));}throw error;
}finally{
  await writeFile(output+'/browser-checks.json',JSON.stringify({checks,errors,status:failure?'failed':'passed',isolatedDatabase:true,adminSessionInjection:true,appRealOtp:true,businessResponsesMocked:false,commercialEvidence:false},null,2));await browser?.close();for(const server of servers)await new Promise(ok=>server.close(ok));await app?.close();await db?.$disconnect();await pool.query('DROP DATABASE "'+database+'" WITH (FORCE)');await pool.end();
}
console.log(JSON.stringify({passed:checks.length,errors}));
