// Local manual fixtures use the same business transitions as the application.
import 'reflect-metadata';
import {randomUUID, createHash} from 'node:crypto';
import {readFile, writeFile, mkdir, open, unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createApp} from '../dist/main.js';
import {Database} from '../dist/database.js';
import {encryptPrivate, phoneLookup} from '../dist/private-data.js';
import {AdminService} from '../dist/admin.js';
import {AdminManagement} from '../dist/admin-management.js';
import {AdminPermissions} from '../dist/admin-permissions.js';
import {DomainService} from '../dist/domain.js';
import {CurriculumAdminService, CurriculumAdminController} from '../dist/curriculum-admin.js';
import {EventsAdmin} from '../dist/events-admin.js';
import {ShoppingService} from '../dist/shopping.js';
import {OrdersService} from '../dist/orders.js';
import {TeachingService} from '../dist/teaching.js';
import {PracticesService} from '../dist/practices.js';
import {QuestionsService} from '../dist/questions.js';
import {FeedbackService} from '../dist/feedback.js';
import {ContentService} from '../dist/content.js';
import {PersonalController} from '../dist/personal.js';
import {ForumService} from '../dist/forum.js';
import {LearningService} from '../dist/learning.js';
import {CourseReviewsService} from '../dist/course-reviews.js';
import {EditorialController, LiveDiscoveryAdminController} from '../dist/editorial.js';
import {MediaService} from '../dist/media.js';
import {SystemConfig, configDefaults} from '../dist/system-config.js';

