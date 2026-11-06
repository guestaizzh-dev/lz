import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../services/api/package.json', import.meta.url));

// Called only by the isolated App review; every API write remains in its disposable database.
export async function reviewMemberCenter({
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
}) {
  const { AuthService } = await import('../../services/api/dist/auth.js'),
    { MemberCenter } = await import('../../services/api/dist/member-center.js'),
    { PaymentChannels } = await import('../../services/api/dist/payment-channels.js');
  const center = app.get(MemberCenter),
    channels = app.get(PaymentChannels),
    auth = app.get(AuthService),
    trades = new Map(),
    refunds = new Map(),
    identity = { appid: 'local-ui-member', mchid: 'local-ui-merchant' };
  const qr = await require('qrcode').toBuffer('isolated-browser-gateway-fixture');
  channels.resolve = () => ({
    identity: () => identity,
    availability: () => ({ enabled: true, reason: '' }),
    prepay: async (no, title, amount, expiresAt) => {
      trades.set(no, {
        ...identity,
        out_trade_no: no,
        trade_type: 'NATIVE',
        trade_state: 'NOTPAY',
        amount: { total: amount, currency: 'CNY' },
      });
      return JSON.stringify({
        codeUrl: 'weixin://wxpay/bizpayurl?pr=fixture',
        qrImageUrl: 'https://cuecanvas.top/api/v1/payments/wechat/native-qr?ticket=fixture',
        expiresAt: expiresAt.toISOString(),
        merchantName: '隔离测试网关',
      });
    },
    query: async (no) => trades.get(no) ?? { trade_state: 'NOTFOUND' },
    close: async (no) => {
      const t = trades.get(no);
      if (t) t.trade_state = 'CLOSED';
    },
    refund: async (id, no, amount, total, orderNo) => {
      const r = refunds.get(no) ?? {
        ...identity,
        transaction_id: id,
        out_trade_no: orderNo,
        out_refund_no: no,
        refund_id: randomUUID(),
        status: 'SUCCESS',
        success_time: new Date().toISOString(),
        amount: { refund: amount, total, currency: 'CNY' },
      };
      refunds.set(no, r);
      return r;
    },
  });
  channels.choices = () => [
    {
      channel: 'WECHAT_NATIVE',
      provider: 'wxnative',
      label: '微信扫码支付',
      enabled: true,
      reason: '',
    },
  ];
  process.env.MEMBERSHIP_SALES_ENABLED = 'true';
  await page.route('**/api/v1/membership-center/**', async (route) => {
    const r = route.request(),
      url = new URL(r.url()),
      cors = {
        'access-control-allow-origin': base,
        'access-control-allow-credentials': 'true',
        'access-control-allow-headers': 'authorization,content-type',
        'access-control-allow-methods': 'GET,POST,PUT,OPTIONS',
      };
    if (r.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    if (url.searchParams.has('platform')) url.searchParams.set('platform', 'ANDROID');
    let data = r.postData();
    if (data) {
      const json = JSON.parse(data);
      if (json.platform) json.platform = 'ANDROID';
      data = JSON.stringify(json);
    }
    const headers = { ...r.headers(), origin: 'http://127.0.0.1:5173' };
    delete headers.host;
    const response = await page.request.fetch(
      api + url.pathname.replace('/api/v1', '') + url.search,
      { method: r.method(), headers, data: data ?? undefined },
    );
    await route.fulfill({ response, headers: { ...response.headers(), ...cors } });
  });
  await page.route('**/api/v1/payments/wechat/native-qr?ticket=fixture', (r) =>
    r.fulfill({ status: 200, contentType: 'image/png', body: qr }),
  );
  async function nav(path) {
    await page.goto(base + '/#/pages/' + path);
    await page
      .locator('.state-loading')
      .waitFor({ state: 'hidden' })
      .catch(() => {});
    await page.waitForTimeout(250);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await nav('membership/index');
  await page.locator('.grade-card').nth(3).waitFor();
  assert.equal(await page.locator('.grade-card').count(), 4);
  await page.screenshot({ path: output + '/member-premium-registered.png' });
  await page.locator('.grade-card').first().click();
  await page.locator('.checkout-action').waitFor();
  assert.match(await page.locator('.checkout-price').innerText(), /365/);
  assert.equal(
    await page.locator('.checkout-action uni-button').evaluate((e) => e.hasAttribute('disabled')),
    true,
  );
  const disabled = await page.locator('.checkout-action .action-label').evaluate((e) => ({
    text: e.textContent,
    color: getComputedStyle(e).color,
    background: getComputedStyle(e.parentElement).backgroundColor,
  }));
  assert.ok(disabled.text.includes('确认付款'));
  assert.notEqual(disabled.color, disabled.background);
  await page.screenshot({ path: output + '/member-purchase-unchecked.png' });
  await page.locator('.commerce-consent').click();
  assert.equal(
    await page.locator('.checkout-action uni-button').evaluate((e) => e.hasAttribute('disabled')),
    false,
  );
  await page.locator('.checkout-action uni-button').click();
  await page.locator('.pay-image').waitFor();
  const order = await db.tradeOrder.findFirstOrThrow({
    where: { userId: student.id, kind: 'MEMBER_LIFETIME', state: 'PENDING' },
  });
  assert.equal(await db.memberPurchase.count({ where: { orderId: order.id } }), 0);
  const fact = {
    ...trades.get(order.orderNo),
    trade_state: 'SUCCESS',
    transaction_id: randomUUID(),
    success_time: new Date().toISOString(),
  };
  trades.set(order.orderNo, fact);
  await page.locator('uni-button.pay-secondary').filter({ hasText: '我已付款' }).click();
  await page.getByText('付款已确认', { exact: true }).waitFor();
  await page.locator('uni-button.pay-primary').filter({ hasText: '返回订单' }).click();
  await page.getByText('查看我的权益', { exact: true }).waitFor();
  await nav('membership/index');
  await page.getByText('铜牌会员', { exact: true }).first().waitFor();
  assert.equal(await page.locator('.pass-balance').innerText(), '50');
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
      false,
    );
    await page.screenshot({ path: output + '/member-premium-copper-' + width + '.png' });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.grade-card').nth(1).click();
  await page.getByText('633', { exact: false }).first().waitFor();
  assert.match(await page.locator('.checkout-price').innerText(), /633/);
  assert.match(await page.locator('.content').innerText(), /50份/);
  await page.screenshot({ path: output + '/member-upgrade-difference.png' });
  await nav('membership/vouchers');
  await page.locator('.wallet-number').waitFor();
  await page.locator('uni-button.voucher-pack').filter({ hasText: '30份' }).click();
  assert.match(await page.locator('.commerce-amount').innerText(), /90/);
  await page.locator('uni-button.action-button').filter({ hasText: '购买代金券' }).click();
  await page.locator('.checkout-price').waitFor();
  assert.match(await page.locator('.checkout-price').innerText(), /90/);
  checks.push(
    '会员实际页面：五档、直达购买、勾选门禁、隔离Native编排后发券、铜升银633元/50份、独立购券选份与金额、320/390/768有效会员布局',
  );

  const courseToken = auth.credentials(),
    operator = auth.credentials(),
    operatorCsrf = randomUUID();
  for (const [user, credential, kind, csrfToken] of [
    [student, courseToken, 'APP', randomUUID()],
    [admin, operator, 'ADMIN', operatorCsrf],
  ])
    await db.authSession.create({
      data: {
        userId: user.id,
        kind,
        accessHash: credential.accessHash,
        refreshHash: credential.refreshHash,
        accessExpiresAt: credential.accessExpiresAt,
        expiresAt: new Date(Date.now() + 86400000),
        csrfToken,
      },
    });
  async function courseAdmin(path, body) {
    const r = await fetch(api + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://127.0.0.1:5173',
        Cookie: 'daoxue_access=' + operator.access,
        'X-CSRF-Token': operatorCsrf,
      },
      body: JSON.stringify(body),
    });
    const result = await r.json();
    assert.ok(r.ok, JSON.stringify(result));
    return result;
  }
  const teacher = await db.teacher.create({
      data: { name: '隔离页面主讲', title: '经典研习', bio: '页面验收', status: 'PUBLISHED' },
    }),
    asset = await db.mediaAsset.create({
      data: {
        storageKey: randomUUID(),
        name: 'review.mp4',
        mime: 'video/mp4',
        bytes: 20,
        uploaderId: admin.id,
        status: 'READY',
        visibility: 'PRIVATE',
      },
    });
  await writeFile(
    resolve(process.env.MEDIA_DIR, asset.storageKey),
    Buffer.from([
      0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0, 105, 115, 111, 109,
    ]),
  );
  const video = await courseAdmin('/admin/courses', {
    title: '视频代金券 · 研习课程',
    subtitle: '隔离页面验收',
    description: '验证兑换和退券',
    category: '经典研习',
    format: 'VIDEO',
    cover: '/static/art/books.svg',
    price: 3000,
    teacherId: teacher.id,
    membershipTier: null,
    accessDays: null,
    refundPolicy: '7天内未开始学习可退课退券',
    tags: [],
    featured: false,
    chapters: [
      {
        title: '正式视频',
        format: 'VIDEO',
        body: '',
        mediaId: asset.id,
        durationSeconds: 120,
        trial: false,
        required: true,
      },
    ],
  });
  await courseAdmin('/admin/courses/' + video.id + '/transition', {
    action: 'publish',
    expectedVersion: video.version,
    reason: '隔离页面验收发布',
  });
  await page.route('**/api/v1/commerce/courses/**/quote?**', async (route) => {
    const r = route.request(),
      url = new URL(r.url());
    url.searchParams.set('platform', 'ANDROID');
    const headers = { ...r.headers(), origin: 'http://127.0.0.1:5173' };
    delete headers.host;
    const response = await page.request.fetch(
      api + url.pathname.replace('/api/v1', '') + url.search,
      { headers },
    );
    await route.fulfill({
      response,
      headers: {
        ...response.headers(),
        'access-control-allow-origin': base,
        'access-control-allow-credentials': 'true',
      },
    });
  });
  await page.route('**/api/v1/commerce/course-orders', async (route) => {
    const r = route.request();
    if (r.method() !== 'POST') {
      await route.fallback();
      return;
    }
    const headers = { ...r.headers(), origin: 'http://127.0.0.1:5173' };
    delete headers.host;
    const data = JSON.parse(r.postData());
    data.platform = 'ANDROID';
    const response = await page.request.fetch(api + '/commerce/course-orders', {
      method: 'POST',
      headers,
      data,
    });
    await route.fulfill({
      response,
      headers: {
        ...response.headers(),
        'access-control-allow-origin': base,
        'access-control-allow-credentials': 'true',
      },
    });
  });
  await nav('course/purchase?courseId=' + video.id);
  await page.locator('.purchase-title').filter({ hasText: video.title }).waitFor();
  await page
    .locator('uni-button')
    .filter({ hasText: /^使用代金券$/ })
    .click();
  await page.locator('uni-button.bar-primary').filter({ hasText: '确认代金券兑换' }).waitFor();
  await page.locator('.purchase-consent').click();
  await page.locator('uni-button.bar-primary').click();
  await page.locator('uni-button.bar-primary').filter({ hasText: '开始研习' }).waitFor();
  const redeemed = await db.tradeOrder.findFirstOrThrow({
    where: { userId: student.id, kind: 'COURSE', payableTotal: 0n },
    orderBy: { createdAt: 'desc' },
  });
  assert.equal(await db.paymentTransaction.count({ where: { orderId: redeemed.id } }), 0);
  await page.screenshot({ path: output + '/video-full-voucher.png' });
  await page.locator('uni-button').filter({ hasText: '申请退课退券' }).click();
  await page.locator('.compose-input textarea').fill('尚未开始视频，申请退回原券');
  await page.locator('uni-button.compose-submit').click();
  await page.getByText('对应购课权限已撤销', { exact: false }).waitFor();
  assert.equal((await center.overview(student.id)).voucher.available, 50);
  await page.screenshot({ path: output + '/video-returned-voucher.png' });
  checks.push(
    '视频真实页面：全券兑换零现金、开始研习入口、退课退券表单、原来源返券；不触发现金收款',
  );

  const root = resolve('apps/admin/dist'),
    server = createServer(async (req, res) => {
      try {
        let path = resolve(
          root,
          '.' + decodeURIComponent(new URL(req.url, 'http://local').pathname),
        );
        if (path !== root && !path.startsWith(root + sep)) {
          res.writeHead(403).end();
          return;
        }
        let content;
        try {
          content = await readFile(path);
        } catch {
          path = resolve(root, 'index.html');
          content = await readFile(path);
        }
        res.setHeader(
          'Content-Type',
          {
            '.html': 'text/html',
            '.js': 'application/javascript',
            '.css': 'text/css',
            '.svg': 'image/svg+xml',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.woff2': 'font/woff2',
          }[extname(path)] ?? 'application/octet-stream',
        );
        res.end(content);
      } catch {
        res.writeHead(500).end();
      }
    });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const adminBase = 'http://127.0.0.1:' + server.address().port,
    credential = auth.credentials(),
    csrf = randomUUID();
  await db.authSession.create({
    data: {
      userId: admin.id,
      kind: 'ADMIN',
      accessHash: credential.accessHash,
      refreshHash: credential.refreshHash,
      accessExpiresAt: credential.accessExpiresAt,
      expiresAt: new Date(Date.now() + 86400000),
      csrfToken: csrf,
    },
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies([
    { name: 'daoxue_access', value: credential.access, url: adminBase },
    { name: 'daoxue_csrf', value: csrf, url: adminBase },
  ]);
  const ap = await context.newPage(),
    adminScreens = [];
  ap.on('pageerror', (e) => errors.push(e.message));
  ap.setDefaultTimeout(15000);
  const adminOutput = output + '/admin';
  await mkdir(adminOutput, { recursive: true });
  await ap.route('**/api/v1/**', async (route) => {
    const r = route.request(),
      url = new URL(r.url()),
      headers = { ...r.headers(), origin: 'http://127.0.0.1:5173' };
    delete headers.host;
    const response = await ap.request.fetch(
      api + url.pathname.replace('/api/v1', '') + url.search,
      { method: r.method(), headers, data: r.postData() ?? undefined },
    );
    await route.fulfill({ response });
  });
  async function adminCall(path, method, body) {
    const r = await fetch(api + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://127.0.0.1:5173',
        Cookie: 'daoxue_access=' + credential.access,
        'X-CSRF-Token': csrf,
      },
      body: JSON.stringify(body),
    });
    const value = await r.json();
    assert.ok(r.ok, JSON.stringify(value));
    return value;
  }
  try {
    await ap.goto(adminBase + '/video-vouchers');
    await ap.getByRole('button', { name: '编辑代金券', exact: true }).click();
    await ap.getByLabel('单份售价（元）', { exact: true }).fill('1.5');
    await ap.getByLabel('单份抵扣面额（元）', { exact: true }).fill('5');
    await ap.getByLabel('修改原因', { exact: true }).fill('隔离浏览器配置券价');
    await ap
      .getByRole('button', { name: /确\s*定/ })
      .last()
      .click();
    await ap.getByText('已保存，后续新发券使用新设置', { exact: true }).waitFor();
    const policy = await db.videoVoucherPolicy.findUniqueOrThrow({ where: { id: 1 } });
    assert.deepEqual([policy.price, policy.faceValue], [150, 500]);
    assert.equal(
      (await db.videoVoucherLot.findUniqueOrThrow({ where: { orderId: order.id } })).faceValue,
      300,
    );
    await ap.screenshot({ path: adminOutput + '/voucher-policy.png' });
    await adminCall('/admin/membership-center/voucher-settings', 'PUT', {
      title: policy.title,
      price: 300,
      faceValue: 300,
      active: true,
      expectedVersion: policy.version,
      reason: '恢复隔离券配置',
    });
    checks.push('独立代金券后台实际表单改售价/面额，旧批次不变');
    await ap.goto(adminBase + '/memberships');
    await ap.getByRole('button', { name: '调整设置' }).first().waitFor();
    await ap.getByRole('button', { name: '调整设置' }).first().click();
    await ap.getByLabel('调整原因', { exact: true }).fill('隔离浏览器验证赠券配置');
    await ap.getByLabel('本档开通赠券总份数', { exact: true }).fill('51');
    await ap.screenshot({ path: adminOutput + '/grade-config.png' });
    await ap
      .getByRole('button', { name: /确\s*定/ })
      .last()
      .click();
    await ap.getByText('新售等级设置已更新，已有订单及赠券保持原约定', { exact: true }).waitFor();
    const grade = await db.membershipGrade.findUniqueOrThrow({ where: { tier: 1 } });
    assert.equal(grade.voucherQuantity, 51);
    assert.equal(
      (await db.videoVoucherLot.findUniqueOrThrow({ where: { orderId: order.id } })).quantity,
      50,
    );
    await adminCall('/admin/membership-center/grades/1', 'PUT', {
      expectedVersion: grade.version,
      price: grade.price,
      voucherQuantity: 50,
      goodsBasisPoints: grade.goodsBasisPoints,
      bookBasisPoints: grade.bookBasisPoints,
      active: true,
      reason: '恢复隔离测试设置',
    });
    const userToken = auth.credentials();
    await db.authSession.create({
      data: {
        userId: student.id,
        kind: 'APP',
        accessHash: userToken.accessHash,
        refreshHash: userToken.refreshHash,
        accessExpiresAt: userToken.accessExpiresAt,
        expiresAt: new Date(Date.now() + 86400000),
        csrfToken: randomUUID(),
      },
    });
    const r = await fetch(api + '/membership-center/orders/' + order.id + '/refund', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + userToken.access },
      body: JSON.stringify({ requestKey: randomUUID(), reason: '隔离浏览器退款验收' }),
    });
    assert.equal(r.status, 201, await r.text());
    await ap.reload();
    await ap.getByRole('button', { name: '订单与售后', exact: true }).first().click();
    await ap.getByRole('button', { name: '同意原路退款', exact: true }).click();
    await ap.getByLabel('处理说明', { exact: true }).fill('核对七天内未用权益');
    await ap
      .getByRole('button', { name: /确\s*定/ })
      .last()
      .click();
    await ap.getByText('退款处理已记录，到账以渠道核实结果为准', { exact: true }).waitFor();
    await center.runJobs();
    assert.equal(
      (await db.memberPurchase.findUniqueOrThrow({ where: { orderId: order.id } })).state,
      'REVOKED',
    );
    checks.push('后台真实等级表单保存与旧券冻结、退款审核实际编排及回收');
    await ap.goto(adminBase + '/products');
    await ap.getByRole('button', { name: '新建商品', exact: true }).click();
    const productModal = ap.locator('.ant-modal').filter({ hasText: '商品草稿' });
    await productModal.waitFor();
    assert.equal(
      await productModal.getByText('参与旧版按期会员商品优惠', { exact: true }).count(),
      0,
    );
    for (const [width, height] of [
      [1440, 900],
      [1280, 720],
      [1024, 600],
      [768, 540],
    ]) {
      await ap.setViewportSize({ width, height });
      const geometry = await productModal.evaluate((el) => {
        const footer = el.querySelector('.ant-modal-footer').getBoundingClientRect();
        const body = el.querySelector('.ant-modal-body');
        body.scrollTop = body.scrollHeight;
        return {
          top: footer.top,
          bottom: footer.bottom,
          left: footer.left,
          right: footer.right,
          height: innerHeight,
          width: innerWidth,
          scrolling: body.scrollHeight > body.clientHeight,
        };
      });
      assert.ok(
        geometry.top >= 0 &&
          geometry.bottom <= height &&
          geometry.left >= 0 &&
          geometry.right <= width,
        JSON.stringify(geometry),
      );
      await productModal.getByRole('button', { name: '保存并上架', exact: true }).waitFor();
      await ap.screenshot({
        path: adminOutput + '/product-modal-' + width + 'x' + height + '.png',
      });
    }
    await productModal.getByRole('button', { name: /取\s*消/ }).click();
    await ap.setViewportSize({ width: 1440, height: 900 });
    await ap.getByRole('button', { name: '上架视频课件', exact: true }).click();
    await productModal.getByRole('button', { name: '保存并上传课件', exact: true }).waitFor();
    await productModal.getByRole('button', { name: /取\s*消/ }).click();
    checks.push(
      '商品弹窗4种桌面高度固定完整操作栏、正文独立滚动、无旧版会员开关、实物和线上课件按钮正确',
    );
    const routeSource = await readFile('apps/admin/config/routes.ts', 'utf8');
    const routes = [
      ...new Set(
        [...routeSource.matchAll(/\bpath\s*:\s*'([^']+)'[^{}]*?\bcomponent\s*:/g)]
          .map((m) => m[1])
          .filter(
            (p) =>
              !p.includes('*') &&
              p !== '/user/login' &&
              (process.env.ACADEMY_REVIEW_FOCUS !== 'true' ||
                ['/memberships', '/products', '/dashboard/analysis'].includes(p)),
          ),
      ),
    ];
    for (const width of [1440, 1024]) {
      await ap.setViewportSize({ width, height: 1000 });
      for (const path of routes) {
        await ap.goto(adminBase + path);
        await ap.waitForTimeout(450);
        await ap
          .locator('.ant-spin-spinning')
          .first()
          .waitFor({ state: 'hidden', timeout: 8000 })
          .catch(() => {});
        const text = await ap.locator('body').innerText();
        assert.ok(text.trim(), path + ' blank');
        const overflow = await ap.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        );
        adminScreens.push({ path, width, overflow, text: text.slice(0, 200) });
        await ap.screenshot({
          path:
            adminOutput +
            '/' +
            (path === '/' ? 'workspace' : path.slice(1).replaceAll('/', '-')) +
            '-' +
            width +
            '.png',
        });
      }
    }
    await writeFile(
      adminOutput + '/report.json',
      JSON.stringify(
        { screens: adminScreens, errors, isolatedDatabase: true, externalGateway: 'fixture' },
        null,
        2,
      ),
    );
    checks.push('后台' + routes.length + '页1440/1024桌面截图、加载与布局采集');
  } finally {
    await context.close();
    await new Promise((ok) => server.close(ok));
  }
  const missingService = (route) =>
    route.fulfill({
      status: 404,
      json: { message: 'Cannot GET /api/v1/membership-center' },
      headers: { 'access-control-allow-origin': base, 'access-control-allow-credentials': 'true' },
    });
  await page.route('**/api/v1/membership-center', missingService);
  await nav('membership/index');
  await page.getByText('可先查看各档权益', { exact: false }).waitFor();
  assert.equal(await page.locator('.pass-balance').innerText(), '—');
  assert.equal(await page.locator('.grade-card').count(), 4);
  const original = page.url();
  await page.locator('.grade-card').first().click();
  assert.equal(page.url(), original);
  await page.screenshot({ path: output + '/member-previous-service.png' });
  await page.unroute('**/api/v1/membership-center', missingService);
  checks.push(
    '旧服务缺少新接口时展示只读等级、未知余额用横线、购买关闭；既有会员按旧接口核对，不伪造开通或余额',
  );
}
