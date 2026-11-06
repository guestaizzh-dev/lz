type RecordingRow = {
  state: string;
  startedAt?: string | null;
  recordingState: string | null;
  recordingFailure?: string | null;
  recordingMessage: string;
  replayState?: string | null;
};

const labels: Record<string, string> = {
  WAITING: '等待录制',
  STARTING: '录制连接中',
  ARMED: '录制已就绪',
  RECORDING: '服务端录制中',
  PROCESSING: '回放处理中',
  READY: '回放已生成',
  FAILED: '录制需处理',
};

export function recordingStatus(row: RecordingRow) {
  const ended = ['ENDED', 'CANCELLED', 'REPLAY_READY'].includes(row.state);
  const neverStarted = ended && row.startedAt === null && !row.replayState;
  // A preparation-only session can leave an empty MP4 that older workers report as invalid.
  const empty =
    row.recordingState === 'FAILED' &&
    (row.recordingFailure === 'RECORDING_EMPTY' ||
      (neverStarted && row.recordingFailure === 'RECORDING_MEDIA_INVALID'));
  if (empty) {
    return {
      label: neverStarted ? '未开播，无回放' : ended ? '未录到有效内容' : '等待有效音视频',
      message: neverStarted
        ? row.state === 'CANCELLED'
          ? '本场已取消，未生成回放。'
          : '本场在准备阶段结束，未生成回放。'
        : ended
          ? '本场未录到有效音视频，无法生成回放。'
          : '尚未收到可录制的音视频，请确认推流画面后重试录制。',
      error: false,
      canRetry: !ended,
    };
  }
  return {
    label: row.recordingState ? (labels[row.recordingState] ?? '录制状态待确认') : '开播后自动录制',
    message:
      row.recordingFailure === 'RECORDING_MEDIA_INVALID'
        ? '回放文件尚未处理完成，请重试处理；仍无法生成时请联系维护人员。'
        : row.recordingMessage,
    error: row.recordingState === 'FAILED',
    canRetry: row.recordingState === 'FAILED',
  };
}
