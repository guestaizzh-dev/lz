import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  createCipheriv,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
  verify,
  createHmac,
} from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../dist/main.js';
import { Database } from '../dist/database.js';
import { AuthService } from '../dist/auth.js';
import { CourseSalesService } from '../dist/course-sales.js';
import { WechatPayService } from '../dist/wechat-pay.js';
import { PaymentChannels } from '../dist/payment-channels.js';

test('Native: signed orders, QR, verified callbacks, original delivery and refunds', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'academy-native-')),
    merchant = generateKeyPairSync('rsa', { modulusLength: 2048 }),
    provider = generateKeyPairSync('rsa', { modulusLength: 2048 }),
    key = randomBytes(16).toString('hex');
  await writeFile(
    join(dir, 'merchant.pem'),
    merchant.privateKey.export({ type: 'pkcs8', format: 'pem' }),
  );
  await writeFile(
    join(dir, 'public.json'),
    JSON.stringify({
      PUB_KEY_ID_NATIVE: provider.publicKey.export({ type: 'spki', format: 'pem' }),
    }),
  );
  Object.assign(process.env, {
    COURSE_WECHAT_ENABLED: 'false',
    WECHAT_NATIVE_ENABLED: 'true',
    COURSE_ALIPAY_ENABLED: 'false',
    PAYMENT_SIMULATION_ENABLED: 'false',
    MEMBERSHIP_SALES_ENABLED: 'true',
    PRODUCT_SALES_ENABLED: 'true',
    BOOKING_SALES_ENABLED: 'true',
    COHORT_SALES_ENABLED: 'true',
    WECHAT_PAY_APP_ID: 'wxNativeTest',
    WECHAT_PAY_MCH_ID: '1900000001',
    WECHAT_PAY_SERIAL: 'TESTSERIAL',
    WECHAT_PAY_API_V3_KEY: key,
    WECHAT_PAY_PRIVATE_KEY_FILE: join(dir, 'merchant.pem'),
    WECHAT_PAY_PUBLIC_KEYS_FILE: join(dir, 'public.json'),
    WECHAT_PAY_MERCHANT_NAME: '测试书院',
    PUBLIC_API_URL: 'https://academy.example/api/v1',
    CORS_ORIGINS: 'http://127.0.0.1:5173',
    COURSE_PAYMENT_WORKER_ENABLED: 'false',
    MEDIA_DIR: dir,
  });
  const realFetch = globalThis.fetch,
    trades = new Map(),
    refunds = new Map();
  let corrupt = false,
    unavailable = false;
  function response(data, status = 200) {
    const body = status === 204 ? '' : JSON.stringify(data),
      stamp = String(Math.floor(Date.now() / 1000)),
      nonce = randomBytes(12).toString('hex');
    return new Response(status === 204 ? null : body, {
      status,
      headers: {
        'Wechatpay-Serial': 'PUB_KEY_ID_NATIVE',
        'Wechatpay-Timestamp': stamp,
        'Wechatpay-Nonce': nonce,
        'Wechatpay-Signature': sign(
          'RSA-SHA256',
          Buffer.from(stamp + '\n' + nonce + '\n' + body + '\n'),
          corrupt ? merchant.privateKey : provider.privateKey,
        ).toString('base64'),
      },
    });
  }
  mock.method(globalThis, 'fetch', async (url, options = {}) => {
    if (!String(url).startsWith('https://api.mch.weixin.qq.com')) return realFetch(url, options);
    if (unavailable) throw Error('Network unavailable');
    const u = new URL(url),
      a = Object.fromEntries(
        [...options.headers.Authorization.matchAll(/(\w+)="([^"]+)"/g)].map((m) => [m[1], m[2]]),
      ),
      body = options.body ?? '',
      method = options.method ?? 'GET';
    assert.ok(
      verify(
        'RSA-SHA256',
        Buffer.from(
          method +
            '\n' +
            u.pathname +
            u.search +
            '\n' +
            a.timestamp +
            '\n' +
            a.nonce_str +
            '\n' +
            body +
            '\n',
        ),
        merchant.publicKey,
        Buffer.from(a.signature, 'base64'),
      ),
    );
    assert.equal(options.headers['Wechatpay-Serial'], 'PUB_KEY_ID_NATIVE');
    if (u.pathname === '/v3/pay/transactions/native') {
      const d = JSON.parse(body);
      assert.equal(d.notify_url, 'https://academy.example/api/v1/payments/wechat/notify');
      assert.ok(Buffer.byteLength(d.description) <= 127);
      if (!trades.has(d.out_trade_no))
        trades.set(d.out_trade_no, {
          appid: d.appid,
          mchid: d.mchid,
          out_trade_no: d.out_trade_no,
          trade_type: 'NATIVE',
          trade_state: 'NOTPAY',
          amount: d.amount,
        });
      return response({ code_url: 'weixin://wxpay/bizpayurl?pr=' + d.out_trade_no });
    }
    if (u.pathname.endsWith('/close')) {
      const row = trades.get(u.pathname.split('/').at(-2));
      if (row) row.trade_state = 'CLOSED';
      return response(null, 204);
    }
    if (u.pathname.startsWith('/v3/pay/transactions/out-trade-no/')) {
      const row = trades.get(u.pathname.split('/').at(-1));
      return row ? response(row) : response({ code: 'ORDER_NOT_EXIST' }, 404);
    }
    if (u.pathname === '/v3/refund/domestic/refunds') {
      const d = JSON.parse(body),
        row = [...trades.values()].find((r) => r.transaction_id === d.transaction_id);
      assert.ok(row);
      const refund = {
        mchid: row.mchid,
        out_trade_no: row.out_trade_no,
        transaction_id: d.transaction_id,
        out_refund_no: d.out_refund_no,
        refund_id: 'RF' + randomUUID(),
        status: 'SUCCESS',
        success_time: new Date().toISOString(),
        amount: d.amount,
      };
      refunds.set(d.out_refund_no, refund);
      return response(refund);
    }
    if (u.pathname.startsWith('/v3/refund/domestic/refunds/'))
      return response(refunds.get(u.pathname.split('/').at(-1)));
    throw Error('Unexpected provider path ' + u.pathname);
  });
  const app = await createApp(false);
  app.useLogger(['error']);
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl(),
    db = app.get(Database),
    auth = app.get(AuthService),
    sales = app.get(CourseSalesService),
    wechat = app.get(WechatPayService),
    channels = app.get(PaymentChannels);
  async function session(role = 'USER') {
    const u = await db.user.create({ data: { nickname: 'native-' + randomUUID(), roles: [role] } }),
      c = auth.credentials(),
      csrf = randomUUID();
    await db.authSession.create({
      data: {
        userId: u.id,
        kind: role === 'USER' ? 'APP' : 'ADMIN',
        accessHash: c.accessHash,
        refreshHash: c.refreshHash,
        accessExpiresAt: c.accessExpiresAt,
        expiresAt: new Date(Date.now() + 86400000),
        csrfToken: csrf,
      },
    });
    return {
      user: u,
      headers:
        role === 'USER'
          ? { Authorization: 'Bearer ' + c.access }
          : { Cookie: 'daoxue_access=' + c.access, 'X-CSRF-Token': csrf },
    };
  }
  async function call(path, s, method = 'GET', body) {
    const r = await fetch(base + '/api/v1' + path, {
      method,
      headers: {
        Origin: 'http://127.0.0.1:5173',
        'Content-Type': 'application/json',
        ...s?.headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: r.status, body: r.status === 204 ? null : await r.json() };
  }
  const admin = await session('ADMIN'),
    a = await session(),
    b = await session(),
    teacher = await db.teacher.create({
      data: { name: 'Native测试主讲', title: '测试', bio: '隔离测试', status: 'PUBLISHED' },
    });
  let serial = 0;
  const mediaBytes = Buffer.from([
      0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0, 105, 115, 111, 109,
    ]),
    asset = await db.mediaAsset.create({
      data: {
        storageKey: randomUUID(),
        name: 'native-test.mp4',
        mime: 'video/mp4',
        bytes: mediaBytes.length,
        uploaderId: admin.user.id,
        status: 'READY',
        visibility: 'PRIVATE',
      },
    });
  await writeFile(join(dir, asset.storageKey), mediaBytes);
  async function order(user = a) {
    const c = await call('/admin/courses', admin, 'POST', {
      title: 'Native研习' + ++serial,
      subtitle: '测试',
      description: '测试内容',
      category: '经典研习',
      format: 'VIDEO',
      cover: '/static/art/books.svg',
      price: 100,
      teacherId: teacher.id,
      membershipTier: null,
      accessDays: null,
      refundPolicy: '七日内未学习可申请退款',
      tags: [],
      featured: false,
      chapters: [
        {
          title: '导读',
          format: 'VIDEO',
          body: '',
          mediaId: asset.id,
          durationSeconds: 120,
          trial: true,
          required: false,
        },
        {
          title: '正文',
          format: 'VIDEO',
          body: '',
          mediaId: asset.id,
          durationSeconds: 120,
          trial: false,
          required: true,
        },
      ],
    });
    assert.equal(c.status, 201, JSON.stringify(c.body));
    const published = await call('/admin/courses/' + c.body.id + '/transition', admin, 'POST', {
      action: 'publish',
      expectedVersion: c.body.version,
      reason: '隔离发布验证',
    });
    assert.equal(published.status, 201, JSON.stringify(published.body));
    const q = await call(
      '/commerce/courses/' + c.body.id + '/quote?platform=ANDROID&channel=WECHAT_NATIVE',
      user,
    );
    assert.equal(q.body.paymentEnabled, true, JSON.stringify(q.body));
    const dto = {
        courseId: c.body.id,
        platform: 'ANDROID',
        channel: 'WECHAT_NATIVE',
        requestKey: randomUUID(),
        quoteHash: q.body.quoteHash,
      },
      o = await call('/commerce/course-orders', user, 'POST', dto);
    assert.equal(o.status, 201, JSON.stringify(o.body));
    return { ...o.body, dto };
  }
  async function prepay(o, user = a) {
    const r = await call('/commerce/course-orders/' + o.id + '/payment', user, 'POST', {});
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.provider, 'wxnative');
    return JSON.parse(r.body.orderInfo);
  }
  function paid(o, amount = Number(o.amount)) {
    const r = {
      ...trades.get(o.orderNo),
      trade_state: 'SUCCESS',
      transaction_id: 'TX' + randomUUID(),
      success_time: new Date().toISOString(),
      amount: { total: amount, currency: 'CNY' },
    };
    trades.set(o.orderNo, r);
    return r;
  }
  function packet(data, event = 'TRANSACTION.SUCCESS') {
    const nonce = randomBytes(6).toString('hex'),
      cipher = createCipheriv('aes-256-gcm', Buffer.from(key), Buffer.from(nonce));
    cipher.setAAD(Buffer.from('transaction'));
    const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(data)),
        cipher.final(),
        cipher.getAuthTag(),
      ]).toString('base64'),
      body = JSON.stringify({
        id: randomUUID(),
        event_type: event,
        resource: {
          algorithm: 'AEAD_AES_256_GCM',
          nonce,
          associated_data: 'transaction',
          ciphertext,
        },
      }),
      stamp = String(Math.floor(Date.now() / 1000)),
      n = randomBytes(8).toString('hex');
    return {
      body,
      headers: {
        'Content-Type': 'application/json',
        'Wechatpay-Serial': 'PUB_KEY_ID_NATIVE',
        'Wechatpay-Timestamp': stamp,
        'Wechatpay-Nonce': n,
        'Wechatpay-Signature': sign(
          'RSA-SHA256',
          Buffer.from(stamp + '\n' + n + '\n' + body + '\n'),
          provider.privateKey,
        ).toString('base64'),
      },
    };
  }
  async function notify(p) {
    return fetch(base + '/api/v1/payments/wechat/notify', { method: 'POST', ...p });
  }
  try {
    await t.test(
      'independent channel gates, finance visibility and shared-account startup',
      async () => {
        assert.equal(channels.choices().find((c) => c.channel === 'WECHAT_NATIVE').enabled, true);
        assert.equal(channels.choices().find((c) => c.channel === 'WECHAT_APP').enabled, false);
        const r = await call('/admin/finance/channels', admin);
        assert.equal(r.status, 200);
        assert.equal(r.body.merchantName, '测试书院');
        assert.ok(!JSON.stringify(r.body).includes(key));
        assert.equal((await call('/admin/finance/channels', a)).status, 403);
        process.env.COURSE_WECHAT_ENABLED = 'true';
        await sales.onModuleInit();
        process.env.COURSE_WECHAT_ENABLED = 'false';
      },
    );
    await t.test(
      'Native checkout ownership and request replay do not permit SDK-channel substitution',
      async () => {
        const o = await order();
        assert.equal(o.channel, 'WECHAT_NATIVE');
        assert.equal((await call('/commerce/course-orders', a, 'POST', o.dto)).body.id, o.id);
        assert.equal(
          (await call('/commerce/course-orders/' + o.id + '/payment', b, 'POST', {})).status,
          404,
        );
        process.env.COURSE_WECHAT_ENABLED = 'true';
        assert.equal(
          (await call('/commerce/course-orders', a, 'POST', { ...o.dto, channel: 'WECHAT_APP' }))
            .status,
          409,
        );
        process.env.COURSE_WECHAT_ENABLED = 'false';
        const qr = await prepay(o);
        const image = await fetch(qr.qrImageUrl.replace('https://academy.example', base));
        assert.equal(image.status, 200);
        assert.equal(image.headers.get('content-type'), 'image/png');
        assert.equal(image.headers.get('cache-control'), 'no-store');
        assert.deepEqual(
          [...new Uint8Array(await image.arrayBuffer()).slice(0, 8)],
          [137, 80, 78, 71, 13, 10, 26, 10],
        );
        assert.equal(
          await db.enrollment.count({ where: { userId: a.user.id, courseId: o.course.courseId } }),
          0,
        );
      },
    );
    await t.test('tampered/expired QR and bad callback signatures are rejected', async () => {
      const o = await order(),
        qr = await prepay(o),
        u = new URL(qr.qrImageUrl);
      assert.equal((await fetch(base + u.pathname + '?ticket=bad')).status, 401);
      const payload = Buffer.from(
          JSON.stringify({ url: qr.codeUrl, expires: Date.now() - 1 }),
        ).toString('base64url'),
        ticket =
          payload +
          '.' +
          createHmac('sha256', Buffer.from(key))
            .update('native-qr:' + payload)
            .digest('base64url');
      assert.equal((await fetch(base + u.pathname + '?ticket=' + ticket)).status, 401);
      const p = packet(paid(o));
      p.headers['Wechatpay-Signature'] = 'invalid';
      assert.equal((await notify(p)).status, 401);
      assert.equal((await db.tradeOrder.findUniqueOrThrow({ where: { id: o.id } })).paidTotal, 0n);
    });
    await t.test(
      'concurrent successful callbacks grant one course and one balanced journal',
      async () => {
        const o = await order();
        await prepay(o);
        const receipt = paid(o),
          p = packet(receipt);
        const results = await Promise.all([notify(p), notify(p), notify(packet(receipt))]);
        assert.deepEqual(
          results.map((r) => r.status),
          [204, 204, 204],
        );
        assert.equal(
          await db.paymentTransaction.count({ where: { orderId: o.id, channel: 'WECHAT_NATIVE' } }),
          1,
        );
        assert.equal(
          await db.enrollment.count({ where: { userId: a.user.id, courseId: o.course.courseId } }),
          1,
        );
        assert.equal(
          await db.financeJournal.count({ where: { orderId: o.id, kind: 'COURSE_PAYMENT' } }),
          1,
        );
        const entries = await db.financeEntry.findMany({
          where: {
            journalId: (await db.financeJournal.findFirstOrThrow({ where: { orderId: o.id } })).id,
          },
        });
        assert.equal(
          entries.reduce((n, e) => n + e.debit - e.credit, 0n),
          0n,
        );
        assert.ok(entries.some((e) => e.accountCode === 'WECHAT_RECEIVABLE' && e.debit === 100n));
      },
    );
    await t.test('lost callback is recovered by signed active query', async () => {
      const o = await order();
      await prepay(o);
      paid(o);
      const r = await call('/commerce/course-orders/' + o.id + '/refresh', a, 'POST', {});
      assert.equal(r.body.access, true);
      assert.equal(r.body.paidAmount, '100');
    });
    await t.test('wrong amount is retained as abnormal money without granting access', async () => {
      const o = await order();
      await prepay(o);
      assert.equal((await notify(packet(paid(o, 1)))).status, 204);
      const p = await db.paymentTransaction.findFirstOrThrow({ where: { orderId: o.id } });
      assert.equal(p.disposition, 'AMOUNT_MISMATCH');
      assert.equal(
        await db.enrollment.count({ where: { userId: a.user.id, courseId: o.course.courseId } }),
        0,
      );
    });
    await t.test(
      'network failure and forged provider responses never imply payment; cancel closes original QR',
      async () => {
        const o = await order();
        unavailable = true;
        assert.equal(
          (await call('/commerce/course-orders/' + o.id + '/payment', a, 'POST', {})).status,
          503,
        );
        unavailable = false;
        assert.equal(
          (await call('/commerce/course-orders/' + o.id + '/refresh', a, 'POST', {})).status,
          201,
        );
        corrupt = true;
        assert.equal(
          (await call('/commerce/course-orders/' + o.id + '/payment', a, 'POST', {})).status,
          503,
        );
        corrupt = false;
        await call('/commerce/course-orders/' + o.id + '/refresh', a, 'POST', {});
        assert.equal(
          (await call('/commerce/course-orders/' + o.id + '/cancel', a, 'POST', {})).body.state,
          'CLOSED',
        );
        assert.equal(trades.get(o.orderNo).trade_state, 'CLOSED');
        assert.equal(
          await db.enrollment.count({ where: { userId: a.user.id, courseId: o.course.courseId } }),
          0,
        );
      },
    );
    await t.test(
      'Native refund callback locates original channel and revokes only its delivery',
      async () => {
        const o = await order();
        await prepay(o);
        assert.equal((await notify(packet(paid(o)))).status, 204);
        const r = await call('/commerce/course-orders/' + o.id + '/refund', a, 'POST', {
          requestKey: randomUUID(),
          reason: '未学习申请原路退课',
        });
        assert.equal(r.status, 201, JSON.stringify(r.body));
        const refund = await db.refund.findFirstOrThrow({ where: { orderId: o.id } });
        const review = await call(
          '/admin/course-orders/refunds/' + refund.id + '/review',
          admin,
          'POST',
          { action: 'APPROVE', expectedVersion: refund.version, reason: '确认未学习退回原付款' },
        );
        assert.equal(review.status, 201, JSON.stringify(review.body));
        await db.outboxJob.updateMany({
          where: { kind: 'COURSE_REFUND', aggregateId: refund.id },
          data: { availableAt: new Date(0) },
        });
        await sales.runJobs();
        const result = refunds.values().next().value;
        assert.ok(result);
        assert.equal((await notify(packet(result, 'REFUND.SUCCESS'))).status, 204);
        assert.equal((await notify(packet(result, 'REFUND.SUCCESS'))).status, 204);
        assert.equal(
          await db.refundTransaction.count({
            where: { refundId: refund.id, channel: 'WECHAT_NATIVE' },
          }),
          1,
        );
        assert.ok(
          (
            await db.enrollment.findUniqueOrThrow({
              where: { userId_courseId: { userId: a.user.id, courseId: o.course.courseId } },
            })
          ).revokedAt,
        );
      },
    );
    await t.test(
      'membership callback dispatch grants the purchased tier exactly once',
      async () => {
        const user = await session(),
          plan = await db.membershipPlan.findFirstOrThrow({ where: { tier: 1, active: true } }),
          q = await call('/commerce/memberships/' + plan.id + '/quote?platform=ANDROID', user);
        assert.equal(q.body.paymentEnabled, true);
        const created = await call('/commerce/membership-orders', user, 'POST', {
          planId: plan.id,
          platform: 'ANDROID',
          channel: 'WECHAT_NATIVE',
          requestKey: randomUUID(),
          quoteHash: q.body.quoteHash,
        });
        assert.equal(created.status, 201, JSON.stringify(created.body));
        const o = created.body,
          p = await call('/commerce/membership-orders/' + o.id + '/payment', user, 'POST', {});
        assert.equal(p.body.provider, 'wxnative');
        const receipt = paid(o);
        assert.equal((await notify(packet(receipt))).status, 204);
        assert.equal((await notify(packet(receipt))).status, 204);
        assert.equal(
          await db.membership.count({
            where: { userId: user.user.id, source: 'PURCHASE', tier: 1 },
          }),
          1,
        );
        assert.equal(
          await db.paymentTransaction.count({ where: { orderId: o.id, channel: 'WECHAT_NATIVE' } }),
          1,
        );
      },
    );
    await t.test('expired and cancelled codes cannot grant a late-paid course', async () => {
      const o = await order();
      await prepay(o);
      await db.tradeOrder.update({
        where: { id: o.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      assert.equal((await notify(packet(paid(o)))).status, 204);
      assert.equal(
        (await db.paymentTransaction.findFirstOrThrow({ where: { orderId: o.id } })).disposition,
        'LATE',
      );
      assert.equal(
        await db.enrollment.count({ where: { userId: a.user.id, courseId: o.course.courseId } }),
        0,
      );
    });
    await t.test('all channel verifiers retain exact trade-type separation', async () => {
      for (const token of [
        'PRODUCT_SALES',
        'MEMBERSHIP_SALES',
        'BOOKING_SALES',
        'COHORT_SALES',
        'DIGITAL_SALES',
        'GIFT_SALES',
      ]) {
        const domain = app.get(token),
          receipt = {
            appid: 'wxNativeTest',
            mchid: '1900000001',
            out_trade_no: 'nonexistent',
            trade_type: 'APP',
            trade_state: 'SUCCESS',
            transaction_id: randomUUID(),
            success_time: new Date().toISOString(),
            amount: { total: 100, currency: 'CNY' },
          };
        await assert.rejects(
          domain.confirmPayment(receipt, undefined, 'WECHAT_NATIVE'),
          (e) => e.status === 400,
        );
      }
    });
  } finally {
    await app.close();
    mock.restoreAll();
    await rm(dir, { recursive: true, force: true });
  }
});
