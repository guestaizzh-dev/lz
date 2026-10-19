import {shallowRef,watch} from 'vue';
import {privateStore} from './secure-storage';
import {currentUser,sessionGeneration} from './session';
import {request} from './api';
import {createStudyQueue} from './study-queue-state';
import type {QueuedStudy,StudyScope} from './study-queue-state';
import {studyEventId} from './learning';
import type {StudyProgress} from './learning';
export const studySync=shallowRef({pending:0,blocked:0,error:''});
type Acknowledgement={event:QueuedStudy;result:StudyProgress;generation:number};
export const studyAcknowledgement=shallowRef<Acknowledgement|null>(null);
const queue=createStudyQueue(privateStore,()=>({id:currentUser.value?.id??'',generation:sessionGeneration()}),event=>request<StudyProgress>('/learning/lessons/'+event.lessonId+'/progress'+(event.cohortId?'?cohortId='+encodeURIComponent(event.cohortId):''),{method:'POST',data:event.data}),(event,result)=>{if(event&&result)studyAcknowledgement.value={event,result,generation:sessionGeneration()};refreshStatus();});
function refreshStatus(){try{studySync.value=queue.status();}catch(e){studySync.value={...studySync.value,error:(e as Error).message};}}
export function recordStudy(scope:StudyScope,positionSeconds:number,elapsedSeconds:number,completed=false){
  queue.enqueue(scope,{eventId:studyEventId(),positionSeconds:Math.max(0,Math.floor(positionSeconds)),elapsedSeconds:Math.min(30,Math.max(0,Math.floor(elapsedSeconds))),completed,recordedAt:new Date().toISOString(),...(scope.releaseId?{releaseId:scope.releaseId}:{})});
  void syncStudy();
}
export async function syncStudy(retry=false){try{if(retry)queue.retry();await queue.drain();}catch(e){studySync.value={...studySync.value,error:(e as Error).message};}finally{refreshStatus();}}
export function removeStudyUser(userId:string){queue.removeUser(userId);}
export function localStudy(scope:StudyScope){return queue.latest(scope);}
let started=false,foreground=true;
export function startStudySync(){
  if(started)return;started=true;
  watch(currentUser,()=>{studyAcknowledgement.value=null;refreshStatus();void syncStudy();});
  uni.onNetworkStatusChange(result=>{if(result.isConnected&&foreground)void syncStudy(true);});
  setInterval(()=>{if(foreground)void syncStudy();},15000);
  refreshStatus();void syncStudy();
}
export function studyForeground(value:boolean){foreground=value;if(value)void syncStudy();}