const target = new URL(process.env.DATABASE_URL ?? '');
if (process.env.NODE_ENV === 'production' || !['localhost', '127.0.0.1', '::1', '[::1]'].includes(target.hostname)) {
  throw Error('手动测试数据只允许写入本机开发数据库');
}
const root = resolve('../..');
const runtime = resolve(process.env.MANUAL_TEST_RUNTIME_DIR ?? resolve(root, '.runtime'));
const output = resolve(process.env.MANUAL_TEST_OUTPUT_DIR ?? resolve(root, 'outputs/manual-test-data'));
const manifestPath = resolve(runtime, 'manual-test-manifest.json');
const fingerprint = createHash('sha256').update(target.host + target.pathname).digest('hex');
await mkdir(runtime, {recursive: true});
const lockPath = resolve(runtime, 'manual-test-seed.lock');
const lock = await open(lockPath, 'wx');
let app;
try {
  let manifest;
  try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  manifest ??= {version: 1, fingerprint, createdAt: new Date().toISOString(), steps: {}};
  if (manifest.fingerprint !== fingerprint || manifest.version !== 1) throw Error('测试清单属于另一数据库或版本，请先确认数据环境');
  async function save() { await writeFile(manifestPath, JSON.stringify(manifest, null, 2)); }
  // Keep only ids and stage markers, never passwords, tokens or private payloads.
  async function once(key, operation) {
    if (Object.hasOwn(manifest.steps, key)) return manifest.steps[key];
    try {
      const row = await operation();
      const value = row?.id ? {id: row.id} : {done: true};
      manifest.steps[key] = value;
      delete manifest.error;
      await save();
      return value;
    } catch (error) {
      manifest.error = {step: key, message: error.message, at: new Date().toISOString()};
      await save();
      throw Error(`${key}: ${error.message}`, {cause: error});
    }
  }
  app = await createApp(false);
  const db = app.get(Database);
  const admin = await db.user.findUnique({where: {username: 'admin'}});
  if (!admin?.roles.includes('ADMIN') || admin.status !== 'ACTIVE') throw Error('请先初始化有效 admin 管理员，不会修改其密码');
  const req = actor => ({actor, headers: {}, permissions: [], requestId: randomUUID()});
  const adminReq = req(admin);
  adminReq.permissions = await app.get(AdminPermissions).resolve(admin.roles);
  const reason = '规范手动测试数据初始化；非真实运营事实';
  const management = app.get(AdminManagement), domain = app.get(DomainService);
  const articles = app.get(AdminService), curriculum = app.get(CurriculumAdminService);
  const teacherAdmin = app.get(CurriculumAdminController), events = app.get(EventsAdmin);
  const shopping = app.get(ShoppingService), teaching = app.get(TeachingService);
  const practices = app.get(PracticesService), learning = app.get(LearningService);
  const personal = app.get(PersonalController), content = app.get(ContentService);
  const forum = app.get(ForumService), questions = app.get(QuestionsService);
  const feedback = app.get(FeedbackService), editorial = app.get(EditorialController);
  const user = {};
  const staff = [
    ['operator', 'operator.demo', '运营测试账号', 'OPERATOR'],
    ['moderator', 'moderator.demo', '审核测试账号', 'MODERATOR'],
    ['teacher', 'teacher.demo', '经典课程老师', 'TEACHER'],
    ['otherTeacher', 'teacher.other', '生活课程老师', 'TEACHER'],
    ['support', 'support.demo', '客服测试账号', 'SUPPORT'],
    ['finance', 'finance.demo', '财务测试账号', 'FINANCE'],
  ];
  for (const [key, username, nickname, role] of staff) {
    const reference = await once(`user.${key}`, async () => {
      if (await db.user.findUnique({where: {username}})) throw Error(`账号 ${username} 已存在但不属于本测试清单，拒绝覆盖`);
      return management.createUser(adminReq, {username, nickname, password: 'DaoxueTest2026!', reason});
    });
    await once(`role.${key}`, () => domain.roleAction(adminReq, {userId: reference.id, role, reason}));
    user[key] = await db.user.findUniqueOrThrow({where: {id: reference.id}});
  }
  const learners = [
    ['new', '19900001001', '初学·未加入课程'],
    ['student', '19900001002', '研习·在读学员'],
    ['member', '19900001003', '进阶·有效会员'],
    ['graduate', '19900001004', '研习·结业学员'],
    ['expired', '19900001005', '会员·已到期'],
    ['revoked', '19900001006', '课程·已撤权'],
    ['frozen', '19900001007', '账号·已停用'],
  ];
  for (const [key, phone, nickname] of learners) {
    const reference = await once(`user.${key}`, async () => {
      if (await db.user.findFirst({where: {OR: [{phone}, {phoneHash: phoneLookup(phone)}]}})) throw Error(`手机号 ${phone} 已存在但不属于本测试清单，拒绝覆盖`);
      return db.$transaction(async tx => {
        const row = await tx.user.create({data: {phone: null, phoneHash: phoneLookup(phone), phoneCipher: encryptPrivate(phone), nickname, roles: ['USER'], tags: ['经典研习', '生活应用']}});
        await tx.auditLog.create({data: {actorId: admin.id, action: 'manual.fixture.user.create', resource: 'app_user', resourceId: row.id, reason, changes: {nickname}}});
        return row;
      });
    });
    user[key] = await db.user.findUniqueOrThrow({where: {id: reference.id}});
  }
  async function demo(model, id) {
    await db.$transaction(async tx => {
      await tx[model].update({where: {id}, data: {isDemo: true}});
      await tx.auditLog.create({data: {actorId: admin.id, action: 'manual.fixture.label', resource: model, resourceId: id, reason, changes: {isDemo: true}}});
    });
  }
  async function publish(key, model, id, desired, transition) {
    const actions = {DRAFT: [], REVIEW: ['submit'], REJECTED: ['submit', 'reject'], PUBLISHED: ['submit', 'publish'], ARCHIVED: ['submit', 'publish', 'archive']}[desired];
    for (const action of actions) await once(`${key}.${action}`, async () => {
      const row = await db[model].findUniqueOrThrow({where: {id}});
      return transition(id, {action, expectedVersion: row.version, reason});
    });
  }
  const teachers = [];
  for (const [index, [name, title, expertise, status, account]] of [
    ['清和老师（测试）', '经典研习导师', ['经典研习', '名师解读'], 'PUBLISHED', 'teacher'],
    ['知行老师（测试）', '生活实践导师', ['生活应用', '实践修行'], 'PUBLISHED', 'otherTeacher'],
    ['童蒙老师（测试）', '亲子阅读导师', ['少儿启蒙'], 'REVIEW', null],
  ].entries()) {
    const row = await once(`teacher.${index}`, () => teacherAdmin.teacher({name, title, expertise, bio: '本档案为手动测试专用虚拟老师。验证介绍、课程关联、教学归属及问答，不代表真实授课资质。'}, adminReq));
    await once(`teacher.${index}.label`, async () => {
      await demo('teacher', row.id);
      if (account) await db.teacher.update({where: {id: row.id}, data: {userId: user[account].id}});
    });
    await publish(`teacher.${index}`, 'teacher', row.id, status, (id, dto) => teacherAdmin.teacherTransition(id, dto, adminReq));
    teachers.push(row.id);
  }
  await once('media.generate', async () => { execFileSync(process.env.MANUAL_TEST_PYTHON ?? 'python', [resolve(root, 'scripts/manual-test-media.py'), resolve(runtime, 'manual-test-media')], {stdio: 'inherit'}); });
  const assets = {};
  for (const [key, file, mime, name] of [
    ['audio', 'audio.wav', 'audio/wav', '静心练习·播放测试音频（20秒）.wav'],
    ['video', 'video.mp4', 'video/mp4', '上善若水·播放测试视频（20秒）.mp4'],
    ['forum', 'study.png', 'image/png', '经典研习·讨论配图.png'],
    ['homework', 'study.png', 'image/png', '研习作业·观察记录.png'],
  ]) {
    const image = mime.startsWith('image/');
    const row = await once(`media.${key}`, async () => {
      const buffer = await readFile(resolve(runtime, 'manual-test-media', file));
      return app.get(MediaService).upload(image ? req(user.student) : adminReq, {buffer, originalname: name, mimetype: mime, size: buffer.length}, image, image ? key === 'forum' ? 'FORUM_IMAGE' : 'SUBMISSION_IMAGE' : undefined);
    });
    assets[key] = row.id;
  }
  const quote = '上善若水。水善利万物而不争，处众人之所恶，故几于道。';
  const articleSpecs = [
    ['上善若水：从第八章开始读老子', '经典原文', 'mountains', 'PUBLISHED', 'PUBLIC', 1],
    ['致虚守静：第十六章阅读札记', '经典原文', 'meditation', 'PUBLISHED', 'PUBLIC', 1],
    ['一盏茶的时间，练习专注', '实践心得', 'tea', 'PUBLISHED', 'PUBLIC', 1],
    ['经典研读的方法：先原文，再观察', '道学常识', 'books', 'PUBLISHED', 'PUBLIC', 1],
    ['进阶研习：不争与日常选择', '名师解读', 'books', 'PUBLISHED', 'MEMBER', 2],
    ['长文研读：在生活中理解道法自然', '名师解读', 'mountains', 'PUBLISHED', 'PUBLIC', 1],
    ['亲子共读：以水为喻', '实践心得', 'tea', 'DRAFT', 'PUBLIC', 1],
    ['养生交流：建立规律作息', '道学常识', 'meditation', 'REVIEW', 'PUBLIC', 1],
    ['待修订：经典引用的版本说明', '经典原文', 'books', 'REJECTED', 'PUBLIC', 1],
    ['历史专题：秋日读书会回顾', '实践心得', 'tea', 'ARCHIVED', 'PUBLIC', 1],
  ];
  const articleIds = [];
  for (const [index, [title, category, art, state, visibility, membershipTier]] of articleSpecs.entries()) {
    const blocks = [
      {id: 'original', type: 'quote', text: index === 1 ? '致虚极，守静笃。万物并作，吾以观复。' : quote},
      {id: 'observation', type: 'paragraph', text: '研习时先读原文，再写下观察：“不争”在我的日常生活中意味着什么？面对分歧，可以先把对方的话听完整，再表达自己的想法。本文解读为测试编辑样例，非权威译注。'},
      {id: 'practice', type: 'paragraph', text: '今日练习：选择一件可以从容完成的小事，专注于过程。结束后记录一个疑问和一次感受。可以选中原文添加私人笔记，也可以引用段落参与讨论。'},
    ];
    if (index === 5) for (let paragraph = 1; paragraph <= 24; paragraph++) blocks.push({id: `long-${paragraph}`, type: 'paragraph', text: `研习札记 ${paragraph}：读经典需要联系上下文，不急于把一句话当作所有问题的答案。留意水流经过石头时的路径，观察自己的注意力如何变化，再记下一次具体的生活体验。此长文用于测试滚动、连续选文、复制、跨段笔记和返回阅读位置。`});
    const row = await once(`article.${index}`, () => articles.save(adminReq, {title, summary: '手动测试内容：原文阅读、选文笔记、评论审核及内容关联。', category, author: '书院测试编辑', source: '《道德经》通行本；解读为原创测试样例，非真实名师署名', cover: `/static/art/${art}.svg`, blocks, tags: ['经典研习', index === 2 ? '实践修行' : '生活应用'], visibility, membershipTier, featured: index < 3}));
    await once(`article.${index}.label`, () => demo('article', row.id));
    await publish(`article.${index}`, 'article', row.id, state, (id, dto) => articles.transition(adminReq, id, dto));
    articleIds.push(row.id);
  }
  const textChapter = (title, trial = true, required = true) => ({title, format: 'TEXT', body: `${quote}\n\n研习提示：观察水的意象，写下一个疑问。此章节为手动测试图文课件，不代替真实授课。`, durationSeconds: 0, trial, required});
  const audioChapter = (trial = false) => ({title: '静心练习·音频课件', format: 'AUDIO', body: '20秒低音量合成音，用于播放、暂停和进度测试，不是授课录音。', mediaId: assets.audio, durationSeconds: 20, trial, required: false});
  const videoChapter = {title: '上善若水·视频课件', format: 'VIDEO', body: '20秒本地生成的视频样本，测试字幕说明、播放及进度，不是授课录像。', mediaId: assets.video, durationSeconds: 20, trial: false, required: false};
  const courseSpecs = [
    ['道德经入门：图文音频视频研习', '经典研习', 'VIDEO', 9900, 'books', 'PUBLISHED', 0, null, [textChapter('第八章·图文试听'), textChapter('课后观察·付费图文', false), audioChapter(), videoChapter]],
    ['上善若水：免费图文入门', '经典研习', 'VIDEO', 0, 'mountains', 'PUBLISHED', 0, null, [textChapter('先读原文'), textChapter('从原文到生活', false)]],
    ['一盏茶的时间：日常静心音频', '实践修行', 'AUDIO', 4900, 'tea', 'PUBLISHED', 1, null, [audioChapter(true), textChapter('记录一次专注', false)]],
    ['道法自然：进阶会员研习', '生活应用', 'VIDEO', 6900, 'meditation', 'PUBLISHED', 1, 2, [textChapter('课程导读'), textChapter('会员研习内容', false), videoChapter]],
    ['亲子共读：水的故事', '少儿启蒙', 'VIDEO', 3900, 'tea', 'DRAFT', 0, null, [textChapter('亲子阅读提纲')]],
    ['待审核：经典晨读训练', '经典研习', 'AUDIO', 2900, 'books', 'REVIEW', 0, null, [audioChapter(true)]],
    ['待修订：生活中的道意', '生活应用', 'VIDEO', 5900, 'mountains', 'REJECTED', 1, null, [textChapter('课程说明')]],
    ['已下架：秋日研习专题', '实践修行', 'AUDIO', 1900, 'meditation', 'ARCHIVED', 1, null, [audioChapter(true)]],
  ];
  const courseIds = [];
  for (const [index, [title, category, format, price, art, state, teacher, membershipTier, chapters]] of courseSpecs.entries()) {
    const row = await once(`course.${index}`, () => curriculum.save(adminReq, {title, subtitle: '规范手动测试课程，按章节类型和权限进行研习', description: '本课程用于验证课件、试听、加入、权限、作业、实践及评价流程。所有老师与教学内容均为测试样例。标价是售前展示测试，不代表已发生收款。', category, format, price, cover: `/static/art/${art}.svg`, teacherId: teachers[teacher], membershipTier, accessDays: 365, refundPolicy: '默认7日内且未打开付费章节可申请退课；真实支付渠道尚未配置，本数据不提供已支付记录。', tags: [...new Set([category, '生活应用'])], featured: index < 3, chapters}));
    await once(`course.${index}.label`, () => demo('course', row.id));
    await publish(`course.${index}`, 'course', row.id, state, (id, dto) => curriculum.transition(adminReq, id, dto));
    courseIds.push(row.id);
  }
  for (const [courseIndex, teacher] of [[0, 'teacher'], [1, 'teacher'], [2, 'otherTeacher'], [3, 'otherTeacher']]) await once(`staff.${courseIndex}`, () => teaching.staff(adminReq, courseIds[courseIndex], {userId: user[teacher].id, role: 'TEACHER', reason}));
  for (const [key, index] of [['student', 0], ['graduate', 0], ['revoked', 0]]) await once(`grant.${key}.${index}`, () => curriculum.grant(adminReq, courseIds[index], {userId: user[key].id, reason}));
  await once('grant.revoked.revoke', async () => {
    const row = await db.enrollment.findUniqueOrThrow({where: {userId_courseId: {userId: user.revoked.id, courseId: courseIds[0]}}});
    return curriculum.revoke(adminReq, 'course', row.id, reason);
  });
  const plans = [];
  for (const [index, [title, tier, days, price, active]] of [
    ['入门月卡（测试）', 1, 30, 1900, true], ['进阶季卡（测试）', 2, 90, 12900, true], ['至尊年卡（测试）', 3, 365, 89900, true], ['历史入门季卡（已停用）', 1, 90, 4900, false],
  ].entries()) plans.push((await once(`plan.${index}`, async () => { const current=await db.membershipPlan.findUnique({where:{tier_days:{tier,days}}}); return curriculum.plan(adminReq, {title, tier, days, price, active, description: '手动测试会员套餐；后台授予测试权益，不代表购买或收款。',...(current?{expectedVersion:current.version}:{})}); })).id);
  for (const key of ['member', 'expired']) await once(`membership.${key}`, () => curriculum.memberGrant(adminReq, {userId: user[key].id, planId: plans[1], reason}));
  await once('membership.expired.date', async () => {
    const row = await db.membership.findFirstOrThrow({where: {userId: user.expired.id}});
    await db.$transaction(async tx => {
      await tx.membership.update({where: {id: row.id}, data: {startsAt: new Date(Date.now() - 100 * 86400000), endsAt: new Date(Date.now() - 86400000)}});
      await tx.auditLog.create({data: {actorId: admin.id, action: 'manual.fixture.membership.expired', resource: 'membership', resourceId: row.id, reason, changes: {scenario: '到期会员'}}});
    });
  });
  await once('user.frozen.freeze', () => management.userAction(adminReq, user.frozen.id, {action: 'freeze', expectedVersion: user.frozen.version, reason}));
  const lessons = await db.lesson.findMany({where: {releaseId: (await db.course.findUniqueOrThrow({where: {id: courseIds[0]}})).publishedReleaseId}, orderBy: {position: 'asc'}});
  for (const key of ['student', 'graduate']) await once(`progress.${key}.0`, () => learning.progress(lessons[0].id, user[key].id, {eventId: randomUUID(), positionSeconds: 0, elapsedSeconds: 0, completed: true}));
  await once('progress.graduate.1', () => learning.progress(lessons[1].id, user.graduate.id, {eventId: randomUUID(), positionSeconds: 0, elapsedSeconds: 0, completed: true}));
  await once('enroll.free.student', () => learning.enroll(courseIds[1], user.student.id));
  const freeLessons = await db.lesson.findMany({where: {releaseId: (await db.course.findUniqueOrThrow({where: {id: courseIds[1]}})).publishedReleaseId}});
  await once('enroll.free.graduate', () => learning.enroll(courseIds[1], user.graduate.id));
  for (const lesson of freeLessons) await once(`progress.free.graduate.${lesson.position}`, () => learning.progress(lesson.id, user.graduate.id, {eventId: randomUUID(), positionSeconds: 0, elapsedSeconds: 0, completed: true}));
  await once('certificate.graduate', () => learning.certificate(courseIds[1], user.graduate.id));
  for (const [key, state, body] of [['student', 'APPROVE', '图文、音频和视频在同一目录，试听和权限说明清楚。'], ['graduate', null, '完成原文与生活观察，期待补充更多练习案例。']]) {
    const review = await once(`course.review.${key}`, () => app.get(CourseReviewsService).submit(courseIds[0], user[key].id, {expectedVersion: 0, rating: 5, body}));
    if (state) await once(`course.review.${key}.approve`, () => app.get(CourseReviewsService).moderate(review.id, adminReq, {expectedVersion: 1, action: state, reason}));
  }
  const assignments = [];
  for (const [index, [title, state]] of [['原文观察：水的意象', 'PUBLISHED'], ['生活记录：一次从容的选择', 'PUBLISHED'], ['扩展研习：阅读版本比较', 'DRAFT'], ['已结束：入门阅读分享', 'CLOSED']].entries()) {
    const row = await once(`assignment.${index}`, () => teaching.saveAssignment(adminReq, courseIds[0], {title, instructions: '引用一句原文，结合一次具体的生活经历写100字左右观察。可附一张记录图片。测试样例作业，不要求填写真实个人信息。', required: index === 0, dueAt: new Date(Date.now() + 14 * 86400000).toISOString()}));
    if (state !== 'DRAFT') await once(`assignment.${index}.publish`, () => teaching.transition(adminReq, row.id, {action: 'publish', expectedVersion: 1, reason}));
    if (state === 'CLOSED') await once(`assignment.${index}.close`, () => teaching.transition(adminReq, row.id, {action: 'close', expectedVersion: 2, reason}));
    assignments.push(row.id);
  }
  const teacherReq = req(user.teacher);
  const returned = await once('submission.student.returned', () => teaching.submit(user.student, assignments[0], {requestKey: randomUUID(), expectedRevision: 0, body: '水很柔和，我觉得可以从水中学习。', assetIds: []}));
  await once('submission.student.return', () => teaching.review(teacherReq, returned.id, {expectedVersion: 1, reason, body: '请补充一个具体生活场景，再结合原文说明观察。', outcome: 'RETURNED'}));
  await once('submission.student.resubmit', () => teaching.submit(user.student, assignments[0], {requestKey: randomUUID(), expectedRevision: 1, body: '今天讨论读书安排时，我先听完学友的意见，再说明自己的时间限制。联系“水善利万物而不争”，我理解为保持清晰表达，同时给对方充分空间。', assetIds: [assets.homework]}));
  const reviewed = await once('submission.graduate', () => teaching.submit(user.graduate, assignments[0], {requestKey: randomUUID(), expectedRevision: 0, body: '我选择放慢整理书桌的节奏，先观察物品用途，再决定位置。原文中的“居善地”提醒我注意具体情境，不把一句话理解成机械规则。', assetIds: []}));
  await once('submission.graduate.review', () => teaching.review(teacherReq, reviewed.id, {expectedVersion: 1, reason, body: '观察具体，引用与生活经历的联系清楚。继续保持。', score: 92, outcome: 'REVIEWED'}));
  const tasks = [];
  for (const [index, [title, days]] of [['七日晨读：每日一个观察', 7], ['一日实践：专注泡茶', 1]].entries()) tasks.push((await once(`practice.task.${index}`, () => practices.create(courseIds[0], adminReq, {title, instructions: '记录今日阅读的一句原文与一个具体感受，不填写私人敏感信息。', requiredDays: days, required: false}))).id);
  const checkin = await once('checkin.student', () => practices.checkin(tasks[0], user.student.id, {body: '今天读第八章，留意“居善地”。我整理了阅读角，减少干扰，读书时更加专注。', assetIds: []}));
  await once('checkin.student.review', () => practices.review(checkin.id, teacherReq, {expectedVersion: 1, body: '从阅读环境入手很具体，明天继续观察。', score: 90}));
  await once('checkin.graduate', () => practices.checkin(tasks[1], user.graduate.id, {body: '泡茶时专注于水温与动作，结束后记录一次注意力变化。', assetIds: []}));
  const currentArticle = await db.article.findUniqueOrThrow({where: {id: articleIds[0]}});
  for (const [index, text] of ['“不争”不是放弃表达，可以先完整倾听。', '', '将经典联系到今天的一次具体经历。'].entries()) await once(`note.${index}`, () => personal.note({articleId: articleIds[0], articleVersion: currentArticle.version, blockId: index === 2 ? 'practice' : 'original', rangeStart: 0, rangeEnd: index === 2 ? 5 : 4, text}, req(user.student)));
  for (const [index, text] of ['今日晨读第八章，记录一个疑问：在讨论中如何既不争又把意思说明白？', '泡茶时放下手机，专注于动作，结束后感觉思绪更清晰。', '复习自己的选文笔记，将问题整理好，准备向老师请教。'].entries()) await once(`journal.${index}`, () => personal.record({day: new Date(Date.now() - index * 86400000).toLocaleDateString('en-CA', {timeZone: 'Asia/Shanghai'}), text, expectedVersion: 0}, req(user.student)));
  for (const [index, id] of articleIds.slice(0, 4).entries()) {
    await once(`reading.${index}`, () => content.reading(id, user.student.id, {eventKey: `manual-reading-${index}`, dwellSeconds: 60 + index * 30}));
    if (index < 2) {
      await once(`like.${index}`, () => content.like(id, user.student.id));
      await once(`favorite.${index}`, () => personal.favorite(id, req(user.student)));
    }
  }
  let parentComment;
  for (const [index, [body, state, key]] of [
    ['“不争”与表达自己的观点可以同时做到吗？', 'APPROVED', 'student'],
    ['我会先听完整，再用具体例子说明自己的理解。', 'APPROVED', 'graduate'],
    ['希望补充不同版本的对照说明。', null, 'member'],
    ['此评论是审核退回场景样例，请勿发布。', 'REJECTED', 'new'],
  ].entries()) {
    const row = await once(`comment.${index}`, () => content.createComment(articleIds[0], user[key].id, {body, ...(index === 0 ? {quotedBlockId: 'original', articleVersion: currentArticle.version, quotedRanges: [{blockId: 'original', rangeStart: 0, rangeEnd: 4}]} : index === 1 ? {parentId: parentComment} : {})}));
    if (index === 0) parentComment = row.id;
    if (state) await once(`comment.${index}.review`, () => content.moderate(row.id, adminReq, {state, expectedVersion: 1, reason}));
  }
  await once('article.report', () => content.report(articleIds[0], user.member.id, {reason: 'OTHER', description: '测试举报：建议补充原文版本说明，请按测试流程处理。'}));
  const evidence = await once('article.evidence.source', () => editorial.addEvidence(articleIds[0], {kind: 'SOURCE', title: '通行本原文来源说明（测试）', author: '老子', edition: '《道德经》通行本', sourceUrl: 'https://zh.wikisource.org/wiki/道德經', rightsHolder: '古籍原文；现代解读为测试编辑样例', licenseScope: '仅用于手动测试来源显示。该记录不是现代注释版本的真实授权凭证。'}, adminReq));
  await once('article.evidence.approve', () => editorial.review(articleIds[0], evidence.id, {expectedVersion: 1, state: 'APPROVED', reason}, adminReq));
  await once('article.evidence.pending', () => editorial.addEvidence(articleIds[0], {kind: 'ANNOTATION', title: '测试解读版本·待核验', author: '书院测试编辑', edition: '手动测试样例第一版', sourceUrl: 'https://example.com/manual-test-annotation', rightsHolder: '测试占位，非真实授权主体', licenseScope: '待审核测试记录，不得作为正式版权证明。'}, adminReq));
  await once('article.course.relation', () => editorial.relate(articleIds[0], {toId: courseIds[0], type: 'COURSE', rank: 1, reason}, adminReq));
  const productIds = [], skuIds = [];
  for (const [index, [title, category, type, price, art, state]] of [
    ['经典研读手账', '文创', 'PHYSICAL', 3900, 'books', 'PUBLISHED'],
    ['素雅茶器·阅读茶杯', '修行工具', 'PHYSICAL', 12900, 'tea', 'PUBLISHED'],
    ['《道德经》原文研读册', '经典典籍', 'PHYSICAL', 5900, 'mountains', 'PUBLISHED'],
    ['静心阅读坐垫（售罄）', '修行工具', 'PHYSICAL', 8900, 'meditation', 'PUBLISHED'],
    ['经典原文电子阅读资料（待开放）', '经典典籍', 'DIGITAL', 990, 'books', 'DRAFT'],
    ['书院参访讲解预约', '线下服务', 'SERVICE', 9900, 'mountains', 'DRAFT'],
    ['待审核：阅读书签套装', '文创', 'PHYSICAL', 1900, 'books', 'REVIEW'],
    ['已下架：秋日茶席布', '文创', 'PHYSICAL', 6900, 'tea', 'ARCHIVED'],
  ].entries()) {
    const row = await once(`product.${index}`, () => shopping.saveProduct(adminReq, {title, subtitle: '书院生活与经典研习主题测试商品', description: '手动测试目录。规格、价格、库存和配送用于验证界面及报价；不提供真实发货、数字交付或预约履约。', category, type, price, cover: `/static/art/${art}.svg`, culturalOrigin: '以经典阅读和日常实践为设计主题，无真实文物、传承资质或健康功效声明。', featured: index < 3}));
    await once(`product.${index}.label`, () => demo('product', row.id));
    const sku = await once(`sku.${index}.0`, () => shopping.sku(adminReq, row.id, {title: index === 0 ? '素白·标准款' : '标准款', price, stock: index === 3 ? 0 : 30, active: true, reason}));
    if (index === 0) {
      await once('sku.0.1', () => shopping.sku(adminReq, row.id, {title: '山青·加厚款', price: 4900, stock: 5, active: true, reason}));
      await once('sku.0.2', () => shopping.sku(adminReq, row.id, {title: '旧款·已停用', price: 2900, stock: 10, active: false, reason}));
    }
    await publish(`product.${index}`, 'product', row.id, state, (id, dto) => shopping.transition(adminReq, id, dto));
    productIds.push(row.id); skuIds.push(sku.id);
  }
  const orders = app.get(OrdersService);
  for (const [province, fee, surcharge, freeAbove, enabled] of [['河南省', 600, 0, 9900, true], ['北京市', 800, 0, 15900, true], ['西藏自治区', 1200, 1000, null, false]]) await once(`delivery.${province}`, () => orders.zone(adminReq, province, {fee, surcharge, freeAbove, enabled, expectedVersion: 0, reason}));
  const addresses = [];
  for (const [index, [province, city, district, detail, isDefault]] of [
    ['河南省', '郑州市', '金水区', '测试路1号（虚构地址，请勿寄送）', true],
    ['北京市', '北京市', '朝阳区', '测试路2号（虚构地址，请勿寄送）', false],
    ['西藏自治区', '拉萨市', '城关区', '测试路3号（未开放配送测试地址）', false],
  ].entries()) addresses.push((await once(`address.${index}`, () => shopping.address(user.student.id, {recipient: '测试收件人', phone: '19900001002', province, city, district, detail, isDefault}))).id);
  for (const [index, quantity] of [[0, 2], [1, 1]]) await once(`cart.${index}`, () => shopping.setCart(user.student.id, skuIds[index], quantity));
  // Preview reservations are local, unpaid and expire automatically; never invent payment facts.
  if (process.env.ORDER_RESERVATION_PREVIEW === 'true') {
    const orderDto = {addressId: addresses[0], items: [{skuId: skuIds[0], quantity: 1}]};
    for (const scenario of ['pending', 'cancelled']) {
      const row = await once(`order.${scenario}`, async () => {
        const quote = await orders.quote(user.student.id, orderDto);
        return orders.create(user.student.id, {...orderDto, quoteId: quote.quoteId, requestId: randomUUID()});
      });
      if (scenario === 'cancelled') await once('order.cancelled.close', () => orders.cancel(user.student.id, row.id));
    }
  }
  const eventIds = [];
  for (const [index, [title, category, location, price, state]] of [
    ['书院周末读书会', '文化沙龙', '郑州·书院阅读空间（测试地点）', 0, 'PUBLISHED'],
    ['山水之间：经典研习体验营', '线下研习', '洛阳·研习空间（测试地点）', 19900, 'PUBLISHED'],
    ['亲子共读：以水为喻', '亲子活动', '郑州·书院阅读空间（测试地点）', 5900, 'DRAFT'],
    ['待审核：茶与道的日常实践', '文化沙龙', '郑州·茶席空间（测试地点）', 9900, 'REVIEW'],
    ['已下架：秋日经典分享会', '文化沙龙', '郑州·书院阅读空间（测试地点）', 0, 'ARCHIVED'],
  ].entries()) {
    const startsAt = new Date(Date.now() + (index + 7) * 86400000);
    const row = await once(`event.${index}`, () => events.save(adminReq, {title, description: '手动测试活动：包括主题介绍、时间地点、容量和价格。地点为虚构测试地点，报名、出票和签到尚未接入。', category, location, cover: '/static/art/mountains.svg', startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.getTime() + 2 * 3600000).toISOString(), capacity: index === 1 ? 20 : 50, price}));
    await once(`event.${index}.label`, () => demo('event', row.id));
    await publish(`event.${index}`, 'event', row.id, state, (id, dto) => events.transition(adminReq, id, dto));
    eventIds.push(row.id);
  }
  for (const [index, title] of ['第八章晨读·直播预告', '生活实践答疑·直播预告'].entries()) {
    const room = await once(`live.${index}`, () => db.$transaction(async tx => {
      const resource = await tx.resource.create({data: {kind: 'LIVE', title, summary: '仅测试预告资料，尚未接入直播服务，不提供播放流。', ownerId: user.teacher.id, categoryCode: '经典研习', isDemo: true}});
      await tx.liveRoom.create({data: {id: resource.id, teacherId: teachers[0], provider: 'MANUAL_TEST', providerRoomId: `manual-test-room-${index}`, categoryCode: '经典研习', accessRule: {mode: 'PUBLIC'}}});
      await tx.auditLog.create({data: {actorId: admin.id, action: 'manual.fixture.live.create', resource: 'live', resourceId: resource.id, reason, changes: {title}}});
      return resource;
    }));
    await once(`live.${index}.publish`, () => app.get(LiveDiscoveryAdminController).publish(room.id, {state: 'PUBLISHED', expectedVersion: 1, title, summary: '测试预告：原文阅读与生活观察。直播服务尚未接通，无真实播放流。', reason}, adminReq));
    await once(`live.${index}.session`, () => db.$transaction(async tx => {
      const row = await tx.liveSession.create({data: {roomId: room.id, hostUserId: user.teacher.id, title, scheduledAt: new Date(Date.now() + (index + 2) * 86400000), state: 'SCHEDULED', accessRuleSnapshot: {mode: 'PUBLIC', manualTest: true}}});
      await tx.auditLog.create({data: {actorId: admin.id, action: 'manual.fixture.live.schedule', resource: 'live_session', resourceId: row.id, reason, changes: {title}}});
      return row;
    }));
    if (index === 0) await once('article.live.relation', () => editorial.relate(articleIds[0], {toId: room.id, type: 'LIVE', rank: 2, reason}, adminReq));
  }
  const sections = (await forum.sections()).items;
  const threadIds = [];
  for (const [index, title] of ['如何理解“水善利万物而不争”？', '七日晨读第一天：先听完整，再表达', '规律作息与阅读时间的安排', '整理阅读角：一次小小的生活实践', '请教老师：如何比较不同版本？', '周末读书会：想交流哪些阅读问题？', '待审核：我的第八章阅读笔记', '已退回：缺少具体内容的分享'].entries()) {
    const row = await once(`thread.${index}`, () => forum.create(user.student.id, {requestKey: randomUUID(), sectionId: sections.find(s => s.code.startsWith(`0${index % 6 + 1}-`)).id, title, body: '今天阅读第八章，我记录了一个具体生活场景：交流读书安排时，先了解学友的时间，再说明自己的想法。欢迎分享你对原文的理解。此帖子为测试样例。', assetIds: index === 0 ? [assets.forum] : [], tags: ['经典研习', '生活应用'], ...(index === 0 ? {articleId: articleIds[0]} : {})}));
    if (index < 6 || index === 7) await once(`thread.${index}.moderate`, () => forum.moderation(row.id, adminReq, {expectedVersion: 1, action: index === 7 ? 'REJECT' : 'APPROVE', reason}));
    threadIds.push(row.id);
  }
  const thread = await db.forumThread.findUniqueOrThrow({where: {id: threadIds[0]}});
  await once('thread.0.feature', () => forum.feature(thread.id, adminReq, {expectedVersion: thread.version, essence: true, pinDays: 7}));
  const reply = await once('thread.reply', () => forum.reply(threadIds[0], user.member.id, {requestKey: randomUUID(), body: '我理解为兼顾自己的表达和对方的感受，欢迎继续交流。'}));
  await once('thread.reply.approve', () => forum.moderation(reply.id, adminReq, {expectedVersion: 1, action: 'APPROVE', reason}, true));
  await once('thread.like', () => forum.react(threadIds[0], user.graduate.id, {kind: 'LIKE', active: true}));
  await once('thread.favorite', () => forum.react(threadIds[0], user.member.id, {kind: 'FAVORITE', active: true}));
  await once('thread.report', () => forum.report(threadIds[1], user.member.id, {reason: 'OTHER', description: '测试举报：请核对是否重复发布，无真实违规指控。'}));
  const courseSections = (await forum.sections(user.student.id, courseIds[0])).items;
  const courseThread = await once('thread.course', () => forum.create(user.student.id, {requestKey: randomUUID(), sectionId: courseSections[0].id, title: '课程讨论：课后观察如何选择场景？', body: '这一讨论仅对有课程权限的学员开放，测试课程社群隔离。', assetIds: [], tags: ['经典研习']}));
  await once('thread.course.approve', () => forum.moderation(courseThread.id, adminReq, {expectedVersion: 1, action: 'APPROVE', reason}));
  for (const [index, [visibility, body, answer, approval]] of [
    ['PRIVATE', '我在表达意见时容易急躁，如何从经典阅读开始记录自己的变化？', '建议先记录一次具体交流，不急于评价自己；再回看原文与当时的感受。', null],
    ['PUBLIC', '“不争”与主动表达观点是否矛盾？', '可以结合上下文观察：保持清晰表达，同时充分倾听，避免把一句话当作机械规则。此答复为测试样例。', 'APPROVED'],
    ['PUBLIC', '研读经典时应该先看注释还是先读原文？', '可先读原文，记下问题，再比较可靠版本，保留自己的观察。', null],
    ['PRIVATE', '如何整理每周阅读笔记？', null, null],
  ].entries()) {
    const question = await once(`question.${index}`, () => questions.ask(teachers[0], user.student.id, {requestKey: randomUUID(), body, visibility}));
    if (answer) {
      const reply = await once(`question.${index}.answer`, () => questions.answer(question.id, teacherReq, {body: answer, expectedVersion: 1}));
      if (approval) await once(`question.${index}.review`, () => questions.review(reply.id, adminReq, {expectedVersion: 1, state: approval, featured: true, reason}));
    }
  }
  for (const [index, [kind, body, state]] of [
    ['SUGGESTION', '建议在课程目录里明确区分图文、音频和视频章节。', 'OPEN'],
    ['ISSUE', '测试问题：弱网时重新加载课件，希望保留已经填写的作业。', 'PROCESSING'],
    ['CONTENT', '测试反馈：经典文章希望补充版本来源说明。', 'CLOSED'],
  ].entries()) {
    const row = await once(`feedback.${index}`, () => feedback.create(user.student.id, {requestKey: randomUUID(), kind, body}));
    if (state !== 'OPEN') {
      await once(`feedback.${index}.internal`, () => feedback.reply(row.id, adminReq, {expectedVersion: 1, body: '内部测试处理记录：已分派给运营核对。此记录不应对学员可见。', internal: true, state: 'PROCESSING'}));
      await once(`feedback.${index}.reply`, () => feedback.reply(row.id, adminReq, {expectedVersion: 2, body: state === 'CLOSED' ? '已补充测试来源说明，感谢你的反馈。' : '我们已经收到并在核对，处理进度会通过站内消息通知。', internal: false, state}));
    }
  }
  for (const key of Object.keys(configDefaults)) await once(`configuration.${key}`, async () => {
    const config = app.get(SystemConfig);
    const current = await config.current(key);
    if (current.revision !== 0) throw Error(`配置 ${key} 已被手动设置，拒绝覆盖`);
    return config.save(key, adminReq, {expectedRevision: 0, value: configDefaults[key], reason});
  });
  const countModels = ['user', 'teacher', 'article', 'articleRelease', 'course', 'courseRelease', 'lesson', 'mediaAsset', 'membershipPlan', 'membership', 'enrollment', 'assignment', 'submission', 'practiceTask', 'practiceCheckin', 'studyProgress', 'courseCertificate', 'courseReview', 'note', 'practiceLog', 'comment', 'forumThread', 'teacherQuestion', 'teacherAnswer', 'feedback', 'product', 'productSku', 'address', 'cartItem', 'deliveryZone', 'order', 'event', 'liveRoom', 'liveSession', 'notification', 'featureConfig', 'auditLog'];
  const counts = {};
  for (const model of countModels) if (db[model]?.count) counts[model] = await db[model].count();
  manifest.completedAt = new Date().toISOString();
  manifest.counts = counts;
  await save();
  await mkdir(output, {recursive: true});
  await writeFile(resolve(output, 'summary.json'), JSON.stringify({generatedAt: manifest.completedAt, counts, completedSteps: Object.keys(manifest.steps).length, limitations: ['仅本地测试数据，非真实运营内容', '无成功支付、退款、直播播放或真实履约事实', '重复执行保留手动修改，不自动重置状态']}, null, 2));
  console.log(JSON.stringify({status: 'complete', counts, steps: Object.keys(manifest.steps).length}, null, 2));
} finally {
  if (app) await app.close();
  await lock.close();
  await unlink(lockPath);
}
