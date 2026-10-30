import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer,request as proxyRequest} from 'node:http';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';

const require=createRequire(new URL('../../services/api/package.json',import.meta.url)),{Pool}=require('pg');
const {chromium}=createRequire(process.env.ACADEMY_BROWSER_MODULE+'/package.json')('playwright');
const source=new URL(process.env.DATABASE_URL);
if(process.env.NODE_ENV==='production'||!['localhost','127.0.0.1'].includes(source.hostname))throw Error('Local isolated database required');
const name='academy_test_member_directory_'+Date.now(),target=new URL(source);target.pathname='/'+name;
const pool=new Pool({connectionString:source.toString()}),output=resolve('outputs/member-directory'),media=await mkdtemp(resolve('.runtime/live-polish-'));
await mkdir(output,{recursive:true});let app,server,browser,page,mobile,upstream='';const checks=[],errors=[];
try{
  await pool.query('CREATE DATABASE "'+name+'"');
  Object.assign(process.env,{DATABASE_URL:target.toString(),NODE_ENV:'test',MEDIA_DIR:media,DEV_OTP_CODE:'123456',PREVIEW_LOGIN_ENABLED:'false',SMS_ENABLED:'true',ZEGO_RTC_ENABLED:'true',ZEGO_ROOM_TOKEN_AUTH_ENABLED:'true',ZEGO_APP_ID:'123',ZEGO_SERVER_SECRET:'12345678901234567890123456789012',ZEGO_CALLBACK_SECRET:'test',ZEGO_RTC_SERVER:'wss://test.zego.im/ws',ZEGO_WHIP_DOMAIN:'i-whip123.whip.zegotech.cn',ZEGO_LOCAL_RECORDING_ENABLED:'false'});
  await new Promise((ok,fail)=>{const child=spawn(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{cwd:resolve('services/api'),env:process.env,stdio:'ignore',windowsHide:true});child.on('error',fail);child.on('exit',code=>code===0?ok():fail(Error('Migration failed')));});
  const adminRoot=resolve('apps/admin/dist'),mobileRoot=resolve(process.env.ACADEMY_MEMBER_WEB??'.runtime/member-directory-web');
  server=createServer(async(req,res)=>{
    if(req.url.startsWith('/api/v1/')){const p=proxyRequest(upstream+req.url,{method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});p.on('error',()=>res.writeHead(502).end());req.pipe(p);return;}
    try{const path=decodeURIComponent(req.url.split('?')[0]),isMobile=path.startsWith('/app/')||path.startsWith('/assets/')||path.startsWith('/static/'),root=isMobile?mobileRoot:adminRoot;let file=resolve(root,'.'+(path.startsWith('/app/')?path.slice(4):path));if(!file.startsWith(root+sep))file=resolve(root,'index.html');let body;try{body=await readFile(file);}catch{file=resolve(root,'index.html');body=await readFile(file);}res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.otf':'font/otf'})[extname(file)]??'application/octet-stream');res.end(body);}catch{res.writeHead(500).end();}
  });
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));const base='http://127.0.0.1:'+server.address().port;process.env.CORS_ORIGINS=base;
  const {createApp}=await import('../../services/api/dist/main.js'),{Database}=await import('../../services/api/dist/database.js'),{AuthService}=await import('../../services/api/dist/auth.js');
  app=await createApp(false);app.useLogger(['error']);await app.listen(0,'127.0.0.1');upstream=await app.getUrl();const db=app.get(Database),auth=app.get(AuthService);

  const admin=await db.user.create({data:{nickname:'书院管理员',roles:['ADMIN']}}),credential=auth.credentials(),csrf=randomUUID();
  await db.authSession.create({data:{userId:admin.id,kind:'ADMIN',accessHash:credential.accessHash,refreshHash:credential.refreshHash,accessExpiresAt:credential.accessExpiresAt,expiresAt:new Date(Date.now()+86400000),csrfToken:csrf}});
  const learner=await db.user.create({data:{phone:'19900001002',nickname:'清风同学',roles:['USER']}});
  for(let tier=1;tier<=4;tier++){
   const plan=await db.membershipPlan.upsert({where:{tier_days:{tier,days:30}},create:{tier,days:30,title:'本档待开放',price:100,description:'隔离验证',active:false},update:{active:false}});
   const u=await db.user.create({data:{nickname:['','松风','明月','云舟','知行'][tier],roles:['USER']}});
   await db.membership.create({data:{userId:u.id,planId:plan.id,tier,source:'ADMIN',startsAt:new Date(Date.now()-1000),endsAt:new Date(Date.now()+86400000)}});
  }
  browser=await chromium.launch({headless:true,channel:'msedge'});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.addCookies([{name:'daoxue_access',value:credential.access,url:base},{name:'daoxue_csrf',value:csrf,url:base}]);
  page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/memberships');
  await page.getByText('全部注册用户').first().waitFor();await page.getByRole('button',{name:'钻石会员 · 1 人',exact:true}).waitFor();
  assert.match(await page.locator('.ant-card').filter({hasText:'会员名单'}).first().innerText(),/全部注册用户\s*5\s*人/);
  await page.screenshot({path:output+'/admin-directory.png',fullPage:true});checks.push('后台注册无授权也显示，五档人数按人统计');
  await page.getByRole('button',{name:'钻石会员 · 1 人',exact:true}).click();await page.locator('.ant-table-tbody').first().getByText('知行',{exact:true}).waitFor();await page.locator('.ant-table-tbody').first().getByText('清风同学',{exact:true}).waitFor({state:'hidden'});
  await page.getByRole('button',{name:'注册会员 · 1 人',exact:true}).click();await page.locator('.ant-table-tbody').first().getByText('清风同学',{exact:true}).waitFor();await page.getByRole('button',{name:'查看权益',exact:true}).first().click();await page.getByText('清风同学 · 权益与用量',{exact:true}).waitFor();await page.locator('.ant-drawer-close').click();checks.push('档位筛选与注册用户权益查看');
  await page.getByRole('button',{name:'全部注册用户',exact:true}).click();await page.locator('.ant-table-tbody').first().getByText('知行',{exact:true}).waitFor();const q=page.getByRole('textbox',{name:'昵称或完整手机号'});await q.fill('19900001002');await page.getByRole('button',{name:/查\s*询/}).first().click();await page.locator('.ant-table-tbody').first().getByText('199****1002',{exact:true}).waitFor();checks.push('完整手机号查询且结果脱敏');
  await page.goto(base+'/system/config');await page.getByRole('tab',{name:'首页主图与视频',exact:true}).click();await page.getByText('图片 / 轮播',{exact:true}).waitFor();await page.screenshot({path:output+'/admin-home-hero.png',fullPage:true});checks.push('首页主图与视频实际后台配置入口');
  const mobileContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});mobile=await mobileContext.newPage();mobile.on('pageerror',e=>errors.push(e.message));
  await mobile.route('**/api/v1/**',async route=>{const r=route.request(),url=new URL(r.url()),cors={'access-control-allow-origin':base,'access-control-allow-credentials':'true','access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,POST,OPTIONS'};if(r.method()==='OPTIONS'){await route.fulfill({status:204,headers:cors});return;}const h={...r.headers(),origin:base};delete h.host;const response=await mobile.request.fetch(upstream+url.pathname+url.search,{method:r.method(),headers:h,data:r.postData()??undefined});await route.fulfill({response,headers:{...response.headers(),...cors}});});
  await mobile.goto(base+'/app/#/pages/profile/index');await mobile.getByText('点击登录',{exact:true}).click();await mobile.locator('input').nth(0).fill('19900001002');await mobile.getByText('获取验证码',{exact:true}).click();await mobile.getByText(/秒后重发/).waitFor();await mobile.locator('input').nth(1).fill('123456');await mobile.locator('.consent-touch').click();await mobile.locator('.login-submit').click();await mobile.locator('.login-submit').waitFor({state:'hidden'});await mobile.locator('.member-strip-title').filter({hasText:'注册会员'}).waitFor();await mobile.screenshot({path:output+'/app-profile.png'});checks.push('App我的页面显示真实注册会员身份');
  await mobile.locator('.member-strip').click();await mobile.locator('.member-level').nth(4).waitFor();await mobile.getByText('注册会员 · 注册即享',{exact:true}).waitFor();
  assert.equal(await mobile.locator('.member-level').count(),5);assert.deepEqual(await mobile.locator('.member-level .detail-tab-text').allTextContents(),['注册会员','铜牌会员','银牌会员','金牌会员','钻石会员']);
  for(const width of [320,390,768]){await mobile.setViewportSize({width,height:844});assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'App overflow '+width);const cards=await mobile.locator('.member-level').all();for(const card of cards){const r=await card.boundingBox();assert.ok(r.width>100&&r.height>=60);}await mobile.screenshot({path:output+'/app-levels-'+width+'.png'});}checks.push('五档在无可售套餐时仍完整展示，320/390/768布局无溢出');
  await mobile.locator('.member-level').nth(4).click();await mobile.getByText('本档套餐尚未开放，具体权益与价格由书院发布。',{exact:true}).waitFor();assert.equal(await mobile.locator('.plan-row').count(),0);checks.push('未开放档位明确说明，不虚构套餐或价格');
  assert.deepEqual(errors,[]);for(const stale of ['failure.json','admin-failure.png','app-failure.png'])await rm(resolve(output,stale),{force:true});await writeFile(output+'/checks.json',JSON.stringify({checks,errors,actualBusinessAPI:true,isolatedDatabase:true,nativeAcceptance:false},null,2));console.log(JSON.stringify({checks:checks.length,errors:errors.length}));
}catch(e){await page?.screenshot({path:output+'/admin-failure.png'}).catch(()=>{});await mobile?.screenshot({path:output+'/app-failure.png'}).catch(()=>{});await writeFile(output+'/failure.json',JSON.stringify({error:String(e),errors},null,2));throw e;}
finally{await browser?.close();await app?.close();server?.closeAllConnections();await new Promise(ok=>server?server.close(ok):ok());await pool.query('DROP DATABASE IF EXISTS "'+name+'" WITH (FORCE)');await pool.end();if(!media.startsWith(resolve('.runtime')+sep))throw Error('Unexpected temporary path');await rm(media,{recursive:true,force:true});}
