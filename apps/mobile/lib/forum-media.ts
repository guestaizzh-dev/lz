import {apiBase,request} from './api';
import {accessToken,currentUser,sessionGeneration} from './session';
import {studyEventId} from './learning';

export type ForumUpload={id:string;name:string;mime:string;sectionId:string;bytes:number;receivedBytes:number;state:string;assetId:string|null;failure:string|null;expiresAt:string;chunkBytes:number};
export type ForumFile={name:string;path:string;bytes:number;mime:string;requestKey:string};
export type ForumTransfer={stopped:boolean;abort?:()=>void};
export type ForumMediaTicket={path:string;mime:string;expiresAt:string;durationSeconds:number};
const endpoint='/forum/media/uploads';

export function chooseForumMedia(type:'video'|'audio'):Promise<ForumFile|null>{
  return new Promise((resolve,reject)=>uni.chooseFile({count:1,type,success:result=>{
    const file=result.tempFiles[0];if(!file){resolve(null);return;}
    const extension=file.name.split('.').pop()?.toLowerCase()??'',mime=({mp4:'video/mp4',mp3:'audio/mpeg',m4a:'audio/mp4',wav:'audio/wav'} as Record<string,string>)[extension];
    if(!mime||mime.startsWith('video/')!==(type==='video')){reject(new Error(type==='video'?'请选择MP4视频':'请选择MP3、M4A或WAV音频'));return;}
    if(!file.size||file.size>256*1024*1024){reject(new Error('每份音视频须小于等于256MiB'));return;}
    resolve({name:file.name.slice(0,200),path:file.path,bytes:file.size,mime,requestKey:studyEventId()});
  },fail:error=>error.errCode===1101001||error.errMsg.toLowerCase().includes('cancel')?resolve(null):reject(new Error('无法选择文件，请检查文件权限后重试'))}));
}

export async function uploadForumMedia(file:ForumFile,sectionId:string,initial:ForumUpload|null,control:ForumTransfer,onTask:(task:ForumUpload)=>void,onProgress:(value:number)=>void):Promise<ForumUpload>{
  const owner=currentUser.value?.id,generation=sessionGeneration();
  function assertOwner(){if(!owner||owner!==currentUser.value?.id||generation!==sessionGeneration())throw new Error('账号已变化，请重新选择文件');if(control.stopped)throw new Error('已暂停，点击继续上传可恢复进度');}
  assertOwner();
  let task=initial?await request<ForumUpload>(endpoint+'/'+initial.id):await request<ForumUpload>(endpoint,{method:'POST',data:{requestKey:file.requestKey,sectionId,name:file.name,mime:file.mime,bytes:file.bytes}});
  assertOwner();onTask(task);if(task.state!=='UPLOADING')return task;
  // #ifdef WEB
  const response=await fetch(file.path);if(!response)throw new Error('原文件无法读取，请重新选择');
  const source=await response.blob();if(source.size!==file.bytes)throw new Error('原文件已变化，请移除后重新选择');
  // #endif
  // #ifdef APP
  const fs=uni.getFileSystemManager(),folder=uni.env.CACHE_PATH+'/academy-forum-'+owner;
  try{fs.accessSync(folder);}catch{fs.mkdirSync(folder,true);}
  const chunkPath=folder+'/'+task.id+'.chunk';
  const fd=await new Promise<string>((resolve,reject)=>fs.open({filePath:file.path,flag:'r',success:r=>resolve(r.fd),fail:()=>reject(new Error('原文件无法读取，请重新选择同一文件'))}));
  // #endif
  try{
    while(task.receivedBytes<task.bytes){
      assertOwner();const offset=task.receivedBytes,size=Math.min(task.chunkBytes,task.bytes-offset);let path='';
      // #ifdef WEB
      path=URL.createObjectURL(source.slice(offset,offset+size));
      // #endif
      // #ifdef APP
      const bytes=new ArrayBuffer(size);
      const count=await new Promise<number>((resolve,reject)=>fs.read({fd,arrayBuffer:bytes,length:size,position:offset,success:r=>resolve(r.bytesRead),fail:()=>reject(new Error('无法读取文件，请检查原文件是否仍可访问'))}));
      if(count!==size)throw new Error('原文件已变化，请重新选择');
      await new Promise<void>((resolve,reject)=>fs.writeFile({filePath:chunkPath,data:bytes,success:()=>resolve(),fail:()=>reject(new Error('无法准备上传分片，请检查手机存储空间'))}));path=chunkPath;
      // #endif
      try{
        const upload=()=>new Promise<ForumUpload>((resolve,reject)=>{
          assertOwner();const transfer=uni.uploadFile({url:apiBase+endpoint+'/'+task.id+'/chunks/'+offset,filePath:path,name:'file',timeout:60000,header:{Authorization:'Bearer '+accessToken()},success:r=>{
            try{assertOwner();const data=JSON.parse(r.data) as ForumUpload&{message?:string|string[]};if(r.statusCode>=200&&r.statusCode<300)resolve(data);else{const e=new Error(Array.isArray(data.message)?data.message.join('；'):data.message??'上传失败，请重试');(e as Error&{status:number}).status=r.statusCode;reject(e);}}catch(e){reject(e);}
          },fail:()=>reject(new Error(control.stopped?'已暂停，点击继续上传可恢复进度':'网络中断，正文已保留，点击继续上传'))});
          control.abort=()=>transfer.abort();transfer.onProgressUpdate(value=>{if(owner===currentUser.value?.id&&generation===sessionGeneration()&&!control.stopped)onProgress(Math.min(99,Math.floor((offset+size*value.progress/100)/task.bytes*100)));});
        });
        try{task=await upload();}catch(e){if((e as Error&{status?:number}).status!==401)throw e;await request('/auth/me');assertOwner();task=await upload();}
        assertOwner();onTask(task);
      }finally{
        control.abort=undefined;
        // #ifdef WEB
        URL.revokeObjectURL(path);
        // #endif
      }
    }
    assertOwner();task=await request<ForumUpload>(endpoint+'/'+task.id+'/complete',{method:'POST'});assertOwner();onTask(task);onProgress(100);return task;
  }finally{
    // #ifdef APP
    try{fs.closeSync({fd});}catch{}try{fs.unlinkSync(chunkPath);}catch{}
    // #endif
  }
}
