import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../dist/main.js';
import { Database } from '../dist/database.js';
import { AuthService } from '../dist/auth.js';
import { PaymentChannels } from '../dist/payment-channels.js';
import { DigitalSales } from '../dist/digital-sales.js';
import { MemberCenter } from '../dist/member-center.js';
import { MarketingService } from '../dist/marketing.js';

test('commerce configuration reaches listing, separate digital fulfilment and frozen voucher accounting', async (t) => {
  process.env.PRODUCT_SALES_ENABLED = 'false';
  process.env.MEMBERSHIP_SALES_ENABLED = 'false';
  const app = await createApp(false);
  app.useLogger(['error']);
  await app.listen(0, '127.0.0.1');
  const db = app.get(Database),
    auth = app.get(AuthService),
    center = app.get(MemberCenter),
    sales = app.get(DigitalSales),
    channels = app.get(PaymentChannels),
    base = await app.getUrl();
  const identity = { appid: 'isolated-commerce', mchid: 'isolated-merchant' },
    trades = new Map();
  mock.method(channels, 'resolve', () => ({
    identity: () => identity,
    availability: () => ({ enabled: true, reason: '' }),
    prepay: async (no, _title, amount) => {
      trades.set(no, {
        ...identity,
        out_trade_no: no,
        trade_type: 'NATIVE',
        trade_state: 'SUCCESS',
        transaction_id: randomUUID(),
        success_time: new Date().toISOString(),
        amount: { total: amount, currency: 'CNY' },
      });
      return '{}';
    },
    query: async (no) => trades.get(no) ?? { trade_state: 'NOTFOUND' },
    close: async () => {},
    refund: async (transactionId, no, amount, total, orderNo) => ({
      ...identity,
      transaction_id: transactionId,
      out_trade_no: orderNo,
      out_refund_no: no,
      refund_id: randomUUID(),
      status: 'SUCCESS',
      refund_status: 'SUCCESS',
      success_time: new Date().toISOString(),
      amount: { refund: amount, total, currency: 'CNY' },
    }),
  }));
  mock.method(channels, 'choices', () => [
    {
      channel: 'WECHAT_NATIVE',
      provider: 'wxnative',
      label: '微信扫码',
      enabled: true,
      reason: '',
    },
  ]);
  process.env.PRODUCT_SALES_ENABLED = 'true';
  process.env.MEMBERSHIP_SALES_ENABLED = 'true';
  async function actor(admin = false) {
    const user = await db.user.create({
        data: { nickname: 'commerce-review', roles: admin ? ['ADMIN'] : ['USER'] },
      }),
      c = auth.credentials(),
      csrf = randomUUID();
    await db.authSession.create({
      data: {
        userId: user.id,
        kind: admin ? 'ADMIN' : 'APP',
        accessHash: c.accessHash,
        refreshHash: c.refreshHash,
        accessExpiresAt: c.accessExpiresAt,
        expiresAt: new Date(Date.now() + 86400000),
        csrfToken: csrf,
      },
    });
    return {
      user,
      headers: admin
        ? { Cookie: 'daoxue_access=' + c.access, 'X-CSRF-Token': csrf }
        : { Authorization: 'Bearer ' + c.access },
    };
  }
  const admin = await actor(true),
    student = await actor(),
    other = await actor();
  async function call(path, who = student, method = 'GET', body) {
    const r = await fetch(base + '/api/v1' + path, {
      method,
      headers: {
        ...who?.headers,
        Origin: 'http://127.0.0.1:5173',
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: r.status, body: await r.json() };
  }
  const expect = (r, status) => {
    assert.equal(r.status, status, JSON.stringify(r.body));
    return r.body;
  };
  async function policy(price, faceValue, active = true) {
    const p = await db.videoVoucherPolicy.findUniqueOrThrow({ where: { id: 1 } });
    return expect(
      await call('/admin/membership-center/voucher-settings', admin, 'PUT', {
        title: '视频代金券',
        price,
        faceValue,
        active,
        expectedVersion: p.version,
        reason: '隔离验证配置',
      }),
      200,
    );
  }
  async function buyVouchers(quantity) {
    const q = expect(
      await call(
        '/membership-center/quote?platform=ANDROID&kind=VIDEO_VOUCHER&quantity=' + quantity,
      ),
      200,
    );
    const o = expect(
      await call('/membership-center/orders', student, 'POST', {
        kind: 'VIDEO_VOUCHER',
        quantity,
        platform: 'ANDROID',
        quoteHash: q.quoteHash,
        requestKey: randomUUID(),
      }),
      201,
    );
    await center.prepay(o.id, student.user.id);
    await center.confirmPayment(trades.get(o.orderNo));
    return db.videoVoucherLot.findUniqueOrThrow({ where: { orderId: o.id } });
  }
  let video, sku, physical, oldLot, newLot;
  const original = await db.videoVoucherPolicy.findUniqueOrThrow({ where: { id: 1 } });
  try {
    await t.test(
      'coupon editing applies only to future claims and choice can be disabled or explicit',
      async () => {
        const payload = {
          title: '课程营销券',
          claimPolicy: 'PUBLIC',
          discountKind: 'FIXED',
          discountValue: 200,
          threshold: 0,
          startsAt: new Date(Date.now() - 60000).toISOString(),
          endsAt: new Date(Date.now() + 86400000).toISOString(),
          totalLimit: 10,
          perUserLimit: 2,
          allowedChannels: ['WECHAT_NATIVE'],
          courseIds: [],
          active: true,
          reason: '测试发行',
        };
        const template = expect(
          await call('/admin/marketing/coupons', admin, 'POST', payload),
          201,
        );
        const old = expect(
          await call('/me/marketing/coupons/' + template.id + '/claim', student, 'POST', {
            requestKey: randomUUID(),
          }),
          201,
        );
        const current = await db.couponTemplate.findUniqueOrThrow({ where: { id: template.id } });
        expect(
          await call('/admin/marketing/coupons/' + template.id, admin, 'PATCH', {
            ...payload,
            discountValue: 500,
            maxDiscount: 400,
            validDays: 1,
            expectedVersion: current.version,
          }),
          200,
        );
        const fresh = expect(
          await call('/me/marketing/coupons/' + template.id + '/claim', student, 'POST', {
            requestKey: randomUUID(),
          }),
          201,
        );
        assert.equal(
          (await db.userCoupon.findUniqueOrThrow({ where: { id: old.id } })).termsSnapshot
            .discountValue,
          '200',
        );
        assert.equal(fresh.termsSnapshot.discountValue, '500');
        const pricing = app.get(MarketingService),
          courseId = randomUUID();
        assert.equal(
          (
            await pricing.coursePrice(
              db,
              student.user.id,
              courseId,
              1000n,
              'ANDROID',
              'WECHAT_NATIVE',
            )
          ).discount,
          400n,
        );
        assert.equal(
          (
            await pricing.coursePrice(
              db,
              student.user.id,
              courseId,
              1000n,
              'ANDROID',
              'WECHAT_NATIVE',
              old.id,
            )
          ).discount,
          200n,
        );
        assert.equal(
          (
            await pricing.coursePrice(
              db,
              student.user.id,
              courseId,
              1000n,
              'ANDROID',
              'WECHAT_NATIVE',
              'NONE',
            )
          ).discount,
          0n,
        );
        assert.equal(
          (
            await call('/admin/marketing/coupons/' + template.id, admin, 'PATCH', {
              ...payload,
              expectedVersion: current.version,
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await call('/admin/marketing/coupons/' + template.id, other, 'PATCH', {
              ...payload,
              expectedVersion: current.version,
            })
          ).status,
          403,
        );
      },
    );
    await t.test(
      'three configurable categories include independent online and physical courseware',
      async () => {
        const before = await db.course.count();
        video = expect(
          await call('/admin/products', admin, 'POST', {
            title: '独立视频课件',
            subtitle: '单独购买',
            description: '课程之外独立上传',
            type: 'DIGITAL',
            mallCategory: 'VIDEO',
            cover: '/static/art/books.svg',
            price: 1000,
            culturalOrigin: '测试',
            featured: false,
          }),
          201,
        );
        assert.equal(
          expect(
            await call('/admin/products/' + video.id + '/transition', admin, 'POST', {
              action: 'publish',
              expectedVersion: video.version,
            }),
            400,
          ).statusCode,
          400,
        );
        const asset = await db.mediaAsset.create({
          data: {
            storageKey: randomUUID(),
            name: 'isolated-video.mp4',
            mime: 'video/mp4',
            bytes: 32,
            uploaderId: admin.user.id,
            status: 'READY',
            visibility: 'PRIVATE',
          },
        });
        expect(
          await call('/admin/products/' + video.id + '/digital-releases', admin, 'POST', {
            description: '独立上传视频',
            assetIds: [asset.id],
          }),
          201,
        );
        video = expect(
          await call('/admin/products/' + video.id + '/transition', admin, 'POST', {
            action: 'publish',
            expectedVersion: video.version,
          }),
          201,
        );
        sku = await db.productSku.findFirstOrThrow({ where: { productId: video.id } });
        physical = expect(
          await call('/admin/products', admin, 'POST', {
            title: '实物课件U盘',
            subtitle: '邮寄',
            description: '实物课件',
            type: 'PHYSICAL',
            mallCategory: 'VIDEO',
            membershipPriceCategory: 'LIFESTYLE',
            cover: '/static/art/books.svg',
            price: 2000,
            culturalOrigin: '测试',
            featured: false,
            initialStock: 5,
          }),
          201,
        );
        physical = expect(
          await call('/admin/products/' + physical.id + '/transition', admin, 'POST', {
            action: 'publish',
            expectedVersion: physical.version,
          }),
          201,
        );
        assert.equal(await db.course.count(), before);
        for (const sort of ['recent', 'popular', 'priceAsc', 'priceDesc']) {
          const list = expect(
            await call('/catalog/products?mallCategory=VIDEO&sort=' + sort, null),
            200,
          );
          for (const p of [video, physical]) assert.ok(list.items.some((i) => i.id === p.id));
        }
        const category = await db.catalogCategory.findUniqueOrThrow({
          where: { scope_code: { scope: 'MALL', code: 'VIDEO' } },
        });
        expect(
          await call('/admin/categories/' + category.id, admin, 'PATCH', {
            scope: 'MALL',
            label: '视频与实物课件',
            position: 1,
            enabled: false,
            expectedVersion: category.version,
          }),
          200,
        );
        assert.equal(
          expect(await call('/catalog/products?mallCategory=VIDEO', null), 200).items.length,
          0,
        );
        assert.ok(
          !expect(await call('/catalog/categories?scope=MALL', null), 200).some(
            (c) => c.code === 'VIDEO',
          ),
        );
        expect(
          await call('/admin/products/' + physical.id + '/transition', admin, 'POST', {
            action: 'revise',
            expectedVersion: physical.version,
          }),
          201,
        );
        const c = await db.catalogCategory.findUniqueOrThrow({ where: { id: category.id } });
        expect(
          await call('/admin/categories/' + c.id, admin, 'PATCH', {
            scope: 'MALL',
            label: category.label,
            position: category.position,
            enabled: true,
            expectedVersion: c.version,
          }),
          200,
        );
      },
    );
    await t.test(
      'policy changes freeze old lot value and create new paid terms;停售 blocks only new purchases',
      async () => {
        await policy(100, 300);
        oldLot = await buyVouchers(2);
        await policy(150, 400);
        newLot = await buyVouchers(3);
        assert.deepEqual(
          [oldLot.unitPrice, oldLot.faceValue, newLot.unitPrice, newLot.faceValue],
          [100, 300, 150, 400],
        );
        await assert.rejects(
          db.videoVoucherLot.update({ where: { id: oldLot.id }, data: { faceValue: 999 } }),
          /immutable/,
        );
        await policy(150, 400, false);
        assert.equal(
          (await call('/membership-center/quote?platform=ANDROID&kind=VIDEO_VOUCHER&quantity=1'))
            .status,
          409,
        );
        const overview = expect(await call('/membership-center'), 200);
        assert.equal(overview.voucher.availableValue, 1800);
        await policy(150, 400);
      },
    );
    async function quote(n) {
      return expect(
        await call(
          '/commerce/digital-products/' + sku.id + '/quote?platform=ANDROID&voucherQuantity=' + n,
        ),
        200,
      );
    }
    async function checkout(n, q) {
      return expect(
        await call('/commerce/digital-orders', student, 'POST', {
          skuId: sku.id,
          platform: 'ANDROID',
          channel: 'WECHAT_NATIVE',
          voucherQuantity: n,
          requestKey: randomUUID(),
          quoteHash: (q ?? (await quote(n))).quoteHash,
        }),
        201,
      );
    }
    await t.test(
      'quote binds exact lots, cancellation releases holds and stale quotes cannot consume funds',
      async () => {
        const q = await quote(2),
          order = await checkout(2, q);
        assert.equal(order.payableTotal, '400');
        assert.equal(
          (await db.videoVoucherLot.findUniqueOrThrow({ where: { id: oldLot.id } })).held,
          2,
        );
        assert.equal((await call('/commerce/digital-orders/' + order.id, other)).status, 404);
        expect(
          await call('/commerce/digital-orders/' + order.id + '/cancel', student, 'POST'),
          201,
        );
        assert.equal(
          (await db.videoVoucherLot.findUniqueOrThrow({ where: { id: oldLot.id } })).remaining,
          2,
        );
        await db.productSku.update({
          where: { id: sku.id },
          data: { price: 1100, version: { increment: 1 } },
        });
        assert.equal(
          (
            await call('/commerce/digital-orders', student, 'POST', {
              skuId: sku.id,
              platform: 'ANDROID',
              channel: 'WECHAT_NATIVE',
              voucherQuantity: 2,
              requestKey: randomUUID(),
              quoteHash: q.quoteHash,
            })
          ).status,
          409,
        );
        await db.productSku.update({
          where: { id: sku.id },
          data: { price: 1000, version: { increment: 1 } },
        });
      },
    );
    await t.test(
      'full vouchers grant independent media once and refund returns the same lots once',
      async () => {
        const order = await checkout(3);
        assert.equal(order.payableTotal, '0');
        assert.equal(order.canReceive, true);
        assert.equal(await db.paymentTransaction.count({ where: { orderId: order.id } }), 0);
        assert.equal(
          (await db.videoVoucherLot.findUniqueOrThrow({ where: { id: oldLot.id } })).used,
          2,
        );
        assert.equal(
          (await db.videoVoucherLot.findUniqueOrThrow({ where: { id: newLot.id } })).used,
          1,
        );
        const key = randomUUID(),
          body = { requestKey: key, reason: '未观看退券' };
        for (let i = 0; i < 2; i++)
          expect(
            await call('/commerce/digital-orders/' + order.id + '/refunds', student, 'POST', body),
            201,
          );
        assert.equal(
          (await db.videoVoucherLot.findUniqueOrThrow({ where: { id: oldLot.id } })).remaining,
          2,
        );
        assert.equal(
          (await db.videoVoucherLot.findUniqueOrThrow({ where: { id: newLot.id } })).remaining,
          3,
        );
        assert.equal((await sales.detail(order.id, student.user.id)).canReceive, false);
        assert.equal((await sales.detail(order.id, student.user.id)).canRefund, false);
      },
    );
    await t.test(
      'mixed cash receipt consumes vouchers and a successful original refund restores vouchers',
      async () => {
        const order = await checkout(2);
        await sales.prepay(order.id, student.user.id);
        const fact = trades.get(order.orderNo);
        await sales.confirmPayment(fact, undefined, 'WECHAT_NATIVE');
        await sales.confirmPayment(fact, undefined, 'WECHAT_NATIVE');
        assert.equal((await sales.detail(order.id, student.user.id)).paidTotal, '400');
        expect(
          await call('/commerce/digital-orders/' + order.id + '/refunds', student, 'POST', {
            requestKey: randomUUID(),
            reason: '未观看退款',
          }),
          201,
        );
        const refund = await db.refund.findFirstOrThrow({ where: { orderId: order.id } });
        assert.equal(refund.requestedAmount, 400n);
        expect(
          await call('/admin/digital-orders/refunds/' + refund.id + '/review', admin, 'POST', {
            expectedVersion: refund.version,
            action: 'APPROVE',
            reason: '隔离核实',
          }),
          201,
        );
        await sales.runJobs();
        assert.equal(
          (await db.refund.findUniqueOrThrow({ where: { id: refund.id } })).state,
          'SUCCEEDED',
        );
        assert.equal(
          (await db.videoVoucherLot.findUniqueOrThrow({ where: { id: oldLot.id } })).remaining,
          2,
        );
        for (const journal of await db.financeJournal.findMany({ where: { orderId: order.id } })) {
          const entries = await db.financeEntry.findMany({ where: { journalId: journal.id } });
          assert.equal(
            entries.reduce((n, e) => n + e.debit - e.credit, 0n),
            0n,
          );
        }
      },
    );
  } finally {
    await db.videoVoucherPolicy.update({
      where: { id: 1 },
      data: {
        title: original.title,
        price: original.price,
        faceValue: original.faceValue,
        active: original.active,
        version: { increment: 1 },
      },
    });
    mock.restoreAll();
    await app.close();
  }
});
