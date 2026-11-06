import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('a normal App launch opens home while checkout remains a separate order route', () => {
  const config = JSON.parse(
    readFileSync(new URL('../../../apps/mobile/pages.json', import.meta.url), 'utf8'),
  );
  assert.equal(config.pages[0].path, 'pages/index/index');
  assert.equal(config.tabBar.list[0].pagePath, config.pages[0].path);
  assert.equal(config.pages.filter((page) => page.path === 'pages/payment/native').length, 1);
});
