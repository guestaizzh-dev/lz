import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../dist/main.js';
import { Database } from '../dist/database.js';
import { AuthService } from '../dist/auth.js';
test('product image gallery preserves order, legacy edits and validates untrusted arrays', async () => {
  const app = await createApp(false);
  app.useLogger(['error']);
  await app.listen(0, '127.0.0.1');
  const db = app.get(Database),
    auth = app.get(AuthService),
    base = await app.getUrl();
  const user = await db.user.create({ data: { nickname: 'gallery-test', roles: ['ADMIN'] } }),
    c = auth.credentials(),
    csrf = randomUUID();
  await db.authSession.create({
    data: {
      userId: user.id,
      kind: 'ADMIN',
      accessHash: c.accessHash,
      refreshHash: c.refreshHash,
      accessExpiresAt: c.accessExpiresAt,
      expiresAt: new Date(Date.now() + 86400000),
      csrfToken: csrf,
    },
  });
  async function call(path, method = 'GET', body, admin = true) {
    const r = await fetch(base + '/api/v1' + path, {
      method,
      headers: {
        Origin: 'http://127.0.0.1:5173',
        'Content-Type': 'application/json',
        ...(admin ? { Cookie: 'daoxue_access=' + c.access, 'X-CSRF-Token': csrf } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: r.status, body: await r.json() };
  }
  const input = {
      title: 'gallery-test',
      subtitle: 'test',
      description: 'test',
      type: 'PHYSICAL',
      cover: 'https://example.com/old.jpg',
      price: 100,
      culturalOrigin: 'test',
      featured: false,
      mallCategory: 'LIFESTYLE',
    },
    images = ['https://example.com/portrait.jpg', 'https://example.com/landscape.jpg'];
  try {
    for (const invalid of [
      ['javascript:alert(1)'],
      [images[0], images[0]],
      Array.from({ length: 10 }, (_, i) => 'https://example.com/' + i + '.jpg'),
      [42],
      'image',
    ])
      assert.equal(
        (await call('/admin/products', 'POST', { ...input, images: invalid })).status,
        400,
      );
    let r = await call('/admin/products', 'POST', { ...input, images });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    let product = r.body;
    assert.deepEqual(product.images, images);
    assert.equal(product.cover, images[0]);
    r = await call('/admin/products/' + product.id, 'PATCH', {
      ...input,
      expectedVersion: product.version,
    });
    assert.equal(r.status, 200);
    product = r.body;
    assert.deepEqual(product.images, images);
    r = await call('/admin/products/' + product.id, 'PATCH', {
      ...input,
      images: [...images].reverse(),
      expectedVersion: product.version,
    });
    assert.equal(r.status, 200);
    product = r.body;
    assert.equal(product.cover, images[1]);
    await db.product.update({ where: { id: product.id }, data: { status: 'PUBLISHED' } });
    r = await call('/catalog/products/' + product.id, 'GET', undefined, false);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.images, [...images].reverse());
    await db.product.update({ where: { id: product.id }, data: { status: 'DRAFT' } });
    r = await call('/admin/products/' + product.id, 'PATCH', {
      ...input,
      images: [],
      expectedVersion: product.version,
    });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.images, []);
    assert.equal(r.body.cover, input.cover);
  } finally {
    await app.close();
  }
});
