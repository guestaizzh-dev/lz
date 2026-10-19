import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomInt } from 'node:crypto';
import { createApp } from '../dist/main.js';
import { Database } from '../dist/database.js';
import {decryptPrivate, phoneLookup} from '../dist/private-data.js';
import { passwordHash } from '../dist/auth.js';
import { clearArticles, clearCourses } from './fixture-cleanup.mjs';

if (process.env.NODE_ENV === 'production') throw new Error('Never run fixture tests against production');
const origin = 'http://127.0.0.1:5173';
process.env.CORS_ORIGINS = origin;
process.env.DEV_OTP_CODE = '123456';

test('real PostgreSQL: publication, permissions, sessions and isolation', async (t) => {
  const db = new Database(), app = await createApp(false);
  // Isolate test traffic counters from the developer's real browser sessions.
  const testIp = '2001:db8:' + randomInt(1, 65535).toString(16) + ':' + randomInt(1, 65535).toString(16) + '::1';
  app.getHttpAdapter().getInstance().set('trust proxy', 'loopback');
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  const prefix = 'qa-' + randomUUID();
  const users = [], articleIds = [], teacherIds = [], courseIds = [], eventIds = [];
  const testPhones = [];
  const password = randomUUID() + 'A!';
  const hash = await passwordHash(password);
  const roleUser = async (role) => {
    const user = await db.user.create({ data: { username: prefix + '-' + role, nickname: 'QA', passwordHash: hash, tags: [], roles: [role] } });
    users.push(user.id); return user;
  };
  async function request(path, options = {}, auth) {
    const res = await fetch(base + '/api/v1' + path, { ...options, headers: { 'Content-Type': 'application/json', Origin: origin, 'X-Forwarded-For': testIp, ...(auth ? { Cookie: auth.cookie, 'X-CSRF-Token': auth.csrfToken } : {}), ...options.headers }, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) });
    return { status: res.status, body: await res.json(), cookies: res.headers.getSetCookie() };
  }
  async function login(user) {
    const res = await request('/admin/auth/login', { method: 'POST', body: { username: user.username, password } });
    assert.equal(res.status, 200);
    assert.ok(res.cookies.filter(value => value.startsWith('daoxue_access=') || value.startsWith('daoxue_refresh=')).every(value => value.includes('HttpOnly') && value.includes('SameSite=Strict')));
    return { cookie: res.cookies.map(value => value.split(';')[0]).join('; '), csrfToken: res.body.csrfToken };
  }
  const article = () => ({ title: prefix + ' 经典阅读', summary: '测试摘要', author: 'QA', source: 'QA integration fixture', cover: '/static/art/books.svg', category: '经典原文', visibility: 'PUBLIC', featured: false, tags: ['测试'], blocks: [{ id: 'paragraph-1', type: 'paragraph', text: 'PRIVATE_BODY_SENTINEL_' + prefix }] });
  try {
    const admin = await roleUser('ADMIN'), operator = await roleUser('OPERATOR'), moderator = await roleUser('MODERATOR'), teacher = await roleUser('TEACHER');
    const adminAuth = await login(admin), operatorAuth = await login(operator), moderatorAuth = await login(moderator), teacherAuth = await login(teacher);
    let appA, appB;
    const newPhone = () => { const phone = '199' + String(randomInt(0, 100000000)).padStart(8, '0'); testPhones.push(phone); return phone; };
    async function appLogin() {
      const phone = newPhone();
      const challenge = await request('/auth/sms', { method: 'POST', body: { phone } });
      assert.equal(challenge.status, 201); assert.equal(challenge.body.channel, 'DEVELOPMENT');
      assert.equal('code' in challenge.body, false);
      const login = await request('/auth/login', { method: 'POST', body: { phone, challengeId: challenge.body.challengeId, code: '123456' } });
      assert.equal(login.status, 200); users.push(login.body.user.id);
      return login.body;
    }
    const appRequest = (path, appAuth, options = {}) => request(path, { ...options, headers: { ...options.headers, Authorization: 'Bearer ' + appAuth.accessToken } });

    await t.test('anonymous, role, CSRF and origin checks operate at HTTP boundary', async () => {
      assert.equal((await request('/admin/articles')).status, 401);
      assert.equal((await request('/admin/articles', {}, teacherAuth)).status, 403);
      assert.equal((await request('/admin/articles', { method: 'POST', body: article(), headers: { 'X-CSRF-Token': '' } }, adminAuth)).status, 403);
      assert.equal((await request('/admin/articles', { method: 'POST', body: article(), headers: { Origin: 'https://untrusted.invalid' } }, adminAuth)).status, 403);
      assert.equal((await request('/admin/auth/login', { method: 'POST', body: { username: admin.username, password }, headers: { Origin: 'https://untrusted.invalid' } })).status, 403);
      assert.equal((await request('/admin/articles', { method: 'POST', body: { ...article(), status: 'PUBLISHED' } }, adminAuth)).status, 400);
      assert.equal((await request('/catalog/articles?size=500')).status, 400);
      assert.equal((await request('/catalog/articles?cursor=bad')).status, 400);
      assert.equal((await db.$queryRawUnsafe("SELECT CURRENT_SETTING('TimeZone') AS zone"))[0].zone, 'UTC');
    });
    await t.test('OTP is phone bound, single use, rate limited and safe under simultaneous login', async () => {
      const phone = newPhone();
      const challenge = await request('/auth/sms', { method: 'POST', body: { phone } }); assert.equal(challenge.status, 201);
      const storedChallenge=await db.otpChallenge.findUniqueOrThrow({where:{id:challenge.body.challengeId}});assert.equal(storedChallenge.phone,'');assert.equal(storedChallenge.phoneHash,phoneLookup(phone));assert.equal(await db.rateLimit.findUnique({where:{key:'sms-phone-minute:'+phone}}),null);
      assert.equal((await request('/auth/sms', { method: 'POST', body: { phone } })).status, 429);
      const body = { phone, challengeId: challenge.body.challengeId, code: '123456' };
      assert.equal((await request('/auth/login', { method: 'POST', body: { ...body, phone: newPhone() } })).status, 401);
      assert.equal((await request('/auth/login', { method: 'POST', body: { ...body, code: '654321' } })).status, 401);
      const results = await Promise.all([request('/auth/login', { method: 'POST', body }), request('/auth/login', { method: 'POST', body })]);
      assert.deepEqual(results.map(result => result.status).sort(), [200, 401]);
      appA = results.find(result => result.status === 200).body; users.push(appA.user.id);
      assert.equal((await appRequest('/auth/me', appA)).body.id, appA.user.id);
      assert.equal((await appRequest('/admin/articles', appA)).status, 403);
      assert.equal((await request('/auth/login', { method: 'POST', body })).status, 401);
      appB = await appLogin();
    });
    await t.test('legacy and encrypted phone login keep identity and never return private ciphers',async()=>{
      const phone=newPhone();
      const legacy=await db.user.create({data:{phone,nickname:'旧账号',roles:['USER'],tags:[]}});users.push(legacy.id);
      async function signIn(){
        await db.rateLimit.deleteMany({where:{key:'sms-phone-minute:'+phoneLookup(phone)}});
        const otp=await request('/auth/sms',{method:'POST',body:{phone}});
        return request('/auth/login',{method:'POST',body:{phone,challengeId:otp.body.challengeId,code:'123456'}});
      }
      const first=await signIn();assert.equal(first.status,200);assert.equal(first.body.user.id,legacy.id);assert.equal(first.body.user.phoneCipher,undefined);assert.equal(first.body.user.phone,undefined);
      const stored=await db.user.findUniqueOrThrow({where:{id:legacy.id}});assert.equal(stored.phone,null);assert.equal(stored.phoneHash,phoneLookup(phone));assert.equal(decryptPrivate(stored.phoneCipher),phone);
      const second=await signIn();assert.equal(second.status,200);assert.equal(second.body.user.id,legacy.id);
      assert.equal(await db.user.count({where:{phoneHash:phoneLookup(phone)}}),1);
    });
    await t.test('expired OTP and maximum attempts cannot be bypassed', async () => {
      const phone = newPhone(); const challenge = await request('/auth/sms', { method: 'POST', body: { phone } });
      const body = { phone, challengeId: challenge.body.challengeId, code: '654321' };
      for (let i = 0; i < 5; i++) assert.equal((await request('/auth/login', { method: 'POST', body })).status, 401);
      assert.equal((await request('/auth/login', { method: 'POST', body: { ...body, code: '123456' } })).status, 401);
      assert.equal((await db.otpChallenge.findUniqueOrThrow({ where: { id: challenge.body.challengeId } })).attempts, 5);
      const other = newPhone(); const expired = await request('/auth/sms', { method: 'POST', body: { phone: other } });
      await db.otpChallenge.update({ where: { id: expired.body.challengeId }, data: { expiresAt: new Date(Date.now() - 1000) } });
      assert.equal((await request('/auth/login', { method: 'POST', body: { phone: other, challengeId: expired.body.challengeId, code: '123456' } })).status, 401);
    });
    await t.test('private notes preserve original quotes and cannot be read or changed by another user', async () => {
      const record = await db.article.create({ data: { ...article(), status: 'PUBLISHED', isDemo: true } }); articleIds.push(record.id);
      const saved = await appRequest('/me/notes', appA, { method: 'POST', body: { articleId: record.id, blockId: 'paragraph-1', text: 'A_PRIVATE_NOTE_' + prefix } });
      assert.equal(saved.status, 201); assert.equal(saved.body.quote, article().blocks[0].text);
      assert.equal((await appRequest('/me/notes', appB)).body.items.length, 0);
      assert.equal((await appRequest('/me/notes/' + saved.body.id, appB, { method: 'PATCH', body: { text: 'stolen' } })).status, 404);
      assert.equal((await appRequest('/me/notes/' + saved.body.id, appB, { method: 'DELETE' })).status, 404);
      assert.equal((await appRequest('/me/notes', appA, { method: 'POST', body: { articleId: record.id, blockId: 'paragraph-1', text: 'test', userId: appB.user.id } })).status, 400);
      await db.article.update({ where: { id: record.id }, data: { version: { increment: 1 }, blocks: [{ id: 'paragraph-new', type: 'paragraph', text: 'replacement' }], status: 'ARCHIVED' } });
      const existing = (await appRequest('/me/notes', appA)).body.items.find(note => note.id === saved.body.id);
      assert.equal(existing.quote, article().blocks[0].text); assert.equal(existing.articleVersion, 1);
      const edited = await appRequest('/me/notes/' + saved.body.id, appA, { method: 'PATCH', body: { text: 'updated private note' } }); assert.equal(edited.status, 200);
    });
    await t.test('favorites are idempotent and private; personal logs are one per Shanghai calendar date', async () => {
      const record = await db.article.create({ data: { ...article(), visibility: 'MEMBER', status: 'PUBLISHED', isDemo: true } }); articleIds.push(record.id);
      const first = await appRequest('/me/favorites/' + record.id, appA, { method: 'PUT' });
      const repeated = await appRequest('/me/favorites/' + record.id, appA, { method: 'PUT' }); assert.equal(first.body.id, repeated.body.id);
      const favorites = (await appRequest('/me/favorites', appA)).body.items;
      assert.equal(favorites.length, 1); assert.equal('blocks' in favorites[0].article, false);
      assert.equal((await appRequest('/me/favorites', appB)).body.items.length, 0);
      assert.equal((await appRequest('/me/notes', appA, { method: 'POST', body: { articleId: record.id, blockId: 'paragraph-1', text: 'member leak' } })).status, 404);
      const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
      const entry = await appRequest('/me/practice', appA, { method: 'PUT', body: { day, text: 'first' } });
      const again = await appRequest('/me/practice', appA, { method: 'PUT', body: { day, text: 'second' } }); assert.equal(entry.body.id, again.body.id);
      assert.equal((await appRequest('/me/practice', appA)).body.items.length, 1);
      assert.equal((await appRequest('/me/practice', appB)).body.items.length, 0);
      assert.equal((await appRequest('/me/practice/' + entry.body.id, appB, { method: 'DELETE' })).status, 404);
      assert.equal((await appRequest('/me/practice', appA, { method: 'PUT', body: { day: '2026-02-30', text: 'invalid' } })).status, 400);
      assert.equal((await appRequest('/me/practice', appA, { method: 'PUT', body: { day: '2999-01-01', text: 'future' } })).status, 400);
    });
    await t.test('App tokens cannot authenticate through admin cookies; App refresh and account closure revoke access', async () => {
      assert.equal((await request('/admin/articles', { headers: { Cookie: 'daoxue_access=' + appB.accessToken } })).status, 403);
      const refreshed = await request('/auth/refresh', { method: 'POST', body: { refreshToken: appB.refreshToken } }); assert.equal(refreshed.status, 200);
      assert.equal((await appRequest('/auth/me', appB)).status, 401); appB = refreshed.body;
      assert.equal((await appRequest('/me/close-account', appB, { method: 'POST', body: { confirmation: 'wrong' } })).status, 400);
      assert.equal((await appRequest('/me/close-account', appB, { method: 'POST', body: { confirmation: '确认注销' } })).status, 201);
      assert.equal((await appRequest('/auth/me', appB)).status, 401);
      assert.equal((await request('/auth/refresh', { method: 'POST', body: { refreshToken: appB.refreshToken } })).status, 401);
      const closed = await db.user.findUniqueOrThrow({ where: { id: appB.user.id } }); assert.equal(closed.phone, null); assert.equal(closed.status, 'DELETED');
    });
    await t.test('missing SMS configuration fails closed and production forbids test codes', async () => {
      const code = process.env.DEV_OTP_CODE; delete process.env.DEV_OTP_CODE;
      const phone = newPhone();
      try { assert.equal((await request('/auth/sms', { method: 'POST', body: { phone } })).status, 503); assert.ok((await db.otpChallenge.findFirstOrThrow({ where: { phoneHash: phoneLookup(phone) } })).consumedAt); }
      finally { process.env.DEV_OTP_CODE = code; }
      const env = process.env.NODE_ENV;
      try { process.env.NODE_ENV = 'production'; await assert.rejects(createApp(false), /forbids DEV_OTP_CODE/); }
      finally { process.env.NODE_ENV = env; }
    });
    await t.test('draft -> review -> published -> archived, with role and version checks', async () => {
      const created = await request('/admin/articles', { method: 'POST', body: article() }, operatorAuth);
      assert.equal(created.status, 201); const id = created.body.id; articleIds.push(id);
      assert.equal((await request('/catalog/articles/' + id)).status, 404);
      assert.equal((await request('/admin/articles/' + id, { method: 'PATCH', body: { ...article(), expectedVersion: 1 } }, moderatorAuth)).status, 403);
      const submitted = await request(`/admin/articles/${id}/transition`, { method: 'POST', body: { action: 'submit', reason: 'QA submit', expectedVersion: 1 } }, operatorAuth);
      assert.equal(submitted.status, 201); assert.equal(submitted.body.version, 2);
      assert.equal((await request(`/admin/articles/${id}/transition`, { method: 'POST', body: { action: 'publish', reason: 'QA unauthorized', expectedVersion: 2 } }, operatorAuth)).status, 403);
      const published = await request(`/admin/articles/${id}/transition`, { method: 'POST', body: { action: 'publish', reason: 'QA approved', expectedVersion: 2 } }, moderatorAuth);
      assert.equal(published.status, 201); assert.equal(published.body.version, 3);
      assert.equal((await request('/catalog/articles/' + id)).body.blocks[0].text, article().blocks[0].text);
      assert.equal((await request('/admin/articles/' + id, { method: 'PATCH', body: { ...article(), expectedVersion: 3 } }, operatorAuth)).status, 409);
      assert.equal((await request(`/admin/articles/${id}/transition`, { method: 'POST', body: { action: 'archive', reason: 'QA archived', expectedVersion: 3 } }, operatorAuth)).status, 201);
      assert.equal((await request('/catalog/articles/' + id)).status, 404);
      assert.equal((await request(`/admin/articles/${id}/transition`, { method: 'POST', body: { action: 'archive', reason: 'QA stale', expectedVersion: 3 } }, operatorAuth)).status, 409);
      const audit = await request(`/admin/articles/${id}/audit`, {}, operatorAuth);
      assert.equal(audit.body.length, 4); assert.ok(audit.body.every(row => row.resourceId === id));
    });
    await t.test('member body never appears in public list/home/detail; demo hidden in production', async () => {
      const row = await db.article.create({ data: { ...article(), status: 'PUBLISHED', visibility: 'MEMBER', isDemo: true, featured: true } }); articleIds.push(row.id);
      const detail = await request('/catalog/articles/' + row.id);
      assert.equal(detail.status, 200); assert.equal(detail.body.access, 'MEMBERSHIP_REQUIRED'); assert.deepEqual(detail.body.blocks, []);
      assert.equal(JSON.stringify((await request('/catalog/home')).body).includes('PRIVATE_BODY_SENTINEL_' + prefix), false);
      assert.equal(JSON.stringify((await request('/catalog/articles?q=' + encodeURIComponent(prefix))).body).includes('PRIVATE_BODY_SENTINEL_' + prefix), false);
      const oldEnv = process.env.NODE_ENV;
      try { process.env.NODE_ENV = 'production'; assert.equal((await request('/catalog/articles/' + row.id)).status, 404); }
      finally { process.env.NODE_ENV = oldEnv; }
    });
    await t.test('cursor pagination is bounded and stable across equal timestamps', async () => {
      const createdAt = new Date();
      for (let i = 0; i < 5; i++) { const row = await db.article.create({ data: { ...article(), title: prefix + '-page-' + i, status: 'PUBLISHED', createdAt, isDemo: true } }); articleIds.push(row.id); }
      const found = []; let cursor = null;
      do {
        const res = await request('/catalog/articles?size=2&q=' + encodeURIComponent(prefix + '-page-') + (cursor ? '&cursor=' + cursor : ''));
        assert.equal(res.status, 200); assert.ok(res.body.items.length <= 2); found.push(...res.body.items.map(row => row.id)); cursor = res.body.nextCursor;
      } while (cursor);
      assert.equal(found.length, 5); assert.equal(new Set(found).size, 5);
    });
    await t.test('a draft teacher and related course cannot leak into catalog', async () => {
      const teacherRow = await db.teacher.create({ data: { name: 'QA', title: 'QA', bio: 'QA', expertise: [], status: 'DRAFT', isDemo: true } }); teacherIds.push(teacherRow.id);
      const course = await db.course.create({ data: { title: prefix, subtitle: 'QA', description: 'QA', category: '经典研习', cover: '/static/art/books.svg', price: 0, tags: [], teacherId: teacherRow.id, status: 'PUBLISHED', isDemo: true } }); courseIds.push(course.id);
      assert.equal((await request('/catalog/teachers/' + teacherRow.id)).status, 404);
      assert.equal((await request('/catalog/teachers?q=QA')).body.items.some(row => row.id === teacherRow.id), false);
      assert.equal((await request('/catalog/courses/' + course.id)).status, 404);
      assert.equal((await request('/catalog/courses?q=' + encodeURIComponent(prefix))).body.items.length, 0);
    });
    await t.test('teacher publication, course filters and event visibility operate at HTTP boundary', async () => {
      const teacher = await db.teacher.create({ data: { name: prefix, title: 'QA', bio: 'QA', expertise: [], status: 'PUBLISHED', isDemo: true } }); teacherIds.push(teacher.id);
      const course = await db.course.create({ data: { title: prefix, subtitle: 'QA', description: 'QA', category: '经典研习', cover: '/static/art/books.svg', price: 0, tags: [], teacherId: teacher.id, format: 'AUDIO', status: 'PUBLISHED', isDemo: true } }); courseIds.push(course.id);
      assert.equal((await request('/catalog/teachers/' + teacher.id)).body.id, teacher.id);
      assert.equal((await request('/catalog/teachers?size=1&q=' + encodeURIComponent(prefix))).body.items[0].id, teacher.id);
      assert.equal((await request('/catalog/courses?teacherId=' + teacher.id + '&format=AUDIO')).body.items[0].id, course.id);
      assert.equal((await request('/catalog/courses?teacherId=' + teacher.id + '&format=VIDEO')).body.items.length, 0);
      assert.equal((await request('/catalog/courses?format=INVALID')).status, 400);
      const event = await db.event.create({ data: { title: prefix, description: 'QA', category: '雅集', cover: '/static/art/tea.svg', location: 'QA', startsAt: new Date(), endsAt: new Date(Date.now()+3600000), capacity: 1, price: 0, status: 'DRAFT', isDemo: true, responsibleUserId: admin.id } }); eventIds.push(event.id);
      assert.equal((await request('/catalog/events/' + event.id)).status, 404);
      assert.equal((await request('/catalog/events?q=' + encodeURIComponent(prefix))).body.items.length, 0);
      await db.event.update({ where: { id: event.id }, data: { status: 'PUBLISHED' } });
      assert.equal((await request('/catalog/events/' + event.id)).body.id, event.id);
      assert.equal((await request('/catalog/events?q=' + encodeURIComponent(prefix))).body.items[0].id, event.id);
    });
    await t.test('refresh rotates both tokens; replay revokes the session family', async () => {
      const original = await login(admin);
      const refreshed = await request('/admin/auth/refresh', { method: 'POST', body: {} }, original);
      assert.equal(refreshed.status, 200);
      const latest = { cookie: refreshed.cookies.map(value => value.split(';')[0]).join('; '), csrfToken: refreshed.body.csrfToken };
      assert.notEqual(latest.cookie, original.cookie);
      assert.equal((await request('/admin/auth/session', {}, original)).status, 401);
      assert.equal((await request('/admin/auth/session', {}, latest)).status, 200);
      assert.equal((await request('/admin/auth/refresh', { method: 'POST', body: {} }, original)).status, 401);
      assert.equal((await request('/admin/auth/session', {}, latest)).status, 401);
    });
    await t.test('logout and frozen accounts immediately revoke access', async () => {
      const session = await login(admin);
      assert.equal((await request('/admin/auth/logout', { method: 'POST', body: {} }, session)).status, 200);
      assert.equal((await request('/admin/auth/session', {}, session)).status, 401);
      await db.user.update({ where: { id: moderator.id }, data: { status: 'FROZEN' } });
      assert.equal((await request('/admin/articles', {}, moderatorAuth)).status, 401);
    });
  } finally {
    await app.close();
    await db.auditLog.deleteMany({ where: { actorId: { in: users } } });
    await clearArticles(db, articleIds);
    await clearCourses(db, courseIds);
    await db.article.deleteMany({ where: { id: { in: articleIds } } });
    await db.course.deleteMany({ where: { id: { in: courseIds } } });
    await db.event.deleteMany({ where: { id: { in: eventIds } } });
    await db.teacher.deleteMany({ where: { id: { in: teacherIds } } });
    const sessions = await db.authSession.findMany({where: {userId: {in: users}}, select: {id: true}});
    await db.consumedRefresh.deleteMany({where: {sessionId: {in: sessions.map(session => session.id)}}});
    await db.authSession.deleteMany({ where: { userId: { in: users } } });
    await db.note.deleteMany({ where: { userId: { in: users } } });
    await db.favorite.deleteMany({ where: { userId: { in: users } } });
    await db.practiceLog.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.otpChallenge.deleteMany({ where: { OR: [{phone: {in: testPhones}}, {phoneHash: {in: testPhones.map(phoneLookup)}}] } });
    await db.rateLimit.deleteMany({ where: { OR: [{ key: { contains: prefix } }, { key: { contains: testIp } }, ...testPhones.map(phone => ({ key: { endsWith: ':' + phoneLookup(phone) } }))] } });
    await db.$disconnect();
  }
});
