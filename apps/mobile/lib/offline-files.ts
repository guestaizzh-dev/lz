import {apiBase} from './environment';import {offlineTrustKeys} from './offline-trust';
// #ifdef APP-ANDROID || APP-IOS
import {offlineConfigure,offlineCommand} from '@/uni_modules/academy-offline';
// #endif
export type CachedLesson={id:string;deviceHash:string;lessonId:string;cohortId:string|null;releaseId:string;title:string;courseTitle:string;mime:string;bytes:number;receivedBytes:number;state:string;expiresAt:string;error:string;version:number};
let activeOwner='',ready=false;
function checked<T>(raw:string):T{const result=JSON.parse(raw) as {ok:boolean;value:T;error?:string};if(!result.ok)throw new Error(result.error??'离线课件暂不可用，请解锁设备后重试');return result.value;}
export function selectOfflineUser(userId:string){activeOwner=userId;ready=false;
// #ifdef APP-ANDROID || APP-IOS
checked(offlineConfigure(userId,apiBase,JSON.stringify(offlineTrustKeys)));
ready=true;
// #endif
}
export function nativeOffline<T>(action:string,payload:Record<string,unknown>={}):T{
if(!activeOwner)throw new Error('请先登录当前账号');
// #ifdef APP-ANDROID || APP-IOS
if(!ready)throw new Error('离线安全存储暂不可用，请解锁后重新登录');return checked<T>(offlineCommand(action,JSON.stringify(payload)));
// #endif
// #ifndef APP-ANDROID || APP-IOS
throw new Error('离线课件仅在Android和iOS App中提供');
// #endif
}
export function offlineDeviceId():string{return nativeOffline<{deviceId:string}>('LIST').deviceId;}
export function cachedLessons():CachedLesson[]{return nativeOffline<{items:CachedLesson[]}>('LIST').items;}
export function hasOfflineKey(kid:string):boolean{return !!offlineTrustKeys[kid];}
