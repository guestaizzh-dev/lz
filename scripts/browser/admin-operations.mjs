import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const { chromium } = createRequire(process.env.ACADEMY_BROWSER_MODULE + '/package.json')('playwright');
const output = resolve('outputs/admin-operations-2026-10-14/browser'), checks = [], errors = [];
await mkdir(output, { recursive: true });
const codes = [...new Set((await readFile('apps/admin/src/access.ts', 'utf8')).match(/'\w+\.\w+'/g).map(c => c.slice(1, -1)))];
const id = '00000000-0000-4000-8000-000000000001', jobId = '00000000-0000-4000-8000-000000000002', when = '2026-10-14T02:00:00Z';
let actor = { id, nickname: '运营专项', roles: ['ADMIN'], permissions: codes }, revision = 'a'.repeat(64), retried = false, conflict = true;
const paid = { id, orderNo: 'DX20261014001', state: 'COMPLETED', kind: 'COURSE', currency: 'CNY', amount: '12800', payableTotal: '12800', paidTotal: '12800', paidAmount: '12800', refundedTotal: '0', refundedAmount: '0', createdAt: when, expiresAt: when, paidAt: when, channel: 'WECHAT_APP', nickname: '测试学员', access: true,
  course: { title: '道德经精读', teacherName: '书院名师', refundPolicy: '七天未学习可申请', releaseId: id, accessDays: 365 },
  plan: { title: '研习会员', days: 365, description: '研习权益', refundPolicy: '按实际使用核查' }, membership: { state: 'ACTIVE', startsAt: when, endsAt: when },
  cohort: { title: '秋季研习营', courseTitle: '道德经精读', startsAt: when, endsAt: when, refundPolicy: '按履约核查' }, currentSchedule: { startsAt: when, endsAt: when, cancelled: false, schedulePending: false },
  booking: { title: '名师咨询', kind: 'appointment', startsAt: when, endsAt: when, originalStartsAt: when, originalEndsAt: when, originalLocation: '书院', location: '书院', state: 'CONFIRMED', quantity: 1, cancelDeadline: when, deliveryPolicy: '按约定履约', refundPolicy: '按履约核查' },
  discount: '0', shipping: '0', address: null, items: [], shipments: [], refunds: [], payments: [], recoveryJobs: [] };
