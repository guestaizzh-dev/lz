import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const { chromium } = createRequire(process.env.ACADEMY_BROWSER_MODULE + '/package.json')(
  'playwright',
);
const root = resolve('apps/mobile/unpackage/dist/build/web'),
  output = resolve('outputs/live-viewing-122/player-bar');
await mkdir(output, { recursive: true });
const fixture = await readFile('outputs/course-recovery/fixtures/lesson.mp4');
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(req.url.split('?')[0]);
    let file = resolve(root, '.' + path);
    if (!file.startsWith(root + sep)) file = resolve(root, 'index.html');
    let data;
    try {
      data = await readFile(file);
    } catch {
      file = resolve(root, 'index.html');
      data = await readFile(file);
    }
    res.setHeader(
      'Content-Type',
      {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.png': 'image/png',
        '.svg': 'image/svg+xml',
        '.otf': 'font/otf',
      }[extname(file)] ?? 'application/octet-stream',
    );
    res.end(data);
  } catch {
    res.writeHead(500).end();
  }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } }),
  errors = [],
  checks = [];
page.on('pageerror', (e) => errors.push(e.message));
const lesson = {
  id: 'test-video',
  title: '上善若水',
  position: 1,
  format: 'VIDEO',
  durationSeconds: 20,
  trial: true,
  accessible: true,
  required: true,
  progress: null,
  releaseId: 'release',
  body: '',
  hasMedia: true,
  subtitles: [],
};
await page.route('**/api/v1/**', async (route) => {
  const url = new URL(route.request().url()),
    path = url.pathname;
  const headers = {
    'access-control-allow-origin': base,
    'access-control-allow-headers': '*',
    'access-control-allow-methods': '*',
  };
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
  if (path.endsWith('/test-video.mp4')) {
    const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range ?? '');
    const start = range ? Number(range[1]) : 0,
      end = range?.[2] ? Math.min(fixture.length - 1, Number(range[2])) : fixture.length - 1;
    return route.fulfill({
      status: range ? 206 : 200,
      contentType: 'video/mp4',
      headers: {
        ...headers,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(end - start + 1),
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${fixture.length}` } : {}),
      },
      body: fixture.subarray(start, end + 1),
    });
  }
  const specific = path.endsWith('/auth/sms')
    ? { challengeId: 'fixture-only', retryAfter: 60, channel: 'TEST' }
    : path.endsWith('/auth/login')
      ? {
          user: { id: 'viewer', nickname: '预览学员', avatar: null, tags: [], roles: ['USER'] },
          accessToken: 'a'.repeat(43),
          refreshToken: 'b'.repeat(43),
          expiresIn: 3600,
        }
      : path.includes('/commerce/digital-orders/')
        ? {
            id: 'preview-order',
            orderNo: 'UI-PREVIEW',
            state: 'COMPLETED',
            createdAt: new Date().toISOString(),
            payableTotal: '0',
            paidTotal: '0',
            refundedTotal: '0',
            pack: {
              title: '独立视频课件',
              description: '',
              files: [{ id: 'file', name: '课件视频', mime: 'video/mp4', bytes: fixture.length }],
            },
            canReceive: true,
            canRefund: false,
            refundPolicy: '',
            delivery: { id: 'delivery', firstAccessAt: null, expiresAt: null, revokedAt: null },
            refunds: [],
          }
        : path.startsWith('/api/v1/me/digital/')
          ? {
              path: '/test-video.mp4',
              durationSeconds: 20,
              expiresAt: new Date(Date.now() + 3600000).toISOString(),
            }
          : null;
  if (specific)
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers,
      body: JSON.stringify(specific),
    });
  const data = path.includes('/learning/courses/')
    ? {
        course: {
          id: 'preview',
          title: '道德经共读',
          cover: '',
          refundPolicy: '',
          accessDays: null,
        },
        access: 'TRIAL',
        releaseId: 'release',
        lessons: [lesson],
      }
    : path.endsWith('/media')
      ? { path: '/test-video.mp4', expiresAt: new Date(Date.now() + 3600000).toISOString() }
      : path.includes('/learning/lessons/')
        ? lesson
        : { items: [] };
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers,
    body: JSON.stringify(data),
  });
});
try {
  await page.goto(base + '/#/pages/course/player?id=preview');
  const trigger = page.getByRole('button', { name: '播放速度', exact: true });
  await trigger.waitFor();
  await page.locator('video').waitFor();
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 1);
  assert.equal(await page.getByText('播放速度', { exact: true }).count(), 0);
  const box = await page.locator('.lesson-video').boundingBox(),
    button = await trigger.boundingBox();
  assert.ok(
    button.x >= box.x &&
      button.y >= box.y &&
      button.x + button.width <= box.x + box.width + 1 &&
      button.y + button.height <= box.y + box.height,
  );
  const bar = await page.locator('.video-control-bar').boundingBox();
  assert.ok(
    Math.abs(bar.y + bar.height - box.y - box.height) < 2,
    'Control bar must touch the video bottom',
  );
  assert.ok(button.y >= bar.y && button.y + button.height <= bar.y + bar.height);
  assert.equal(await page.getByText('登录后可保存学习进度。', { exact: true }).count(), 0);
  assert.equal(await page.getByText('进度会同步到当前研习记录。', { exact: true }).count(), 0);
  await trigger.click();
  await page.locator('.video-speed-option').filter({ hasText: '1.5×' }).click();
  await page.waitForFunction(() => document.querySelector('video')?.playbackRate === 1.5);
  assert.equal(await page.locator('.video-speed-options').count(), 0);
  await page.screenshot({ path: output + '/course-inline-speed.png', fullPage: true });
  checks.push('倍速与播放进度全屏同排在底栏，1.5倍实际生效，已删除冗余进度提示');
  await trigger.click();
  await page.screenshot({ path: output + '/course-inline-options.png', fullPage: true });
  await page.locator('.video-speed-option').filter({ hasText: /^1×$/ }).click();
  await page.waitForFunction(() => document.querySelector('video')?.playbackRate === 1);
  checks.push('可恢复正常速度，视频下方不重复展示速度栏');
  await page.getByRole('button', { name: '播放视频', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('video')?.paused === false);
  await page.getByRole('button', { name: '暂停视频', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('video')?.paused === true);
  checks.push('底栏实际播放和暂停，不改变播放源');
  const progress = page.locator('.video-control-progress input[type="range"]');
  await progress.click({ position: { x: 50, y: 12 } });
  await page.waitForFunction(() => document.querySelector('video')?.currentTime > 0);
  checks.push('底栏进度拖动可实际定位视频');
  await page.getByRole('button', { name: '视频全屏', exact: true }).click();
  await page.waitForFunction(() => !!document.fullscreenElement);
  await trigger.click();
  await page.locator('.video-speed-option').filter({ hasText: '2×' }).click();
  await page.waitForFunction(() => document.querySelector('video')?.playbackRate === 2);
  await page.screenshot({ path: output + '/course-fullscreen-speed.png' });
  await page.getByRole('button', { name: '退出视频全屏', exact: true }).click();
  await page.waitForFunction(() => !document.fullscreenElement);
  checks.push('全屏内仍可选择2倍速，退出后保留播放速度');
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await trigger.click();
    const options = await page.locator('.video-speed-options').boundingBox();
    assert.ok(options.x >= 0 && options.x + options.width <= width + 1);
    const barBox = await page.locator('.video-control-bar').boundingBox();
    const children = await page.locator('.video-control-bar').evaluate((element) =>
      [...element.children].map((child) => {
        const rect = child.getBoundingClientRect();
        return { x: rect.x, right: rect.right };
      }),
    );
    assert.ok(
      children.every((child) => child.x >= barBox.x && child.right <= barBox.x + barBox.width + 1),
      'Bottom controls must not overlap or overflow at ' + width,
    );
    await trigger.click();
  }
  checks.push('320/390/768宽度倍速选择不溢出');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + '/#/pages/auth/login');
  await page.locator('input').nth(0).fill('19900001002');
  await page.getByText('获取验证码', { exact: true }).click();
  await page.getByText(/秒后重发/).waitFor();
  await page.locator('input').nth(1).fill('123456');
  await page.locator('.consent-touch').click();
  await page.locator('.login-submit').click();
  await page.locator('.login-submit').waitFor({ state: 'hidden' });
  await page.goto(base + '/#/pages/shop/digital-order?id=preview-order');
  await page.getByText('领取 / 打开', { exact: true }).click();
  await page.getByText('确认领取', { exact: true }).click();
  await trigger.waitFor();
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 1);
  await trigger.click();
  await page.locator('.video-speed-option').filter({ hasText: '1.25×' }).click();
  await page.waitForFunction(() => document.querySelector('video')?.playbackRate === 1.25);
  await page.screenshot({ path: output + '/marketplace-inline-speed.png', fullPage: true });
  checks.push('独立商城视频课件同样支持视频内1.25倍速');
  assert.deepEqual(errors, []);
  for (const name of ['failure.json', 'failure.png'])
    await rm(resolve(output, name), { force: true });
  await writeFile(
    output + '/report.json',
    JSON.stringify(
      {
        checks,
        errors,
        api: 'UI fixtures only, no external requests',
        video: 'real local MP4',
        nativeAcceptance: false,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ checks: checks.length, errors }));
} catch (error) {
  await writeFile(
    output + '/failure.json',
    JSON.stringify(
      await page.evaluate(() => ({
        text: document.querySelector('.video-time')?.textContent,
        video: [...document.querySelectorAll('video')].map((v) => ({
          currentTime: v.currentTime,
          duration: v.duration,
          paused: v.paused,
          seekable: v.seekable.length,
          readyState: v.readyState,
        })),
        sliders: [...document.querySelectorAll('input[type="range"]')].map((s) => ({
          value: s.value,
          max: s.max,
          disabled: s.disabled,
        })),
      })),
      null,
      2,
    ),
  );
  await page.screenshot({ path: output + '/failure.png', fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((ok) => server.close(ok));
}
