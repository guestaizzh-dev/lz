import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const source = await readFile(
  new URL('../../../apps/admin/src/pages/live-discovery/recording-status.ts', import.meta.url),
  'utf8',
);
const { recordingStatus } = await import(
  'data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64')
);
const row = {
  state: 'ENDED',
  startedAt: null,
  recordingState: 'FAILED',
  replayState: null,
  recordingFailure: 'RECORDING_MEDIA_INVALID',
  recordingMessage: '旧处理失败提示',
};

test('preparation-only ended session is a neutral no-replay notice with no futile retry', () => {
  const result = recordingStatus(row);
  assert.equal(result.label, '未开播，无回放');
  assert.equal(result.error, false);
  assert.equal(result.canRetry, false);
  assert.doesNotMatch(result.message, /失败|原片段|维护|摄像头/);
});
test('cancelled preparation and ended empty recording have accurate explanations', () => {
  assert.match(recordingStatus({ ...row, state: 'CANCELLED' }).message, /已取消/);
  const empty = recordingStatus({
    ...row,
    startedAt: '2026-11-03T09:00:00Z',
    recordingFailure: 'RECORDING_EMPTY',
  });
  assert.equal(empty.label, '未录到有效内容');
  assert.equal(empty.error, false);
  assert.equal(empty.canRetry, false);
});
test('real media processing failure after a started broadcast remains an error with retry', () => {
  const failure = recordingStatus({ ...row, startedAt: '2026-11-03T09:00:00Z' });
  assert.equal(failure.error, true);
  assert.equal(failure.canRetry, true);
  assert.match(failure.message, /重试/);
  assert.doesNotMatch(failure.message, /原片段已保留/);
});
test('unknown start history or real recorder faults are not disguised as ordinary empty sessions', () => {
  for (const change of [
    { startedAt: undefined },
    { recordingFailure: 'RECORDING_PROCESS_FAILED' },
    { recordingFailure: 'RECORDING_DISK_LOW' },
    { replayState: 'PENDING' },
  ]) {
    const result = recordingStatus({ ...row, ...change });
    assert.equal(result.error, true);
    assert.equal(result.canRetry, true);
  }
});
test('active recording and recoverable lack of incoming media keep appropriate actions', () => {
  const active = recordingStatus({
    ...row,
    state: 'LIVE',
    recordingState: 'RECORDING',
    recordingFailure: null,
    recordingMessage: '',
  });
  assert.equal(active.label, '服务端录制中');
  assert.equal(active.error, false);
  assert.equal(active.canRetry, false);
  const empty = recordingStatus({ ...row, state: 'LIVE', recordingFailure: 'RECORDING_EMPTY' });
  assert.equal(empty.label, '等待有效音视频');
  assert.equal(empty.canRetry, true);
});
test('completed replay is not downgraded by its recovery advisory', () => {
  const result = recordingStatus({
    ...row,
    state: 'REPLAY_READY',
    recordingState: 'READY',
    recordingFailure: 'RECORDING_PARTIAL',
    replayState: 'PENDING',
    recordingMessage: '预览后确认发布',
  });
  assert.equal(result.label, '回放已生成');
  assert.equal(result.message, '预览后确认发布');
  assert.equal(result.error, false);
  assert.equal(result.canRetry, false);
});
