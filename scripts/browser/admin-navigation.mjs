import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const require = createRequire(new URL('../../apps/admin/package.json', import.meta.url));
const ts = require('typescript');
const { chromium } = createRequire(process.env.ACADEMY_BROWSER_MODULE + '/package.json')('playwright');
const output = resolve(process.env.ACADEMY_BROWSER_OUTPUT ?? 'outputs/admin-navigation-2026-10-14');
const checks = [], errors = [];
await mkdir(output, { recursive: true });
async function sourceModule(path) {
  const source = await readFile(path, 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  return import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
}
const { default: access } = await sourceModule('apps/admin/src/access.ts');
const { navigation, visibleNavigation, canOpenPage, matchesEntry } = await sourceModule('apps/admin/src/operations/navigation.ts');
const { workflows, matchesWorkflow } = await sourceModule('apps/admin/src/operations/workflows.ts');
const { default: routes } = await sourceModule('apps/admin/config/routes.ts');
const allRoutes = new Map();
function collect(items, parentAccess) {
  for (const item of items) {
    if (item.component) allRoutes.set(item.path, item.access ?? parentAccess);
    if (item.routes) collect(item.routes, item.access ?? parentAccess);
  }
}
collect(routes);
const entries = navigation.flatMap(group => group.entries);
assert.equal(new Set(entries.map(entry => entry.path)).size, entries.length);
for (const entry of entries) assert.equal(entry.access, allRoutes.get(entry.path), entry.path + ' route guard mismatch');
for (const [path] of allRoutes) if (!['/user/login', '/content', '/system', '/legacy-orders', '/*'].includes(path) && !path.startsWith('/exception')) assert.ok(entries.some(entry => entry.path === path), 'Unlisted business page: ' + path);
for (const workflow of workflows) for (const step of workflow.steps) if (step.path) assert.ok(entries.some(entry => entry.path === step.path), 'Unknown guide link');
assert.equal(new Set(workflows.map(workflow => workflow.id)).size, workflows.length);
assert.ok(matchesEntry(entries.find(entry => entry.path === '/content/live'), '开播'));
assert.ok(matchesWorkflow(workflows.find(workflow => workflow.id === 'live'), '摄像头'));
assert.deepEqual(visibleNavigation(access(undefined)).map(group => group.id), ['work']);
const teacher = { id: 'ui-teacher', nickname: '教学账号（界面权限专项）', roles: ['TEACHER'], permissions: ['teaching.read', 'teaching.write'] };
const teacherAccess = access({ currentUser: teacher });
assert.equal(canOpenPage('/live-host', teacherAccess), true);
assert.equal(canOpenPage('/content/live', teacherAccess), false);
checks.push('全部业务页面目录覆盖、唯一链接、路由权限一致、指南链接完整和无权限空组过滤');

let server, browser, currentPage, localActor;
const external = process.env.ACADEMY_ADMIN_URL;
let base = external;
try {
  if (!external) {
    const folder = resolve('apps/admin/dist');
    server = createServer(async (req, res) => {
      try {
        let path = resolve(folder, '.' + decodeURIComponent(new URL(req.url, 'http://local').pathname));
        if (!path.startsWith(folder + sep)) path = resolve(folder, 'index.html');
        let data;
        try { data = await readFile(path); } catch { path = resolve(folder, 'index.html'); data = await readFile(path); }
        res.setHeader('Content-Type', ({ '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' })[extname(path)] ?? 'application/octet-stream');
        res.end(data);
      } catch { res.writeHead(500).end(); }
    });
    await new Promise(ok => server.listen(0, '127.0.0.1', ok));
    base = 'http://127.0.0.1:' + server.address().port;
  }
  browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  if (!external) {
    const codes = [...new Set((await readFile('apps/admin/src/access.ts', 'utf8')).match(/'\w+\.\w+'/g).map(code => code.slice(1, -1)))];
    localActor = { id: 'ui-admin', nickname: '书院运营', roles: ['ADMIN'], permissions: codes };
    await context.route('**/api/v1/**', route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/v1/configuration') return route.fulfill({ json: { academyName: '老子道学书院' } });
      if (path === '/api/v1/admin/auth/session') return route.fulfill({ json: { user: localActor, csrfToken: 'ui-only' } });
      if (path === '/api/v1/admin/operations/summary') return route.fulfill({ json: { counts: {}, overdue: 0, expiredLeases: 0, oldestPendingAt: null, checkedAt: new Date().toISOString() } });
      return route.fulfill({ json: [] });
    });
  }
  const page = await context.newPage();
  currentPage = page;
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/');
  if (external) {
    await page.getByPlaceholder('请输入管理账号').fill(process.env.ACADEMY_ADMIN_USER ?? 'admin');
    await page.getByPlaceholder(/密码/).fill(process.env.ACADEMY_ADMIN_PASSWORD);
    await page.getByRole('button', { name: /登.*录/ }).click();
  }
  await page.locator('.ant-page-header-heading-title').filter({ hasText: /^工作台$/ }).waitFor();
  const menu = page.locator('.ant-layout-sider .ant-menu');
  for (const group of navigation) await menu.getByText(group.title, { exact: true }).waitFor();
  assert.equal(await page.locator('.ant-layout-sider-collapsed').count(), 0);
  await page.screenshot({ path: output + '/workbench.png', fullPage: true });
  await page.getByRole('searchbox', { name: '搜索业务入口' }).fill('开播');
  await page.getByRole('link', { name: '直播间与场次 →', exact: true }).waitFor();
  assert.equal(await page.getByRole('link', { name: '商品与库存 →', exact: true }).count(), 0);
  await page.getByRole('searchbox', { name: '搜索业务入口' }).fill('no-such-entry');
  await page.getByText('没有匹配的可用入口，请尝试其他关键词或查看操作指南').waitFor();
  checks.push(`实际浏览器：${navigation.length}个业务分组、文字侧栏展开、工作台搜索和空结果反馈`);
  await page.goto(base + '/guide?workflow=live');
  await page.getByRole('heading', { name: '创建直播并开播', exact: true }).waitFor();
  await page.getByRole('link', { name: '打开我的直播 →', exact: true }).first().waitFor();
  await page.screenshot({ path: output + '/live-guide.png', fullPage: true });
  await page.reload();
  await page.getByRole('heading', { name: '创建直播并开播', exact: true }).waitFor();
  await page.getByRole('searchbox', { name: '搜索操作指南' }).fill('摄像头');
  await page.getByText('1 个流程 · 灰色入口表示当前账号无权操作').waitFor();
  await page.getByRole('searchbox', { name: '搜索操作指南' }).fill('no-such-guide');
  await page.getByText('未找到流程，请尝试其他关键词').waitFor();
  await page.goto(base + '/guide?workflow=invalid');
  await page.getByText('该操作指南不存在，请从左侧选择流程').waitFor();
  checks.push('实际浏览器：直播指南深链与刷新、全文搜索、空结果及无效指南处理');
  await page.goto(base + '/content/live');
  await page.locator('.ant-page-header-heading-title').filter({ hasText: /^直播间与场次$/ }).waitFor();
  await menu.getByRole('link', { name: '直播间与场次', exact: true }).waitFor();
  await page.getByRole('button', { name: /操作指南/ }).click();
  await page.getByText('本页流程：创建直播并开播', { exact: true }).click();
  await page.getByRole('heading', { name: '创建直播并开播', exact: true }).waitFor();
  await page.goBack();
  await page.locator('.ant-page-header-heading-title').filter({ hasText: /^直播间与场次$/ }).waitFor();
  checks.push('实际浏览器：旧直播URL、分组自动展开、本页指南和返回业务页面');
  for (const workflow of workflows) {
    await page.goto(base + '/guide?workflow=' + workflow.id);
    await page.getByRole('heading', { name: workflow.title, exact: true }).waitFor();
  }
  checks.push(`实际浏览器：${workflows.length}篇操作指南均可打开`);
  if (!external) {
    localActor = { ...teacher, id: 'ui-admin' };
    await page.evaluate(() => window.dispatchEvent(new Event('daoxue:permissions-changed')));
    await menu.getByText('系统管理', { exact: true }).waitFor({ state: 'hidden' });
    await page.goto(base + '/guide?workflow=live');
    await page.getByText('直播间与场次：当前账号无入口权限，请由对应负责人处理').first().waitFor();
    checks.push('运行中权限变化后菜单与指南入口同步收缩（界面会话专项）');
    const restricted = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await restricted.route('**/api/v1/**', route => {
      const path = new URL(route.request().url()).pathname;
      return route.fulfill({ json: path.endsWith('/configuration') ? { academyName: '老子道学书院' } : path.endsWith('/admin/auth/session') ? { user: teacher, csrfToken: 'ui-only' } : [] });
    });
    const teacherPage = await restricted.newPage();
    teacherPage.on('pageerror', error => errors.push(error.message));
    await teacherPage.goto(base + '/');
    await teacherPage.locator('.ant-page-header-heading-title').filter({ hasText: /^工作台$/ }).waitFor();
    const teacherMenu = teacherPage.locator('.ant-layout-sider .ant-menu');
    assert.equal(await teacherMenu.getByText('系统管理', { exact: true }).count(), 0);
    assert.equal(await teacherPage.getByRole('link', { name: '课程与名师 →', exact: true }).count(), 0);
    await teacherPage.goto(base + '/guide?workflow=live');
    await teacherPage.getByText('直播间与场次：当前账号无入口权限，请由对应负责人处理').first().waitFor();
    await teacherPage.getByRole('link', { name: '打开我的直播 →', exact: true }).first().waitFor();
    await teacherPage.goto(base + '/system/users');
    await teacherPage.getByText(/403/).first().waitFor();
    await teacherPage.screenshot({ path: output + '/teacher-guard.png', fullPage: true });
    checks.push('教学角色界面会话专项：隐藏系统/课程菜单、禁用跨角色指南链接、原路由403保持（会话模拟，不代替API权限验收）');
    await restricted.close();
  }
  if (external) {
    for (const [path, title, screenshot] of [['/finance', '收退款与账务', 'finance-online.png'], ['/operations', '任务监控与恢复', 'operations-online.png']]) {
      await page.goto(base + path);
      await page.locator('.ant-page-header-heading-title').filter({ hasText: new RegExp('^' + title + '$') }).waitFor();
      await page.locator('.ant-spin-spinning').first().waitFor({ state: 'hidden' });
      assert.equal(await page.locator('.ant-alert-error').count(), 0);
      await page.screenshot({ path: output + '/' + screenshot, fullPage: true });
      checks.push('真实公网页面：' + title + '实际会话与接口加载，无页面错误');
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + '/guide?workflow=live');
  await page.getByRole('heading', { name: '创建直播并开播', exact: true }).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2));
  checks.push('窄屏指南无横向溢出');
  assert.deepEqual(errors, []);
} catch (error) {
  if (currentPage) {
    await currentPage.screenshot({ path: output + '/failure.png', fullPage: true }).catch(() => {});
    await writeFile(output + '/failure.txt', await currentPage.locator('body').innerText().catch(() => 'No page'));
  }
  throw error;
} finally {
  await browser?.close();
  if (server) await new Promise(ok => server.close(ok));
  await writeFile(output + '/checks.json', JSON.stringify({ environment: external ?? 'local production build; UI session fixtures', checks, errors }, null, 2));
}
console.log(JSON.stringify({ passed: checks.length, errors }));

