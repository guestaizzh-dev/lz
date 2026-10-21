import { api } from '@/api';
import { Alert, App, Button, Modal, Space } from 'antd';
import { useState } from 'react';
import CategorySelect from './index';
export default function CategoryBatch({scope,items,onDone}:{scope:string;items:{id:string;version:number}[];onDone:()=>void}){
  const {message}=App.useApp(),[open,setOpen]=useState(false),[category,setCategory]=useState<string>(),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function save(){if(!category||busy)return;setBusy(true);try{const result=await api<{count:number}>('/admin/categories/assign','POST',{scope,category,items:items.map(({id,version})=>({id,version}))});setOpen(false);onDone();message.success('已调整'+result.count+'项内容的分类');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <><Button disabled={!items.length} onClick={()=>{setCategory(undefined);setError('');setOpen(true);}}>批量归类{items.length?'（'+items.length+'）':''}</Button><Modal title={'调整'+items.length+'项内容的分类'} open={open} onCancel={()=>!busy&&setOpen(false)} onOk={save} confirmLoading={busy} okButtonProps={{disabled:!category}}><Space orientation="vertical" style={{width:'100%'}}><CategorySelect scope={scope} value={category} onChange={setCategory} disabled={busy}/><Alert type="info" title="只调整内容归类，原订单、已售课程版本和已享权益保持。"/>{error&&<Alert type="error" title={error}/>}</Space></Modal></>;
}
