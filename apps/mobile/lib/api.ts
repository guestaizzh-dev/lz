export type PublicEvidence={id:string;kind?:string;title:string;author?:string|null;edition?:string|null;rightsHolder?:string|null;licenseScope?:string|null;sourceUrl:string|null;validFrom?:string|null;validUntil?:string|null;isDemo?:boolean};
export type Article = { id: string; version: number; title: string; summary: string; category: string; author: string; cover: string; visibility: string; tags: string[]; source?: string; templateCode?:string; blocks?: { id: string; type: string; text: string; url?: string; caption?: string; mediaId?: string }[]; access?: string };
export type TeacherArticle={id:string;title:string;summary:string;visibility:string;membershipTier:number};
export type TeacherSchedule={id:string;kind:string;resourceId:string;title:string;startsAt:string;endsAt:string|null;location:string;state:string};
export type Teacher = { id: string; name: string; title: string; bio: string; expertise: string[]; portrait?: string | null; isDemo?: boolean; evidence?:PublicEvidence[];teachingDirection?:string;lineageSummary?:string|null;achievementSummary?:string|null;representativeCourses?:Course[];introductions?:TeacherArticle[];interpretations?:TeacherArticle[];schedule?:TeacherSchedule[];scheduleHasMore?:boolean };
export type Course = { id: string; title: string; subtitle: string; description: string; cover: string; category: string; format: string; contentFormats?: string[]; price: number; chaptersCount: number; durationMinutes: number; tags: string[]; teacher: Teacher; isDemo?: boolean };
export type ProductPromotionRules={threshold?:number;reduction?:number};
export type ProductPromotion={id:string;skuId:string;title:string;kind:string;price:number|null;remaining:number;startsAt:string;endsAt:string;rules:ProductPromotionRules};
export type Product = {serverTime?:string;promotions?:ProductPromotion[]; id: string; title: string; subtitle: string; description: string; cover: string; category: string; price: number; type: string; isDemo?: boolean; culturalOrigin: string; skus?: import('./shopping').ProductSku[]; checkoutEnabled?: boolean; refundPolicy?:string; evidence?:PublicEvidence[]; relatedCourses?:{id:string;title:string}[] };
export type AcademyEvent = {studyTour:boolean;studyTourBrief:string; id: string; title: string; description: string; location: string; startsAt: string; cover: string; price: number };
export type HomeData = { articles: Article[]; courses: Course[]; products: Product[]; events: AcademyEvent[]; development: boolean; demoContentVisible?: boolean };
export type ContentPage<T> = { items: T[]; nextCursor: string | null };

import {apiBase} from './environment';
export {apiBase,apiEnvironment} from './environment';
export function assetUrl(value:string|null|undefined):string { return value?.startsWith('/api/v1/')?apiBase+value.slice(7):value??''; }
import { accessToken, refreshToken, saveSession, clearSession, sessionGeneration, refreshRotation } from './session';
import {studyEventId} from './learning';
import type { LoginResult } from './session';
type RequestOptions = { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; data?: Record<string, unknown> };
let renewing: {generation:number;promise:Promise<void>} | null = null;
function perform<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const owner=sessionGeneration();
  return new Promise((resolve, reject) => {
    uni.request({ url: apiBase + path, timeout: 10000, method: options.method ?? 'GET', data: options.data,
      header: { 'Content-Type': 'application/json', ...(accessToken() ? { Authorization: 'Bearer ' + accessToken() } : {}) },
      success: (response) => {
        if(owner!==sessionGeneration()){reject(new Error('登录会话已变化，请重新打开页面'));return;}
        if (response.statusCode >= 200 && response.statusCode < 300) resolve(response.data as T);
        else {
          const data = response.data as { message?: string | string[] } | null;
          const detail = data?.message;
          const message = Array.isArray(detail) ? detail.join('；') : detail ?? '操作暂时无法完成';
          const smsNotice = response.statusCode === 503 && path === '/auth/sms' && ['短信登录尚未开通，请联系书院', '短信服务暂不可用，请稍后再试', '预览测试账号不可用'].includes(message);
          const error = new Error(response.statusCode >= 500 && !smsNotice ? '服务暂时繁忙，请稍后重试' : /^Cannot (GET|POST|PUT|PATCH|DELETE)\b/.test(message) ? '内容暂时无法打开，请返回上一页重新进入' : message);
          (error as Error & { status: number }).status = response.statusCode; reject(error);
        }
      },
      fail: (error) => { console.warn('Academy request failed', error.errMsg); reject(new Error('暂时无法连接书院，请检查网络后重试')); },
    });
  });
}
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const generation=sessionGeneration();
  try { return await perform<T>(path, options); }
  catch (e) {
    if ((e as Error & { status: number }).status !== 401 || (path.startsWith('/auth/social/')||['/auth/sms', '/auth/login', '/auth/refresh'].includes(path)) || !refreshToken()) throw e;
    if(generation!==sessionGeneration())throw e;
    const token=refreshToken(),rotationId=refreshRotation(studyEventId);
    const pending=renewing?.generation===generation?renewing.promise:perform<LoginResult>('/auth/refresh', { method: 'POST', data: { refreshToken: token,rotationId } }).then(value=>{if(sessionGeneration()!==generation||refreshToken()!==token)throw new Error('会话已变化，请重新登录');saveSession(value,true);}).catch(e => { if(sessionGeneration()===generation&&[400,401,403].includes((e as Error&{status?:number}).status??0))clearSession(); throw e; });
    renewing={generation,promise:pending};
    try{await pending;}finally{if(renewing?.promise===pending)renewing=null;}
    if(generation!==sessionGeneration())throw new Error('会话已变化，请重新登录');
    return perform<T>(path, options);
  }
}
export const money = (cents: number): string => (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);
export const goArticle = (id: string): void => { uni.navigateTo({ url: '/pages/article/detail?id=' + encodeURIComponent(id) }); };
export const goCourse = (id: string): void => { uni.navigateTo({ url: '/pages/course/detail?id=' + encodeURIComponent(id) }); };
export const goProduct = (id: string): void => { uni.navigateTo({ url: '/pages/product/detail?id=' + encodeURIComponent(id) }); };
