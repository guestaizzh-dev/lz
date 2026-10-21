import {useEffect,useRef,useState} from 'react';
import {App,Button,Space,Typography,Upload} from 'antd';
import {api} from '@/api';
export default function PrivateEvidenceUpload({value,onChange,endpoint='/admin/partner-finance/proof',onBusyChange}:{value?:string;onChange?:(id:string)=>void;endpoint?:string;onBusyChange?:(busy:boolean)=>void}){
 const {message}=App.useApp(),[busy,setBusy]=useState(false),[name,setName]=useState(''),alive=useRef(true),callback=useRef(onBusyChange);callback.current=onBusyChange;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;callback.current?.(false);};},[]);
 return <Space wrap><Upload accept="application/pdf,image/png,image/jpeg,image/webp" showUploadList={false} disabled={busy} beforeUpload={async file=>{if(file.size>8*1024*1024){message.error('请选择8MB以内的PDF或图片');return false;}setBusy(true);callback.current?.(true);try{const body=new FormData();body.append('file',file);const result=await api<{id:string}>(endpoint,'POST',body);if(alive.current){onChange?.(result.id);setName(file.name);message.success('私有凭证已上传');}}catch(e){if(alive.current)message.error((e as Error).message);}finally{if(alive.current)setBusy(false);callback.current?.(false);}return false;}}><Button loading={busy}>{value?'更换凭证':'上传本地凭证'}</Button></Upload><Typography.Text type="secondary">{value?name||'已上传私有凭证':'PDF、PNG、JPEG或WebP，最大8MB'}</Typography.Text></Space>;
}
