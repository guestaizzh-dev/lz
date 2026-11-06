import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(
  new URL('../../../apps/mobile/lib/member-center.ts', import.meta.url),
  'utf8',
);
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function setup(request) {
  const exports = {};
  vm.runInNewContext(code, { exports, require: () => ({ request }) });
  return exports;
}
test('the new service owns current prices, quantities and balances', async () => {
  const data = { grades: [], voucher: { available: 12 } },
    calls = [];
  const module = setup(async (path) => {
    calls.push(path);
    return data;
  });
  assert.equal(await module.getMemberOverview(true), data);
  assert.deepEqual(calls, ['/membership-center']);
});
test('only a missing service exposes approved readonly terms, never a made-up wallet or payment', async () => {
  const module = setup(async (path) => {
    if (path === '/membership-center') throw Object.assign(Error('not found'), { status: 404 });
    return { tier: 2 };
  });
  const result = await module.getMemberOverview(true);
  assert.equal(result.serviceReady, false);
  assert.equal(result.displayTier, 2);
  assert.equal(result.member, null);
  assert.deepEqual(
    Array.from(result.grades, (g) => g.price),
    [36500, 99800, 168000, 298000],
  );
  assert.ok(result.grades.every((g) => !g.active));
});
test('network/server/auth errors remain retryable errors rather than hiding behind readonly terms', async () => {
  for (const status of [0, 401, 500]) {
    const error = Object.assign(Error('unavailable'), { status }),
      module = setup(async () => {
        throw error;
      });
    await assert.rejects(module.getMemberOverview(true), (e) => e === error);
  }
});
