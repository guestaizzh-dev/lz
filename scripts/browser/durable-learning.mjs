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
const database='academy_test_durable_ui_'+Date.now(),target=new URL(source);target.pathname='/'+database;
const pool=new Pool({connectionString:source.toString()}),output=resolve('outputs/durable-learning-2026-10-15'),checks=[],errors=[],servers=[];
await mkdir(output,{recursive:true});await pool.query('CREATE DATABASE "'+database+'"');
Object.assign(process.env,{DATABASE_URL:target.toString(),NODE_ENV:'test',DEV_OTP_CODE:'123456',PREVIEW_LOGIN_ENABLED:'false',SMS_ENABLED:'true',MEMBERSHIP_PAYMENT_WORKER_ENABLED:'false',COURSE_PAYMENT_WORKER_ENABLED:'false',PRODUCT_PAYMENT_WORKER_ENABLED:'false',CORS_ORIGINS:'http://127.0.0.1:5173',MEDIA_DIR:resolve('work/cohort-ui-media-'+database)});
let db,app,browser,mobile,admin,mobileUrl,failure=null;
async function run(args){await new Promise((ok,fail)=>{const child=spawn(process.execPath,args,{cwd:resolve('services/api'),env:process.env,stdio:'ignore',windowsHide:true});child.on('error',fail);child.on('exit',code=>code===0?ok():fail(Error('Migration failed')));});}
async function serve(folder){const server=createServer(async(req,res)=>{try{let path=resolve(folder,'.'+decodeURIComponent(new URL(req.url,'http://local').pathname));if(!path.startsWith(folder+sep))path=resolve(folder,'index.html');let data;try{data=await readFile(path);}catch{path=resolve(folder,'index.html');data=await readFile(path);}res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.jpg':'image/jpeg'})[extname(path)]??'application/octet-stream');res.end(data);}catch{res.writeHead(500).end();}});await new Promise(ok=>server.listen(0,'127.0.0.1',ok));servers.push(server);return 'http://127.0.0.1:'+server.address().port;}

let mode='online',lostEvent='',refreshLost=false;const progressCalls=[],refreshCalls=[];
try{
  await run(['node_modules/prisma/build/index.js','migrate','deploy']);
  const {createApp}=await import('../../services/api/dist/main.js'),{Database}=await import('../../services/api/dist/database.js');
  db=new Database();app=await createApp(false);await app.listen(0,'127.0.0.1');const base=(await app.getUrl())+'/api/v1';
  const teacher=await db.teacher.create({data:{name:'书院测试讲师',title:'经典研习',bio:'仅供隔离测试',expertise:[],status:'PUBLISHED'}});
  const course=await db.course.create({data:{teacherId:teacher.id,title:'道德经共读',subtitle:'持久研习专项',description:'仅供隔离测试',category:'经典研习',cover:'',price:0,status:'PUBLISHED'}});
  const release=await db.courseRelease.create({data:{courseId:course.id,version:1,title:course.title,lessons:{create:['观其妙','知足常乐','上善若水'].map((title,index)=>({sourceId:randomUUID(),title,position:index+1,format:'TEXT',body:'研习正文 · '+title,durationSeconds:0,trial:false,required:true}))}},include:{lessons:true}});
  await db.course.update({where:{id:course.id},data:{publishedReleaseId:release.id}});
  mobileUrl=await serve(resolve('apps/mobile/unpackage/dist/build/web'));
  browser=await chromium.launch({channel:'msedge',headless:true});mobile=await browser.newPage({viewport:{width:390,height:844}});mobile.on('pageerror',e=>errors.push(e.message));
  await mobile.route('**/api/v1/**',async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname.slice('/api/v1'.length)+url.search;
    const cors={'access-control-allow-origin':new URL(mobile.url()).origin,'access-control-allow-headers':'content-type,authorization','access-control-allow-methods':'GET,POST,PATCH,PUT,DELETE,OPTIONS'};
    if(req.method()==='OPTIONS'){await route.fulfill({status:204,headers:cors});return;}
    const input=req.postData()?JSON.parse(req.postData()):null;
    if(path.includes('/progress'))progressCalls.push(input);
    if(path==='/auth/refresh')refreshCalls.push(input);
    if(mode==='all-offline'||(mode==='progress-offline'&&path.includes('/progress'))){await route.abort('failed');return;}
    const headers={...req.headers(),origin:'http://127.0.0.1:5173'};delete headers.host;
    const response=await mobile.request.fetch(base+path,{method:req.method(),headers,data:req.postData()??undefined});
    if(mode==='lost-completion'&&path.includes('/progress')&&input?.completed&&!lostEvent){lostEvent=input.eventId;await route.abort('failed');return;}
    if(mode==='lost-refresh'&&path==='/auth/refresh'&&!refreshLost){refreshLost=true;await route.abort('failed');return;}
    await route.fulfill({response,headers:{...response.headers(),...cors}});
  });
  await mobile.goto(mobileUrl+'/#/pages/auth/login');await mobile.locator('input').nth(0).fill('19900001997');
  const sms=mobile.waitForResponse(r=>r.url().endsWith('/auth/sms')&&r.request().method()==='POST');await mobile.getByText('获取验证码',{exact:true}).click();assert.equal((await sms).status(),201);
  await mobile.locator('input').nth(1).fill('123456');await mobile.locator('.consent-touch').click();const login=mobile.waitForResponse(r=>r.url().endsWith('/auth/login')&&r.request().method()==='POST');await mobile.locator('.login-submit').click();const credentials=await (await login).json();
  await mobile.getByText('正在登录…',{exact:true}).waitFor({state:'hidden'});
  await db.enrollment.create({data:{userId:credentials.user.id,courseId:course.id,releaseId:release.id,source:'FREE'}});
  await mobile.goto(mobileUrl+'/#/pages/course/player?id='+course.id);await mobile.getByText('标记本章已读',{exact:true}).waitFor();
  mode='progress-offline';await mobile.getByText('标记本章已读',{exact:true}).click();await mobile.getByText('本章已读，待同步',{exact:true}).waitFor();
  await mobile.locator('.lesson-title').getByText('知足常乐',{exact:true}).click();await mobile.getByText('研习正文 · 知足常乐',{exact:true}).waitFor();await mobile.getByText('标记本章已读',{exact:true}).click();await mobile.getByText('本章已读，待同步',{exact:true}).waitFor();
  await mobile.screenshot({path:output+'/pending-study.png',fullPage:true});checks.push('断网后本机保留已读记录、显示待同步，待发送记录不阻挡切章');
  mode='online';await mobile.getByText('重试同步',{exact:true}).click();await mobile.getByText('已完成研习',{exact:true}).first().waitFor();assert.equal(await db.studyProgress.count({where:{userId:credentials.user.id,completedAt:{not:null}}}),2);checks.push('恢复联网后两章自动依序补传并更新真实学习记录');
  await mobile.locator('.lesson-title').getByText('上善若水',{exact:true}).click();await mobile.getByText('研习正文 · 上善若水',{exact:true}).waitFor();mode='lost-completion';await mobile.getByText('标记本章已读',{exact:true}).click();await mobile.getByText('本章已读，待同步',{exact:true}).waitFor();
  await mobile.getByText('重试同步',{exact:true}).click();await mobile.getByText('已完成研习',{exact:true}).first().waitFor();assert.ok(lostEvent);assert.ok(progressCalls.filter(row=>row.eventId===lostEvent).length>=2);assert.equal(await db.studyEvent.count({where:{id:lostEvent}}),1);checks.push('服务器写入后响应丢失，重试使用同一事件且不重复完成或奖励');
  await mobile.goto(mobileUrl+'/#/pages/profile/settings');await mobile.getByText('保存研习方向',{exact:true}).waitFor();await db.authSession.updateMany({where:{userId:credentials.user.id},data:{accessExpiresAt:new Date(Date.now()-1000)}});
  mode='lost-refresh';await mobile.getByText('保存研习方向',{exact:true}).click();await mobile.getByText('暂时无法连接书院，请检查网络后重试',{exact:true}).waitFor();await mobile.getByText('保存研习方向',{exact:true}).click();await mobile.getByText('已保存',{exact:true}).waitFor();assert.equal(refreshCalls.length,2);assert.equal(refreshCalls[0].rotationId,refreshCalls[1].rotationId);checks.push('刷新响应丢失不清除登录，同一轮换编号重试后可继续保存');
  const browserStorage=await mobile.evaluate(()=>Object.values(localStorage).join(' '));assert.ok(!browserStorage.includes(credentials.accessToken));assert.ok(!browserStorage.includes(credentials.refreshToken));checks.push('普通浏览器Storage无登录令牌');
  mode='all-offline';await mobile.getByText('退出当前账号',{exact:true}).click();await mobile.goto(mobileUrl+'/#/pages/profile/settings');await mobile.getByText('隐私与设置',{exact:true}).waitFor();assert.equal(await mobile.getByText('退出当前账号',{exact:true}).count(),0);checks.push('断网时也能立即退出，不保留当前登录界面');
  assert.equal(errors.length,0,JSON.stringify(errors));
}catch(error){failure=String(error);errors.push(failure);console.error(failure);if(mobile){await mobile.screenshot({path:output+'/app-failure.png',fullPage:true});console.error((await mobile.locator('body').innerText()).slice(-2000));}throw error;}
finally{await writeFile(output+'/browser-checks.json',JSON.stringify({checks,errors,status:failure?'failed':'passed',isolatedDatabase:true,appRealOtp:true,nativeStorageVerified:false,businessResponsesMocked:false,networkFaultsInjected:true,commercialEvidence:false},null,2));await browser?.close();for(const server of servers)await new Promise(ok=>server.close(ok));await app?.close();await db?.$disconnect();await pool.query('DROP DATABASE "'+database+'" WITH (FORCE)');await pool.end();}
console.log(JSON.stringify({passed:checks.length,errors}));
