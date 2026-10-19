type DateInput = string | number | Date | null | undefined;
const pad = (value: number) => String(value).padStart(2, '0');
// App V8 may not implement Intl or Date locale formatting. Use UTC arithmetic.
function chinaDate(value: DateInput): Date | null {
  if (value == null || value === '') return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time + 8 * 3600000) : null;
}
export function chinaDay(value: DateInput = Date.now()): string {
  const date = chinaDate(value);
  return date ? date.getUTCFullYear() + '-' + pad(date.getUTCMonth() + 1) + '-' + pad(date.getUTCDate()) : '';
}
export function formatChinaDate(value: DateInput): string { return chinaDay(value) || '—'; }
export function formatChinaTime(value: DateInput): string {
  const date = chinaDate(value);
  return date ? chinaDay(value) + ' ' + pad(date.getUTCHours()) + ':' + pad(date.getUTCMinutes()) : '—';
}
export function readingDuration(seconds: number): string {
  return seconds <= 0 ? '刚开始阅读' : seconds < 60 ? '阅读不足1分钟' : '累计阅读 ' + Math.floor(seconds / 60) + ' 分钟';
}
