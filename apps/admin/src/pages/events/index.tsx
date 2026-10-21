import CategoryBatch from '@/components/CategorySelect/Batch';
import ImagePicker from '@/components/ImagePicker';
import {useUploads} from '@/components/ImagePicker/use-uploads';
import CategorySelect from '@/components/CategorySelect';
import Sessions from './Sessions';
import { PageContainer, ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import { Alert, App, Button, DatePicker, Drawer, Form, Input, InputNumber, Modal, Select, Space, Switch, Typography } from 'antd';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { useEffect, useRef, useState } from 'react';
import { api,session } from '@/api';
import MoneyInput from '@/components/MoneyInput';
import { formatChinaTime, chinaPickerValue, chinaPickerIso } from '@/utils/date-time';
dayjs.extend(utc);

type Event={teacherId?:string|null;teacherName?:string|null;id:string;version:number;title:string;description:string;category:string;categoryLabel?:string;cover:string;location:string;startsAt:string;endsAt:string;capacity:number;price:number;status:string;responsibleUserId:string;responsibleUserName:string};
type Staff={id:string;nickname:string};
const states={DRAFT:{text:'草稿',status:'Default'},REVIEW:{text:'待审核',status:'Processing'},PUBLISHED:{text:'已发布',status:'Success'},REJECTED:{text:'已驳回',status:'Error'},ARCHIVED:{text:'已下架',status:'Default'}};
const actions:Record<string,string>={submit:'提交审核',publish:'审核发布',reject:'驳回',archive:'下架',revise:'修订'};
export default function EventsPage() {
  const [selected,setSelected]=useState<Event[]>([]);
  const {uploading,track}=useUploads(),publishAfterSave=useRef(false);
  const access=useAccess(),{message,modal}=App.useApp(),table=useRef<ActionType>(undefined),[form]=Form.useForm(),[transitionForm]=Form.useForm(),[editor,setEditor]=useState<{item?:Event;read:boolean}>(),[transition,setTransition]=useState<{item:Event;action:string}>(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[staff,setStaff]=useState<Staff[]>([]),[teachers,setTeachers]=useState<{id:string;name:string}[]>([]);
  useEffect(()=>{if(access.canEventsEdit)Promise.all([api<Staff[]>('/admin/events/staff'),api<{id:string;name:string}[]>('/admin/events/teachers')]).then(([staff,teachers])=>{setStaff(staff);setTeachers(teachers);}).catch(e=>setError((e as Error).message));},[access.canEventsEdit]);
  function edit(item?:Event,read=false){setError('');form.resetFields();form.setFieldsValue(item?{...item,startsAt:chinaPickerValue(item.startsAt),endsAt:chinaPickerValue(item.endsAt)}:{category:'线下活动',cover:'/static/art/mountains.svg',capacity:30,price:0,responsibleUserId:session?.user.id??staff[0]?.id});setEditor({item,read});}
  function begin(item:Event,action:string){setError('');transitionForm.resetFields();if(access.canAdmin&&action!=='reject')transitionForm.setFieldValue('reason','管理员'+actions[action]);setTransition({item,action});}
  async function save(values:Record<string,any>){if(busy||uploading)return;setBusy(true);setError('');try{
    const body=Object.fromEntries(['title','description','category','cover','location','capacity','price','responsibleUserId','teacherId','studyTour','studyTourBrief'].map(key=>[key,values[key]]));
    for(const key of ['startsAt','endsAt'])body[key]=chinaPickerIso(values[key]);
    const saved=await api<Event>(editor?.item?'/admin/events/'+editor.item.id:'/admin/events',editor?.item?'PATCH':'POST',{...body,...(editor?.item?{expectedVersion:editor.item.version}:{})});setEditor({item:saved,read:false});if(publishAfterSave.current)await api('/admin/events/'+saved.id+'/transition','POST',{action:'publish',expectedVersion:saved.version});setEditor(undefined);table.current?.reload();message.success(publishAfterSave.current?'活动已发布':'活动草稿已保存');
  }catch(e){setError((e as Error).message);}finally{publishAfterSave.current=false;setBusy(false);}}
  async function move(values:{reason:string}){if(!transition||busy)return;setBusy(true);setError('');try{await api('/admin/events/'+transition.item.id+'/transition','POST',{...values,action:transition.action,expectedVersion:transition.item.version});setTransition(undefined);table.current?.reload();message.success('活动状态已更新');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  const [sessions,setSessions]=useState<Event>();
  const columns:ProColumns<Event>[]=[{title:'活动名称',dataIndex:'q',render:(_,row)=><Button type="link" onClick={()=>edit(row,true)}>{row.title}</Button>},{title:'分类',dataIndex:'category',render:(_,row)=>row.categoryLabel??row.category,formItemRender:(_,config)=> <CategorySelect scope="EVENT" value={config.value} onChange={config.onChange}/>},{title:'负责人',dataIndex:'responsibleUserName',search:false},{title:'状态',dataIndex:'status',valueEnum:states},{title:'开始时间（北京时间）',search:false,render:(_,row)=>formatChinaTime(row.startsAt)},{title:'地点',dataIndex:'location',search:false},{title:'人数上限',dataIndex:'capacity',search:false},{title:'票价',search:false,render:(_,row)=>'¥'+(row.price/100).toFixed(2)},{title:'操作',valueType:'option',render:(_,row)=><Space wrap><Button type="link" onClick={()=>setSessions(row)}>场次与报名</Button>
    {access.canEventsEdit&&['DRAFT','REJECTED'].includes(row.status)&&<><Button type="link" onClick={()=>edit(row)}>编辑</Button><Button type="link" onClick={()=>begin(row,access.canAdmin?'publish':'submit')}>{access.canAdmin?'发布':'提交审核'}</Button></>}
    {access.canEventsReview&&row.status==='REVIEW'&&<><Button type="link" onClick={()=>begin(row,'publish')}>审核发布</Button><Button type="link" danger onClick={()=>begin(row,'reject')}>驳回</Button></>}
    {access.canAdmin&&row.status==='PUBLISHED'&&<Button type="link" onClick={()=>modal.confirm({title:'开始修改活动？',content:'编辑期间暂时下架；已有报名的活动可能需要新建安排，原订单和参加资格保留。',onOk:async()=>{try{await api('/admin/events/'+row.id+'/transition','POST',{action:'revise',expectedVersion:row.version});await edit({...row,status:'DRAFT',version:row.version+1});table.current?.reload();}catch(e){message.error((e as Error).message);}}})}>编辑</Button>}
    {access.canEventsEdit&&row.status==='PUBLISHED'&&<Button type="link" danger onClick={()=>begin(row,'archive')}>下架</Button>}{access.canEventsEdit&&['ARCHIVED','REJECTED'].includes(row.status)&&<Button type="link" onClick={()=>begin(row,'revise')}>修订</Button>}
  </Space>}];
  return <PageContainer title="活动管理" subTitle="发布活动、安排场次和查看报名，时间统一为北京时间">
    <ProTable<Event> rowSelection={access.canAdmin?{selectedRowKeys:selected.map(row=>row.id),onChange:(_,rows)=>setSelected(rows)}:undefined}  rowKey="id" actionRef={table} columns={columns} pagination={{pageSize:20}} toolBarRender={()=>access.canEventsEdit?[...(access.canAdmin?[<CategoryBatch key="batch" scope="EVENT" items={selected} onDone={()=>{setSelected([]);table.current?.reload();}}/>]:[]),<Button key="create" type="primary" onClick={()=>edit()}>创建活动</Button>]:[]} request={async p=>{const q=new URLSearchParams({page:String(p.current??1),size:String(p.pageSize??20)});for(const key of ['q','status','category'])if(p[key])q.set(key,String(p[key]));const result=await api<{items:Event[];total:number}>('/admin/events?'+q);return{data:result.items,total:result.total,success:true};}}/>
    <Drawer title={editor?.read?'活动资料':editor?.item?'编辑活动':'创建活动'} open={!!editor} size={740} onClose={()=>{if(busy)return;if(!editor?.read&&form.isFieldsTouched())modal.confirm({title:'放弃未保存的活动？',onOk:()=>setEditor(undefined)});else setEditor(undefined);}} extra={!editor?.read&&<Space wrap><Button loading={busy} disabled={uploading} onClick={()=>{publishAfterSave.current=false;form.submit();}}>保存草稿</Button>{access.canAdmin&&<Button type="primary" loading={busy} disabled={uploading} onClick={()=>{publishAfterSave.current=true;form.submit();}}>保存并发布</Button>}</Space>}>
      {error&&<Alert type="error" showIcon title={error} style={{marginBottom:16}}/>}
      <Form form={form} layout="vertical" disabled={busy||editor?.read} onFinish={save} onFinishFailed={()=>{publishAfterSave.current=false;}}>
        {[['title','活动名称',150],['location','地点',200]].map(([key,label,max])=><Form.Item key={key} name={key} label={label} rules={[{required:true,whitespace:true,max:Number(max)}]}><Input maxLength={Number(max)}/></Form.Item>)}
<Form.Item name="category" label="活动分类" rules={[{required:true}]}><CategorySelect scope="EVENT"/></Form.Item><Form.Item name="cover" label="活动封面" rules={[{required:true}]}><ImagePicker onBusyChange={value=>track("cover",value)}/></Form.Item>
        <Form.Item hidden={staff.length<=1} name="responsibleUserId" label="活动负责人" rules={[{required:true,message:'请选择活动负责人'}]}><Select showSearch optionFilterProp="label" options={staff.map(item=>({value:item.id,label:item.nickname}))} placeholder="选择负责活动协调的运营人员"/></Form.Item>
        {editor?.read?<Form.Item label="活动主讲"><Input value={editor.item?.teacherName??'未指定'} disabled/></Form.Item>:<Form.Item name="teacherId" label="活动主讲（线下课程必选）" extra="用于名师真实日程及线下课堂绑定；活动协调负责人另行指定。"><Select allowClear onClear={()=>form.setFieldValue('teacherId',null)} showSearch optionFilterProp="label" options={teachers.map(t=>({value:t.id,label:t.name}))}/></Form.Item>}
        <Form.Item name="studyTour" label="研学活动" valuePropName="checked"><Switch/></Form.Item>
        <Form.Item noStyle shouldUpdate={(a,b)=>a.studyTour!==b.studyTour}>{({getFieldValue})=>getFieldValue('studyTour')&&<Form.Item name="studyTourBrief" label="实际行程与参加说明" rules={[{required:true,min:10,max:4000,whitespace:true}]} extra="说明行程、集合安排、费用包含与不包含、参加条件；优先窗口在场次配置，共用同一容量。"><Input.TextArea rows={5} maxLength={4000}/></Form.Item>}</Form.Item>
        <Form.Item name="description" label="活动介绍" rules={[{required:true,whitespace:true,max:5000}]}><Input.TextArea rows={7} maxLength={5000} showCount/></Form.Item>
        <Space wrap align="start"><Form.Item name="startsAt" label="开始时间（北京时间）" rules={[{required:true}]}><DatePicker showTime format="YYYY-MM-DD HH:mm"/></Form.Item><Form.Item name="endsAt" label="结束时间（北京时间）" rules={[{required:true}]}><DatePicker showTime format="YYYY-MM-DD HH:mm"/></Form.Item></Space>
        <Space wrap align="start"><Form.Item name="capacity" label="人数上限" rules={[{required:true}]}><InputNumber min={1} max={100000}/></Form.Item><Form.Item name="price" label="票价（元）" rules={[{required:true}]}><MoneyInput min={0} max={100000000}/></Form.Item></Space>
        <Typography.Paragraph type="secondary">管理员首次发布时，按以上时间、地点、人数和票价自动开放一场报名，每人1席。默认可在开始前1小时自助取消（不足1小时则以开放报名时刻为截止）；多场活动或多票种可在「场次与报名」继续安排。付费报名按实际收款开通状态提供。</Typography.Paragraph>
      </Form>
    </Drawer>
    <Drawer title={'场次与报名 · '+(sessions?.title??'')} size={980} open={!!sessions} onClose={()=>setSessions(undefined)}>{sessions&&<Sessions key={sessions.id} event={sessions}/>}</Drawer>
    <Modal title={actions[transition?.action??'submit']+' · '+(transition?.item.title??'')} open={!!transition} confirmLoading={busy} onOk={()=>transitionForm.submit()} onCancel={()=>{if(!busy)setTransition(undefined);}}>
      {error&&<Alert type="error" showIcon title={error} style={{marginBottom:16}}/>}<Form form={transitionForm} layout="vertical" disabled={busy} onFinish={move}><Form.Item hidden={access.canAdmin&&transition?.action!=='reject'} name="reason" label="操作原因" rules={[{required:true,whitespace:true,max:500}]}><Input.TextArea maxLength={500} rows={3}/></Form.Item></Form>
    </Modal>
  </PageContainer>;
}
