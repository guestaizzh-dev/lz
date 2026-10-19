import {request} from './api';import {accessToken,currentUser,sessionGeneration} from './session';import {cachedLessons,hasOfflineKey,nativeOffline,offlineDeviceId} from './offline-files';import type {CachedLesson} from './offline-files';
export type OfflineCapabilities={licenseServiceReady:boolean;nativeDownloadReady:boolean;verificationKey:{kid:string}|null;maxOfflineHours:number;maxDevices:number};
type License={id:string;token:string;expiresAt:string;version:number};
export async function downloadLesson(lesson:{id:string;title:string;courseTitle:string;cohortId?:string},consent:boolean){
  if(!consent)throw new Error('请先确认开始本讲学习交付');const owner=currentUser.value?.id,generation=sessionGeneration();if(!owner)throw new Error('请先登录');
  const capabilities=await request<OfflineCapabilities>('/learning/offline/capabilities');
  if(!capabilities.nativeDownloadReady||!capabilities.verificationKey||!hasOfflineKey(capabilities.verificationKey.kid))throw new Error('此版本的离线课件尚未开通，请先联网学习');
  const deviceId=offlineDeviceId(),existing=cachedLessons().find(item=>item.lessonId===lesson.id&&(item.cohortId??null)===(lesson.cohortId??null)),data={deviceId,consentToStart:true,...(lesson.cohortId?{cohortId:lesson.cohortId}:{})};
  const license=await request<License>(existing?'/learning/offline/licenses/'+existing.id+'/refresh':'/learning/lessons/'+lesson.id+'/offline-license',{method:'POST',data});
  if(owner!==currentUser.value?.id||generation!==sessionGeneration())throw new Error('登录账号已变化，请重新操作');
  if(existing?.state==='READY'){nativeOffline('RENEW',{id:existing.id,licenseToken:license.token});return;}
  nativeOffline('START',{licenseToken:license.token,accessToken:accessToken(),deviceId,title:lesson.title,courseTitle:lesson.courseTitle});
}
export async function renewOffline(item:CachedLesson){return downloadLesson({id:item.lessonId,title:item.title,courseTitle:item.courseTitle,cohortId:item.cohortId??undefined},true);}
export async function deleteOffline(id:string){nativeOffline('DELETE',{id});try{await request('/learning/offline/licenses/'+id,{method:'DELETE'});return true;}catch{return false;}}
