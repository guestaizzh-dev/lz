import { Alert, App, Form, Input, Modal, Select, Switch, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/api';

type Plan={id:string;version:number;title:string};
export default function EventBenefits({plan,onClose,onSaved}:{plan:Plan;onClose:()=>void;onSaved:()=>void}){
  const {message,modal}=App.useApp(),[form]=Form.useForm(),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[events,setEvents]=useState<{value:string;label:string}[]>([]),generation=useRef(0);
  const enabled=Form.useWatch('eventPriority',form);
  async function search(q=''){const g=++generation.current;try{const r=await api<{items:{id:string;title:string;status:string}[]}>('/admin/events?size=50&q='+encodeURIComponent(q));if(g===generation.current)setEvents(r.items.filter(e=>e.status==='PUBLISHED').map(e=>({value:e.id,label:e.title})));}catch(e){if(g===generation.current)setError((e as Error).message);}}
  async function load(){setLoading(true);setError('');try{const r=await api<{current:{benefits:{definition:{code:string};scopes:{resourceId:string|null}[]}[]}|null}>('/admin/membership-benefits/plans/'+plan.id+'?size=1');const b=r.current?.benefits.find(x=>x.definition.code==='EVENT_PRIORITY');form.setFieldsValue({eventPriority:!!b,eventIds:b?.scopes.flatMap(s=>s.resourceId?[s.resourceId]:[])??[]});await search();}catch(e){setError((e as Error).message);}finally{setLoading(false);}}
  useEffect(()=>{load();},[plan.id]);
  function cancel(){if(busy)return;if(form.isFieldsTouched())modal.confirm({title:'放弃未保存的活动权益？',onOk:onClose});else onClose();}
  async function save(values:Record<string,unknown>){if(busy||loading)return;setBusy(true);setError('');try{await api('/admin/membership-benefits/plans/'+plan.id+'/events','POST',{...values,eventIds:values.eventPriority?values.eventIds:[],expectedVersion:plan.version});message.success('新售活动权益已发布，旧会员保持原版本');onSaved();onClose();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <Modal open title={plan.title+' · 新售活动权益'} onOk={()=>form.submit()} onCancel={cancel} confirmLoading={busy} okText="发布新权益版本" okButtonProps={{disabled:loading}}>
    <Typography.Paragraph>会员优先报名仅适用于公布了优先窗口的活动，共用实际剩余名额。旧会员、已确认报名和其他权益保留；不包含票价减免或免费咨询。</Typography.Paragraph>
    {error&&<Alert type="error" showIcon title={error} style={{marginBottom:16}}/>}
    <Form form={form} name="membership-event-benefits" layout="vertical" disabled={busy||loading} initialValues={{eventPriority:false,eventIds:[]}} onFinish={save}>
      <Form.Item name="eventPriority" label="活动优先报名" valuePropName="checked"><Switch aria-label="活动优先报名"/></Form.Item>
      {enabled&&<Form.Item name="eventIds" label="适用活动" extra="未选择表示所有设置了会员优先窗口的书院活动。"><Select aria-label="适用活动" mode="multiple" showSearch filterOption={false} onSearch={search} options={events} placeholder="可选：选择指定活动"/></Form.Item>}
      <Form.Item name="reason" label="调整原因" rules={[{required:true,whitespace:true,min:2,max:500}]}><Input.TextArea aria-label="活动权益调整原因" maxLength={500} rows={3}/></Form.Item>
    </Form>
  </Modal>;
}
