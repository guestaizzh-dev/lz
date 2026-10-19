import { BadRequestException } from '@nestjs/common';

export type SubtitleCue = { start: number; end: number; text: string };

// Store plain SRT/WebVTT as part of the reviewed delivery; never render subtitle HTML.
export function subtitleCues(source: string, durationSeconds?: number | null): SubtitleCue[] {
  if (!source.trim()) return [];
  if (source.length > 200000) throw new BadRequestException('字幕最多 20 万字');
  const content = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  const blocks = content.split(/\n[ \t]*\n/);
  if (/^WEBVTT(?:[ \t].*)?(?:\n|$)/.test(blocks[0]!)) blocks.shift();
  const cues: SubtitleCue[] = [];
  const time = (value: string): number => {
    const match = /^(?:(\d{2,}):)?([0-5]\d):([0-5]\d)[.,](\d{3})$/.exec(value);
    if (!match) throw new BadRequestException('字幕时间须为 00:00:00,000（SRT）或 00:00.000（WebVTT）');
    return Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
  };
  for (const block of blocks) {
    const lines = block.split('\n');
    if (!lines[0]!.includes('-->')) lines.shift();
    const timing = /^(\S+)\s+-->\s+(\S+)\s*$/.exec(lines.shift() ?? '');
    if (!timing) throw new BadRequestException('请提供带时间轴的纯文本 SRT / WebVTT 字幕，不支持样式或定位指令');
    const start = time(timing[1]!), end = time(timing[2]!), text = lines.join('\n').trim();
    if (!text || text.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw new BadRequestException('每段字幕须有正文且不超过 2000 字');
    if (start >= end || end > (durationSeconds ?? 86400) || (cues.length && start < cues.at(-1)!.end)) throw new BadRequestException('字幕须按时间顺序排列、不能重叠或超出课件实际时长');
    cues.push({ start, end, text });
    if (cues.length > 1000) throw new BadRequestException('字幕最多 1000 段');
  }
  if (!cues.length) throw new BadRequestException('字幕文件没有有效正文');
  return cues;
}
