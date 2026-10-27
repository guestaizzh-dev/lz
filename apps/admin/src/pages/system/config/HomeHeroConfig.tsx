import { useAccess } from '@umijs/max';
import { Alert, App, Button, Card, Radio, Space, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { api } from '@/api';
import ImagePicker from '@/components/ImagePicker';
import MediaUploader from '@/components/MediaUploader';

type Hero = { images:string[]; videoId:string };
type Config = { revision:number; value:Hero };
export default function HomeHeroConfig({item,reload,onDirty}:{item:Config;reload:()=>Promise<void>;onDirty:(value:boolean)=>void}) {
  const access=useAccess(),{message}=App.useApp();
  const [mode,setMode]=useState<'default'|'images'|'video'>('default'),[images,setImages]=useState<string[]>([]),[videoId,setVideoId]=useState(''),[busy,setBusy]=useState(false),[uploading,setUploading]=useState(false),[imageBusy,setImageBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{setImages(item.value.images??[]);setVideoId(item.value.videoId??'');setMode(item.value.videoId?'video':item.value.images?.length?'images':'default');onDirty(false);},[item,onDirty]);
  const changed=()=>onDirty(true);
  function setImage(index:number,url:string|null){const id=url?.match(/\/assets\/images\/([0-9a-f-]{36})(?:[?#]|$)/i)?.[1]??'';setImages(rows=>rows.map((row,i)=>i===index?id:row));changed();}
  function move(index:number,direction:number){setImages(rows=>{const next=[...rows],other=index+direction;[next[index],next[other]]=[next[other],next[index]];return next;});changed();}
  async function save(){
    if(busy||uploading||imageBusy)return;
    if(mode==='images'&&(!images.length||images.some(id=>!id))){setError('请上传或选择每张图片，也可移除空位置');return;}
    if(mode==='video'&&!videoId){setError('请先上传视频并等待处理完成');return;}
    setBusy(true);setError('');try{
      await api('/admin/config/homeHero','PUT',{expectedRevision:item.revision,value:{images:mode==='images'?images:[],videoId:mode==='video'?videoId:''},reason:'更新首页展示'});
      await reload();message.success('首页展示已更新');
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  const disabled=busy||uploading||imageBusy||!access.canConfigWrite;
  return <Card title="首页主图与视频" extra={<Typography.Text type="secondary">保存后 App 首页更新</Typography.Text>}>
    <Typography.Paragraph type="secondary">选择首页“上善若水”所在位置的内容。单张图片直接展示，多张按顺序轮播；视频处理完成后可发布。</Typography.Paragraph>
    {error&&<Alert type="error" title={error} showIcon style={{marginBottom:16}}/>}
    <Radio.Group value={mode} disabled={disabled} onChange={e=>{setMode(e.target.value);setError('');changed();}} options={[{label:'原有画面',value:'default'},{label:'图片 / 轮播',value:'images'},{label:'视频',value:'video'}]}/>
    {mode==='images'&&<div style={{marginTop:20,maxWidth:680}}>{images.map((id,index)=><Card key={index} size="small" title={'图片 '+(index+1)} style={{marginBottom:12}} extra={<Space><Button size="small" disabled={disabled||index===0} onClick={()=>move(index,-1)}>上移</Button><Button size="small" disabled={disabled||index===images.length-1} onClick={()=>move(index,1)}>下移</Button><Button size="small" danger disabled={disabled} onClick={()=>{setImages(rows=>rows.filter((_,i)=>i!==index));changed();}}>移除</Button></Space>}><ImagePicker ratio={2} value={id?'/api/v1/assets/images/'+id:null} disabled={disabled} onBusyChange={setImageBusy} onChange={url=>setImage(index,url)}/></Card>)}<Button disabled={disabled||images.length>=10} onClick={()=>{setImages(rows=>[...rows,'']);changed();}}>添加图片</Button></div>}
    {mode==='video'&&<div style={{marginTop:20}}><Typography.Paragraph>{videoId?'已选择视频；保存后在首页展示。':'请选择本地 MP4 视频。'}</Typography.Paragraph><MediaUploader homeHero compact onBusyChange={value=>{setUploading(value);if(value){setVideoId('');changed();}}} onReady={asset=>{setVideoId(asset.id);setError('');changed();}}/>{videoId&&videoId===item.value.videoId&&<video controls src={'/api/v1/media/stream?homeHero='+videoId} style={{width:'min(100%, 600px)',maxHeight:300,background:'#111'}}/>}</div>}
    {access.canConfigWrite&&<div style={{marginTop:24}}><Button type="primary" loading={busy} disabled={disabled} onClick={()=>void save()}>保存首页展示</Button></div>}
  </Card>;
}
