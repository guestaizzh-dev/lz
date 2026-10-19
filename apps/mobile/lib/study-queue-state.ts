import type {PrivateStore} from './secure-storage';
import type {StudyProgress} from './learning';
export type StudyScope={userId:string;courseId:string;releaseId:string;lessonId:string;cohortId:string};
export type StudyPayload={eventId:string;positionSeconds:number;elapsedSeconds:number;completed:boolean;recordedAt:string;releaseId?:string};
export type QueuedStudy=StudyScope&{data:StudyPayload;attempts:number;nextAt:number;blocked:boolean;error:string};
type Actor={id:string;generation:number};
export function createStudyQueue(store:PrivateStore,actor:()=>Actor,send:(event:QueuedStudy)=>Promise<StudyProgress>,notify:(event:QueuedStudy|null,result:StudyProgress|null)=>void,now=()=>Date.now()){
  let running:Promise<void>|null=null;
  const storageKey=(userId:string)=>'study-queue.v1|'+userId;
  function read(userId:string):QueuedStudy[]{
    const raw=store.read(storageKey(userId));if(!raw)return [];
    const rows=JSON.parse(raw) as QueuedStudy[];
    if(!Array.isArray(rows)||rows.some(row=>row.userId!==userId||!row.lessonId||!row.data?.eventId||!Number.isFinite(row.data.elapsedSeconds)))throw new Error('本机学习记录读取失败，请保留应用数据并联系书院');
    return rows;
  }
  function write(userId:string,rows:QueuedStudy[]){if(rows.length)store.write(storageKey(userId),JSON.stringify(rows));else store.remove(storageKey(userId));}
  function enqueue(scope:StudyScope,data:StudyPayload){
    if(!scope.userId||actor().id!==scope.userId)throw new Error('登录账号已变化，未提交其他账号的学习记录');
    const rows=read(scope.userId);
    if(rows.length>=3000)throw new Error('本机待同步记录较多，请联网同步后继续记录');
    if(rows.some(row=>row.data.eventId===data.eventId))return;
    write(scope.userId,[...rows,{...scope,data,attempts:0,nextAt:0,blocked:false,error:''}]);notify(null,null);
  }
  function status(){const userId=actor().id,rows=userId?read(userId):[];return {pending:rows.length,blocked:rows.filter(row=>row.blocked).length,error:rows.find(row=>row.error)?.error??''};}
  function latest(scope:StudyScope){const rows=read(scope.userId).filter(row=>!row.blocked&&row.courseId===scope.courseId&&row.releaseId===scope.releaseId&&row.lessonId===scope.lessonId&&row.cohortId===scope.cohortId),last=rows[rows.length-1];return last?{...last.data,completed:rows.some(row=>row.data.completed)}:null;}
  function retry(){const userId=actor().id;if(!userId)return;write(userId,read(userId).map(row=>({...row,blocked:false,nextAt:0,attempts:0,error:''})));notify(null,null);}
  async function process(){
    const owner=actor();if(!owner.id)return;
    for(;;){
      if(actor().id!==owner.id||actor().generation!==owner.generation)return;
      const rows=read(owner.id),snapshot=rows.find(row=>!row.blocked);
      if(!snapshot||snapshot.nextAt>now())return;
      try{
        const result=await send(snapshot);
        // Acknowledgement is durable too: a failed write leaves the identical event for replay.
        write(owner.id,read(owner.id).filter(row=>row.data.eventId!==snapshot.data.eventId));
        if(actor().id===owner.id&&actor().generation===owner.generation)notify(snapshot,result);
      }catch(error){
        const status=(error as Error&{status?:number}).status??0;
        const blocked=[400,403,404,409,422].includes(status),attempts=snapshot.attempts+1;
        write(owner.id,read(owner.id).map(row=>row.data.eventId===snapshot.data.eventId?{...row,attempts,blocked,error:(error as Error).message,nextAt:now()+Math.min(60000,1000*2**Math.min(attempts,6))}:row));
        if(actor().id===owner.id&&actor().generation===owner.generation)notify(null,null);
        if(!blocked)return;
      }
    }
  }
  function drain():Promise<void>{if(running)return running;running=process().finally(()=>{running=null;});return running;}
  function removeUser(userId:string){write(userId,[]);notify(null,null);}
  return {enqueue,status,retry,drain,removeUser,latest};
}
