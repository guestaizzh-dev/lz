import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer, request as proxyRequest } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const require = createRequire(new URL('../../services/api/package.json', import.meta.url)), { Pool } = require('pg');
const { chromium } = createRequire(process.env.ACADEMY_BROWSER_MODULE + '/package.json')('playwright');
const source = new URL(process.env.DATABASE_URL);
if (process.env.NODE_ENV === 'production' || !['localhost', '127.0.0.1'].includes(source.hostname)) throw Error('Isolated local database required');
const name = 'academy_test_closure_' + Date.now(), target = new URL(source); target.pathname = '/' + name;
const pool = new Pool({ connectionString: source.toString() }), output = resolve('outputs/prelaunch-review'), media = await mkdtemp(resolve('.runtime/operations-browser-'));
await mkdir(output, { recursive: true });
let app, server, browser, page, mobile, upstream = ''; const checks = [], errors = [];
try {
  await pool.query('CREATE DATABASE "' + name + '"');
  Object.assign(process.env, { DATABASE_URL: target.toString(), NODE_ENV: 'test', MEDIA_DIR: media, PREVIEW_LOGIN_ENABLED: 'false',SMS_ENABLED:'true',DEV_OTP_CODE:'123456', ZEGO_RTC_ENABLED: 'false', ZEGO_LOCAL_RECORDING_ENABLED: 'false' });
  await new Promise((ok, fail) => { const child = spawn(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { cwd: resolve('services/api'), env: process.env, stdio: 'ignore', windowsHide: true }); child.on('error', fail); child.on('exit', code => code === 0 ? ok() : fail(Error('Migration failed'))); });
  const adminRoot = resolve('apps/admin/dist'), mobileRoot = resolve('apps/mobile/unpackage/dist/build/web');
  server = createServer(async (req, res) => {
    if (req.url.startsWith('/api/v1/')) { const proxy = proxyRequest(upstream + req.url, { method: req.method, headers: req.headers }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res); }); proxy.on('error', () => res.writeHead(502).end()); req.pipe(proxy); return; }
    try {
      const path = decodeURIComponent(req.url.split('?')[0]), isMobile = path.startsWith('/app/') || path.startsWith('/assets/') || path.startsWith('/static/'), root = isMobile ? mobileRoot : adminRoot;
      let file = resolve(root, '.' + (path.startsWith('/app/') ? path.slice(4) : path)); if (!file.startsWith(root + sep)) file = resolve(root, 'index.html');
      let body; try { body = await readFile(file); } catch { file = resolve(root, 'index.html'); body = await readFile(file); }
      res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.otf': 'font/otf' })[extname(file)] ?? 'application/octet-stream'); res.end(body);
    } catch { res.writeHead(500).end(); }
  });
  await new Promise(ok => server.listen(0, '127.0.0.1', ok)); const base = 'http://127.0.0.1:' + server.address().port;
  process.env.CORS_ORIGINS = base; process.env.PUBLIC_API_URL = base + '/api/v1';
  const { createApp } = await import('../../services/api/dist/main.js'), { Database } = await import('../../services/api/dist/database.js'), { AuthService } = await import('../../services/api/dist/auth.js');
  app = await createApp(false); app.useLogger(['error']); await app.listen(0, '127.0.0.1'); upstream = await app.getUrl();
  const db = app.get(Database), auth = app.get(AuthService), admin = await db.user.create({ data: { nickname: '书院管理员', roles: ['ADMIN'] } }), credential = auth.credentials(), csrf = randomUUID();
  await db.authSession.create({ data: { userId: admin.id, kind: 'ADMIN', accessHash: credential.accessHash, refreshHash: credential.refreshHash, accessExpiresAt: credential.accessExpiresAt, expiresAt: new Date(Date.now() + 86400000), csrfToken: csrf } });
  const req={actor:admin,requestId:randomUUID()};
  async function api(path,method='GET',body){const r=await fetch(upstream+'/api/v1'+path,{method,headers:{'Content-Type':'application/json',Origin:base,Cookie:'daoxue_access='+credential.access,'X-CSRF-Token':csrf},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();assert.ok(r.ok,JSON.stringify(data));return data;}
  const teacher=await db.teacher.create({data:{name:'经典研习名师',title:'书院讲师',bio:'上线前隔离验证',expertise:[],status:'PUBLISHED'}});
  const course=await db.course.create({data:{title:'待删除的下架课程',subtitle:'原权益保留',description:'仅隔离验收',category:'经典研习',cover:'/static/art/books.svg',price:0,tags:[],teacherId:teacher.id,status:'ARCHIVED'}});
  browser=await chromium.launch({headless:true,channel:'msedge'});const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.addCookies([{name:'daoxue_access',value:credential.access,url:base},{name:'daoxue_csrf',value:csrf,url:base}]);page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/content/courses');await page.getByRole('button',{name:'待删除的下架课程',exact:true}).waitFor();await page.screenshot({path:output+'/course-delete-before.png'});
  await page.getByRole('button',{name:/^删\s*除$/}).click();const dialog=page.getByRole('dialog').last();await dialog.getByText('删除后移出课程管理列表，不能重新发布。已购学员仍可按原权益学习，历史订单、退款和学习记录保留。',{exact:true}).waitFor();await dialog.getByRole('button',{name:/确认删除/}).click();await page.getByRole('button',{name:'待删除的下架课程',exact:true}).waitFor({state:'hidden'});assert.ok((await db.course.findUniqueOrThrow({where:{id:course.id}})).deletedAt);await page.screenshot({path:output+'/course-delete-after.png'});checks.push('真实后台：下架列表删除、影响确认、请求成功刷新、数据库留痕');
  const phone=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});mobile=await phone.newPage();mobile.on('pageerror',e=>errors.push(e.message));
  for(const [width,height,label] of [[320,740,'small'],[390,844,'portrait'],[844,390,'landscape']]){
    await mobile.setViewportSize({width,height});await mobile.goto(base+'/app/#/pages/academy/index');await mobile.waitForTimeout(800);await mobile.screenshot({path:output+'/app-'+label+'.png'});const size=await mobile.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));assert.ok(size.scroll<=size.width+1,JSON.stringify(size));checks.push('课程列表Web布局 '+label+' 无文档横向溢出');
  }
  await mobile.emulateMedia({colorScheme:'dark'});await mobile.goto(base+'/app/#/pages/auth/login');await mobile.waitForTimeout(500);await mobile.screenshot({path:output+'/app-dark-login.png'});checks.push('Web深色系统偏好下登录页截图（固定纸色主题）');
  assert.deepEqual(errors,[]);await writeFile(output+'/browser-checks.json',JSON.stringify({checks,errors,scope:'isolated database and real API; Web only'},null,2));console.log(JSON.stringify({checks,errors}));
} catch(error){await page?.screenshot({path:output+'/failure-admin.png'}).catch(()=>{});await mobile?.screenshot({path:output+'/failure-app.png'}).catch(()=>{});throw error;
} finally {
  await browser?.close();if(server)await new Promise(ok=>server.close(ok));await app?.close();await pool.query('DROP DATABASE IF EXISTS "'+name+'" WITH (FORCE)');await pool.end();
  if(!media.startsWith(resolve('.runtime')+sep))throw Error('Unexpected temporary media path');await rm(media,{recursive:true,force:true});
}
