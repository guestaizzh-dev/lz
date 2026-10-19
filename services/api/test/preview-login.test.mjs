import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../dist/main.js';
import { Database } from '../dist/database.js';
import { phoneLookup } from '../dist/private-data.js';
import { previewLoginConfig, previewPhone, previewSessionDevice } from '../dist/preview-login.js';

test('preview OTP is bound to one existing ordinary account and an expiring switch', async t => {
  const db = new Database();
  const user = await db.user.create({ data: { nickname: '预览测试学员', phoneHash: phoneLookup(previewPhone), roles: ['USER'], tags: [] } });
  const baselineUsers = await db.user.count();
  Object.assign(process.env, { SMS_ENABLED: 'false', PREVIEW_LOGIN_ENABLED: 'true', PREVIEW_LOGIN_USER_ID: user.id, PREVIEW_LOGIN_CODE: '123456', PREVIEW_LOGIN_EXPIRES_AT: new Date(Date.now() + 86400_000).toISOString(), PRODUCT_SALES_ENABLED: 'false', COURSE_WECHAT_ENABLED: 'false', COURSE_ALIPAY_ENABLED: 'false', MEMBERSHIP_SALES_ENABLED: 'false', APPLE_IAP_ENABLED: 'false', APPLE_MEMBERSHIP_SALES_ENABLED: 'false' });
  const app = await createApp(false);
  await app.listen(0, '127.0.0.1');
  const base = (await app.getUrl()) + '/api/v1';
  async function call(path, data, bearer) {
    const res = await fetch(base + path, { method: data ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
    return { status: res.status, body: await res.json() };
  }
  async function challenge() {
    await db.rateLimit.deleteMany({ where: { key: 'sms-phone-minute:' + phoneLookup(previewPhone) } });
    const res = await call('/auth/sms', { phone: previewPhone });
    assert.equal(res.status, 201); assert.equal(res.body.channel, 'PREVIEW'); assert.equal(res.body.code, undefined);
    return { phone: previewPhone, challengeId: res.body.challengeId, code: '123456' };
  }
  async function signIn() { const res = await call('/auth/login', await challenge()); assert.equal(res.status, 200); return res.body; }
  try {
    await t.test('configuration refuses malformed, unbounded and real-payment combinations', () => {
      const config = { ...process.env };
      for (const changes of [{ PREVIEW_LOGIN_ENABLED: 'yes' }, { PREVIEW_LOGIN_USER_ID: '' }, { PREVIEW_LOGIN_CODE: 'x' }, { PREVIEW_LOGIN_EXPIRES_AT: 'bad' }, { PREVIEW_LOGIN_EXPIRES_AT: new Date(Date.now() + 8 * 86400_000).toISOString() }, { SMS_ENABLED: 'true' }, { PRODUCT_SALES_ENABLED: 'true' }, { COURSE_WECHAT_ENABLED: 'true' }, { COURSE_ALIPAY_ENABLED: 'true' }, { MEMBERSHIP_SALES_ENABLED: 'true' }, { APPLE_IAP_ENABLED: 'true' }]) assert.throws(() => previewLoginConfig({ ...config, ...changes }));
      assert.equal(previewLoginConfig({ ...config, PREVIEW_LOGIN_ENABLED: 'false' }), null);
      assert.equal(previewLoginConfig({ ...config, PREVIEW_LOGIN_EXPIRES_AT: new Date(Date.now() - 1).toISOString() }), null);
    });
    await t.test('other phones cannot receive mock codes or register accounts', async () => {
      assert.equal((await call('/auth/sms', { phone: '19900001001' })).status, 503);
      assert.equal((await call('/auth/sms', { phone: '13800000000' })).status, 503);
      assert.equal(await db.user.count(), baselineUsers);
    });
    await t.test('codes retain phone binding, attempts, one-time consumption and request limits', async () => {
      const dto = await challenge();
      const stored = await db.otpChallenge.findUniqueOrThrow({ where: { id: dto.challengeId } });
      assert.equal(stored.purpose, 'PREVIEW_LOGIN'); assert.equal(stored.deliveryState, 'SIMULATED'); assert.equal(stored.phone, ''); assert.notEqual(stored.codeHash, '123456');
      assert.equal((await call('/auth/sms', { phone: previewPhone })).status, 429);
      assert.equal((await call('/auth/login', { ...dto, phone: '19900001001' })).status, 401);
      assert.equal((await call('/auth/login', { ...dto, code: '654321' })).status, 401);
      const results = await Promise.all([call('/auth/login', dto), call('/auth/login', dto)]);
      assert.deepEqual(results.map(r => r.status).sort(), [200, 401]);
      const login = results.find(r => r.status === 200).body;
      assert.equal(login.user.id, user.id); assert.deepEqual(login.user.roles, ['USER']);
      assert.equal((await call('/auth/me', null, login.accessToken)).status, 200);
      assert.equal((await call('/admin/articles', null, login.accessToken)).status, 403);
      const session = await db.authSession.findFirstOrThrow({ where: { userId: user.id } });
      assert.equal(session.deviceId, previewSessionDevice); assert.equal(session.expiresAt.toISOString(), process.env.PREVIEW_LOGIN_EXPIRES_AT);
      const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'auth.preview.login' } });
      assert.equal(JSON.stringify(audit.changes).includes('123456'), false);
      assert.equal((await call('/auth/login', dto)).status, 401);
    });
    await t.test('disabling preview immediately invalidates pending codes, access and refresh', async () => {
      const login = await signIn(), dto = await challenge();
      process.env.PREVIEW_LOGIN_ENABLED = 'false';
      try {
        assert.equal((await call('/auth/login', dto)).status, 401);
        assert.equal((await call('/auth/me', null, login.accessToken)).status, 401);
        assert.equal((await call('/auth/refresh', { refreshToken: login.refreshToken })).status, 401);
        assert.equal((await call('/auth/sms', { phone: previewPhone })).status, 503);
      } finally { process.env.PREVIEW_LOGIN_ENABLED = 'true'; }
    });
    await t.test('expiry and changed pinned identity close existing sessions and pending codes', async () => {
      const login = await signIn(), dto = await challenge(), expires = process.env.PREVIEW_LOGIN_EXPIRES_AT;
      process.env.PREVIEW_LOGIN_EXPIRES_AT = new Date(Date.now() - 1).toISOString();
      try {
        assert.equal((await call('/auth/login', dto)).status, 401);
        assert.equal((await call('/auth/me', null, login.accessToken)).status, 401);
        assert.equal((await call('/auth/refresh', { refreshToken: login.refreshToken })).status, 401);
      } finally { process.env.PREVIEW_LOGIN_EXPIRES_AT = expires; }
      process.env.PREVIEW_LOGIN_USER_ID = randomUUID();
      try { assert.equal((await call('/auth/me', null, login.accessToken)).status, 401); assert.equal((await call('/auth/sms', { phone: previewPhone })).status, 503); }
      finally { process.env.PREVIEW_LOGIN_USER_ID = user.id; }
    });
    await t.test('staff promotion or frozen account cannot use a preview session or code', async () => {
      const login = await signIn();
      await db.rateLimit.deleteMany({ where: { key: 'sms-phone-minute:' + phoneLookup(previewPhone) } });
      for (const roles of [['ADMIN'], ['USER', 'TEACHER']]) {
        await db.user.update({ where: { id: user.id }, data: { roles } });
        assert.equal((await call('/auth/sms', { phone: previewPhone })).status, 503);
        assert.equal((await call('/auth/me', null, login.accessToken)).status, 401);
        assert.equal((await call('/auth/refresh', { refreshToken: login.refreshToken })).status, 401);
      }
      await db.user.update({ where: { id: user.id }, data: { roles: ['USER'], status: 'FROZEN' } });
      assert.equal((await call('/auth/sms', { phone: previewPhone })).status, 503);
      assert.equal((await call('/auth/me', null, login.accessToken)).status, 401);
    });
  } finally { await app.close(); await db.$disconnect(); }
});
