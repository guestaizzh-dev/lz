import {nativeShare,type SharePayload} from './native-share';
import { request } from './api';
import type { Course, Teacher } from './api';
// Web keeps one readable column instead of stretching cards across a wide window; keep in step with .content in styles/app.css.
const CONTENT_WIDTH = 688;
export const viewWidth = (): number => {
  const available = Math.max(280, uni.getWindowInfo().windowWidth - 32);
  // #ifdef WEB
  return Math.min(CONTENT_WIDTH, available);
  // #endif
  // #ifndef WEB
  return available;
  // #endif
};
export function artwork(cover: string, category = ''): string {
  if (cover.includes('tea')) return 'tea';
  if (cover.includes('meditation')) return 'tools';
  if (cover.includes('books') || category === '经典典籍' || category === '文创') return 'book';
  return 'landscape';
}
export function courseType(course: Course) {
  if (['VIDEO', 'AUDIO', 'LIVE'].includes(course.format) && course.contentFormats?.length) {
    if (course.contentFormats.length > 1) return '综合研习课';
    return ({ TEXT: '图文课', AUDIO: '音频课', VIDEO: '视频课', LIVE:'直播课' } as Record<string, string>)[course.contentFormats[0]] ?? '研习课';
  }
  return ({ VIDEO: '视频课', AUDIO: '音频课', LIVE: '直播课', COHORT: '训练营', OFFLINE: '线下课' } as Record<string, string>)[course.format] ?? '研习课';
}
export function courseIcon(course: Course): string {
  if (course.contentFormats?.length) return course.contentFormats.some(f=>['VIDEO','LIVE'].includes(f)) ? 'video-camera' : course.contentFormats.includes('AUDIO') ? 'headphones' : 'book-open';
  return course.format === 'AUDIO' ? 'headphones' : 'video-camera';
}
const tabPages = ['index/index','academy/index','discover/index','shop/index','profile/index'];
export function openPage(path: string) {
  const page = path.split('?')[0];
  if (tabPages.includes(page)) {
    if (page === 'academy/index') {
      const query = path.split('?')[1] ?? '';
      uni.setStorageSync('academyFormat', query.split('&').includes('format=COHORT') ? 'COHORT' : 'ALL');
    }
    uni.switchTab({ url: '/pages/' + page });
  } else uni.navigateTo({ url: '/pages/' + path });
}
export function showUnavailable(title: string, content: string) { uni.showModal({ title, content, showCancel: false, confirmText: '我知道了', confirmColor: '#245564' }); }
export async function shareContent(kind: string, id: string, title: string) {
  const types:Record<string,string>={'文章':'ARTICLE','课程':'COURSE','名师':'TEACHER','商品':'PRODUCT','活动':'EVENT'};
  try { const result=await request<SharePayload>('/share/links',{method:'POST',data:{resourceType:types[kind]??kind,resourceId:id}});await nativeShare(result); }
  catch(e){uni.showToast({title:(e as Error).message,icon:'none'});}
}
export async function teachers(): Promise<Teacher[]> {
  return (await request<{ items: Teacher[] }>('/catalog/teachers')).items;
}
