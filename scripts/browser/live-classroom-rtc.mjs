import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile,access} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';

const require=createRequire(new URL('../../services/api/package.json',import.meta.url)),{Pool}=require('pg'),{chromium}=createRequire(process.env.ACADEMY_BROWSER_MODULE+'/package.json')('playwright');
const capture=process.env.ACADEMY_RTC_CAPTURE_FILE?resolve(process.env.ACADEMY_RTC_CAPTURE_FILE):null;
if(capture)await access(capture);
const source=new URL(process.env.DATABASE_URL);
if(process.env.NODE_ENV==='production'||!['localhost','127.0.0.1'].includes(source.hostname))throw Error('Real RTC business verification requires an isolated local database');
const database='academy_test_rtc_delivery_'+Date.now(),target=new URL(source);target.pathname='/'+database;
const pool=new Pool({connectionString:source.toString()}),output=resolve(process.env.ACADEMY_BROWSER_OUTPUT??'outputs/zego-rtc-r1-2026-10-13'),checks=[],errors=[],diagnostics=[],servers=[];
await mkdir(output,{recursive:true});await pool.query('CREATE DATABASE "'+database+'"');
Object.assign(process.env,{DATABASE_URL:target.toString(),NODE_ENV:'test',DEV_OTP_CODE:'123456',PREVIEW_LOGIN_ENABLED:'false',SMS_ENABLED:'true',COURSE_PAYMENT_WORKER_ENABLED:'false',COHORT_PAYMENT_WORKER_ENABLED:'false',BOOKING_PAYMENT_WORKER_ENABLED:'false',ZEGO_ALLOW_UNVERIFIED_TOKEN_AUTH:'true',CORS_ORIGINS:'http://127.0.0.1:5173'});
let db,app,browser,host,mobile,guest,failed,learnerTokens,viewerLease;
async function serve(folder){const server=createServer(async(req,res)=>{try{let path=resolve(folder,'.'+decodeURIComponent(new URL(req.url,'http://local').pathname));if(!path.startsWith(folder+sep))path=resolve(folder,'index.html');let data;try{data=await readFile(path);}catch{path=resolve(folder,'index.html');data=await readFile(path);}res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.png':'image/png','.otf':'font/otf'})[extname(path)]??'application/octet-stream');res.end(data);}catch{res.writeHead(500).end();}});await new Promise(ok=>server.listen(0,'127.0.0.1',ok));servers.push(server);return 'http://127.0.0.1:'+server.address().port;}
const watchdog=setTimeout(()=>{failed='Real RTC workflow exceeded four minutes';void browser?.close();},240000);
try{
  await new Promise((ok,fail)=>{const p=spawn(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{cwd:resolve('services/api'),env:process.env,stdio:'ignore',windowsHide:true});p.on('error',fail);p.on('exit',code=>code===0?ok():fail(Error('Migration failed')));});
  const {createApp}=await import('../../services/api/dist/main.js'),{Database}=await import('../../services/api/dist/database.js'),{AuthService}=await import('../../services/api/dist/auth.js');
  db=new Database();app=await createApp(false);app.getHttpAdapter().getInstance().set('trust proxy','loopback');await app.listen(0,'127.0.0.1');const base=(await app.getUrl())+'/api/v1',auth=app.get(AuthService);
  const operator=await db.user.create({data:{nickname:'RTC实际研习运营',roles:['ADMIN']}}),credentials=auth.credentials(),csrfToken=randomUUID();
  await db.authSession.create({data:{userId:operator.id,kind:'ADMIN',accessHash:credentials.accessHash,refreshHash:credentials.refreshHash,accessExpiresAt:credentials.accessExpiresAt,expiresAt:new Date(Date.now()+86400000),csrfToken}});
  const teacher=await db.teacher.create({data:{name:'清和老师',title:'道学研习',bio:'真实RTC链路验证',status:'PUBLISHED'}});
  const headers={Origin:'http://127.0.0.1:5173','Content-Type':'application/json',Cookie:'daoxue_access='+credentials.access,'X-CSRF-Token':csrfToken};
  async function post(path,data){const r=await fetch(base+path,{method:'POST',headers,body:JSON.stringify(data)});const body=await r.json();assert.equal(r.status,201,JSON.stringify(body));return body;}
  let room=await post('/admin/live',{title:'道德经 · 不争之道',summary:'真实RTC推流、课程观看与结束验证',teacherId:teacher.id,categoryCode:'CULTURE',accessMode:'PUBLIC'});
  await post('/admin/live-discovery/'+room.id+'/publication',{title:'道德经 · 不争之道',summary:'真实RTC推流、课程观看与结束验证',state:'PUBLISHED',expectedVersion:1,reason:'验证公开研习展示'});
  let session=await post('/admin/live/rooms/'+room.id+'/sessions',{title:'不争之道 · 实际推流',hostUserId:operator.id,scheduledAt:new Date(Date.now()+300000).toISOString()});
  session=await post('/admin/live/sessions/'+session.id+'/state',{action:'PREPARE',expectedVersion:session.version,reason:'实际SDK开播'});
  const hostLease=await post('/admin/live/sessions/'+session.id+'/host',{});
  const mobileUrl=await serve(resolve('.runtime/live-room-web'));process.env.CORS_ORIGINS+=','+mobileUrl;
  browser=await chromium.launch({headless:true,channel:'msedge',args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',...(capture?['--use-file-for-fake-video-capture='+capture]:[])]});
  const context=await browser.newContext({permissions:['camera','microphone']});host=await context.newPage();mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await host.addInitScript(()=>{window.__csp=[];document.addEventListener('securitypolicyviolation',e=>window.__csp.push({directive:e.violatedDirective,blocked:e.blockedURI.split('?')[0]}));});
  for(const page of [host,mobile])page.on('requestfailed',r=>{const u=new URL(r.url());diagnostics.push({request:u.origin+u.pathname,error:r.failure()?.errorText});});
  host.setDefaultTimeout(45000);mobile.setDefaultTimeout(25000);host.on('pageerror',e=>errors.push(e.message));mobile.on('pageerror',e=>errors.push(e.message));
  await host.goto(base+hostLease.playerPath);await host.locator('#start').waitFor({state:'visible'});await host.locator('#start').click();
  await host.waitForFunction(()=>document.querySelector('#hint')?.textContent.includes('已开始推流'),{},{timeout:30000});
  await host.waitForFunction(()=>[...document.querySelectorAll('#video video')].some(v=>v.videoWidth>0&&v.getVideoPlaybackQuality().totalVideoFrames>0),{},{timeout:15000});
  checks.push('项目受控开播台通过正式ZEGO Web SDK实际推流（摄像头使用浏览器测试设备）');
  const reconciled=await post('/admin/live/sessions/'+session.id+'/reconcile',{});assert.equal(reconciled.active,true);assert.equal(reconciled.state,'LIVE');
  checks.push('后端通过ZEGO真实DescribeRTCStreamState确认活跃流并切换直播状态');
  await mobile.route('**/api/v1/**',async route=>{
    const r=route.request(),u=new URL(r.url()),path=u.pathname.replace('/api/v1','')+u.search,cors={'access-control-allow-origin':mobileUrl,'access-control-allow-credentials':'true','access-control-allow-headers':'authorization,content-type,x-csrf-token','access-control-allow-methods':'GET,POST,PATCH,OPTIONS'};
    if(r.method()==='OPTIONS'){await route.fulfill({status:204,headers:cors});return;}
    const requestHeaders={...r.headers(),origin:'http://127.0.0.1:5173','x-forwarded-for':'2001:db8::37'};delete requestHeaders.host;
    const response=await mobile.request.fetch(base+path,{method:r.method(),headers:requestHeaders,data:r.postData()??undefined});if(path==='/auth/login')learnerTokens=await response.json();if(path.endsWith('/join'))viewerLease=await response.json();await route.fulfill({response,headers:{...response.headers(),...cors}});
  });
  await mobile.goto(mobileUrl+'/#/pages/live/detail?id='+room.id);await mobile.getByText('进入直播',{exact:true}).click();await mobile.locator('input').nth(0).fill('19900001002');await mobile.getByText('获取验证码',{exact:true}).click();await mobile.getByText(/秒后重发/).waitFor();await mobile.locator('input').nth(1).fill('123456');await mobile.locator('.consent-touch').click();await mobile.locator('.login-submit').click();await mobile.locator('.login-submit').waitFor({state:'hidden'});await mobile.waitForURL('**/#/pages/live/detail?**');await mobile.getByText('进入直播',{exact:true}).waitFor();await mobile.getByText('进入直播',{exact:true}).click();
  await mobile.waitForURL('**/#/pages/live/watch?**');
  const frame=mobile.frameLocator('iframe');await frame.locator('#video video').first().waitFor();
  await mobile.waitForFunction(()=>document.querySelector('iframe')!==null);
  const player=mobile.frames().find(f=>f.url().includes('/live/player'));assert.ok(player);
  await player.waitForFunction(()=>[...document.querySelectorAll('#video video')].some(v=>v.videoWidth>0),{},{timeout:35000});
  const decoded=await player.evaluate(()=>{const e=[...document.querySelectorAll('#video video')].find(v=>v.videoWidth>0);return {width:e.videoWidth,height:e.videoHeight,frames:e.getVideoPlaybackQuality().totalVideoFrames};});assert.ok(decoded.width>0);assert.ok(decoded.frames>0);
  assert.equal(await player.locator('#sound').isVisible(),true);
  assert.ok((await player.locator('#sound').boundingBox()).height>=44);
  await mobile.waitForResponse(r=>r.url().endsWith('/live/rtc/refresh')&&r.request().method()==='POST',{timeout:40000});
  await player.waitForFunction(()=>document.querySelector('#hint')?.textContent.includes('点击开启声音'));
  assert.equal(await player.evaluate(()=>document.documentElement.scrollHeight<=innerHeight),true);
  checks.push('44像素播放器按钮完整显示，续签后保留开启声音引导');
  await player.locator('#sound').click();await player.locator('#sound').waitFor({state:'hidden'});assert.equal(await player.locator('#hint').innerText(),'正在直播 · 声音已开启');checks.push('App Web真实OTP登录、准入、静音自动解码及点击开启声音');

  assert.ok(learnerTokens?.accessToken&&viewerLease?.key,'learner connection must be real');
  async function viewerMic(action,row){const response=await fetch(base+'/live/mics',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+learnerTokens.accessToken},body:JSON.stringify({key:viewerLease.key,action,...(row?{requestId:row.id,expectedVersion:row.version}:{})})});const value=await response.json();assert.equal(response.status,201,JSON.stringify(value));return value;}
  viewerLease=await fetch(base+'/live/sessions/'+session.id+'/join',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+learnerTokens.accessToken},body:'{}'}).then(r=>r.json());assert.ok(viewerLease.key);
  let queue=await viewerMic('REQUEST');const requested=queue.items.find(r=>r.state==='WAITING');assert.ok(requested);
  await post('/admin/live/mics',{key:hostLease.key,action:'APPROVE',requestId:requested.id,expectedVersion:requested.version});
  queue=await viewerMic('LIST');await viewerMic('CONNECT',queue.items.find(r=>r.state==='APPROVED'));
  const credential=await fetch(base+'/live/rtc/refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:viewerLease.key})}).then(r=>r.json());assert.ok(credential.publishStreamId);
  guest=await context.newPage();await guest.goto(base+'/live/player');await guest.waitForFunction(()=>typeof ZegoExpressEngine==='function');
  await guest.evaluate(async c=>{window.guestEngine=new ZegoExpressEngine(c.appId,c.server);const engine=window.guestEngine;engine.setLogConfig({logLevel:'error',remoteLogLevel:'disable'});await Promise.race([engine.loginRoom(c.roomId,c.token,{userID:c.userId,userName:'测试连麦学员'},{userUpdate:false}),new Promise((_,reject)=>setTimeout(()=>reject(Error('Guest login timeout')),25000))]);window.guestStream=await engine.createZegoStream({camera:{video:false,audio:true}});engine.startPublishingStream(c.publishStreamId,window.guestStream);},credential);
  await host.locator('#guests video,#guests audio').first().waitFor({timeout:35000});await host.locator('#sound').click();
  await host.waitForFunction(()=>[...document.querySelectorAll('#guests video,#guests audio')].some(e=>!e.muted&&!e.paused&&e.srcObject?.getAudioTracks().some(t=>t.readyState==='live')),{},{timeout:20000});
  checks.push('实际ZEGO学员音频推流，主播经服务端授权拉流并显式开启声音');
  const hostQueue=await post('/admin/live/mics',{key:hostLease.key,action:'LIST'}),connected=hostQueue.items.find(r=>r.state==='CONNECTED');assert.ok(connected);
  await post('/admin/live/mics',{key:hostLease.key,action:'REMOVE',requestId:connected.id,expectedVersion:connected.version});
  await host.locator('#guests .guest-video').waitFor({state:'hidden',timeout:35000});checks.push('主播结束连麦后服务端撤销学员租约、播放器移除连麦画面');
  await guest.close();guest=null;

  await mobile.screenshot({path:output+'/app-actual-rtc.png'});await host.screenshot({path:output+'/host-actual-rtc.png'});
  session=await db.liveSession.findUniqueOrThrow({where:{id:session.id}});await post('/admin/live/sessions/'+session.id+'/state',{action:'END',expectedVersion:session.version,reason:'实际结束观看验证'});
  await player.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('会话已结束'),{},{timeout:40000});assert.equal(await player.locator('#video video').count(),0);
  checks.push('结束本场后真实播放器在下一短期续签时清理视频并退出房间');
  assert.equal(await db.liveRtcLease.count({where:{sessionId:session.id,revokedAt:null}}),0);assert.equal(errors.length,0,JSON.stringify(errors));
  await writeFile(output+'/actual-rtc.json',JSON.stringify({status:'passed',checkedAt:new Date().toISOString(),checks,decoded,isolatedDatabase:true,providerAdapterSimulated:false,actualRtc:true,hostCameraTestDevice:true,appNativeAcceptance:false,publicCallbackAcceptance:false,cloudRecording:false},null,2));
}catch(e){failed=String(e);if(mobile)await mobile.screenshot({path:output+'/app-rtc-failure.png'}).catch(()=>{});if(host)await host.screenshot({path:output+'/host-rtc-failure.png'}).catch(()=>{});await writeFile(output+'/actual-rtc.json',JSON.stringify({status:'failed',checkedAt:new Date().toISOString(),checks,error:failed,errors,diagnostics,appText:mobile?await mobile.locator('body').innerText().catch(()=>null):null,videos:mobile?await Promise.all(mobile.frames().filter(f=>f.url().includes('/live/player')).map(f=>f.locator('video').evaluateAll(vs=>vs.map(v=>({width:v.videoWidth,height:v.videoHeight,ready:v.readyState,paused:v.paused,muted:v.muted,error:v.error?.code,tracks:v.srcObject?.getTracks().map(t=>({kind:t.kind,state:t.readyState,enabled:t.enabled,muted:t.muted}))}))).catch(()=>null))):[],playerText:mobile?await Promise.all(mobile.frames().filter(f=>f.url().includes('/live/player')).map(f=>f.locator('body').innerText().catch(()=>null))):[],csp:host?await host.evaluate(()=>window.__csp??[]).catch(()=>[]):[],providerAdapterSimulated:false},null,2));throw e;}
finally{clearTimeout(watchdog);await browser?.close();for(const server of servers){server.closeAllConnections();await new Promise(ok=>server.close(ok));}await app?.close();await db?.$disconnect();await pool.query('DROP DATABASE "'+database+'" WITH (FORCE)');await pool.end();}
console.log(JSON.stringify({passed:checks.length,actualRtc:true}));
