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
const name = 'academy_test_operations_' + Date.now(), target = new URL(source); target.pathname = '/' + name;
const pool = new Pool({ connectionString: source.toString() }), output = resolve('outputs/operations-simplification'), media = await mkdtemp(resolve('.runtime/operations-browser-'));
await mkdir(output, { recursive: true });
let app, server, browser, page, mobile, upstream = ''; const checks = [], errors = [];
try {
  await pool.query('CREATE DATABASE "' + name + '"');
  Object.assign(process.env, { DATABASE_URL: target.toString(), NODE_ENV: 'test', MEDIA_DIR: media, PREVIEW_LOGIN_ENABLED: 'false', ZEGO_RTC_ENABLED: 'false', ZEGO_LOCAL_RECORDING_ENABLED: 'false' });
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
  const teacher = await db.teacher.create({ data: { name: '经典共读讲师', title: '书院讲师', bio: '隔离验证资料', expertise: [], status: 'PUBLISHED' } });
  browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies([{ name: 'daoxue_access', value: credential.access, url: base }, { name: 'daoxue_csrf', value: csrf, url: base }]);
  page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/categories'); await page.getByRole('button', { name: '新增分类', exact: true }).click();
  await page.getByLabel('分类名称', { exact: true }).fill('生活中的道学'); await page.getByRole('button', { name: /确\s*定/ }).click();
  await page.getByRole('cell', { name: '生活中的道学', exact: true }).waitFor();
  const category = await db.catalogCategory.findFirstOrThrow({ where: { scope: 'COURSE', label: '生活中的道学' } });
  await page.screenshot({ path: output + '/categories.png' }); checks.push('分类新增、列表状态和实际数据库记录');
  await page.goto(base + '/content/courses'); await page.getByRole('button', { name: /新建课程/ }).click();const drawer=page.getByRole('dialog').last();
  await drawer.waitFor();await writeFile(output+'/form-fields.json',JSON.stringify(await page.locator('label,input,textarea').evaluateAll(nodes=>nodes.map(node=>({tag:node.tagName,id:node.id,for:node.htmlFor,text:node.tagName==='LABEL'?node.textContent:'',visible:!!node.getClientRects().length}))),null,2));
  await drawer.getByLabel('课程标题', { exact: true }).fill('把经典读进生活'); await drawer.getByLabel('副标题', { exact: true }).fill('从上善若水开始的共读');
  await drawer.getByLabel('课程介绍', { exact: true }).fill('通过经典图文与音视频，学习将道学智慧融入日常生活。');
  await drawer.getByLabel('分类', { exact: true }).click(); await page.getByText('生活中的道学', { exact: true }).last().click();
  await drawer.getByLabel('主讲名师', { exact: true }).click(); await page.getByText(teacher.name + '（已发布）', { exact: true }).click();
  await drawer.locator('input[type=file]').first().setInputFiles(resolve('.runtime/valid-cover.png'));
  await page.getByText('调整图片', { exact: true }).waitFor(); await page.screenshot({ path: output + '/cover-crop.png' });
  await page.getByRole('button', { name: '使用裁剪图片', exact: true }).click(); await page.getByText('调整图片', { exact: true }).waitFor({ state: 'hidden' });
  await drawer.getByLabel('章节名称', { exact: true }).fill('上善若水'); await drawer.getByLabel('正文 / 研习提示', { exact: true }).fill('上善若水，水善利万物而不争。');
  const {MediaIngest,mediaCommand}=await import('../../services/api/dist/media-ingest.js');const videoPath=resolve(media,'共读课件.mp4');
  await mediaCommand(process.env.FFMPEG_PATH??'ffmpeg',['-v','error','-nostdin','-f','lavfi','-i','testsrc2=size=320x180:rate=15','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','2','-c:v','libx264','-preset','ultrafast','-c:a','aac','-movflags','+faststart','-y',videoPath]);
  await drawer.getByRole('button',{name:'添加章节',exact:true}).click();await drawer.getByLabel('章节名称',{exact:true}).last().fill('经典视频共读');
  await drawer.getByLabel('章节内容',{exact:true}).last().click();await page.getByText('视频',{exact:true}).last().click();await drawer.locator('input[type=file]').last().setInputFiles(videoPath);
  await drawer.getByText('已上传，正在后台优化音视频；可以继续上传其他课件',{exact:true}).waitFor({timeout:20000});await app.get(MediaIngest).runJobs();await drawer.getByText('处理完成，可直接使用',{exact:true}).waitFor({timeout:20000});
  await drawer.getByRole('button',{name:/试\s*看/}).click();await page.waitForFunction(()=>document.querySelector('video')?.readyState>=1);await page.getByRole('dialog',{name:'试看课件'}).getByRole('button',{name:/关\s*闭/}).click();
  await drawer.getByLabel('课程标题',{exact:true}).scrollIntoViewIfNeeded();checks.push('章节直接上传真实音视频、后台转码、自动绑定与时长、就地试看');
  await page.screenshot({ path: output + '/course-editor.png' }); await drawer.getByRole('button', { name: '保存并发布', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  const course = await db.course.findFirstOrThrow({ where: { title: '把经典读进生活' } }); assert.equal(course.status, 'PUBLISHED'); assert.equal(course.category, category.code); assert.ok(course.cover.startsWith(base));const chapters=await db.courseChapter.findMany({where:{courseId:course.id},orderBy:{position:'asc'}});assert.equal(chapters.length,2);assert.ok(chapters[1].mediaId&&chapters[1].durationSeconds>0);
  checks.push('课程就地上传与裁剪封面、选择分类和主讲、编排图文并直接发布');
  await page.goto(base + '/products'); await page.getByRole('button', { name: '新建商品', exact: true }).click();
  const productDialog = page.getByRole('dialog', { name: '商品草稿', exact: true });
  await productDialog.getByLabel('商品名称', { exact: true }).fill('道德经研习手册'); await productDialog.getByLabel('副标题', { exact: true }).fill('经典共读随手记录');
  await productDialog.getByLabel('商品详情', { exact: true }).fill('用于书院研习、记录经典摘录与个人心得。'); await productDialog.getByLabel('文化溯源与依据', { exact: true }).fill('本手册结合经典研习整理，本次仅作隔离操作验证。');
  await productDialog.getByLabel('初始库存', { exact: true }).fill('12'); await productDialog.getByRole('button', { name: /从素材库选择/ }).click();
  const library = page.getByRole('dialog', { name: '图片素材库', exact: true }); await library.locator('img').first().click();
  await productDialog.getByRole('button', { name: '保存并上架', exact: true }).click(); await productDialog.waitFor({ state: 'hidden' });
  const product = await db.product.findFirstOrThrow({ where: { title: '道德经研习手册' }, include: { skus: true } }); assert.equal(product.status, 'PUBLISHED'); assert.equal(product.skus.length, 1); assert.equal(product.skus[0].stock, 12);
  await page.screenshot({ path: output + '/product-list.png' }); checks.push('商品复用封面、填写初始库存并一次保存上架，默认规格与库存账真实生成');
  await page.goto(base + '/content/articles'); await page.getByRole('button', { name: /新建文章/ }).click();
  const articleDrawer = page.getByRole('dialog').last();
  for (const [label, text] of [['标题', '上善若水的日常练习'], ['摘要', '从一段经典开始，记录生活中的道学体会。'], ['作者', '书院编辑'], ['来源 / 版本 / 授权说明', '隔离测试原创内容'], ['段落内容', '上善若水，水善利万物而不争。以日常实践体会经典。']]) await articleDrawer.getByLabel(label, { exact: true }).fill(text);
  await articleDrawer.getByRole('button', { name: '保存并发布', exact: true }).click(); await articleDrawer.waitFor({ state: 'hidden' });
  assert.equal((await db.article.findFirstOrThrow({ where: { title: '上善若水的日常练习' } })).status, 'PUBLISHED'); checks.push('文章编辑并直接发布，无重复送审和原因表单');
  await page.goto(base + '/guide?workflow=daily-operations'); await page.getByText('管理员日常操作', { exact: true }).first().waitFor(); await page.screenshot({ path: output + '/guide.png' });
  assert.equal(await page.getByText('直播礼物与分成', { exact: true }).count(), 0); checks.push('日常操作指南可用，礼物退出主导航');
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await mobileContext.route('https://academy.43-160-229-173.sslip.io/api/v1/**', async route => { const response = await route.fetch({ url: base + new URL(route.request().url()).pathname + new URL(route.request().url()).search }); await route.fulfill({ response }); });
  mobile = await mobileContext.newPage(); mobile.on('pageerror', error => errors.push(error.message));
  for (const [path, label] of [['academy/index', '生活中的道学'], ['discover/index', '上善若水的日常练习'], ['shop/index', '道德经研习手册'], ['event/index', '活动与预约']]) {
    await mobile.goto(base + '/app/#/pages/' + path); await mobile.getByText(label, { exact: true }).first().waitFor();
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, path + ' overflow'); await mobile.screenshot({ path: output + '/app-' + path.split('/')[0] + '.png' });
  }
  checks.push('App课程/文章/商品/活动页面连接同一真实测试API，分类及新发布内容同步，无整页横向溢出');
  await mobile.goto(base + '/app/#/pages/academy/index'); await mobile.getByText('生活中的道学', { exact: true }).click(); await mobile.getByText(course.title, { exact: true }).waitFor();
  await db.catalogCategory.update({ where: { id: category.id }, data: { label: '生活实践', version: { increment: 1 } } }); await mobile.reload(); await mobile.getByText('生活实践', { exact: true }).waitFor(); checks.push('分类筛选与改名同步，课程稳定关联保持');
  assert.deepEqual(errors, []);
  await writeFile(output + '/browser-checks.json', JSON.stringify({ checks, errors, isolatedDatabase: true, realBusinessAPI: true, nativeAcceptance: false }, null, 2)); console.log(JSON.stringify({ checks: checks.length, errors: errors.length }));
} catch (error) {
  if(page)await writeFile(output+'/form-fields.json',JSON.stringify(await page.locator('label,input,textarea,[role=dialog]').evaluateAll(nodes=>nodes.map(node=>({tag:node.tagName,id:node.id,for:node.htmlFor,role:node.getAttribute('role'),text:node.tagName==='LABEL'?node.textContent:'',visible:!!node.getClientRects().length}))),null,2));
  await page?.screenshot({ path: output + '/admin-failure.png' }).catch(() => {}); await mobile?.screenshot({ path: output + '/app-failure.png' }).catch(() => {});
  await writeFile(output + '/failure.json', JSON.stringify({ error: String(error), errors }, null, 2)); throw error;
} finally {
  await browser?.close(); if (server) await new Promise(ok => server.close(ok)); await app?.close();
  await pool.query('DROP DATABASE IF EXISTS "' + name + '" WITH (FORCE)'); await pool.end();
  if (!media.startsWith(resolve('.runtime') + sep)) throw Error('Unexpected temporary media path'); await rm(media, { recursive: true, force: true });
}
