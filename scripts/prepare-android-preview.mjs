import { previewNotifications, previewSettings } from './android-preview-overrides.mjs';
// User-authorized preview without the unopened uni-push service; release sources stay intact.
import { cp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, relative, basename } from 'node:path';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = resolve(root, 'apps/mobile');
const pages = JSON.parse(await readFile(resolve(source, 'pages.json'), 'utf8'));
assert.equal(
  pages.pages[0]?.path,
  'pages/index/index',
  'App must launch on the home tab, never on checkout',
);
assert(
  pages.tabBar.list.some((page) => page.pagePath === pages.pages[0].path),
  'Launch page must be a tab',
);
const manifest = JSON.parse(await readFile(resolve(source, 'manifest.json'), 'utf8'));
assert(
  /^\d+\.\d+\.\d+$/.test(manifest.versionName) && Number.isInteger(Number(manifest.versionCode)),
);
const revision = process.argv[2] ?? '';
assert(!revision || /^[a-z0-9]+$/.test(revision), 'Invalid snapshot revision');
const suffix = manifest.versionName.replaceAll('.', '') + (revision ? '-' + revision : '');
const target = resolve(root, '.runtime/android-preview-' + suffix),
  evidence = resolve(root, 'outputs/android-preview-' + suffix);
const rtc = JSON.parse(
  await readFile(resolve(source, 'uni_modules/academy-rtc/utssdk/app-android/config.json'), 'utf8'),
);
assert(
  rtc.project?.repositories?.includes("maven { url 'https://maven.zego.im' }") && !rtc.repositories,
  'ZEGO must use DCloud project.repositories',
);
await mkdir(resolve(root, '.runtime'), { recursive: true });
await mkdir(evidence, { recursive: true });
try {
  await mkdir(target);
} catch {
  throw Error(
    'Preview directory already exists; use its recorded build instead of overwriting it.',
  );
}
await cp(source, target, {
  recursive: true,
  filter: (path) =>
    !relative(source, path)
      .split(/[\\/]/)
      .some((part) => ['unpackage', 'node_modules', '.git', '.hbuilderx'].includes(part)),
});
const notificationPath = resolve(source, 'lib/notifications.ts');
const original = await readFile(notificationPath, 'utf8');
await writeFile(resolve(target, 'lib/notifications.ts'), previewNotifications(original));
const settingsPath = resolve(target, 'pages/profile/settings.uvue');
const settings = previewSettings(await readFile(settingsPath, 'utf8'));
await writeFile(settingsPath, settings);
assert.equal(await readFile(notificationPath, 'utf8'), original);
assert(
  !(await readFile(resolve(target, 'lib/notifications.ts'), 'utf8')).includes(
    'uni.getPushClientId',
  ),
);
const environment = await readFile(resolve(target, 'lib/environment.ts'), 'utf8');
assert(
  environment.includes("apiEnvironment = 'production'") &&
    environment.includes('https://cuecanvas.top/api/v1'),
);
await writeFile(
  resolve(evidence, 'profile.json'),
  JSON.stringify(
    {
      project: basename(target),
      path: target,
      version: manifest.versionName,
      code: Number(manifest.versionCode),
      environment: 'production',
      systemPush: false,
      inAppMessages: true,
      releasePushSourcePreserved: true,
      createdAt: new Date().toISOString(),
    },
    null,
    2,
  ) + '\n',
);
console.log('Isolated Android preview prepared: ' + target);
