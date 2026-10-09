import { Database } from '../src/database.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

if (process.env.NODE_ENV === 'production') throw new Error('Development fixtures are forbidden in production');
const db = new Database();
const id = (group: number, index: number) => `d0000000-0000-4000-8000-${String(group * 100 + index).padStart(12, '0')}`;
try {
  // Generated test tone, not a teacher recording; demo-only and explicitly labelled.
  const rate = 16000, seconds = 3, pcmBytes = rate * seconds * 2;
  const wav = Buffer.alloc(44 + pcmBytes);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + pcmBytes, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(pcmBytes, 40);
  for (let i = 0; i < rate * seconds; i++) wav.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 220 / rate) * 600), 44 + i * 2);
  const mediaRoot = resolve(process.env.MEDIA_DIR ?? '.media'); await mkdir(mediaRoot, { recursive: true }); await writeFile(resolve(mediaRoot, id(7, 1)), wav);
  await db.$transaction(async (tx) => {
    await tx.user.upsert({where:{id:'development-seed'},update:{},create:{id:'development-seed',nickname:'开发示例导入',status:'FROZEN',roles:['USER']}});
    await tx.mediaAsset.upsert({ where: { id: id(7, 1) }, update: {}, create: { id: id(7, 1), storageKey: id(7, 1), name: '播放验证测试音频.wav', mime: 'audio/wav', bytes: wav.length, uploaderId: 'development-seed', status:'READY',visibility:'PRIVATE',sha256:createHash('sha256').update(wav).digest('hex') } });
    await tx.teacher.upsert({ where: { id: id(1, 1) }, update: {}, create: {
      id: id(1, 1), name: '书院编辑团队（示例）', title: '开发演示',
      bio: '此档案仅供开发和界面验证。正式授课老师须由运营核实资料及内容授权后发布。',
      expertise: ['经典研习', '生活实践'], status: 'PUBLISHED', isDemo: true,
    } });
    const articles = [
      { title: '上善若水：从第八章开始读老子', summary: '读一段经典，留一点安静给日常。', category: '经典原文', cover: 'mountains', source: '《道德经》第八章，通行本；说明为开发编辑示例', blocks: [
        { id: 'laozi-8-original', type: 'quote', text: '上善若水。水善利万物而不争，处众人之所恶，故几于道。' },
        { id: 'laozi-8-note', type: 'paragraph', text: '研习提示：先朗读原文，再观察“水”在这一章中承担怎样的比喻。把阅读中的疑问记下来，无须急于得出结论。本文为开发示例，不是名师署名译注。' },
        { id: 'laozi-8-practice', type: 'paragraph', text: '今日练习：选择一件可以从容完成的小事，专注于过程。结束后写下你的感受，将经典与自己的生活经验联系起来。' },
      ] },
      { title: '致虚极，守静笃', summary: '第十六章中的“静”，与一次专注的阅读。', category: '经典原文', cover: 'meditation', source: '《道德经》第十六章，通行本；说明为开发编辑示例', blocks: [
        { id: 'laozi-16-original', type: 'quote', text: '致虚极，守静笃。万物并作，吾以观复。' },
        { id: 'laozi-16-note', type: 'paragraph', text: '读完这一段，留意“观”与“复”的关系。经典阅读需要结合上下文与版本，不把一句话直接当作所有生活问题的答案。' },
      ] },
      { title: '一盏茶的时间，练习专注', summary: '用一个简单的日常动作，记录自己的注意力。', category: '实践心得', cover: 'tea', source: '书院开发编辑示例，非医疗建议', blocks: [
        { id: 'tea-observe', type: 'paragraph', text: '准备一杯适合自己的饮品，在饮用之前观察杯中的颜色、温度与气息。放下手头的任务，把这一刻完整地留给自己。' },
        { id: 'tea-record', type: 'paragraph', text: '练习之后记录两三句话：刚开始时在想什么？结束后感受如何？这是一份私人练习，不必与他人比较。' },
      ] },
      { title: '经典研读的方法：从原文到生活', summary: '会员文章权限验证示例：游客仅能看到摘要。', category: '名师解读', cover: 'books', source: '开发编辑示例，无真实名师署名', visibility: 'MEMBER' as const, blocks: [
        { id: 'member-private', type: 'paragraph', text: '这段受限正文用于验证服务端不会向未授权用户泄漏会员内容。正式文章需要真实授权、审核与会员内容集配置。' },
      ] },
    ];
    for (const [index, article] of articles.entries()) {
      const data = { ...article, cover: `/static/art/${article.cover}.svg`, author: '书院编辑（示例）', tags: ['经典', '日常'], status: 'PUBLISHED' as const, isDemo: true, featured: index === 0, publishedAt: new Date(`2026-10-0${4 - index}T00:00:00Z`) };
      await tx.article.upsert({ where: { id: id(2, index + 1) }, update: data, create: { id: id(2, index + 1), ...data } });
    }
    const courses = [
      { title: '读懂《道德经》：入门研习', subtitle: '从原文出发，建立自己的阅读路径', category: '经典研习', cover: 'books', price: 9900, format: 'VIDEO' as const, chaptersCount: 12, durationMinutes: 180 },
      { title: '日常里的静心练习', subtitle: '每天十分钟，把专注带回生活', category: '实践修行', cover: 'meditation', price: 4900, format: 'AUDIO' as const, chaptersCount: 7, durationMinutes: 70 },
      { title: '一茶一书，生活中的道意', subtitle: '从简单日常开始的生活观察', category: '生活应用', cover: 'tea', price: 6900, format: 'VIDEO' as const, chaptersCount: 8, durationMinutes: 120 },
      { title: '上善若水 · 图文研习（开发示例）', subtitle: '读一段原文，写下一次研习', category: '经典研习', cover: 'mountains', price: 0, format: 'AUDIO' as const, chaptersCount: 3, durationMinutes: 1 },
    ];
    for (const [index, course] of courses.entries()) {
      const data = { ...course, cover: `/static/art/${course.cover}.svg`, description: '这是用于开发验证的示例课程，尚不提供真实购买或授课。正式课程将展示经审核的老师、章节、试听、交付期限与退课规则。', tags: ['入门'], teacherId: id(1, 1), status: 'PUBLISHED' as const, featured: index === 0, isDemo: true };
      await tx.course.upsert({ where: { id: id(3, index + 1) }, update: data, create: { id: id(3, index + 1), ...data } });
      const courseId = id(3, index + 1);
      let release = await tx.courseRelease.findUnique({ where: { courseId_version: { courseId, version: 1 } } });
      if (!release) {
        const lessons = [
          { sourceId: id(8, index * 10 + 1), title: '先读原文（图文试听）', position: 1, format: 'TEXT' as const, body: '《道德经》第八章，通行本：上善若水。水善利万物而不争，处众人之所恶，故几于道。\n\n此章节为开发示例，用于验证图文章节、目录与研习记录。', mediaId: null, durationSeconds: 0, trial: true, required: true },
          { sourceId: id(8, index * 10 + 2), title: '记录你的思考', position: 2, format: 'TEXT' as const, body: '研习提示（开发编辑示例）：观察“水”的意象，写下阅读时产生的一个疑问。可以在“修行日志”里记录这次练习。', mediaId: null, durationSeconds: 0, trial: false, required: true },
          ...(index === 3 ? [{ sourceId: id(8, index * 10 + 3), title: '播放验证 · 测试音频（非授课）', position: 3, format: 'AUDIO' as const, body: '这是一段生成的低音量测试音频，只用于验证播放、暂停与进度同步，不代表真实课程录音。', mediaId: id(7, 1), durationSeconds: 3, trial: true, required: false }] : []),
        ];
        release = await tx.courseRelease.create({ data: { courseId, version: 1, title: course.title, lessons: { create: lessons } } });
        await tx.courseChapter.createMany({ data: lessons.map(({ sourceId: chapterId, ...lesson }) => ({ ...lesson, id: chapterId, courseId })) });
      }
      const actual = await tx.lesson.findMany({ where: { releaseId: release.id } });
      await tx.course.update({ where: { id: courseId }, data: { publishedReleaseId: release.id, chaptersCount: actual.length, durationMinutes: Math.ceil(actual.reduce((sum, lesson) => sum + lesson.durationSeconds, 0) / 60) } });
    }
    const products = [
      { title: '经典研读手账', subtitle: '记录每一次与经典的相遇', category: '文创', cover: 'books', price: 3900 },
      { title: '素雅茶器', subtitle: '让日常，多一份从容', category: '修行工具', cover: 'tea', price: 12900 },
      { title: '《道德经》研读册', subtitle: '经典原文与阅读留白', category: '经典典籍', cover: 'mountains', price: 5900 },
      { title: '静心坐垫', subtitle: '一个属于自己的安静角落', category: '修行工具', cover: 'meditation', price: 8900 },
    ];
    for (const [index, product] of products.entries()) {
      const data = { ...product, cover: `/static/art/${product.cover}.svg`, description: '开发演示商品，暂无真实库存与供应。正式商品需补齐规格、材质、供应、配送及售后信息后才允许上架销售。', culturalOrigin: '以经典研习和日常实践为设计主题。此处为演示说明，未声称具有文物、传承或健康功效证明。', tags: undefined, status: 'PUBLISHED' as const, featured: index === 0, isDemo: true };
      const { tags: _, ...record } = data;
      await tx.product.upsert({ where: { id: id(4, index + 1) }, update: record, create: { id: id(4, index + 1), ...record } });
      if (!await tx.productSku.count({ where: { productId: id(4, index + 1) } })) {
        await tx.productSku.create({ data: { id: id(9, index + 1), productId: id(4, index + 1), title: '标准款（开发示例）', price: product.price, stock: 100, active: true } });
      }
    }
  });
  console.log('Development catalog seeded; production excludes all demo records.');
} finally { await db.$disconnect(); }
