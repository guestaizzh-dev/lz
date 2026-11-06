import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Run with the local API .env. All API writes stay in a disposable database copy.
const require = createRequire(new URL('../../services/api/package.json', import.meta.url));
const { Pool } = require('pg');
const { chromium } = createRequire(process.env.ACADEMY_BROWSER_MODULE + '/package.json')(
  'playwright',
);
const source = new URL(process.env.DATABASE_URL);
assert.ok(
  ['127.0.0.1', 'localhost'].includes(source.hostname) && process.env.NODE_ENV !== 'production',
);
const original = decodeURIComponent(source.pathname.slice(1)),
  database = 'academy_test_ui_review_' + Date.now();
assert.match(original, /^[a-zA-Z0-9_]+$/);
const connection = new URL(source);
connection.pathname = '/postgres';
const control = new Pool({ connectionString: connection.toString() });
const output = resolve(process.env.ACADEMY_BROWSER_OUTPUT ?? 'outputs/ui-full-review');
const checks = [],
  screens = [],
  errors = [];
let db, app, browser, server, failure;
await mkdir(output, { recursive: true });
await control.query(`CREATE DATABASE "${database}" TEMPLATE "${original}"`);
source.pathname = '/' + database;
Object.assign(process.env, {
  DATABASE_URL: source.toString(),
  NODE_ENV: 'test',
  DEV_OTP_CODE: '123456',
  SMS_ENABLED: 'true',
  PREVIEW_LOGIN_ENABLED: 'false',
  CORS_ORIGINS: 'http://127.0.0.1:5173',
  COURSE_PAYMENT_WORKER_ENABLED: 'false',
  MEMBERSHIP_PAYMENT_WORKER_ENABLED: 'false',
  PRODUCT_PAYMENT_WORKER_ENABLED: 'false',
  BOOKING_PAYMENT_WORKER_ENABLED: 'false',
  COHORT_PAYMENT_WORKER_ENABLED: 'false',
});
try {
  await new Promise((ok, no) => {
    const child = spawn(
      process.execPath,
      ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
      { cwd: resolve('services/api'), env: process.env, stdio: 'ignore', windowsHide: true },
    );
    child.on('error', no);
    child.on('exit', (code) => (code === 0 ? ok() : no(Error('Isolated migration failed'))));
  });
  process.env.MEDIA_DIR = output + '/test-media';
  await mkdir(process.env.MEDIA_DIR, { recursive: true });
  const { createApp } = await import('../../services/api/dist/main.js');
  const { Database } = await import('../../services/api/dist/database.js');
  const { phoneLookup } = await import('../../services/api/dist/private-data.js');
  db = new Database();
  app = await createApp(false);
  await app.listen(0, '127.0.0.1');
  const api = (await app.getUrl()) + '/api/v1';
  const web = resolve(process.env.ACADEMY_WEB_DIR ?? '.runtime/ui-full-web');
  server = createServer(async (req, res) => {
    try {
      const path = resolve(
        web,
        '.' + decodeURIComponent(new URL(req.url, 'http://local').pathname),
      );
      if (path !== web && !path.startsWith(web + sep)) {
        res.writeHead(403).end();
        return;
      }
      const file = path === web ? resolve(web, 'index.html') : path;
      res.setHeader(
        'Content-Type',
        {
          '.html': 'text/html',
          '.js': 'application/javascript',
          '.css': 'text/css',
          '.svg': 'image/svg+xml',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.ttf': 'font/ttf',
          '.otf': 'font/otf',
        }[extname(file)] ?? 'application/octet-stream',
      );
      res.end(await readFile(file));
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  page.setDefaultTimeout(12000);
  page.on('pageerror', (e) => errors.push(e.message));
  const responses = [];
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    const cors = {
      'access-control-allow-origin': base,
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'authorization,content-type',
      'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
    };
    if (req.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    const headers = { ...req.headers(), origin: 'http://127.0.0.1:5173' };
    delete headers.host;
    const response = await page.request.fetch(
      api + url.pathname.replace('/api/v1', '') + url.search,
      { method: req.method(), headers, data: req.postData() ?? undefined },
    );
    responses.push({ path: url.pathname, status: response.status() });
    await route.fulfill({ response, headers: { ...response.headers(), ...cors } });
  });
  async function nav(path) {
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.goto(base + '/#/' + path);
      await page.waitForTimeout(400);
      await page
        .locator('.state-loading')
        .waitFor({ state: 'hidden', timeout: 12000 })
        .catch(() => {});
      await page.evaluate(() => document.fonts.ready);
      // Images settle before the shot; a half-loaded tabbar icon otherwise reads as a product defect.
      await page.evaluate(() =>
        Promise.all(
          [...document.images].map((i) =>
            i.complete
              ? 0
              : new Promise((r) => {
                  i.onload = i.onerror = r;
                }),
          ),
        ),
      );
      const timedOut = await page.evaluate(() =>
        document.body.innerText.includes('连接服务器超时'),
      );
      if (!timedOut) return;
      await page.waitForTimeout(1200);
    }
  }
  await nav('pages/auth/login');
  await page.screenshot({ path: output + '/auth-login.png', animations: 'disabled' });
  screens.push({ path: 'pages/auth/login', mode: 'login', http: [] });
  await page.locator('input').nth(0).fill('19900001002');
  await page.locator('.send-code').click();
  await page.getByText(/秒后重发/).waitFor();
  await page.locator('input').nth(1).fill('123456');
  await page.locator('.consent-touch').click();
  await page.locator('.login-submit').click();
  await page.locator('.login-submit').waitFor({ state: 'hidden' });
  checks.push('真实验证码登录，操作仅落隔离数据库');
  const student = await db.user.findFirstOrThrow({
    where: { phoneHash: phoneLookup('19900001002') },
  });
  const course = await db.course.findFirstOrThrow({
    where: { status: 'PUBLISHED', publishedReleaseId: { not: null } },
  });
  const article = await db.article.findFirstOrThrow({ where: { status: 'PUBLISHED' } });
  const teacher = await db.teacher.findFirstOrThrow({ where: { status: 'PUBLISHED' } });
  const product = await db.product.findFirstOrThrow({ where: { status: 'PUBLISHED' } });
  const event = await db.event.findFirst({ where: { status: 'PUBLISHED', price: 0 } });
  const plan = await db.membershipPlan.findFirst({ where: { active: true } });
  const thread = await db.forumThread.findFirst();
  const section = await db.forumSection.findFirst();
  const room = await db.liveRoom.findFirst();
  const live = await db.liveSession.findFirst();
  const order = await db.order.findFirst({ where: { userId: student.id } });
  const admin = await db.user.findFirstOrThrow({ where: { roles: { has: 'ADMIN' } } });
  const req = { actor: admin, permissions: [], requestId: randomUUID() };
  const { CohortsService } = await import('../../services/api/dist/cohorts.js');
  const cohorts = app.get(CohortsService),
    day = 86400000;
  const cohort = await cohorts.create(req, {
    courseId: course.id,
    title: '道德经七日共读 · 秋日营',
    startsAt: new Date(Date.now() + day * 3).toISOString(),
    endsAt: new Date(Date.now() + day * 10).toISOString(),
    enrollDeadline: new Date(Date.now() + day * 2).toISOString(),
    capacity: 30,
    price: 0,
  });
  await cohorts.state(req, cohort.id, {
    state: 'OPEN',
    expectedVersion: cohort.version,
    reason: '隔离界面走查',
  });
  let registration = null,
    bookingTicket = null;
  if (event) {
    const { BookingsService } = await import('../../services/api/dist/bookings.js');
    const bookings = app.get(BookingsService);
    await db.event.update({
      where: { id: event.id },
      data: {
        startsAt: new Date(Date.now() + day),
        endsAt: new Date(Date.now() + day * 4),
        capacity: 100,
      },
    });
    const session = await bookings.createSession(req, event.id, {
      startsAt: new Date(Date.now() + day * 2).toISOString(),
      endsAt: new Date(Date.now() + day * 2 + 3600000).toISOString(),
      publicOpenAt: new Date(Date.now() - 60000).toISOString(),
      cancelDeadline: new Date(Date.now() + day).toISOString(),
      location: '书院共读室',
      capacity: 20,
      ticketTitle: '共读席位',
      perUserLimit: 2,
    });
    bookingTicket = await db.eventTicketType.findFirstOrThrow({ where: { sessionId: session.id } });
    registration = await bookings.register(
      { actor: student, permissions: [], requestId: randomUUID() },
      {
        ticketTypeId: bookingTicket.id,
        requestKey: randomUUID(),
        quantity: 1,
        name: '研习学员',
        phone: '19900001002',
        contactConsent: true,
      },
    );
  }
  const sku = await db.productSku.findFirst({ where: { productId: product.id } });
  const nil = '00000000-0000-4000-8000-000000000000';
  const queries = {
    'article/detail': 'id=' + article.id,
    'teacher/detail': 'id=' + teacher.id,
    'product/detail': 'id=' + product.id,
    'event/detail': 'id=' + (event?.id ?? nil),
    'course/purchase': 'courseId=' + course.id,
    'membership/purchase': 'planId=' + (plan?.id ?? nil),
    'order/confirm': 'type=product&skuId=' + (sku?.id ?? nil) + '&quantity=1',
    'community/detail': 'id=' + (thread?.id ?? nil),
    'community/editor': 'sectionId=' + (section?.id ?? nil),
    'live/detail': 'id=' + (room?.id ?? nil),
    'live/watch': 'id=' + (live?.id ?? nil) + '&roomId=' + (live?.roomId ?? nil),
    'order/detail': 'id=' + (order?.id ?? nil),
    'shop/order-detail': 'id=' + (order?.id ?? nil),
    'booking/credential': 'id=' + (registration?.id ?? nil),
    'booking/confirm': 'eventId=' + (event?.id ?? nil),
    'booking/purchase': bookingTicket
      ? 'kind=registration&resourceId=' + bookingTicket.id + '&quantity=1'
      : 'orderId=' + nil,
    'cohort/purchase': 'cohortId=' + cohort.id,
    'cohort/detail': 'id=' + cohort.id,
    'profile/library': 'kind=notes',
    'profile/service': 'kind=orders',
    'shared/index': 'code=invalid-review-link',
  };
  const config = JSON.parse(await readFile('apps/mobile/pages.json', 'utf8'));
  const entries =
    process.env.ACADEMY_REVIEW_FOCUS === 'true'
      ? config.pages.filter((p) => p.path === 'pages/membership/index')
      : config.pages;
  for (const entry of entries) {
    const path = entry.path,
      short = path.replace('pages/', '');
    if (path === 'pages/auth/login') continue;
    const query =
      queries[short] ??
      (short.startsWith('course/') && !['course/library', 'course/orders'].includes(short)
        ? 'id=' + course.id
        : '');
    const at = responses.length;
    await nav(path + (query ? '?' + query : ''));
    const state = await page.evaluate(() => ({
      text: document.querySelector('uni-page')?.innerText ?? document.body.innerText,
      width: innerWidth,
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
    }));
    assert.ok(state.text.trim(), path + ' rendered blank');
    if (state.overflow) checks.push('OVERFLOW 390 ' + path);
    if (state.text.includes('连接服务器超时')) checks.push('NAV-TIMEOUT ' + path);
    const name = short.replaceAll('/', '-');
    await page.screenshot({ path: output + '/' + name + '.png', animations: 'disabled' });
    const metrics = await page.evaluate(() => {
      const box = (e) => {
        let r = e.getBoundingClientRect(),
          b = {
            left: r.left,
            top: r.top,
            right: r.right,
            bottom: r.bottom,
            width: r.width,
            height: r.height,
          };
        for (let p = e.parentElement; p; p = p.parentElement) {
          const s = getComputedStyle(p);
          if (
            [s.overflowX, s.overflowY].some((v) => ['hidden', 'auto', 'scroll', 'clip'].includes(v))
          ) {
            const q = p.getBoundingClientRect();
            b.left = Math.max(b.left, q.left);
            b.top = Math.max(b.top, q.top);
            b.right = Math.min(b.right, q.right);
            b.bottom = Math.min(b.bottom, q.bottom);
          }
        }
        b.width = b.right - b.left;
        b.height = b.bottom - b.top;
        return b;
      };
      const texts = [...document.querySelectorAll('uni-text')].filter((e) => {
        const r = box(e),
          s = getComputedStyle(e);
        return r.width > 1 && r.height > 1 && s.visibility !== 'hidden' && e.textContent.trim();
      });
      const tiny = texts
        .filter((e) => parseFloat(getComputedStyle(e).fontSize) < 11)
        .map((e) => ({ t: e.textContent.trim().slice(0, 24), s: getComputedStyle(e).fontSize }));
      const clipped = texts
        .filter((e) => e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0)
        .map((e) => ({
          t: e.textContent.trim().slice(0, 24),
          w: e.clientWidth,
          sw: e.scrollWidth,
        }));
      const overlaps = [];
      const rects = texts.map((e) => ({ e, r: box(e) }));
      for (let i = 0; i < rects.length && overlaps.length < 8; i++)
        for (let j = i + 1; j < rects.length && overlaps.length < 8; j++) {
          const a = rects[i],
            b = rects[j];
          if (a.e.contains(b.e) || b.e.contains(a.e)) continue;
          const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left),
            h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
          if (w > 2 && h > 4)
            overlaps.push({
              a: a.e.textContent.trim().slice(0, 20),
              b: b.e.textContent.trim().slice(0, 20),
            });
        }
      const edges = {};
      for (const { r } of rects) {
        if (r.width > 1) edges[Math.round(r.left)] = (edges[Math.round(r.left)] ?? 0) + 1;
      }
      const buttons = [...document.querySelectorAll('uni-button')].filter((e) => box(e).width > 0);
      return {
        tiny: tiny.slice(0, 6),
        tinyCount: tiny.length,
        clipped: clipped.slice(0, 6),
        overlaps,
        edges,
        maxRight: Math.max(0, ...rects.map((x) => x.r.right)),
        whiteButtons: buttons
          .filter((e) =>
            ['rgb(255, 255, 255)', 'rgb(248, 248, 248)'].includes(
              getComputedStyle(e).backgroundColor,
            ),
          )
          .map((e) => ({ t: e.textContent.trim().slice(0, 20), c: e.className }))
          .slice(0, 5),
        disabledButtons: buttons.filter(
          (e) => e.disabled || e.getAttribute('aria-disabled') === 'true',
        ).length,
        buttons: buttons.length,
      };
    });
    screens.push({
      path,
      mode: state.text.includes('暂时无法加载')
        ? 'error-state'
        : state.text.includes('需要登录')
          ? 'login'
          : 'content-or-empty',
      text: state.text.slice(0, 1000),
      metrics,
      http: responses.slice(at).filter((r) => r.status >= 400),
    });
  }
  for (const width of [320, 768]) {
    await page.setViewportSize({ width, height: 844 });
    for (const entry of entries) {
      const short = entry.path.replace('pages/', ''),
        query =
          queries[short] ??
          (short.startsWith('course/') && !['course/library', 'course/orders'].includes(short)
            ? 'id=' + course.id
            : '');
      await nav(entry.path + (query ? '?' + query : ''));
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      );
      if (overflow) checks.push('OVERFLOW ' + width + ' ' + entry.path);
      await page.screenshot({
        path: output + '/' + short.replaceAll('/', '-') + '-' + width + '.png',
        animations: 'disabled',
      });
    }
  }
  checks.push('本次' + entries.length + '页390/320/768视口截图与页面状态采集');
  const { reviewMemberCenter } = await import('./member-center-review.mjs');
  await reviewMemberCenter({
    app,
    db,
    browser,
    page,
    base,
    api,
    output,
    student,
    admin,
    checks,
    errors,
  });
  assert.deepEqual(errors, []);
} catch (e) {
  failure = e;
  if (browser) {
    const pages = browser.contexts().flatMap((c) => c.pages());
    for (let i = 0; i < pages.length; i++)
      await pages[i].screenshot({ path: output + '/failure-' + i + '.png' }).catch(() => {});
  }
} finally {
  await writeFile(
    output + '/report.json',
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        platform: 'Edge Web，非原生验收',
        checks,
        screens,
        errors,
        failure: failure?.stack ?? null,
      },
      null,
      2,
    ),
  );
  if (browser) await browser.close();
  if (server) await new Promise((ok) => server.close(ok));
  if (app) await app.close();
  if (db) await db.$disconnect();
  await control.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1', [
    database,
  ]);
  await control.query(`DROP DATABASE "${database}"`);
  await control.end();
}
console.log(
  JSON.stringify({
    checks: checks.length,
    screens: screens.length,
    errors,
    failure: failure?.message ?? null,
  }),
);
if (failure) throw failure;
