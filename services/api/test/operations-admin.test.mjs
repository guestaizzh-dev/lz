import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomInt } from 'node:crypto';
import { createApp } from '../dist/main.js';
import { Database } from '../dist/database.js';
import { passwordHash } from '../dist/auth.js';

if (process.env.NODE_ENV !== 'test' || !['localhost', '127.0.0.1'].includes(new URL(process.env.DATABASE_URL).hostname)) throw Error('Requires isolated local test database');

test('operations and unified finance: real HTTP, permissions, money and concurrent recovery', async t => {
  process.env.CORS_ORIGINS = 'http://127.0.0.1:5173';
  const db = new Database(), app = await createApp(false), prefix = 'qa-ops-' + randomUUID(), password = randomUUID() + '!A';
  app.getHttpAdapter().getInstance().set('trust proxy', 'loopback');
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl(), ip = '2001:db8:' + randomInt(1, 65535).toString(16) + '::1';
  let auth;
  async function call(path, method = 'GET', body, session = auth, extra = {}) {
    const response = await fetch(base + '/api/v1' + path, { method, headers: { 'Content-Type': 'application/json', Origin: process.env.CORS_ORIGINS, 'X-Forwarded-For': ip, ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrfToken } : {}), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json(), cookies: response.headers.getSetCookie() };
  }
  async function login(role) {
    const user = await db.user.create({ data: { nickname: prefix, username: prefix + role, passwordHash: await passwordHash(password), roles: [role] } });
    const response = await call('/admin/auth/login', 'POST', { username: user.username, password }, null);
    assert.equal(response.status, 200);
    return { id: user.id, cookie: response.cookies.map(c => c.split(';')[0]).join('; '), csrfToken: response.body.csrfToken };
  }
  try {
    auth = await login('ADMIN'); const support = await login('SUPPORT'), finance = await login('FINANCE');
    await t.test('read access is explicit and write access does not follow financial access', async () => {
      assert.equal((await call('/admin/finance/summary', 'GET', undefined, null)).status, 401);
      for (const session of [support, finance]) assert.equal((await call('/admin/finance/summary', 'GET', undefined, session)).status, 403);
      const policy = await db.accessRole.findUniqueOrThrow({ where: { code: 'FINANCE' } });
      await db.accessRole.update({ where: { id: policy.id }, data: { permissionCodes: [...policy.permissionCodes, 'finance.read'] } });
      assert.equal((await call('/admin/finance/summary', 'GET', undefined, finance)).status, 200);
      assert.equal((await call('/admin/operations/jobs', 'GET', undefined, finance)).status, 403);
      assert.equal((await call('/admin/operations/jobs', 'GET', undefined, support)).status, 403);
    });
    const from = '2026-01-01T00:00:00+08:00', to = '2026-02-01T00:00:00+08:00', when = new Date('2026-01-10T10:00:00+08:00'), range = new URLSearchParams({ from, to });
    const kinds = ['COURSE', 'MEMBERSHIP', 'PHYSICAL', 'CONSULTATION', 'EVENT', 'COHORT'], orders = [], payments = [];
    for (const [index, kind] of kinds.entries()) {
      const amount = index === 0 ? 9007199254740993n : BigInt((index + 1) * 100);
      const order = await db.tradeOrder.create({ data: { kind, orderNo: prefix + index, userId: auth.id, requestKey: randomUUID(), requestHash: prefix, currency: 'CNY', subtotal: amount, payableTotal: amount, paidTotal: amount, state: 'PAID', pricingSnapshot: { secret: 'DO_NOT_EXPOSE' }, addressSnapshotCipher: 'DO_NOT_EXPOSE', quoteHash: prefix, expiresAt: new Date('2026-01-11'), paidAt: when } }); orders.push(order);
      payments.push(await db.paymentTransaction.create({ data: { orderId: order.id, channel: 'WECHAT_APP', appScope: prefix, externalTransactionId: prefix + index, amount, currency: 'CNY', verifiedAt: when, paidAt: when, disposition: 'ACCEPTED', receiptHash: 'DO_NOT_EXPOSE', receiptStorageRef: 'DO_NOT_EXPOSE' } }));
    }
    const abnormal = await db.paymentTransaction.create({ data: { orderId: orders[2].id, channel: 'ALIPAY_APP', appScope: prefix, externalTransactionId: prefix + '-abnormal', amount: 300n, currency: 'CNY', verifiedAt: when, paidAt: when, disposition: 'DUPLICATE', receiptHash: prefix } });
    const refund = await db.refund.create({ data: { orderId: orders[2].id, userId: auth.id, requestKey: randomUUID(), kind: 'REFUND_ONLY', state: 'SUCCEEDED', requestedAmount: 300n, approvedAmount: 300n, reasonCode: 'DUPLICATE', description: '规范异常收款退款', paymentTransactionId: abnormal.id, succeededAt: when, createdAt: new Date('2025-12-30') } });
    await db.refundTransaction.create({ data: { refundId: refund.id, paymentTransactionId: abnormal.id, channel: 'ALIPAY_APP', appScope: prefix, externalRefundId: prefix + '-refund', amount: 300n, currency: 'CNY', verifiedAt: when, succeededAt: when, receiptHash: prefix } });
    await db.refund.create({ data: { orderId: orders[2].id, userId: auth.id, requestKey: randomUUID(), kind: 'EXCHANGE', state: 'SUCCEEDED', requestedAmount: 0n, reasonCode: 'PRODUCT_RETURN', description: '换货不是退款', paymentTransactionId: payments[2].id, succeededAt: when, createdAt: when } });
    const usdOrder = await db.tradeOrder.create({ data: { kind: 'COURSE', orderNo: prefix + '-usd', userId: auth.id, requestKey: randomUUID(), requestHash: prefix, currency: 'USD', subtotal: 199n, payableTotal: 199n, pricingSnapshot: {}, quoteHash: prefix, expiresAt: new Date('2026-01-11') } });
    const usdPayment = await db.paymentTransaction.create({ data: { orderId: usdOrder.id, channel: 'APPLE_IAP', appScope: prefix, externalTransactionId: prefix + '-usd', amount: 199n, currency: 'USD', verifiedAt: when, paidAt: when, disposition: 'ACCEPTED', receiptHash: prefix } });
    const account = await db.financeAccount.create({ data: { code: prefix, title: '专项资金科目', kind: 'ASSET' } });
    for (const payment of [payments[2], abnormal]) await db.$transaction(async tx => {
      const journal = await tx.financeJournal.create({ data: { eventKey: prefix + payment.id, kind: 'PRODUCT_PAYMENT', orderId: payment.orderId, transactionId: payment.id, currency: 'CNY', postedAt: when, description: '专项已确认收款' } });
      await tx.financeEntry.createMany({ data: [{ journalId: journal.id, accountCode: account.code, debit: payment.amount }, { journalId: journal.id, accountCode: account.code, credit: payment.amount }] });
    });
    const appleRefund = await db.refund.create({ data: { orderId: usdOrder.id, userId: auth.id, requestKey: randomUUID(), kind: 'REFUND_ONLY', state: 'REVERSED', requestedAmount: 99n, approvedAmount: 99n, reasonCode: 'APPLE_REVOKED', description: '历史退款在次月撤回', paymentTransactionId: usdPayment.id, succeededAt: when, createdAt: new Date('2025-12-30') } });
    await db.refundTransaction.create({ data: { refundId: appleRefund.id, paymentTransactionId: usdPayment.id, channel: 'APPLE_IAP', appScope: prefix, externalRefundId: prefix + '-apple-refund', amount: 99n, currency: 'USD', verifiedAt: when, succeededAt: when, receiptHash: prefix } });
    await db.$transaction(async tx => {
      const original = await tx.financeJournal.create({ data: { eventKey: prefix + '-apple-original', kind: 'COURSE_REFUND', orderId: usdOrder.id, transactionId: usdPayment.id, refundId: appleRefund.id, currency: 'USD', postedAt: when, description: '历史退款' } });
      const reversal = await tx.financeJournal.create({ data: { eventKey: prefix + '-apple-reversed', kind: 'COURSE_REFUND_REVERSAL', orderId: usdOrder.id, transactionId: usdPayment.id, refundId: appleRefund.id, reversalOfId: original.id, currency: 'USD', postedAt: new Date('2026-02-10'), description: '次月退款撤回' } });
      for (const journal of [original, reversal]) await tx.financeEntry.createMany({ data: [{ journalId: journal.id, accountCode: account.code, debit: 99n }, { journalId: journal.id, accountCode: account.code, credit: 99n }] });
    });
    await t.test('six real order types, abnormal refund and currency groups retain integer precision', async () => {
      const response = await call('/admin/finance/summary?' + range); assert.equal(response.status, 200, JSON.stringify(response.body));
      const cny = response.body.currencies.find(r => r.currency === 'CNY'), usd = response.body.currencies.find(r => r.currency === 'USD');
      assert.equal(cny.accepted, '9007199254742993'); assert.equal(cny.abnormal, '300'); assert.equal(cny.refunded, '300'); assert.equal(cny.cashDifference, cny.accepted); assert.equal(usd.accepted, '199'); assert.equal(usd.refunded, '99'); assert.equal(usd.cashDifference, '100');
      const february = await call('/admin/finance/summary?from=2026-02-01&to=2026-03-01'); const feb = february.body.currencies.find(r => r.currency === 'USD'); assert.equal(feb.refundCount, 0); assert.equal(feb.reversalCount, 1); assert.equal(feb.refunded, '-99'); assert.equal(feb.cashDifference, '99');
      for (const kind of kinds) { const list = await call('/admin/finance/payments?' + range + '&kind=' + kind); assert.equal(list.status, 200); assert.ok(list.body.items.some(r => r.orderKind === kind)); }
      const list = await call('/admin/finance/payments?' + range); assert.equal(list.body.total, 8); assert.equal(JSON.stringify(list.body).includes('DO_NOT_EXPOSE'), false);
    });
    await t.test('channel-scoped journals do not include another channel on the same order', async () => {
      const list = await call('/admin/finance/journals?' + range + '&channel=ALIPAY_APP'); assert.equal(list.status, 200, JSON.stringify(list.body)); assert.equal(list.body.total, 1); assert.equal(list.body.items[0].debit, '300'); assert.equal(list.body.items[0].balanced, true);
      const detail = await call('/admin/finance/orders/' + orders[2].id); assert.equal(detail.status, 200); assert.equal(detail.body.payments.length, 2); assert.equal(detail.body.journals.length, 2); assert.equal(detail.body.journals[0].entries[0].accountName, account.title); assert.equal(JSON.stringify(detail.body).includes('DO_NOT_EXPOSE'), false);
      const refunds = await call('/admin/finance/refunds?' + range); assert.equal(refunds.body.total, 0, 'application day differs from successful refund day');
    });
    await t.test('date limits, SQL input and unknown businesses are validated', async () => {
      assert.equal((await call('/admin/finance/summary?from=' + encodeURIComponent(to) + '&to=' + encodeURIComponent(from))).status, 400);
      assert.equal((await call('/admin/finance/summary?from=2024-01-01&to=2026-01-01')).status, 400);
      assert.equal((await call('/admin/finance/payments?kind=PRODUCT')).status, 400);
      const list = await call('/admin/finance/payments?' + range + '&q=' + encodeURIComponent("' OR 1=1 --")); assert.equal(list.status, 200); assert.equal(list.body.total, 0);
      assert.equal((await call('/admin/finance/orders/' + randomUUID())).status, 404);
    });
    async function job(kind = 'COURSE_DELIVERY_NOTICE', data = {}) { return db.outboxJob.create({ data: { eventKey: prefix + randomUUID(), kind, aggregateType: 'COURSE_ORDER', aggregateId: orders[0].id, payload: { cursor: 'saved-cursor', deliveryFailures: 8, secret: 'DO_NOT_EXPOSE' }, state: 'DEAD', attempts: 8, lastErrorCode: 'PROVIDER_OR_PROCESSING_ERROR', availableAt: when, ...data } }); }
    const failed = await job();
    await t.test('actual list revision allows exactly one audited recovery and preserves worker identity', async () => {
      const list = await call('/admin/operations/jobs?state=DEAD&q=' + failed.id); assert.equal(list.status, 200); const row = list.body.items[0]; assert.equal(row.retryable, true); assert.equal(JSON.stringify(row).includes('DO_NOT_EXPOSE'), false);
      assert.equal((await call('/admin/operations/jobs/' + failed.id + '/retry', 'POST', { expectedRevision: '0'.repeat(64), reason: '核查通过' })).status, 409);
      assert.equal((await call('/admin/operations/jobs/' + failed.id + '/retry', 'POST', { expectedRevision: row.revision, reason: '核查通过' }, auth, { 'X-CSRF-Token': '' })).status, 403);
      const results = await Promise.all([1, 2].map(() => call('/admin/operations/jobs/' + failed.id + '/retry', 'POST', { expectedRevision: row.revision, reason: '已核查渠道恢复' })));
      assert.deepEqual(results.map(r => r.status).sort(), [201, 409], JSON.stringify(results));
      const saved = await db.outboxJob.findUniqueOrThrow({ where: { id: failed.id } }); assert.equal(saved.state, 'READY'); assert.equal(saved.attempts, 0); assert.equal(saved.eventKey, failed.eventKey); assert.equal(saved.payload.cursor, 'saved-cursor'); assert.equal(saved.payload.deliveryFailures, 0);
      assert.equal(await db.auditLog.count({ where: { resourceId: failed.id, action: 'operations.job.retry' } }), 1);
      const detail = await call('/admin/operations/jobs/' + failed.id); assert.equal(detail.body.order.id, orders[0].id); assert.equal(detail.body.audit.length, 1); assert.equal(detail.body.retryable, false);
    });
    await t.test('changed, running, completed, leased and unsupported recovery tasks cannot be retried', async () => {
      for (const [kind, data, status] of [['COURSE_REFUND', { state: 'RUNNING' }, 409], ['COURSE_REFUND', { state: 'DONE' }, 409], ['COURSE_REFUND', { lockedUntil: new Date(Date.now() + 60000) }, 409], ['NOT_IMPLEMENTED', {}, 400]]) {
        const row = await job(kind, data), detail = await call('/admin/operations/jobs/' + row.id); assert.equal(detail.body.retryable, false);
        assert.equal((await call('/admin/operations/jobs/' + row.id + '/retry', 'POST', { expectedRevision: detail.body.revision, reason: '核查记录' })).status, status);
      }
      const row = await job('COHORT_SCHEDULE_COMPENSATION', { payload: { cursor: 'keep', failures: 8 } }), detail = await call('/admin/operations/jobs/' + row.id);
      await db.outboxJob.update({ where: { id: row.id }, data: { attempts: 9 } });
      assert.equal((await call('/admin/operations/jobs/' + row.id + '/retry', 'POST', { expectedRevision: detail.body.revision, reason: '核查记录' })).status, 409);
      const fresh = await call('/admin/operations/jobs/' + row.id); assert.equal((await call('/admin/operations/jobs/' + row.id + '/retry', 'POST', { expectedRevision: fresh.body.revision, reason: '核查记录' })).status, 201);
      const saved = await db.outboxJob.findUniqueOrThrow({ where: { id: row.id } }); assert.deepEqual(saved.payload, { cursor: 'keep', failures: 0 });
      await job('COURSE_PAYMENT_CHECK', { state: 'READY', availableAt: new Date(Date.now() - 10 * 60000) });
      const stats = await call('/admin/operations/summary'); assert.equal(stats.status, 200); assert.ok(stats.body.counts.READY >= 2); assert.ok(stats.body.overdue >= 1);
    });
  } finally { await app.close(); await db.$disconnect(); }
});
