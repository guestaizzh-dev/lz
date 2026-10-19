import { openPage } from './presentation';
export type DiscoveryItem = { id: string; type: string; title: string; summary: string; cover: string; tags: string[]; visibility: string; isDemo: boolean; reason?: string };
export const typeNames: Record<string,string> = { ARTICLE:'文章',COURSE:'课程',TEACHER:'名师',PRODUCT:'商品',EVENT:'活动',LIVE:'直播',THREAD:'讨论' };
export function openContent(item: DiscoveryItem) {
  const pages: Record<string,string> = { ARTICLE:'article/detail',COURSE:'course/detail',TEACHER:'teacher/detail',PRODUCT:'product/detail',EVENT:'event/detail',LIVE:'live/detail',THREAD:'community/detail' };
  if (pages[item.type]) openPage(pages[item.type]+'?id='+encodeURIComponent(item.id));
}
