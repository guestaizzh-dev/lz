import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createApp } from '../dist/main.js';
import { Database } from '../dist/database.js';
import { AuthService } from '../dist/auth.js';
import { PaymentChannels } from '../dist/payment-channels.js';
import { MemberCenter } from '../dist/member-center.js';
import { ProductSalesService } from '../dist/product-sales.js';
import { CourseSalesService } from '../dist/course-sales.js';
if (process.env.NODE_ENV !== 'test') throw Error('Local isolated database required');

test('long term membership, upgrades and video vouchers use verified receipts and source-aware refunds', async (t) => {
  process.env.MEMBERSHIP_SALES_ENABLED = 'false';
  const app = await createApp(false),
    db = app.get(Database),
    auth = app.get(AuthService),
    center = app.get(MemberCenter),
    courses = app.get(CourseSalesService),
    channels = app.get(PaymentChannels);
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl(),
    trades = new Map(),
    refunds = new Map(),
    identity = { appid: 'center-app', mchid: 'center-merchant' };
  let fail = false;
  const adapter = {
    identity: () => identity,
    availability: () => ({ enabled: true, reason: '' }),
    prepay: async (no, title, amount) => {
      if (fail) throw Error('gateway offline');
      trades.set(no, {
        ...identity,
        out_trade_no: no,
        trade_type: 'NATIVE',
        trade_state: 'NOTPAY',
        amount: { total: amount, currency: 'CNY' },
      });
      return '{}';
    },
    query: async (no) => {
      if (fail) throw Error('gateway offline');
      return trades.get(no) ?? { trade_state: 'NOTFOUND' };
    },
    close: async (no) => {
      const trade = trades.get(no);
      if (trade) trade.trade_state = 'CLOSED';
    },
    refund: async (transactionId, refundNo, amount, total, no) => {
      if (fail) throw Error('gateway offline');
      const value = refunds.get(refundNo) ?? {
        ...identity,
        out_trade_no: no,
        transaction_id: transactionId,
        out_refund_no: refundNo,
        refund_id: randomUUID(),
        status: 'SUCCESS',
        success_time: new Date().toISOString(),
        amount: { refund: amount, total, currency: 'CNY' },
      };
      refunds.set(refundNo, value);
      return value;
    },
    queryRefund: async (no) => refunds.get(no),
  };
  mock.method(channels, 'resolve', () => adapter);
  mock.method(channels, 'choices', () => [
    {
      channel: 'WECHAT_NATIVE',
      provider: 'wxnative',
      label: '微信扫码支付',
      enabled: true,
      reason: '',
    },
  ]);
  process.env.MEMBERSHIP_SALES_ENABLED = 'true';
  async function account(role = 'USER') {
    const user = await db.user.create({ data: { nickname: 'center-test', roles: [role] } }),
      c = auth.credentials(),
      csrf = randomUUID();
    await db.authSession.create({
      data: {
        userId: user.id,
        kind: role === 'USER' ? 'APP' : 'ADMIN',
        accessHash: c.accessHash,
        refreshHash: c.refreshHash,
        accessExpiresAt: c.accessExpiresAt,
        expiresAt: new Date(Date.now() + 86400000),
        csrfToken: csrf,
      },
    });
    return {
      user,
      headers:
        role === 'USER'
          ? { Authorization: 'Bearer ' + c.access }
          : { Cookie: 'daoxue_access=' + c.access, 'X-CSRF-Token': csrf },
    };
  }
  async function call(path, session, method = 'GET', data) {
    const response = await fetch(base + '/api/v1' + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://127.0.0.1:5173',
        ...session?.headers,
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    return { status: response.status, body: await response.json() };
  }
  async function order(s, selection) {
    const q = await call(
      '/membership-center/quote?platform=ANDROID&' + new URLSearchParams(selection),
      s,
    );
    assert.equal(q.status, 200, JSON.stringify(q.body));
    const dto = {
        ...selection,
        platform: 'ANDROID',
        requestKey: randomUUID(),
        quoteHash: q.body.quoteHash,
      },
      r = await call('/membership-center/orders', s, 'POST', dto);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return { row: r.body, dto };
  }
  async function paid(s, selection) {
    const { row } = await order(s, selection);
    await center.prepay(row.id, s.user.id);
    const fact = {
      ...trades.get(row.orderNo),
      trade_state: 'SUCCESS',
      transaction_id: randomUUID(),
      success_time: new Date().toISOString(),
    };
    trades.set(row.orderNo, fact);
    assert.equal((await center.confirmPayment(fact)).disposition, 'ACCEPTED');
    return { row, fact };
  }
  async function finishRefund(orderId, user, quantity) {
    const r = await call('/membership-center/orders/' + orderId + '/refund', user, 'POST', {
      requestKey: randomUUID(),
      reason: '测试退款规则',
      ...(quantity ? { quantity } : {}),
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    let refund = await db.refund.findFirstOrThrow({ where: { orderId, state: 'REQUESTED' } });
    const result = await call(
      '/admin/membership-center/refunds/' + refund.id + '/review',
      admin,
      'POST',
      { expectedVersion: refund.version, action: 'APPROVE', reason: '核实未使用权益' },
    );
    assert.equal(result.status, 201, JSON.stringify(result.body));
    await center.runJobs();
    return db.refund.findUniqueOrThrow({ where: { id: refund.id } });
  }
  const admin = await account('ADMIN');
  try {
    await t.test(
      'overview lists all five levels including registration, and no cash wallet is created',
      async () => {
        const r = await call('/membership-center');
        assert.equal(r.status, 200);
        assert.deepEqual(
          r.body.grades.map((g) => [g.price, g.voucherQuantity]),
          [
            [36500, 50],
            [99800, 100],
            [168000, 200],
            [298000, 300],
          ],
        );
        assert.equal(r.body.member, null);
        assert.equal(r.body.voucher.value, 300);
        assert.equal(r.body.voucher.expiresAt, null);
      },
    );
    await t.test(
      'duplicate checkout and callbacks grant one permanent membership and one gift lot',
      async () => {
        const s = await account(),
          { row, dto } = await order(s, { kind: 'MEMBER_LIFETIME', tier: 1 });
        const again = await call('/membership-center/orders', s, 'POST', dto);
        assert.equal(again.body.id, row.id);
        await center.prepay(row.id, s.user.id);
        const fact = {
          ...trades.get(row.orderNo),
          trade_state: 'SUCCESS',
          transaction_id: randomUUID(),
          success_time: new Date().toISOString(),
        };
        await Promise.all([center.confirmPayment(fact), center.confirmPayment(fact)]);
        assert.equal(await db.memberPurchase.count({ where: { userId: s.user.id } }), 1);
        const lot = await db.videoVoucherLot.findUniqueOrThrow({ where: { orderId: row.id } });
        assert.equal(lot.remaining, 50);
        assert.equal(lot.unitPrice, 0);
        assert.equal(await db.paymentTransaction.count({ where: { orderId: row.id } }), 1);
        assert.equal(
          (await call('/membership-center/quote?platform=ANDROID&kind=MEMBER_LIFETIME&tier=1', s))
            .status,
          409,
        );
      },
    );
    await t.test(
      'permanent members appear in directory, benefit summary and transaction notifications',
      async () => {
        const s = await account(),
          purchase = await paid(s, { kind: 'MEMBER_LIFETIME', tier: 2 });
        const directory = await call('/admin/memberships/users?tier=2', admin);
        assert.equal(directory.status, 200, JSON.stringify(directory.body));
        assert.ok(
          directory.body.items.some((u) => u.id === s.user.id && u.longTerm && u.endsAt === null),
        );
        const summary = await call('/admin/membership-benefits/users/' + s.user.id, admin);
        assert.equal(summary.status, 200, JSON.stringify(summary.body));
        assert.equal(summary.body.longTerm.tier, 2);
        assert.equal(summary.body.videoVouchers.available, 100);
        const message = await db.notification.findFirstOrThrow({
          where: { userId: s.user.id, kind: 'MEMBER_CENTER_ORDER' },
        });
        const { messageTarget, messageCategory } = await import('../dist/message-target.js');
        assert.equal(
          messageTarget(message).path,
          '/pages/membership/center-purchase?id=' + purchase.row.id,
        );
        assert.equal(messageCategory(message.kind), 'transactions');
      },
    );
    await t.test(
      'member center receipts, journals and durable checks appear in shared finance and recovery',
      async () => {
        const s = await account(),
          purchase = await paid(s, { kind: 'VIDEO_VOUCHER', quantity: 3 });
        const list = await call(
          '/admin/finance/payments?kind=VIDEO_VOUCHER&q=' + purchase.row.orderNo,
          admin,
        );
        assert.equal(list.status, 200, JSON.stringify(list.body));
        assert.equal(list.body.items.length, 1);
        assert.equal(list.body.items[0].amount, '900');
        const detail = await call('/admin/finance/orders/' + purchase.row.id, admin);
        assert.equal(detail.status, 200, JSON.stringify(detail.body));
        assert.equal(detail.body.order.kind, 'VIDEO_VOUCHER');
        assert.equal(
          (await call('/admin/membership-center/orders/' + purchase.row.id, admin)).status,
          200,
        );
        const job = await db.outboxJob.findUniqueOrThrow({
          where: { eventKey: 'center.check:' + purchase.row.id },
        });
        await db.outboxJob.update({
          where: { id: job.id },
          data: { state: 'DEAD', lockedUntil: null },
        });
        const recovery = await call('/admin/operations/jobs/' + job.id, admin);
        assert.equal(recovery.status, 200);
        assert.equal(recovery.body.order.id, purchase.row.id);
        assert.equal(recovery.body.retryable, true);
        const retry = await call('/admin/operations/jobs/' + job.id + '/retry', admin, 'POST', {
          expectedRevision: recovery.body.revision,
          reason: '隔离测试恢复核查任务',
        });
        assert.equal(retry.status, 201, JSON.stringify(retry.body));
      },
    );
    await t.test(
      'account closure protects purchased vouchers and requires explicit permanent membership forfeiture',
      async () => {
        const s = await account(),
          purchase = await paid(s, { kind: 'VIDEO_VOUCHER', quantity: 2 });
        const blocked = await call('/me/close-account', s, 'POST', {
          confirmation: '确认注销',
          forfeitPaidAccess: true,
        });
        assert.equal(blocked.status, 409, JSON.stringify(blocked.body));
        assert.match(blocked.body.message, /已购视频代金券/);
        await finishRefund(purchase.row.id, s, 2);
        const member = await paid(s, { kind: 'MEMBER_LIFETIME', tier: 1 });
        const confirm = await call('/me/close-account', s, 'POST', { confirmation: '确认注销' });
        assert.equal(confirm.status, 409, JSON.stringify(confirm.body));
        const closed = await call('/me/close-account', s, 'POST', {
          confirmation: '确认注销',
          forfeitPaidAccess: true,
        });
        assert.equal(closed.status, 201, JSON.stringify(closed.body));
        assert.equal(
          (await db.memberPurchase.findUniqueOrThrow({ where: { orderId: member.row.id } })).state,
          'REVOKED',
        );
        assert.equal(
          (await db.videoVoucherLot.findFirstOrThrow({ where: { orderId: member.row.id } }))
            .suspended,
          true,
        );
      },
    );
    await t.test(
      'upgrade charges only difference and supplements only the gift difference, refund restores copper',
      async () => {
        const s = await account(),
          first = await paid(s, { kind: 'MEMBER_LIFETIME', tier: 1 }),
          upgrade = await paid(s, { kind: 'MEMBER_LIFETIME', tier: 2 });
        assert.equal(upgrade.row.amount, '63300');
        assert.equal(upgrade.row.terms.giftQuantity, 50);
        assert.equal(
          (
            await db.videoVoucherLot.aggregate({
              where: { userId: s.user.id },
              _sum: { remaining: true },
            })
          )._sum.remaining,
          100,
        );
        const refund = await finishRefund(upgrade.row.id, s);
        assert.equal(refund.state, 'SUCCEEDED');
        const view = await center.overview(s.user.id);
        assert.equal(view.member.tier, 1);
        assert.equal(view.voucher.available, 50);
        const next = await order(s, { kind: 'MEMBER_LIFETIME', tier: 2 });
        assert.equal(next.row.amount, '63300');
        await center.cancel(next.row.id, s.user.id);
        assert.equal(
          (await db.memberPurchase.findUniqueOrThrow({ where: { orderId: first.row.id } })).state,
          'ACTIVE',
        );
      },
    );
    await t.test(
      'standalone purchased vouchers support partial unused refunds and remain independent of membership',
      async () => {
        const s = await account(),
          member = await paid(s, { kind: 'MEMBER_LIFETIME', tier: 1 }),
          purchase = await paid(s, { kind: 'VIDEO_VOUCHER', quantity: 10 });
        assert.equal(purchase.row.amount, '3000');
        assert.equal((await finishRefund(purchase.row.id, s, 4)).state, 'SUCCEEDED');
        assert.equal(
          (await db.videoVoucherLot.findUniqueOrThrow({ where: { orderId: purchase.row.id } }))
            .remaining,
          6,
        );
        assert.equal((await finishRefund(member.row.id, s)).state, 'SUCCEEDED');
        assert.equal((await center.overview(s.user.id)).voucher.available, 6);
      },
    );
    await t.test(
      'refund pending freezes source, rejection restores it and wrong roles cannot approve',
      async () => {
        const s = await account(),
          support = await account('SUPPORT'),
          purchase = await paid(s, { kind: 'VIDEO_VOUCHER', quantity: 4 });
        const result = await call(
          '/membership-center/orders/' + purchase.row.id + '/refund',
          s,
          'POST',
          { requestKey: randomUUID(), quantity: 3, reason: '申请退未用券' },
        );
        assert.equal(result.status, 201);
        assert.equal((await center.overview(s.user.id)).voucher.available, 1);
        const refund = await db.refund.findFirstOrThrow({ where: { orderId: purchase.row.id } }),
          dto = { expectedVersion: refund.version, action: 'REJECT', reason: '暂不通过测试申请' };
        assert.equal(
          (
            await call(
              '/admin/membership-center/refunds/' + refund.id + '/review',
              support,
              'POST',
              dto,
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await call(
              '/admin/membership-center/refunds/' + refund.id + '/review',
              admin,
              'POST',
              dto,
            )
          ).status,
          201,
        );
        assert.equal((await center.overview(s.user.id)).voucher.available, 4);
      },
    );
    await t.test('old orders keep purchased grade terms after administrative edits', async () => {
      const s = await account(),
        { row } = await order(s, { kind: 'MEMBER_LIFETIME', tier: 1 }),
        grade = await db.membershipGrade.findUniqueOrThrow({ where: { tier: 1 } });
      const r = await call('/admin/membership-center/grades/1', admin, 'PUT', {
        expectedVersion: grade.version,
        price: grade.price,
        voucherQuantity: 51,
        goodsBasisPoints: grade.goodsBasisPoints,
        bookBasisPoints: grade.bookBasisPoints,
        active: true,
        reason: '测试新售赠券数量',
      });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      await center.prepay(row.id, s.user.id);
      const data = {
        ...trades.get(row.orderNo),
        trade_state: 'SUCCESS',
        transaction_id: randomUUID(),
        success_time: new Date().toISOString(),
      };
      await center.confirmPayment(data);
      assert.equal(
        (await db.videoVoucherLot.findUniqueOrThrow({ where: { orderId: row.id } })).quantity,
        50,
      );
      await db.membershipGrade.update({
        where: { tier: 1 },
        data: { voucherQuantity: 50, version: { increment: 1 } },
      });
    });
    await t.test(
      'late, wrong-amount and duplicate receipts are refunded without extra entitlements',
      async () => {
        for (const variant of ['late', 'amount']) {
          const s = await account(),
            { row } = await order(s, { kind: 'VIDEO_VOUCHER', quantity: 2 });
          await center.prepay(row.id, s.user.id);
          if (variant === 'late')
            await db.tradeOrder.update({ where: { id: row.id }, data: { expiresAt: new Date(0) } });
          const fact = {
            ...trades.get(row.orderNo),
            trade_state: 'SUCCESS',
            transaction_id: randomUUID(),
            success_time: new Date().toISOString(),
            amount: { total: variant === 'amount' ? 601 : 600, currency: 'CNY' },
          };
          assert.notEqual((await center.confirmPayment(fact)).disposition, 'ACCEPTED');
          await center.runJobs();
          assert.equal(await db.videoVoucherLot.count({ where: { orderId: row.id } }), 0);
          assert.equal(
            (await db.refund.findFirstOrThrow({ where: { orderId: row.id } })).state,
            'SUCCEEDED',
          );
        }
      },
    );
    await t.test(
      'lifestyle and book prices use distinct frozen rates, pending discounts block membership refunds',
      async () => {
        const s = await account(),
          member = await paid(s, { kind: 'MEMBER_LIFETIME', tier: 1 }),
          province = '长期会员测试' + randomUUID().slice(0, 5);
        await db.deliveryZone.create({ data: { province, fee: 0, surcharge: 0, enabled: true } });
        const address = await db.address.create({
          data: {
            userId: s.user.id,
            recipient: '测试',
            phone: '19900009999',
            province,
            city: '测试市',
            district: '测试区',
            detail: '隔离测试',
            isDefault: true,
          },
        });
        const skus = [];
        for (const type of ['LIFESTYLE', 'BOOK']) {
          const product = await db.product.create({
            data: {
              title: '价格品类测试',
              subtitle: '测试',
              description: '测试',
              category: '文创',
              cover: '/static/art/books.svg',
              price: 10000,
              culturalOrigin: '测试',
              status: 'PUBLISHED',
              membershipPriceCategory: type,
              mallCategory: type,
            },
          });
          const sku = await db.productSku.create({
            data: { productId: product.id, title: '默认', price: 10000, stock: 10, active: true },
          });
          skus.push(sku);
        }
        const sales = app.get(ProductSalesService),
          input = {
            platform: 'ANDROID',
            shippingMode: 'STANDARD',
            addressId: address.id,
            items: skus.map((sku) => ({ skuId: sku.id, quantity: 1 })),
          },
          quote = await sales.quote(s.user.id, input);
        assert.deepEqual(
          quote.items.map((i) => i.goodsPayable).sort((a, b) => a - b),
          [9500, 9900],
        );
        for (const [index, kind] of ['LIFESTYLE', 'BOOK'].entries()) {
          for (const sort of ['recent', 'popular', 'priceAsc', 'priceDesc']) {
            const listing = await call('/catalog/products?mallCategory=' + kind + '&sort=' + sort);
            assert.equal(listing.status, 200);
            assert.ok(listing.body.items.some((row) => row.id === skus[index].productId));
            assert.ok(
              listing.body.items.every((row) => row.mallCategory === kind),
              'Mall display must use the same category as checkout, across every sort',
            );
          }
        }
        assert.equal((await call('/catalog/products?mallCategory=VIDEO')).status, 200);
        const original = process.env.PRODUCT_SALES_ENABLED;
        process.env.PRODUCT_SALES_ENABLED = 'true';
        try {
          const row = await sales.checkout(s.user.id, {
            ...input,
            channel: 'WECHAT_NATIVE',
            requestKey: randomUUID(),
            quoteHash: quote.quoteHash,
          });
          assert.equal(
            (
              await call('/membership-center/orders/' + member.row.id + '/refund', s, 'POST', {
                requestKey: randomUUID(),
                reason: '仍有占用优惠',
              })
            ).status,
            409,
          );
          await sales.cancel(row.id, s.user.id);
          assert.equal((await finishRefund(member.row.id, s)).state, 'SUCCEEDED');
        } finally {
          if (original === undefined) delete process.env.PRODUCT_SALES_ENABLED;
          else process.env.PRODUCT_SALES_ENABLED = original;
        }
      },
    );
    await t.test(
      'video full-voucher purchase creates no cash receipt, mixed purchase returns both sources after refund',
      async () => {
        const bytes = Buffer.from('isolated-video'),
          teacher = await db.teacher.create({
            data: {
              name: '代金券测试名师',
              title: '测试',
              bio: '测试',
              expertise: [],
              status: 'PUBLISHED',
            },
          }),
          asset = await db.mediaAsset.create({
            data: {
              storageKey: randomUUID(),
              name: 'test.mp4',
              mime: 'video/mp4',
              bytes: bytes.length,
              uploaderId: admin.user.id,
              status: 'READY',
              visibility: 'PRIVATE',
            },
          });
        await writeFile(join(process.env.MEDIA_DIR, asset.storageKey), bytes);
        async function video() {
          const result = await call('/admin/courses', admin, 'POST', {
            title: '代金券视频测试',
            subtitle: '测试',
            description: '隔离测试',
            category: '经典研习',
            format: 'VIDEO',
            cover: '/static/art/books.svg',
            price: 3000,
            teacherId: teacher.id,
            membershipTier: null,
            accessDays: null,
            refundPolicy: '7天未学可退',
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
          assert.equal(result.status, 201, JSON.stringify(result.body));
          const submitted = await call(
            '/admin/courses/' + result.body.id + '/transition',
            admin,
            'POST',
            { action: 'submit', expectedVersion: result.body.version, reason: '测试送审' },
          );
          const published = await call(
            '/admin/courses/' + result.body.id + '/transition',
            admin,
            'POST',
            { action: 'publish', expectedVersion: submitted.body.version, reason: '测试发布' },
          );
          assert.equal(published.status, 201, JSON.stringify(published.body));
          return published.body;
        }
        async function buy(s, courseId, n) {
          const quote = await call(
            '/commerce/courses/' +
              courseId +
              '/quote?platform=ANDROID&channel=WECHAT_NATIVE&voucherQuantity=' +
              n,
            s,
          );
          assert.equal(quote.status, 200, JSON.stringify(quote.body));
          const r = await call('/commerce/course-orders', s, 'POST', {
            courseId,
            platform: 'ANDROID',
            channel: 'WECHAT_NATIVE',
            voucherQuantity: n,
            quoteHash: quote.body.quoteHash,
            requestKey: randomUUID(),
          });
          assert.equal(r.status, 201, JSON.stringify(r.body));
          return r.body;
        }
        const concurrent = await account();
        await paid(concurrent, { kind: 'VIDEO_VOUCHER', quantity: 8 });
        const pair = await Promise.all([video(), video()]);
        const quotes = await Promise.all(
          pair.map((c) =>
            call(
              '/commerce/courses/' +
                c.id +
                '/quote?platform=ANDROID&channel=WECHAT_NATIVE&voucherQuantity=8',
              concurrent,
            ),
          ),
        );
        const submitted = await Promise.all(
          pair.map((c, i) =>
            call('/commerce/course-orders', concurrent, 'POST', {
              courseId: c.id,
              platform: 'ANDROID',
              channel: 'WECHAT_NATIVE',
              voucherQuantity: 8,
              quoteHash: quotes[i].body.quoteHash,
              requestKey: randomUUID(),
            }),
          ),
        );
        assert.deepEqual(submitted.map((r) => r.status).sort(), [201, 409]);
        const pending = submitted.find((r) => r.status === 201).body;
        assert.equal((await center.overview(concurrent.user.id)).voucher.held, 8);
        await courses.cancel(pending.id, concurrent.user.id);
        assert.equal((await center.overview(concurrent.user.id)).voucher.available, 8);
        const full = await account();
        await paid(full, { kind: 'VIDEO_VOUCHER', quantity: 10 });
        const course = await video(),
          row = await buy(full, course.id, 10);
        assert.equal(row.amount, '0');
        assert.equal(row.access, true);
        assert.equal(await db.paymentTransaction.count({ where: { orderId: row.id } }), 0);
        assert.equal((await center.overview(full.user.id)).voucher.available, 0);
        const returned = await call('/commerce/course-orders/' + row.id + '/refund', full, 'POST', {
          requestKey: randomUUID(),
          reason: '未开始学习退券',
        });
        assert.equal(returned.status, 201, JSON.stringify(returned.body));
        assert.equal(returned.body.access, false);
        assert.equal((await center.overview(full.user.id)).voucher.available, 10);
        const mixed = await account();
        await paid(mixed, { kind: 'VIDEO_VOUCHER', quantity: 8 });
        const other = await video(),
          mix = await buy(mixed, other.id, 8);
        assert.equal(mix.amount, '600');
        await courses.prepay(mix.id, mixed.user.id);
        const fact = {
          ...trades.get(mix.orderNo),
          trade_state: 'SUCCESS',
          transaction_id: randomUUID(),
          success_time: new Date().toISOString(),
        };
        await courses.confirmPayment(fact, undefined, 'WECHAT_NATIVE');
        assert.equal(
          (await db.videoVoucherLot.findFirstOrThrow({ where: { userId: mixed.user.id } })).used,
          8,
        );
        const r = await call('/commerce/course-orders/' + mix.id + '/refund', mixed, 'POST', {
          requestKey: randomUUID(),
          reason: '未开始学习退课',
        });
        assert.equal(r.status, 201, JSON.stringify(r.body));
        const ref = await db.refund.findFirstOrThrow({ where: { orderId: mix.id } });
        assert.equal(ref.requestedAmount, 600n);
        const reviewed = await call(
          '/admin/course-orders/refunds/' + ref.id + '/review',
          admin,
          'POST',
          { expectedVersion: ref.version, action: 'APPROVE', reason: '核实未学原路退回' },
        );
        assert.equal(reviewed.status, 201, JSON.stringify(reviewed.body));
        await courses.runJobs();
        assert.equal((await center.overview(mixed.user.id)).voucher.available, 8);
      },
    );
    const journals = await db.financeJournal.findMany({
      where: {
        kind: { in: ['MEMBER_CENTER_PAYMENT', 'MEMBER_CENTER_REFUND', 'VIDEO_VOUCHER_REDEEM'] },
      },
    });
    for (const journal of journals) {
      const entries = await db.financeEntry.findMany({ where: { journalId: journal.id } });
      assert.equal(
        entries.reduce((sum, e) => sum + e.debit - e.credit, 0n),
        0n,
      );
    }
  } finally {
    mock.restoreAll();
    await app.close();
  }
});
