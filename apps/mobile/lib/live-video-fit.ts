// 默认等比完整显示；只有用户明确选择裁切铺满时才允许丢失画面边缘。
export function liveVideoFit(mode: string): string {
  return mode === 'cover' ? 'cover' : 'contain';
}
