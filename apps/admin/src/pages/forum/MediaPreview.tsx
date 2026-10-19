import { Alert, Button, Space, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/api';

export default function MediaPreview({threadId,assetId,type}:{threadId:string;assetId:string;type:string}){
  const [url,setUrl]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(false),sequence=useRef(0),player=useRef<HTMLMediaElement|null>(null);
  async function load(){const token=++sequence.current;setLoading(true);setError('');player.current?.pause();setUrl('');try{const result=await api<{path:string}>('/admin/forum/threads/'+threadId+'/media/'+assetId,'POST');if(token===sequence.current)setUrl('/api/v1'+result.path);}catch(e){if(token===sequence.current)setError((e as Error).message);}finally{if(token===sequence.current)setLoading(false);}}
  useEffect(()=>{void load();return()=>{sequence.current++;player.current?.pause();};},[threadId,assetId]);
  return <div style={{marginTop:16,marginBottom:16}}><Space style={{marginBottom:8}}><Typography.Text strong>{type==='video'?'投稿视频':'投稿音频'}</Typography.Text><Button size="small" loading={loading} onClick={()=>void load()}>刷新试看</Button></Space>{url&&(type==='video'?<video ref={node=>{player.current=node;}} aria-label="投稿视频审核预览" src={url} controls preload="metadata" style={{display:'block',width:'100%',maxHeight:320,background:'#17292D',borderRadius:8}} onError={()=>setError('试看链接可能已失效，请刷新；仍失败请驳回并通知作者重新投稿。')}/>:<audio ref={node=>{player.current=node;}} aria-label="投稿音频审核预览" src={url} controls preload="metadata" style={{display:'block',width:'100%'}} onError={()=>setError('试听失败，请刷新后重试。')}/>)}{error&&<Alert type="warning" showIcon title={error} style={{marginTop:8}}/>}</div>;
}
