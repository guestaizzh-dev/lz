import { useEffect, useState } from 'react';
import { Alert, App, Button, Card, DatePicker, Empty, Form, Input, InputNumber, Select, Space, Tag, Typography } from 'antd';
import { useAccess } from '@umijs/max';
import { api } from '@/api';
import { chinaPickerIso, chinaPickerValue, formatChinaTime } from '@/utils/date-time';

export const relationKinds: Record<string,string> = {ARTICLE:'文章',TEACHER:'名师',COURSE:'课程',LIVE:'直播',PRODUCT:'商品',EVENT:'活动'};
type Relation={id:string;fromId:string;toId:string;relationType:string;rank:number;version:number;incoming:boolean;startsAt:string|null;endsAt:string|null;target?:{id:string;title:string;kind:string;publishState:string}};
type Choice={value:string;label:string;type:string};
export async function contentChoices(q:string,types=Object.keys(relationKinds)):Promise<Choice[]> {
  const rows=await Promise.all(types.map(type=>api<{items:{id:string;title:string}[]}>('/discovery/search?type='+type+'&q='+encodeURIComponent(q)+'&size=15').then(r=>r.items.map(i=>({value:i.id,label:relationKinds[type]+' · '+i.title,type})))));return rows.flat();
}
export default function ContentRelations({resourceId,kind}:{resourceId:string;kind:string}) {
  const access=useAccess(),{message}=App.useApp(),[rows,setRows]=useState<Relation[]>([]),[choices,setChoices]=useState<Choice[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[editing,setEditing]=useState<Relation>(),[form]=Form.useForm();
  const canReview=({ARTICLE:access.canContentReview,TEACHER:access.canCoursesReview,COURSE:access.canCoursesReview,LIVE:access.canLiveReview,PRODUCT:access.canProductsReview,EVENT:access.canEventsReview} as Record<string,boolean>)[kind];
  const purposes:Record<string,string>={RELATED:'常规关联 / 代表课程',INTRODUCTION:'公开音视频介绍',INTERPRETATION:'会员专属解读'};
  const selectedId=Form.useWatch('toId',form),selectedType=editing?.target?.kind??choices.find(c=>c.value===selectedId)?.type;
  async function load(){try{setRows((await api<{items:Relation[]}>('/admin/content-relations/'+resourceId)).items);setError('');}catch(e){setError((e as Error).message);}}
  useEffect(()=>{setRows([]);setEditing(undefined);form.resetFields();load();},[resourceId]);
  async function find(q:string){try{setChoices((await contentChoices(q)).filter(i=>i.value!==resourceId));}catch(e){setError((e as Error).message);}}
  async function save(v:Record<string,any>){if(busy)return;const target=editing?.target??choices.find(c=>c.value===v.toId);if(!target)return;setBusy(true);try{await api('/admin/content-relations','POST',{fromId:resourceId,fromType:kind,toId:v.toId,type:'kind' in target?target.kind:target.type,purpose:kind==='TEACHER'&&selectedType==='ARTICLE'?v.purpose??'RELATED':'RELATED',rank:v.rank,reason:v.reason,...(editing?{expectedVersion:editing.version}:{}),...(v.startsAt?{startsAt:chinaPickerIso(v.startsAt)}:{}),...(v.endsAt?{endsAt:chinaPickerIso(v.endsAt)}:{})});setEditing(undefined);form.resetFields();await load();message.success('双向关联已保存');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function remove(r:Relation){setBusy(true);try{await api('/admin/content-relations/'+resourceId+'/'+r.id,'DELETE');await load();message.success('关联已移除');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  function edit(r:Relation){setEditing(r);form.setFieldsValue({toId:r.toId,rank:r.rank,purpose:r.relationType.endsWith('_INTRODUCTION')?'INTRODUCTION':r.relationType.endsWith('_INTERPRETATION')?'INTERPRETATION':'RELATED',startsAt:r.startsAt?chinaPickerValue(r.startsAt):null,endsAt:r.endsAt?chinaPickerValue(r.endsAt):null,reason:''});}
  return <Space orientation="vertical" size="middle" style={{width:'100%'}}>
    <Typography.Paragraph type="secondary">一次关联会在两边详情页展示。下架、隐藏或超过展示期限的内容自动退出推荐；已购课程版本保持原样。</Typography.Paragraph>
    {kind==='TEACHER'&&<Alert type="info" showIcon title="名师档案编排" description="关联本人课程即可按排序展示为代表课；关联文章可选择公开音视频介绍或会员专属解读。直播、活动与咨询日程读取真实业务安排，无需在此重复录入时间。"/>}
    {error&&<Alert type="error" showIcon title={error} action={<Button onClick={load}>刷新</Button>}/>}
    {!rows.length&&<Empty description="尚未配置关联内容"/>}
    {rows.map(r=><Card key={r.id} size="small"><Space wrap><Tag>{relationKinds[r.target?.kind??'']??'内容'}</Tag><Typography.Text>{r.target?.title??'内容已移除'}</Typography.Text><Tag>{r.target?.publishState==='PUBLISHED'?'已发布':'当前不展示'}</Tag><Typography.Text type="secondary">排序 {r.rank}{r.incoming?' · 来自对方关联':''}</Typography.Text></Space><Typography.Paragraph type="secondary" style={{marginTop:8,marginBottom:8}}>{r.startsAt?'开始 '+formatChinaTime(r.startsAt):'立即展示'} · {r.endsAt?'截止 '+formatChinaTime(r.endsAt):'持续展示'}</Typography.Paragraph>{canReview&&!r.incoming&&<Space><Button disabled={busy} onClick={()=>edit(r)}>调整顺序 / 期限</Button><Button danger disabled={busy} onClick={()=>remove(r)}>移除</Button></Space>}</Card>)}
    {canReview&&<Card title={editing?'编辑关联':'新增关联'} size="small"><Form form={form} layout="vertical" onFinish={save} initialValues={{rank:0}} disabled={busy}>
      <Form.Item name="toId" label="关联内容" rules={[{required:true}]}><Select disabled={!!editing} showSearch={{filterOption:false,onSearch:find}} onOpenChange={open=>{if(open)find('');}} options={editing?[{value:editing.toId,label:editing.target?.title??'内容已移除',type:editing.target?.kind??''}]:choices} placeholder="搜索文章、名师、课程、直播、商品或活动"/></Form.Item>
      {kind==='TEACHER'&&selectedType==='ARTICLE'&&<Form.Item name="purpose" label="在名师档案中的用途" initialValue="RELATED"><Select options={Object.entries(purposes).map(([value,label])=>({value,label}))}/></Form.Item>}
      <Form.Item name="rank" label="显示顺序（越小越靠前）" rules={[{required:true}]}><InputNumber min={0} max={9999}/></Form.Item><Space align="start"><Form.Item name="startsAt" label="开始展示（北京时间，可选）"><DatePicker showTime format="YYYY-MM-DD HH:mm"/></Form.Item><Form.Item name="endsAt" label="结束展示（北京时间，可选）"><DatePicker showTime format="YYYY-MM-DD HH:mm"/></Form.Item></Space><Form.Item name="reason" label="维护原因" rules={[{required:true,whitespace:true}]}><Input maxLength={500}/></Form.Item><Space><Button htmlType="submit" type="primary" loading={busy}>审核并保存</Button>{editing&&<Button onClick={()=>{setEditing(undefined);form.resetFields();}}>取消编辑</Button>}</Space>
    </Form></Card>}
  </Space>;
}
