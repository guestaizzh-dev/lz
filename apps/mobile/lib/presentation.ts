import { request } from './api';
import type { Course, Teacher } from './api';
export const viewWidth = () => Math.max(280, uni.getWindowInfo().windowWidth - 32);
export function artwork(cover: string, category = ''): string {
  if (cover.includes('tea')) return 'tea';
  if (cover.includes('meditation')) return 'tools';
  if (cover.includes('books') || category === '经典典籍' || category === '文创') return 'book';
  return 'landscape';
}
export function courseType(course: Course) { return ({ VIDEO: '视频课', AUDIO: '音频课', LIVE: '直播课', COHORT: '训练营', OFFLINE: '线下课' } as Record<string, string>)[course.format] ?? '研习课'; }
export function openPage(path: string) { uni.navigateTo({ url: '/pages/' + path }); }
export function showUnavailable(title: string, content: string) { uni.showModal({ title, content, showCancel: false, confirmText: '我知道了', confirmColor: '#245564' }); }
export function shareContent(kind: string, id: string, title: string) {
  uni.setClipboardData({ data: `${title}\n老子道学书院 · ${kind}`, success: () => uni.showToast({ title: '内容信息已复制', icon: 'none' }) });
}
export async function teachers(): Promise<Teacher[]> {
  return (await request<{ items: Teacher[] }>('/catalog/teachers')).items;
}
