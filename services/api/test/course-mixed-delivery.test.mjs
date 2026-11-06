import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CourseSalesService } from '../dist/course-sales.js';

test('recorded course sales validate actual mixed media rather than the catalog category', async () => {
  const root = await mkdtemp(join(tmpdir(), 'academy-mixed-delivery-'));
  const previous = process.env.MEDIA_DIR;
  process.env.MEDIA_DIR = root;
  try {
    await writeFile(join(root, 'video'), Buffer.from('video'));
    await writeFile(join(root, 'audio'), Buffer.from('audio'));
    const assets = [
      { id: 'video', storageKey: 'video', bytes: 5n, mime: 'video/mp4', status: 'READY' },
      { id: 'audio', storageKey: 'audio', bytes: 5n, mime: 'audio/mp4', status: 'READY' },
    ];
    const store = {
      mediaAsset: {
        findMany: async ({ where }) =>
          assets.filter((a) => a.status === where.status && where.id.in.includes(a.id)),
      },
    };
    const video = { format: 'VIDEO', mediaId: 'video', trial: false, durationSeconds: 760 };
    const audio = { format: 'AUDIO', mediaId: 'audio', trial: false, durationSeconds: 760 };
    const ready = (lessons, format) =>
      CourseSalesService.prototype.deliverable.call({}, lessons, format, store);
    assert.equal(await ready([video], 'AUDIO'), true);
    assert.equal(await ready([audio], 'VIDEO'), true);
    assert.equal(await ready([video, audio], 'VIDEO'), true);
    assert.equal(await ready([{ ...video, trial: true }], 'AUDIO'), false);
    assert.equal(await ready([{ ...video, mediaId: 'missing' }], 'AUDIO'), false);
    assert.equal(await ready([{ ...video, durationSeconds: 0 }], 'AUDIO'), false);
    assert.equal(await ready([{ ...audio, mediaId: 'video' }], 'VIDEO'), false);
    assets[0].status = 'FAILED';
    assert.equal(await ready([video], 'AUDIO'), false);
    assets[0].status = 'READY';
    assets[0].bytes = 6n;
    assert.equal(await ready([video], 'AUDIO'), false);
    assets[0].bytes = 5n;
    assets[0].storageKey = 'missing';
    assert.equal(await ready([video], 'AUDIO'), false);
  } finally {
    if (previous === undefined) delete process.env.MEDIA_DIR;
    else process.env.MEDIA_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
