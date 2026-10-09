export type Actor = { id: string; nickname: string; roles: string[] };
export type Session = { user: Actor; csrfToken: string };
export type Block = { id: string; type: 'paragraph' | 'quote'; text: string };
export type Article = { id: string; version: number; title: string; summary: string; author: string; source: string; cover: string; category: string; status: string; visibility: string; membershipTier: number; featured: boolean; isDemo: boolean; tags: string[]; blocks: Block[]; updatedAt: string };
export let session: Session | null = null;
export function setSession(value: Session | null) { session = value; }
export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
const csrfCookie = () => document.cookie.split('; ').find(value => value.startsWith('daoxue_csrf='))?.slice('daoxue_csrf='.length);
let refreshing: Promise<void> | null = null;
export async function api<T>(path: string, method = 'GET', body?: unknown, retry = true): Promise<T> {
  const csrf = session?.csrfToken ?? csrfCookie();
  const multipart = body instanceof FormData;
  const res = await fetch('/api/v1' + path, { method, credentials: 'include', headers: { ...(multipart ? {} : { 'Content-Type': 'application/json' }), ...(csrf ? { 'X-CSRF-Token': csrf } : {}) }, ...(body === undefined ? {} : { body: multipart ? body : JSON.stringify(body) }) });
  if (res.status === 401 && retry && csrf && !['/admin/auth/login', '/admin/auth/refresh', '/admin/auth/logout'].includes(path)) {
    refreshing ??= api<Session>('/admin/auth/refresh', 'POST', {}, false).then(setSession).finally(() => { refreshing = null; });
    await refreshing;
    return api(path, method, body, false);
  }
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401 && path !== '/admin/auth/login') {
      setSession(null);
      window.dispatchEvent(new Event('daoxue:session-expired'));
    }
    throw new ApiError(Array.isArray(data.message) ? data.message.join('；') : (data.message ?? '操作未完成，请重试'), res.status);
  }
  return data as T;
}