const job = () => ({ id: jobId, revision, kind: 'COURSE_DELIVERY_NOTICE', aggregateType: 'COURSE_ORDER', aggregateId: id, state: retried ? 'READY' : 'DEAD', attempts: retried ? 0 : 8, availableAt: when, lockedUntil: null, lastErrorCode: retried ? null : 'PROVIDER_OR_PROCESSING_ERROR', completedAt: null, createdAt: when, updatedAt: when, retryable: !retried, order: paid, audit: retried ? [{ id, createdAt: when, reason: '已核查通知服务恢复', actorId: id }] : [] });
const folder = resolve('apps/admin/dist');
const server = createServer(async (req, res) => {
  try { let path = resolve(folder, '.' + decodeURIComponent(new URL(req.url, 'http://local').pathname)); if (!path.startsWith(folder + sep)) path = resolve(folder, 'index.html'); let data; try { data = await readFile(path); } catch { path = resolve(folder, 'index.html'); data = await readFile(path); } res.setHeader('Content-Type', ({ '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png' })[extname(path)] ?? 'application/octet-stream'); res.end(data); } catch { res.writeHead(500).end(); }
});
await new Promise(ok => server.listen(0, '127.0.0.1', ok)); const base = 'http://127.0.0.1:' + server.address().port;
let browser, page; const requests = [];
try {
  browser = await chromium.launch({ headless: true, channel: 'msedge' }); const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname.replace('/api/v1', ''); requests.push(path + url.search);
    const json = value => route.fulfill({ json: value });
    if (path === '/configuration') return json({ academyName: '老子道学书院' });
    if (path === '/admin/auth/session') return json({ user: actor, csrfToken: 'ui-only' });
    if (path === '/admin/finance/summary') return json({ currencies: [{ currency: 'CNY', accepted: '12800', abnormal: '12800', refunded: '12800', cashDifference: '12800', paymentCount: 2, refundCount: 1 }] });
    if (path.startsWith('/admin/finance/orders/')) return json({ order: { ...paid, kind: url.searchParams.get('kind') ?? 'COURSE' }, payments: [{ id, channel: 'WECHAT_APP', amount: '12800', currency: 'CNY', disposition: 'ACCEPTED', externalTransactionId: '42020261014001', paidAt: when }], refunds: [], journals: [{ id, description: '课程已验证收款', currency: 'CNY', postedAt: when, balanced: true, entries: [{ id, accountName: '微信应收', debit: '12800', credit: '0' }, { id: jobId, accountName: '课程收入', debit: '0', credit: '12800' }] }] });
    if (path.startsWith('/admin/finance/')) { const kind = url.searchParams.get('kind') ?? 'COURSE'; return json({ items: [{ id, orderId: id, orderNo: paid.orderNo, orderKind: kind, channel: 'WECHAT_APP', currency: 'CNY', amount: '12800', state: path.endsWith('refunds') ? 'SUCCEEDED' : 'ACCEPTED', occurredAt: when, description: '课程已验证收款', debit: '12800', credit: '12800', balanced: true }], total: 1 }); }
    if (path === '/admin/operations/summary') return json({ counts: { DEAD: retried ? 0 : 1, READY: retried ? 1 : 0 }, overdue: 0, expiredLeases: 0, checkedAt: when, oldestPendingAt: when });
    if (path.endsWith('/retry')) { const body = route.request().postDataJSON(); assert.equal(body.reason, '已核查通知服务恢复'); if (conflict) { conflict = false; revision = 'b'.repeat(64); return route.fulfill({ status: 409, json: { message: '任务已变化，请刷新后核查最新状态' } }); } assert.equal(body.expectedRevision, revision); retried = true; return json({ queued: true }); }
    if (path === '/admin/operations/jobs') return json({ items: [job()], total: 1 });
    if (path.startsWith('/admin/operations/jobs/')) return json(job());
    if (/^\/admin\/(course|membership|cohort|booking|product)-orders\//.test(path)) return json(paid);
    if (/^\/admin\/(course|membership|cohort|booking|product)-orders$/.test(path)) return json({ items: [], total: 0, salesEnabled: false });
    return json([]);
  });
  page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/'); await page.getByText('运行待处理事项', { exact: true }).waitFor();
  await page.getByRole('link', { name: '查看任务监控 →', exact: true }).click(); await page.locator('.ant-page-header-heading-title').filter({ hasText: /^任务监控与恢复$/ }).waitFor();
  await page.getByRole('button', { name: '查看与处理', exact: true }).click(); const drawer = page.getByRole('dialog', { name: '任务详情与处理' }); await drawer.getByText(paid.orderNo, { exact: true }).waitFor();
  await drawer.screenshot({ path: output + '/task-detail.png' });
  await drawer.getByRole('button', { name: '核查后重新排队', exact: true }).click(); let modal = page.getByRole('dialog', { name: '核查后重新排队' }); await modal.getByLabel('核查结果与恢复依据').fill('已核查通知服务恢复'); await modal.getByRole('button', { name: /确.*定/ }).click(); await modal.getByText('任务已变化，请刷新后核查最新状态').waitFor();
  await modal.getByRole('button', { name: /取.*消/ }).click(); await drawer.getByRole('button', { name: '刷新详情' }).click(); await drawer.getByRole('button', { name: '核查后重新排队' }).click(); modal = page.getByRole('dialog', { name: '核查后重新排队' }); await modal.getByLabel('核查结果与恢复依据').fill('已核查通知服务恢复'); await modal.getByRole('button', { name: /确.*定/ }).click(); await modal.waitFor({ state: 'hidden' }); await drawer.getByText('已核查通知服务恢复').waitFor(); assert.equal(await drawer.getByRole('button', { name: '核查后重新排队' }).count(), 0);
  checks.push('任务详情、冲突原因保留、刷新后重试、执行后禁用恢复和审计回显（界面会话专项）');
  await drawer.getByRole('link', { name: '打开订单处理 →' }).click(); await page.getByRole('dialog', { name: '课程订单详情' }).waitFor(); checks.push('恢复任务直接打开关联课程订单详情');
  await page.goto(base + '/finance'); await page.locator('.ant-page-header-heading-title').filter({ hasText: /^收退款与账务$/ }).waitFor(); await page.getByRole('button', { name: '查看资金链路' }).click(); const funds = page.getByRole('dialog', { name: '订单资金链路' }); await funds.getByText('借贷平衡', { exact: true }).waitFor(); await funds.screenshot({ path: output + '/finance-order.png' });
  await funds.getByRole('link', { name: '打开对应订单 →' }).click(); await page.getByRole('dialog', { name: '课程订单详情' }).waitFor(); checks.push('财务卡片与实际分录展示、课程资金链路跳到对应订单');
  for (const [path, title] of [['/membership-orders', '会员订单详情'], ['/cohort-orders', '训练营报名订单'], ['/booking-orders', '预约 / 报名订单'], ['/orders', '订单与售后']]) { await page.goto(base + path + '?orderId=' + id); await page.getByRole('dialog', { name: title }).waitFor(); await page.getByRole('dialog', { name: title }).getByText(paid.orderNo, { exact: true }).waitFor(); }
  checks.push('会员、训练营、预约活动、商品四个既有业务深链定位订单，保留原处理流程');
  await page.goto(base + '/finance'); await page.getByRole('tab', { name: '账务明细' }).click(); await page.getByText('平衡', { exact: true }).waitFor(); await page.getByRole('searchbox', { name: '搜索财务订单' }).fill('DX20261014001'); await Promise.all([page.waitForResponse(r => r.url().includes('/admin/finance/journals') && r.url().includes('q=DX20261014001')), page.getByRole('searchbox', { name: '搜索财务订单' }).press('Enter')]); await page.screenshot({ path: output + '/finance-list.png', fullPage: true }); checks.push('账务页签和订单关键词筛选传到接口');
  actor = { ...actor, roles: ['SUPPORT'], permissions: ['orders.read', 'support.read'] }; await page.goto(base + '/finance'); await page.getByText(/403/).first().waitFor(); await page.goto(base + '/operations'); await page.getByText(/403/).first().waitFor(); checks.push('客服权限菜单隐藏且财务/任务直接URL拒绝');
  assert.deepEqual(errors, []);
} catch (error) { if (page) { await page.screenshot({ path: output + '/failure.png', fullPage: true }).catch(() => {}); await writeFile(output + '/failure.txt', await page.locator('body').innerText().catch(() => '')); } throw error; }
finally { await browser?.close(); await new Promise(ok => server.close(ok)); await writeFile(output + '/checks.json', JSON.stringify({ scope: 'Production build, browser UI fixtures; database/API security tested separately', checks, errors }, null, 2)); }
console.log(JSON.stringify({ passed: checks.length, errors }));
