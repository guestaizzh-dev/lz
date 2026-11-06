import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { LiveRecordings } from '../dist/live-recordings.js';

test('idle preparation stops do not exhaust recording retries; actual crashes still do', async () => {
  const root = await mkdtemp(join(tmpdir(), 'academy-idle-recording-'));
  const previous = {
    MEDIA_DIR: process.env.MEDIA_DIR,
    ZEGO_RECORDER_BINARY: process.env.ZEGO_RECORDER_BINARY,
  };
  process.env.MEDIA_DIR = root;
  process.env.ZEGO_RECORDER_BINARY = process.execPath;
  let running;
  try {
    for (const crash of [false, true]) {
      const binary = join(root, crash ? 'crash.cjs' : 'idle.cjs');
      await writeFile(
        binary,
        crash
          ? "process.stdin.once('data',()=>process.exit(7));"
          : "process.stdout.write(JSON.stringify({event:'login',code:0})+String.fromCharCode(10));process.stdin.on('data',line=>{if(String(line).includes('STOP'))process.exit(0);});",
      );
      const row = {
        id: 'recording',
        sessionId: 'session',
        state: 'WAITING',
        attempts: 0,
        retries: 0,
        startedAt: null,
        leaseToken: 'lease',
        failure: null,
      };
      const db = {
        liveRecording: {
          findUniqueOrThrow: async () => ({ ...row }),
          findMany: async () => [],
          updateMany: async ({ data }) => {
            for (const [key, value] of Object.entries(data)) {
              if (value && typeof value === 'object' && 'increment' in value)
                row[key] += value.increment;
              else if (value && typeof value === 'object' && 'decrement' in value)
                row[key] -= value.decrement;
              else row[key] = value;
            }
            return { count: 1 };
          },
        },
        liveSession: { findUniqueOrThrow: async () => ({ id: 'session', state: 'PREPARING' }) },
      };
      const recordings = new LiveRecordings(db, {});
      recordings.requireReady = async () => {};
      recordings.credential = () => ({ appId: binary, userId: 'recorder', token: 'test-token' });
      const task = {
        token: 'lease',
        controller: new AbortController(),
        started: Date.now() - 11 * 60000,
        renewed: Date.now(),
      };
      recordings.active.set(row.id, task);
      running = task;
      const finished = recordings.launch(row.id, task);
      if (!crash) {
        for (let attempt = 0; attempt < 100 && !task.process; attempt++) await delay(10);
        assert.ok(task.process, 'Recorder must start before its preparation timeout');
        await recordings.tick();
      }
      await finished;
      assert.equal(row.state, 'WAITING');
      assert.equal(row.retries, crash ? 1 : 0);
      assert.equal(row.attempts, crash ? 1 : 0);
      assert.equal(row.failure, crash ? 'RECORDING_PROCESS_FAILED' : null);
      assert.equal(recordings.active.size, 0);
      assert.equal(row.leaseToken, null);
      running = null;
    }
  } finally {
    running?.process?.kill();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
});
