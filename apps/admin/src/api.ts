export type Actor = { id: string; nickname: string; roles: string[]; permissions: string[] };
export type Session = { user: Actor; csrfToken: string };
export type Block = { id: string; type: 'paragraph' | 'quote' | 'image' | 'audio' | 'video'; text: string; url?: string; caption?: string; mediaId?: string };
export type Article = { draftTemplateCode?:string|null; id: string; version: number; title: string; summary: string; author: string; source: string; cover: string; category: string; categoryLabel?:string; status: string; visibility: string; membershipTier: number; featured: boolean; isDemo: boolean; tags: string[]; blocks: Block[]; updatedAt: string };
export let session: Session | null = null;
let sessionRevision=0;
export function setSession(value: Session | null) { session = value; sessionRevision++; }
export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
const csrfCookie = () => document.cookie.split('; ').find(value => value.startsWith('daoxue_csrf='))?.slice('daoxue_csrf='.length);
let refreshing: Promise<void> | null = null;
export async function api<T>(path: string, method = 'GET', body?: unknown, retry = true): Promise<T> {
  const owner=session?.user.id,revision=sessionRevision;
  const csrf = session?.csrfToken ?? csrfCookie();
  const multipart = body instanceof FormData;
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),multipart?60000:15000);
  let res:Response,data:any;
  try{res=await fetch('/api/v1' + path, { method, credentials: 'include',signal:controller.signal, headers: { ...(multipart ? {} : { 'Content-Type': 'application/json' }), ...(csrf ? { 'X-CSRF-Token': csrf } : {}) }, ...(body === undefined ? {} : { body: multipart ? body : JSON.stringify(body) }) });data=await res.json();}
  catch{throw new ApiError(controller.signal.aborted?'请求超时，请刷新确认操作结果后重试':'无法连接书院服务，请检查网络后重试',controller.signal.aborted?408:0);}
  finally{clearTimeout(timeout);}
  if(!path.startsWith('/admin/auth/')&&owner!==session?.user.id)throw new ApiError('登录账号已变化，请重新打开页面',409);
  if (res.status === 401 && retry && csrf && !['/admin/auth/login', '/admin/auth/refresh', '/admin/auth/logout'].includes(path)) {
    refreshing ??= api<Session>('/admin/auth/refresh', 'POST', {}, false).then(value=>{if(revision!==sessionRevision)throw new ApiError('会话已变化，请重新登录',401);setSession(value);}).finally(() => { refreshing = null; });
    await refreshing;
    return api(path, method, body, false);
  }
  if (!res.ok) {
    if(res.status===403)window.dispatchEvent(new Event('daoxue:permissions-changed'));
    if (res.status === 401 && path !== '/admin/auth/login') {
      setSession(null);
      window.dispatchEvent(new Event('daoxue:session-expired'));
    }
    throw new ApiError(Array.isArray(data.message) ? data.message.join('；') : (data.message ?? '操作未完成，请重试'), res.status);
  }
  return data as T;
}

// Large files travel in bounded chunks; XHR exposes actual network progress and cancellation.
export async function uploadMediaChunk<T>(id:string,offset:number,chunk:Blob,signal:AbortSignal,progress:(bytes:number)=>void,retry=true,uploadPath='/admin/media/uploads'):Promise<T>{
  const owner=session?.user.id,csrf=session?.csrfToken??csrfCookie();
  if(signal.aborted)throw new DOMException('上传已暂停','AbortError');
  const response=await new Promise<{status:number;body:any}>((yes,no)=>{
    const xhr=new XMLHttpRequest(),abort=()=>xhr.abort();
    const finish=()=>signal.removeEventListener('abort',abort);
    xhr.open('POST','/api/v1'+uploadPath+'/'+id+'/chunks/'+offset);xhr.withCredentials=true;xhr.timeout=300000;
    if(csrf)xhr.setRequestHeader('X-CSRF-Token',csrf);
    xhr.upload.onprogress=event=>progress(Math.min(chunk.size,event.loaded));
    xhr.onload=()=>{finish();try{yes({status:xhr.status,body:JSON.parse(xhr.responseText)});}catch{no(new ApiError('上传服务返回异常，请重试',xhr.status));}};
    xhr.onerror=()=>{finish();no(new ApiError('上传连接中断，可继续上传',0));};
    xhr.ontimeout=()=>{finish();no(new ApiError('当前分片上传超时，可继续上传',408));};
    xhr.onabort=()=>{finish();no(new DOMException('上传已暂停','AbortError'));};
    signal.addEventListener('abort',abort,{once:true});
    const body=new FormData();body.append('file',chunk,'chunk');xhr.send(body);
  });
  if(owner!==session?.user.id)throw new ApiError('登录账号已变化，请重新选择文件',409);
  if(response.status===401&&retry){await api(uploadPath+'/'+id);return uploadMediaChunk<T>(id,offset,chunk,signal,progress,false,uploadPath);}
  if(response.status===403)window.dispatchEvent(new Event('daoxue:permissions-changed'));
  if(response.status<200||response.status>=300)throw new ApiError(response.body.message??'上传未完成，请重试',response.status);
  return response.body as T;
}
