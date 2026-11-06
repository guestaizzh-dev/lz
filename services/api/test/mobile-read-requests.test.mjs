import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const compile = (name) =>
  ts.transpileModule(
    readFileSync(new URL('../../../apps/mobile/lib/' + name + '.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
function setup() {
  let clock = 100,
    scope = 1,
    revision = 0;
  const exports = {};
  vm.runInNewContext(compile('read-requests'), {
    exports,
    Date: { now: () => clock },
    Map,
    Promise,
    JSON,
  });
  return {
    ...exports,
    clock: (value) => (clock = value),
    gate: (load, healthy = () => true) => {
      const result = {};
      vm.runInNewContext(compile('page-refresh'), {
        exports: result,
        Date: { now: () => clock },
        require: (id) =>
          id === './session'
            ? { sessionGeneration: () => scope }
            : { readRevision: () => revision },
      });
      return result.pageRefresh(load, healthy, 1000);
    },
    scope: (value) => (scope = value),
    rev: () => revision++,
  };
}
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

test('concurrent reads share one call, but consumers receive independent objects', async () => {
  const { ReadRequests } = setup(),
    reads = new ReadRequests(),
    d = deferred();
  let calls = 0;
  const load = () => {
      calls++;
      return d.promise;
    },
    a = reads.run('list', load, 60000),
    b = reads.run('list', load, 60000);
  await Promise.resolve();
  assert.equal(calls, 1);
  d.resolve({ items: [{ id: 'one' }] });
  const [x, y] = await Promise.all([a, b]);
  x.items.push({ id: 'local' });
  assert.equal(y.items.length, 1);
  assert.equal((await reads.run('list', load, 60000)).items.length, 1);
  assert.equal(calls, 1);
});
test('payment, membership, authorization, private records and media are never persistent cached reads', () => {
  const { publicReadLifetime } = setup();
  for (const path of [
    '/commerce/course-orders/one',
    '/learning/membership',
    '/learning/benefits',
    '/learning/courses/one',
    '/media/one',
    '/me/notes',
    '/auth/me',
    '/live/one/access',
  ])
    assert.equal(publicReadLifetime(path), 0, path);
  assert.equal(publicReadLifetime('/catalog/courses?size=20'), 60000);
});
test('TTL, explicit reload and failed requests recover without serving a failed cache entry', async () => {
  const s = setup(),
    r = new s.ReadRequests();
  let calls = 0;
  const load = async () => ({ n: ++calls });
  assert.equal((await r.run('a', load, 1000)).n, 1);
  assert.equal((await r.run('a', load, 1000)).n, 1);
  assert.equal((await r.run('a', load, 1000, true)).n, 2);
  s.clock(1200);
  assert.equal((await r.run('a', load, 1000)).n, 3);
  await assert.rejects(
    r.run(
      'bad',
      async () => {
        throw Error('offline');
      },
      1000,
    ),
  );
  assert.equal((await r.run('bad', load, 1000)).n, 4);
});
test('a mutation invalidates values and prevents an older in-flight response refilling the cache', async () => {
  const { ReadRequests } = setup(),
    r = new ReadRequests(),
    d = deferred();
  const old = r.run('one', () => d.promise, 1000);
  await Promise.resolve();
  r.invalidate();
  assert.equal((await r.run('one', async () => ({ version: 2 }), 1000)).version, 2);
  d.resolve({ version: 1 });
  await old;
  assert.equal((await r.run('one', async () => ({ version: 3 }), 1000)).version, 2);
});
test('account changes isolate both pending work and public cached responses', async () => {
  const { ReadRequests } = setup(),
    r = new ReadRequests(),
    d = deferred();
  r.setScope('alice');
  const old = r.run('catalog', () => d.promise, 1000);
  await Promise.resolve();
  r.setScope('bob');
  assert.equal((await r.run('catalog', async () => ({ owner: 'bob' }), 1000)).owner, 'bob');
  d.resolve({ owner: 'alice' });
  await old;
  assert.equal((await r.run('catalog', async () => ({ owner: 'wrong' }), 1000)).owner, 'bob');
});
test('uncached authorized reads share only simultaneous work and query again after completion', async () => {
  const { ReadRequests } = setup(),
    r = new ReadRequests();
  let calls = 0;
  const load = async () => ({ n: ++calls });
  await Promise.all([r.run('access', load), r.run('access', load)]);
  assert.equal(calls, 1);
  await r.run('access', load);
  assert.equal(calls, 2);
});
test('page return is quiet within its lifetime; explicit refresh and writes reload', async () => {
  const s = setup();
  let calls = 0;
  const refresh = s.gate(async () => {
    calls++;
  });
  await refresh();
  await refresh();
  assert.equal(calls, 1);
  await refresh(true);
  assert.equal(calls, 2);
  s.rev();
  await refresh();
  assert.equal(calls, 3);
  s.clock(1200);
  await refresh();
  assert.equal(calls, 4);
});
test('an account change during page loading queues a fresh load for the new account', async () => {
  const s = setup(),
    d = deferred();
  let calls = 0;
  const refresh = s.gate(async () => {
    if (++calls === 1) await d.promise;
  });
  const first = refresh();
  s.scope(2);
  const second = refresh();
  d.resolve();
  await Promise.all([first, second]);
  assert.equal(calls, 2);
  await refresh();
  assert.equal(calls, 2);
});
test('failed page refreshes remain immediately retryable', async () => {
  const s = setup();
  let healthy = false,
    calls = 0;
  const refresh = s.gate(
    async () => {
      calls++;
    },
    () => healthy,
  );
  await refresh();
  await refresh();
  assert.equal(calls, 2);
  healthy = true;
  await refresh();
  await refresh();
  assert.equal(calls, 3);
});

test('the App client coalesces public GETs, keeps POSTs distinct and invalidates after writing', async () => {
  const setupModule = setup(),
    exports = {},
    calls = [];
  let generation = 1;
  vm.runInNewContext(compile('api'), {
    exports,
    console,
    Map,
    Promise,
    JSON,
    require: (id) => {
      if (id === './read-requests') return setupModule;
      if (id === './diagnostics') return { reportClientError: () => {} };
      if (id === './environment') return { apiBase: 'https://example.test/api/v1' };
      if (id === './session')
        return {
          sessionGeneration: () => generation,
          accessToken: () => null,
          refreshToken: () => null,
        };
      if (id === './learning') return { studyEventId: () => '' };
      throw Error(id);
    },
    uni: {
      request: (options) => {
        calls.push(options);
        Promise.resolve().then(() =>
          options.success({ statusCode: 200, data: { items: [{ n: calls.length }] } }),
        );
      },
    },
  });
  await Promise.all([exports.request('/catalog/courses'), exports.request('/catalog/courses')]);
  assert.equal(calls.length, 1);
  await exports.request('/catalog/courses');
  assert.equal(calls.length, 1);
  await Promise.all([
    exports.request('/me/notes', { method: 'POST' }),
    exports.request('/me/notes', { method: 'POST' }),
  ]);
  assert.equal(calls.length, 3);
  await exports.request('/catalog/courses');
  assert.equal(calls.length, 4);
  generation++;
  await exports.request('/catalog/courses');
  assert.equal(calls.length, 5);
});
