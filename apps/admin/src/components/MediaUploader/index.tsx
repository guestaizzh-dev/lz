import { useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Progress, Space, Typography, Upload } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import { api, uploadMediaChunk } from '@/api';

type UploadState={id:string;name:string;bytes:number;receivedBytes:number;state:string;assetId:string|null;failure:string|null;chunkBytes:number;expiresAt:string};
type Asset={id:string;name:string;mime:string;bytes:number;durationSeconds?:number|null};
const maxBytes=2147483647;
function mediaMime(file:File){return /\.mp4$/i.test(file.name)?'video/mp4':/\.m4a$/i.test(file.name)?'audio/mp4':/\.mp3$/i.test(file.name)?'audio/mpeg':/\.wav$/i.test(file.name)?'audio/wav':'';}
async function fingerprint(file:File){
  // A bounded identity sample finds resumable tasks; the server checks every replayed chunk.
  const samples=new Blob([file.slice(0,1048576),file.slice(Math.max(0,file.size-1048576)),JSON.stringify([file.size,file.lastModified,file.name])]);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await samples.arrayBuffer()))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
export default function MediaUploader({onReady,onBusyChange,compact=false,homeHero=false}:{compact?:boolean;homeHero?:boolean;onReady?:(asset:Asset)=>void;onBusyChange?:(busy:boolean)=>void}){
  const uploadPath=homeHero?'/admin/media/uploads/home-hero':'/admin/media/uploads';
  const {message}=App.useApp(),[task,setTask]=useState<UploadState>(),[file,setFile]=useState<File>(),[busy,setBusy]=useState(false),[paused,setPaused]=useState(false),[sent,setSent]=useState(0),[error,setError]=useState('');
  const active=useRef<AbortController|undefined>(undefined),alive=useRef(true),running=useRef(false),readyCallback=useRef(onReady);readyCallback.current=onReady;
  const busyCallback=useRef(onBusyChange);busyCallback.current=onBusyChange;
  useEffect(()=>{busyCallback.current?.(busy);return()=>busyCallback.current?.(false);},[busy]);
  const [pending,setPending]=useState<UploadState[]>([]);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;active.current?.abort();};},[]);
  useEffect(()=>{if(compact)return;let mounted=true;const load=()=>void api<UploadState[]>(uploadPath).then(rows=>{if(mounted)setPending(rows);}).catch(()=>{});load();const timer=setInterval(load,5000);return()=>{mounted=false;clearInterval(timer);};},[compact]);
  async function watchProcessing(start:UploadState,signal:AbortSignal){
    let state=start;
    while(state.state==='PROCESSING'&&!signal.aborted&&alive.current){
      await new Promise<void>(resolve=>{const stop=()=>{clearTimeout(timer);signal.removeEventListener('abort',stop);resolve();};const timer=setTimeout(stop,2000);signal.addEventListener('abort',stop,{once:true});});
      if(signal.aborted||!alive.current)return;
      state=await api<UploadState>(uploadPath+'/' +state.id);if(signal.aborted||!alive.current)return;setTask(state);
    }
    if(signal.aborted||!alive.current)return;
    if(state.state==='FAILED')throw new Error(state.failure??'媒体处理失败，请检查源文件或重试');
    if(state.state==='READY'&&state.assetId){
      const asset=await api<Asset>(homeHero?uploadPath+'/'+state.id+'/asset':'/admin/media/assets/'+state.assetId);readyCallback.current?.(asset);
      message.success(homeHero?'视频已就绪，可以保存首页':'课件已就绪，可以保存或发布');
    }
  }
  async function run(selected:File){
    if(running.current)return;running.current=true;active.current?.abort();const controller=new AbortController();active.current=controller;setBusy(true);setPaused(false);setError('');setFile(selected);
    try{
      let state=await api<UploadState>(uploadPath,'POST',{name:selected.name,mime:mediaMime(selected),bytes:selected.size,fingerprint:await fingerprint(selected)});
      if(controller.signal.aborted||!alive.current)return;setTask(state);setSent(state.receivedBytes);
      if(state.state==='FAILED')throw new Error(state.failure??'处理失败，请点击重新处理');
      let failures=0;
      while(state.state==='UPLOADING'&&state.receivedBytes<selected.size){
        if(controller.signal.aborted)throw new DOMException('上传已暂停','AbortError');
        const offset=state.receivedBytes;
        try{
          state=await uploadMediaChunk<UploadState>(state.id,offset,selected.slice(offset,offset+state.chunkBytes),controller.signal,bytes=>{if(alive.current)setSent(offset+bytes);},true,uploadPath);failures=0;
        }catch(e){
          if(controller.signal.aborted)throw e;
          const status=(e as Error&{status?:number}).status;
          if(![0,408,409,500,502,503,504].includes(status??-1)||++failures>3)throw e;
          state=await api<UploadState>(uploadPath+'/' +state.id);
        }
        if(!alive.current)return;setTask(state);setSent(state.receivedBytes);
      }
      if(controller.signal.aborted)throw new DOMException('上传已暂停','AbortError');
      if(state.state==='UPLOADING')state=await api<UploadState>(uploadPath+'/' +state.id+'/complete','POST',{});
      if(!alive.current)return;setTask(state);void watchProcessing(state,controller.signal).catch(e=>{if(alive.current&&!controller.signal.aborted)setError(e.message);});
    }catch(e){if(alive.current){if((e as Error).name==='AbortError')setPaused(true);else setError((e as Error).message);}}
    finally{running.current=false;if(alive.current)setBusy(false);}
  }
  async function cancel(){if(!task)return;active.current?.abort();setError('');try{await api(uploadPath+'/' +task.id+'/cancel','POST',{});setTask(undefined);setFile(undefined);setSent(0);setPaused(false);}catch(e){setError((e as Error).message);}}
  async function follow(row:UploadState){
    if(running.current)return;running.current=true;active.current?.abort();setBusy(true);setError('');setFile(undefined);setSent(row.receivedBytes);const controller=new AbortController();active.current=controller;
    try{const state=row.state==='FAILED'?await api<UploadState>(uploadPath+'/' +row.id+'/retry','POST',{}):row;setTask(state);void watchProcessing(state,controller.signal).catch(e=>{if(alive.current&&!controller.signal.aborted)setError(e.message);});}catch(e){if(alive.current)setError((e as Error).message);}finally{running.current=false;if(alive.current)setBusy(false);}
  }
  return <div style={{marginBottom:16}}>
    <Upload accept={homeHero?'.mp4':'.mp4,.mp3,.m4a,.wav'} showUploadList={false} disabled={busy} beforeUpload={selected=>{const mime=mediaMime(selected);if(!mime||(homeHero&&mime!=='video/mp4')||!selected.size||selected.size>maxBytes){message.error('请选择 MP4 / MP3 / M4A / WAV，单文件须小于 2GB');return false;}void run(selected);return false;}}><Button type="primary" icon={<UploadOutlined/>} disabled={busy}>{homeHero?'上传首页视频':'上传音视频'}</Button></Upload>
    <Typography.Text type="secondary" style={{marginLeft:12}}>{homeHero?'请选择 MP4，处理完成后保存即可展示。':'单文件小于 2GB，支持 200MB 以上课件；中断后重新选择原文件继续。'}</Typography.Text>
    {task&&<div style={{marginTop:12,padding:16,background:'#fafafa',border:'1px solid #eee',borderRadius:8}}>
      <Typography.Text strong>{task.name}</Typography.Text><Progress percent={Math.min(100,Math.floor(sent/task.bytes*100))} status={error?'exception':task.state==='READY'?'success':busy?'active':'normal'}/>
      <Space wrap><Typography.Text type="secondary">{task.state==='PROCESSING'?'已上传，正在后台优化音视频；可以继续上传其他课件':task.state==='READY'?'处理完成，可直接使用':task.state==='FAILED'?'处理失败，原文件已保留 7 天供重试':`${(sent/1048576).toFixed(1)} / ${(task.bytes/1048576).toFixed(1)} MB${paused?' · 已暂停':''}`}</Typography.Text>
        {busy&&task.state==='UPLOADING'&&<Button size="small" onClick={()=>active.current?.abort()}>暂停</Button>}
        {!busy&&file&&task.state==='UPLOADING'&&<Button size="small" onClick={()=>void run(file)}>继续上传</Button>}
        {!busy&&task.state==='FAILED'&&<Button size="small" onClick={()=>void follow(task)}>重新处理</Button>}
        {!busy&&['UPLOADING','FAILED'].includes(task.state)&&<Button size="small" onClick={()=>void cancel()}>取消任务</Button>}
      </Space>
    </div>}
    {error&&<Alert style={{marginTop:12}} type="error" showIcon title={error} description="上传成功的分片会保留 7 天；可以继续上传。处理中离开页面不影响服务器任务，可在媒体库查看结果。"/>}
    {!busy&&pending.filter(row=>row.id!==task?.id).map(row=><div key={row.id} style={{marginTop:8}}><Space wrap><Typography.Text>{row.name} · {row.state==='UPLOADING'?'上传未完成，请重新选择原文件继续':row.state==='PROCESSING'?'正在处理':row.failure??'处理失败'}</Typography.Text>{row.state!=='UPLOADING'&&<Button size="small" onClick={()=>void follow(row)}>{row.state==='FAILED'?'重新处理':'查看处理进度'}</Button>}{row.state!=='PROCESSING'&&<Button size="small" onClick={()=>{void api(uploadPath+'/' +row.id+'/cancel','POST',{}).then(()=>setPending(rows=>rows.filter(item=>item.id!==row.id))).catch(e=>setError(e.message));}}>取消任务</Button>}</Space></div>)}
  </div>;
}
