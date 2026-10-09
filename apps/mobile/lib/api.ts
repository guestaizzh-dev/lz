export type Article = { id: string; title: string; summary: string; category: string; author: string; cover: string; visibility: string; tags: string[]; source?: string; blocks?: { id: string; type: string; text: string }[]; access?: string };
export type Teacher = { id: string; name: string; title: string; bio: string; expertise: string[]; portrait?: string | null; isDemo?: boolean };
export type Course = { id: string; title: string; subtitle: string; description: string; cover: string; category: string; format: string; price: number; chaptersCount: number; durationMinutes: number; tags: string[]; teacher: Teacher; isDemo?: boolean };
export type Product = { id: string; title: string; subtitle: string; description: string; cover: string; category: string; price: number; type: string; isDemo?: boolean; culturalOrigin: string; skus?: import('./shopping').ProductSku[]; checkoutEnabled?: boolean };
export type AcademyEvent = { id: string; title: string; description: string; location: string; startsAt: string; cover: string; price: number };
export type HomeData = { articles: Article[]; courses: Course[]; products: Product[]; events: AcademyEvent[]; development: boolean };
export type ContentPage<T> = { items: T[]; nextCursor: string | null };

// Development-only address; release configuration must use the verified HTTPS API.
export const apiBase = 'http://127.0.0.1:3000/api/v1';
import { accessToken, refreshToken, saveSession, clearSession } from './session';
import type { LoginResult } from './session';
type RequestOptions = { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; data?: Record<string, unknown> };
let renewing: Promise<void> | null = null;
function perform<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    uni.request({ url: apiBase + path, timeout: 10000, method: options.method ?? 'GET', data: options.data,
      header: { 'Content-Type': 'application/json', ...(accessToken() ? { Authorization: 'Bearer ' + accessToken() } : {}) },
      success: (response) => {
        if (response.statusCode >= 200 && response.statusCode < 300) resolve(response.data as T);
        else { const data = response.data as { message?: string | string[] }; const error = new Error(Array.isArray(data.message) ? data.message.join('；') : data.message ?? '操作暂时无法完成'); (error as Error & { status: number }).status = response.statusCode; reject(error); }
      },
      fail: (error) => { console.warn('Academy request failed', error.errMsg); reject(new Error('暂时无法连接书院，请检查网络后重试')); },
    });
  });
}
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  try { return await perform<T>(path, options); }
  catch (e) {
    if ((e as Error & { status: number }).status !== 401 || ['/auth/sms', '/auth/login', '/auth/refresh'].includes(path) || !refreshToken()) throw e;
    renewing ??= perform<LoginResult>('/auth/refresh', { method: 'POST', data: { refreshToken: refreshToken() } }).then(saveSession).catch(e => { clearSession(); throw e; }).finally(() => { renewing = null; });
    await renewing;
    return perform<T>(path, options);
  }
}
export const money = (cents: number): string => (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);
export const goArticle = (id: string): void => { uni.navigateTo({ url: '/pages/article/detail?id=' + encodeURIComponent(id) }); };
export const goCourse = (id: string): void => { uni.navigateTo({ url: '/pages/course/detail?id=' + encodeURIComponent(id) }); };
export const goProduct = (id: string): void => { uni.navigateTo({ url: '/pages/product/detail?id=' + encodeURIComponent(id) }); };
