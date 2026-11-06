import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as prettier from 'prettier';
import { analyzeMobile } from '../code-quality/mobile.mjs';
import { previewNotifications, previewSettings } from '../android-preview-overrides.mjs';

test('mobile unused checks count destructured template bindings and detect genuinely unused names', () => {
  const used =
    '<template><text>{{loading}}</text><button @click="load">重试</button></template><script setup lang="ts">const {loading,load}=useCatalog();</script>';
  assert.deepEqual(analyzeMobile(used), []);
  const unused = analyzeMobile(
    '<template><text>说明</text></template><script setup lang="ts">const abandoned=1;</script>',
  );
  assert.ok(unused.some((d) => d.code === 6133 && d.message.includes('abandoned')));
});
test('mobile checker reports syntax errors and unused types rather than silently skipping virtual sources', () => {
  assert.ok(analyzeMobile('<template/><script setup lang="ts">const = ;</script>').length > 0);
  assert.ok(
    analyzeMobile('<template/><script setup lang="ts">type Unused={value:number};</script>').some(
      (d) => d.code === 6196,
    ),
  );
});
test('preview overrides survive formatting without mutating release source or unrelated settings', async () => {
  const notification = await readFile(
    new URL('../../apps/mobile/lib/notifications.ts', import.meta.url),
    'utf8',
  );
  const settings = await readFile(
    new URL('../../apps/mobile/pages/profile/settings.uvue', import.meta.url),
    'utf8',
  );
  for (const [source, formatted] of [
    [notification, await prettier.format(notification, { parser: 'typescript' })],
  ]) {
    for (const candidate of [source, formatted]) {
      const result = previewNotifications(candidate);
      assert.ok(!result.includes('uni.getPushClientId'));
      assert.ok(result.includes('export async function refreshPush'));
    }
  }
  for (const candidate of [settings, await prettier.format(settings, { parser: 'vue' })]) {
    const result = previewSettings(candidate);
    assert.ok(result.includes('本机显示'));
    assert.ok(result.includes('本预览包未包含系统推送'));
    assert.ok(!result.includes('void loadPreferences()'));
    assert.ok(result.includes('forfeitPaidAccess'));
  }
  assert.ok(notification.includes('uni.getPushClientId'));
});

test('mobile checker catches an accidentally removed type import', () => {
  const errors = analyzeMobile(
    '<template><text>{{items}}</text></template><script setup lang="ts">const items=ref<MissingItem[]>([]);</script>',
  );
  assert.ok(errors.some((d) => d.code === 2304 && d.message.includes('MissingItem')));
});
