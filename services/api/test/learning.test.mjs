import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../dist/main.js';
import { Database } from '../dist/database.js';
import { passwordHash } from '../dist/auth.js';
import { clearArticles, clearCourses, clearPlans } from './fixture-cleanup.mjs';

if (process.env.NODE_ENV === 'production') throw new Error('Fixtures forbidden in production');
test('learning delivery: actual HTTP, PostgreSQL, media, membership and immutable versions', async t => {
  const origin = 'http://127.0.0.1:5173'; process.env.CORS_ORIGINS = origin; process.env.DEV_OTP_CODE = '123456';
  const mediaDir = await mkdtemp(join(tmpdir(), 'daoxue-learning-')); process.env.MEDIA_DIR = mediaDir;
  const db = new Database(), app = await createApp(false);
  app.getHttpAdapter().getInstance().set('trust proxy', 'loopback');
  await app.listen(0, '127.0.0.1'); const base = await app.getUrl();
  const prefix = 'qa-learning-' + randomUUID(), ip = '2001:db8:' + randomInt(1, 65535).toString(16) + '::1';
  const password = randomUUID() + '!A', users = [], courses = [], teachers = [], plans = [], phones = [], mediaIds = [];
  async function call(path, auth, method = 'GET', body) {
    const res = await fetch(base + '/api/v1' + path, { method, headers: { Origin: origin, 'X-Forwarded-For': ip, 'Content-Type': 'application/json', ...(auth?.accessToken ? { Authorization: 'Bearer ' + auth.accessToken } : auth ? { Cookie: auth.cookie, 'X-CSRF-Token': auth.csrfToken } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: res.status, body: await res.json(), cookies: res.headers.getSetCookie() };
  }
  async function admin(role) {
    const user = await db.user.create({ data: { username: prefix + role, nickname: prefix, roles: [role], tags: [], passwordHash: await passwordHash(password) } }); users.push(user.id);
    const res = await call('/admin/auth/login', null, 'POST', { username: user.username, password }); assert.equal(res.status, 200);
    return { cookie: res.cookies.map(c => c.split(';')[0]).join('; '), csrfToken: res.body.csrfToken };
  }
  async function login() {
    const phone = '198' + String(randomInt(0, 100000000)).padStart(8, '0'); phones.push(phone);
    const otp = await call('/auth/sms', null, 'POST', { phone }); assert.equal(otp.status, 201);
    const result = await call('/auth/login', null, 'POST', { phone, challengeId: otp.body.challengeId, code: '123456' }); assert.equal(result.status, 200); users.push(result.body.user.id); return result.body;
  }
  try {
    const root = await admin('ADMIN'), operator = await admin('OPERATOR'), moderator = await admin('MODERATOR');
    const a = await login(), b = await login(); let teacher, course, release, privateLesson, trial, media;
    await t.test('teacher review and course validation use roles, versions and CSRF', async () => {
      teacher = (await call('/admin/teachers', operator, 'POST', { name: prefix, title: '测试编辑', bio: '自动化测试档案', expertise: ['经典'] })).body; teachers.push(teacher.id);
      let result = await call(`/admin/teachers/${teacher.id}/transition`, operator, 'POST', { action: 'submit', expectedVersion: 1, reason: '测试' }); assert.equal(result.status, 201);
      assert.equal((await call(`/admin/teachers/${teacher.id}/transition`, operator, 'POST', { action: 'publish', expectedVersion: 2, reason: '测试' })).status, 403);
      result = await call(`/admin/teachers/${teacher.id}/transition`, moderator, 'POST', { action: 'publish', expectedVersion: 2, reason: '测试' }); assert.equal(result.status, 201);
      assert.equal((await call(`/admin/teachers/${teacher.id}/transition`, moderator, 'POST', { action: 'archive', expectedVersion: 2, reason: '测试' })).status, 403);
      assert.equal((await call('/admin/courses', a, 'POST', {})).status, 403);
    });
    const draft = chapters => ({ title: prefix, subtitle: '测试', description: '仅用于自动化测试', category: '经典研习', format: 'VIDEO', cover: '/static/art/books.svg', price: 100, teacherId: teacher.id, membershipTier: 2, accessDays: null, refundPolicy: '测试退课规则', featured: false, tags: [], chapters });
    const chapter = (title, trial) => ({ title, format: 'TEXT', body: trial ? 'PUBLIC_TRIAL' : 'PRIVATE_DELIVERED_VERSION', durationSeconds: 0, trial, required: true });
    async function publish(row) {
      let result = await call(`/admin/courses/${row.id}/transition`, operator, 'POST', { action: 'submit', expectedVersion: row.version, reason: '测试提交' }); assert.equal(result.status, 201);
      result = await call(`/admin/courses/${row.id}/transition`, moderator, 'POST', { action: 'publish', expectedVersion: result.body.version, reason: '测试审核' }); assert.equal(result.status, 201); return result.body;
    }
    await t.test('private body never leaks; invalid supplied credentials fail closed', async () => {
      const created = await call('/admin/courses', operator, 'POST', draft([chapter('试听', true), chapter('完整章节', false)])); assert.equal(created.status, 201); courses.push(created.body.id);
      course = await publish(created.body);
      release = (await call('/learning/courses/' + course.id)).body; assert.equal(release.lessons.length, 2); trial = release.lessons[0]; privateLesson = release.lessons[1];
      assert.equal(JSON.stringify(release).includes('PRIVATE_DELIVERED_VERSION'), false);
      assert.equal((await call('/learning/lessons/' + trial.id)).body.body, 'PUBLIC_TRIAL');
      assert.equal((await call('/learning/lessons/' + privateLesson.id)).status, 403);
      assert.equal((await call('/learning/courses/' + course.id, { accessToken: 'invalid' })).status, 401);
      assert.equal((await call('/learning/lessons/' + privateLesson.id, b)).status, 403);
      assert.equal((await call('/learning/courses/' + course.id + '/enroll', a, 'POST', {})).status, 400);
      assert.equal((await call(`/admin/courses/${course.id}`, operator, 'PATCH', { ...draft([]), expectedVersion: course.version })).status, 409);
    });
    await t.test('membership expiration and independent course access are separate', async () => {
      const planResult = await call('/admin/memberships/plans', root, 'POST', { title: prefix, tier: 2, days: 30, price: 100, description: '测试套餐', active: true }); assert.equal(planResult.status, 201); const plan = planResult.body; plans.push(plan.id);
      const grant = await call('/admin/memberships/grant', root, 'POST', { userId: b.user.id, planId: plan.id, reason: '测试补偿' }); assert.equal(grant.status, 201);
      assert.equal((await call('/learning/lessons/' + privateLesson.id, b)).status, 200);
      const next = await call('/admin/memberships/grant', root, 'POST', { userId: b.user.id, planId: plan.id, reason: '续期测试' }); assert.equal(next.body.startsAt, grant.body.endsAt);
      const article = await db.article.create({ data: { title: prefix, summary: '会员摘要', category: '经典原文', author: '测试', source: '测试', cover: '/static/art/books.svg', tags: [], blocks: [{ id: 'p1', type: 'paragraph', text: 'MEMBER_PRIVATE' }], visibility: 'MEMBER', membershipTier: 2, status: 'PUBLISHED' } });
      try {
        assert.equal((await call('/catalog/articles/' + article.id)).body.blocks.length, 0);
        assert.equal((await call('/catalog/articles/' + article.id, b)).body.blocks[0].text, 'MEMBER_PRIVATE');
        assert.equal((await call('/me/notes', b, 'POST', { articleId: article.id, blockId: 'p1', text: '私人思考' })).status, 201);
        assert.equal((await call(`/admin/memberships/${grant.body.id}/revoke`, operator, 'POST', { reason: '无权撤销' })).status, 403);
        assert.equal((await call(`/admin/memberships/${grant.body.id}/revoke`, root, 'POST', { reason: '   ' })).status, 400);
        const listed = await call(`/admin/entitlements?kind=membership&userId=${b.user.id}`, root);
        assert.equal(listed.status, 200); assert.equal(listed.body.total, 2); assert.match(listed.body.items[0].user.phone, /^198\*{4}\d{4}$/);
        assert.equal((await call('/admin/entitlements', operator)).status, 403);
        assert.equal((await call(`/admin/memberships/${grant.body.id}/revoke`, root, 'POST', { reason: '撤销测试' })).status, 201);
        assert.equal((await call(`/admin/memberships/${grant.body.id}/revoke`, root, 'POST', { reason: '重复撤销' })).status, 201);
        assert.equal((await call(`/admin/memberships/${next.body.id}/revoke`, root, 'POST', { reason: '撤销待生效' })).status, 201);
        assert.equal(await db.auditLog.count({ where: { resourceId: grant.body.id, action: 'membership.revoke' } }), 1);
        assert.equal((await call('/learning/lessons/' + privateLesson.id, b)).status, 403);
        assert.equal((await call('/catalog/articles/' + article.id, b)).body.blocks.length, 0);
      } finally { await clearArticles(db, [article.id]); await db.article.delete({ where: { id: article.id } }); }
      assert.equal((await call(`/admin/courses/${course.id}/grant`, operator, 'POST', { userId: a.user.id, reason: '测试' })).status, 403);
      assert.equal((await call(`/admin/courses/${course.id}/grant`, root, 'POST', { userId: a.user.id, reason: '补偿授权测试' })).status, 201);
      assert.equal((await call('/learning/lessons/' + privateLesson.id, a)).status, 200);
    });
    await t.test('progress events are idempotent, user bound and completion is monotonic', async () => {
      const body = { eventId: randomUUID(), positionSeconds: 0, elapsedSeconds: 0, completed: true };
      const results = await Promise.all([call(`/learning/lessons/${privateLesson.id}/progress`, a, 'POST', body), call(`/learning/lessons/${privateLesson.id}/progress`, a, 'POST', body)]);
      assert.deepEqual(results.map(r => r.status), [201, 201]); assert.deepEqual(results[0].body, results[1].body); assert.ok(results[0].body.completedAt);
      assert.equal((await call(`/learning/lessons/${privateLesson.id}/progress`, a, 'POST', { ...body, completed: false })).status, 409);
      const next = await call(`/learning/lessons/${privateLesson.id}/progress`, a, 'POST', { ...body, eventId: randomUUID(), completed: false }); assert.equal(next.body.completedAt, results[0].body.completedAt);
      assert.equal((await call(`/learning/lessons/${privateLesson.id}/progress`, b, 'POST', body)).status, 403);
      assert.equal((await call('/learning/library', a)).body.items[0].lessons[1].progress.completedAt, results[0].body.completedAt);
    });
    await t.test('course archive and republish retain delivered versions', async () => {
      let row = (await call(`/admin/courses/${course.id}/transition`, operator, 'POST', { action: 'archive', expectedVersion: course.version, reason: '测试' })).body;
      assert.equal((await call('/learning/lessons/' + privateLesson.id)).status, 404);
      assert.equal((await call('/learning/lessons/' + privateLesson.id, a)).body.body, 'PRIVATE_DELIVERED_VERSION');
      row = (await call(`/admin/courses/${course.id}/transition`, operator, 'POST', { action: 'revise', expectedVersion: row.version, reason: '测试修订' })).body;
      row = (await call('/admin/courses/' + course.id, operator, 'PATCH', { ...draft([{ ...chapter('新版', true), body: 'NEW_RELEASE' }]), expectedVersion: row.version })).body;
      course = await publish(row);
      assert.notEqual(course.publishedReleaseId, release.releaseId);
      assert.equal((await call('/learning/courses/' + course.id, a)).body.releaseId, release.releaseId);
      assert.equal((await call('/learning/lessons/' + privateLesson.id, a)).body.body, 'PRIVATE_DELIVERED_VERSION');
      assert.equal((await call('/learning/lessons/' + privateLesson.id)).status, 403);
    });
    await t.test('free enrollment is concurrent safe; media credentials enforce entitlement and range', async () => {
      // Container header fixture tests delivery bytes, not media decoding.
      const bytes = Buffer.concat([Buffer.from([0,0,0,16]), Buffer.from('ftypisom'), randomBytes(16)]);
      const data = new FormData(); data.append('file', new Blob([bytes], { type: 'video/mp4' }), 'qa.mp4');
      const uploaded = await fetch(base + '/api/v1/admin/media', { method: 'POST', headers: { Origin: origin, Cookie: operator.cookie, 'X-CSRF-Token': operator.csrfToken }, body: data }); assert.equal(uploaded.status, 201); media = await uploaded.json(); mediaIds.push(media.id); assert.equal('storageKey' in media, false);
      const created = await call('/admin/courses', operator, 'POST', { ...draft([{ title: '媒体', format: 'VIDEO', body: '', mediaId: media.id, durationSeconds: 30, trial: false, required: true }]), price: 0 }); assert.equal(created.status, 201); courses.push(created.body.id);
      const free = await publish(created.body); const curriculum = (await call('/learning/courses/' + free.id)).body; const lessonId = curriculum.lessons[0].id;
      assert.equal((await call(`/learning/lessons/${lessonId}/media`, null, 'POST', {})).status, 403);
      const enrollments = await Promise.all([call(`/learning/courses/${free.id}/enroll`, b, 'POST', {}), call(`/learning/courses/${free.id}/enroll`, b, 'POST', {})]); assert.equal(enrollments[0].body.id, enrollments[1].body.id);
      const token = (await call(`/learning/lessons/${lessonId}/media`, b, 'POST', {})).body;
      const range = await fetch(base + '/api/v1' + token.path, { headers: { Range: 'bytes=4-7' } }); assert.equal(range.status, 206); assert.equal(await range.text(), 'ftyp');
      assert.equal((await fetch(base + '/api/v1' + token.path, { headers: { Range: 'bytes=9999-' } })).status, 416);
      const progress = await call(`/learning/lessons/${lessonId}/progress`, b, 'POST', { eventId: randomUUID(), positionSeconds: 30, elapsedSeconds: 30, completed: true }); assert.equal(progress.body.watchedSeconds, 0); assert.equal(progress.body.completedAt, null);
      assert.equal((await call(`/admin/enrollments/${enrollments[0].body.id}/revoke`, root, 'POST', { reason: '撤销媒体课程测试' })).status, 201);
      assert.equal((await fetch(base + '/api/v1' + token.path)).status, 403);
      assert.equal((await fetch(base + '/api/v1' + token.path + 'tampered')).status, 401);
      assert.ok(await db.auditLog.count({ where: { resource: 'course', resourceId: course.id, action: 'course.publish' } }) >= 2);
    });
  } finally {
    await app.close();
    await db.note.deleteMany({ where: { userId: { in: users } } });
    await db.enrollment.deleteMany({ where: { userId: { in: users } } });
    await db.membership.deleteMany({ where: { userId: { in: users } } });
    await clearCourses(db, courses);
    await clearPlans(db, plans);
    await db.course.deleteMany({ where: { id: { in: courses } } });
    await db.teacher.deleteMany({ where: { id: { in: teachers } } });
    await db.membershipPlan.deleteMany({ where: { id: { in: plans } } });
    await db.mediaAsset.deleteMany({ where: { id: { in: mediaIds } } });
    await db.authSession.deleteMany({ where: { userId: { in: users } } });
    await db.auditLog.deleteMany({ where: { actorId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.otpChallenge.deleteMany({ where: { phone: { in: phones } } });
    await db.rateLimit.deleteMany({ where: { OR: [{ key: { contains: prefix } }, { key: { contains: ip } }, ...phones.map(phone => ({ key: { endsWith: ':' + phone } }))] } });
    await db.$disconnect(); await rm(mediaDir, { recursive: true, force: true });
  }
});
