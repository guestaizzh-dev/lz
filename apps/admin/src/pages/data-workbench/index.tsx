import { PageContainer, ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import { Alert, App, Button, Descriptions, Drawer, Form, Input, InputNumber, Modal, Select, Space, Switch, Tag, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/api';

type Field = { name: string; source: string; type: string; nullable: boolean; default: boolean; initial:boolean|null; choices: string[]; reference: {entity:string; field:string}|null; writable: boolean; readable: boolean; writeOnly: boolean };
type Entity = { key:string; module:string; phase:string; description:string; fields:Field[]; permissions:{read:boolean;create:boolean;update:boolean;delete:boolean;ownerOnly:boolean;mode:string} };
type Row = Record<string,unknown> & {id:string;_revision:string};
const labels: Record<string,string> = { id:'标识',title:'标题',name:'名称',code:'编码',nickname:'昵称',status:'状态',state:'业务状态',reviewState:'审核状态',createdAt:'创建时间',updatedAt:'更新时间',version:'版本',description:'说明',summary:'摘要',active:'启用',body:'正文',reason:'原因',userId:'用户',authorId:'作者',teacherId:'名师',courseId:'课程',resourceId:'内容资源',position:'顺序',price:'价格（分）',stock:'库存',capacity:'容量',startsAt:'开始时间',endsAt:'结束时间',days:'天数',tier:'会员等级',resourceTitle:'资源标题',_revision:'修改凭据' };
const fieldLabel = (field: Field) => labels[field.name] ?? field.source;
const display = (value:unknown) => value==null?'—':typeof value==='object'?JSON.stringify(value):typeof value==='boolean'?(value?'是':'否'):String(value);
const toForm = (f:Field,value:unknown) => ['jsonb','text[]'].includes(f.type)&&value!=null?JSON.stringify(value,null,2):value;

function ForeignInput({field,entities,value,onChange}:{field:Field;entities:Entity[];value?:string;onChange?:(v:string)=>void}) {
  const {message}=App.useApp();
  const [options,setOptions]=useState<{label:string;value:string}[]>([]);
  const target=entities.find(e=>e.key===field.reference?.entity);
  const search=async(q='')=>{
    if (!target) return;
    try { const result=await api<{items:Row[]}>(`/admin/data/${target.key}?size=20&q=${encodeURIComponent(q)}`); setOptions(result.items.map(r=>({value:r.id,label:`${display(r.title??r.name??r.nickname??r.code??r.id)} · ${r.id.slice(0,8)}`}))); } catch(error) { message.error((error as Error).message); }
  };
  if (!target) return <Input aria-label={fieldLabel(field)} value={value} onChange={e=>onChange?.(e.target.value)} placeholder="填写关联记录标识" />;
  return <Select aria-label={fieldLabel(field)} showSearch allowClear filterOption={false} value={value} onChange={onChange} options={options} onOpenChange={open=>{if(open)void search();}} onSearch={q=>void search(q)} placeholder={`选择关联记录 · ${target.description}`} />;
}

export default function DataWorkbench() {
  const {message}=App.useApp();
  const [entities,setEntities]=useState<Entity[]>([]), [key,setKey]=useState('tag');
  const [editing,setEditing]=useState<Row|null|undefined>(), [detail,setDetail]=useState<Row>(), [saving,setSaving]=useState(false);
  const [deleting,setDeleting]=useState<Row>(), [deleteReason,setDeleteReason]=useState('');
  const [form]=Form.useForm(), action=useRef<ActionType>(undefined);
  const entity=entities.find(e=>e.key===key);
  const endpoint='/admin/data/'+key;
  useEffect(()=>{api<Entity[]>('/admin/data/schema').then(data=>{setEntities(data);if(!data.some(e=>e.key===key))setKey(data[0]?.key??'');}).catch(error=>message.error(error.message));},[]);
  const editable=entity?.fields.filter(f=>f.writable)??[];
  const titleRequired=!!entity?.fields.find(f=>f.name==='resourceKind')&&!editable.some(f=>['title','name'].includes(f.name));
  async function openEdit(row?:Row) {
    try {
      const loaded=row?await api<Row>(endpoint+'/'+row.id):null;
      let resourceTitle;
      if (loaded&&titleRequired) resourceTitle=(await api<Row>('/admin/data/resource/'+loaded.id)).title;
      form.resetFields();
      form.setFieldsValue(loaded?{...Object.fromEntries(editable.filter(f=>!f.writeOnly).map(f=>[f.name,toForm(f,loaded[f.name])])),resourceTitle}:Object.fromEntries(editable.filter(f=>f.type==='boolean'&&f.initial!=null).map(f=>[f.name,f.initial])));
      setEditing(loaded);
    }catch(error){message.error((error as Error).message);}
  }
  async function save() {
    try {
      const values=await form.validateFields(); const data:Record<string,unknown>={};
      if(key==='user_role'){
        setSaving(true);await api('/admin/data/roles/grant','POST',{userId:values.userId,role:values.role,reason:values._reason});
        message.success('角色已授权');setEditing(undefined);action.current?.reload();return;
      }
      for(const f of editable) {
        const value=values[f.name];
        if(value===undefined || f.writeOnly&&value==='')continue;
        if(editing&&!form.isFieldTouched(f.name))continue;
        data[f.name]=value===''&&f.nullable?null:['jsonb','text[]'].includes(f.type)?JSON.parse(value):value;
      }
      if(titleRequired&&(!editing||form.isFieldTouched('resourceTitle')))data.resourceTitle=values.resourceTitle;
      setSaving(true);
      await api(endpoint+(editing?'/'+editing.id:''),editing?'PATCH':'POST',{data,reason:values._reason,...(editing?{expectedRevision:editing._revision}:{})});
      message.success('已保存');setEditing(undefined);action.current?.reload();
    }catch(error){if(error instanceof Error)message.error(error.message);}finally{setSaving(false);}
  }
  async function remove() {
    if(!deleting)return;
    try{setSaving(true);await api(key==='user_role'?'/admin/data/roles/'+deleting.id+'/revoke':endpoint+'/'+deleting.id,key==='user_role'?'POST':'DELETE',{reason:deleteReason,expectedRevision:deleting._revision});message.success(key==='user_role'?'授权已撤销':'已删除');setDeleting(undefined);setDeleteReason('');action.current?.reload();}catch(error){message.error((error as Error).message);}finally{setSaving(false);}
  }
  const visible=entity?.fields.filter(f=>f.readable&& !['jsonb','text[]'].includes(f.type))??[];
  const priority=['title','name','code','nickname','status','state','reviewState','active','updatedAt','createdAt'];
  const chosen=[...priority.flatMap(name=>visible.filter(f=>f.name===name)),...visible.filter(f=>!priority.includes(f.name)&&f.name!=='id')].slice(0,7);
  const columns: ProColumns<Row>[]=[{title:'搜索',dataIndex:'q',hideInTable:true},...chosen.map(f=>({title:fieldLabel(f),dataIndex:f.name,search:false,ellipsis:true,render:(_:unknown,row:Row)=>display(row[f.name])})),{title:'操作',valueType:'option',search:false,width:190,render:(_,row)=>[
    <a key="detail" onClick={()=>{api<Row>(endpoint+'/'+row.id).then(setDetail).catch(e=>message.error(e.message));}}>详情</a>,
    entity?.permissions.update&&!(key==='sale_offer'&&row.id.startsWith('sku-offer-'))&&<a key="edit" onClick={()=>void openEdit(row)}>编辑</a>,
    entity?.permissions.delete&&!(key==='sale_offer'&&row.id.startsWith('sku-offer-'))&&<a key="delete" onClick={()=>{setDeleting(row);setDeleteReason('');}}>删除</a>,
    key==='user_role'&&!row.revokedAt&&<a key="revoke" onClick={()=>{setDeleting(row);setDeleteReason('');}}>撤销授权</a>,
  ]}];
  const modules=[...new Set(entities.map(e=>e.module))];
  return <PageContainer title="业务数据管理" subTitle="按业务模块维护配置与资料，查询流程记录">
    <Space wrap style={{marginBottom:16}}><Select aria-label="选择业务实体" showSearch optionFilterProp="label" value={key} style={{width:460,maxWidth:'100%'}} onChange={value=>{setKey(value);setEditing(undefined);setDetail(undefined);}} options={modules.map(module=>({label:module,options:entities.filter(e=>e.module===module).map(e=>({value:e.key,label:`${e.description} · ${e.key}`}))}))}/><Tag>{entity?.phase}</Tag></Space>
    {entity?.permissions.mode==='workflow'&&<Alert style={{marginBottom:16}} type="info" showIcon title="此处查询业务流程记录" description={key==='user_role'?'可在本页授权或撤销角色，所有变更保留审计。':'该记录由登录、发布、授权、交易或核验流程生成。相关操作由所属业务模块提供，尚未接入的流程暂不可操作。'}/>}
    {entity?.permissions.ownerOnly&&<Alert style={{marginBottom:16}} type="info" showIcon title="私人数据仅显示当前账号的记录"/>}
    {entity&&<ProTable<Row> key={key} rowKey="id" actionRef={action} columns={columns} headerTitle={entity.description} pagination={{pageSize:20,showSizeChanger:true,pageSizeOptions:[10,20,50]}} scroll={{x:1000}} request={async params=>{try{const result=await api<{items:Row[];total:number}>(endpoint+`?page=${params.current??1}&size=${params.pageSize??20}&q=${encodeURIComponent(params.q??'')}`);return{data:result.items,total:result.total,success:true};}catch(error){message.error((error as Error).message);return{data:[],total:0,success:false};}}} toolBarRender={()=>entity.permissions.create||key==='user_role'?[<Button key="new" type="primary" onClick={()=>void openEdit()}>{key==='user_role'?'授权角色':'新建记录'}</Button>]:[]}/>}
    <Drawer title={editing?'编辑记录':'新建记录'} open={editing!==undefined} size={720} onClose={()=>setEditing(undefined)} extra={<Button type="primary" loading={saving} onClick={()=>void save()}>保存</Button>} destroyOnHidden>
      <Form form={form} layout="vertical">
        {key==='user_role'&&<><Form.Item name="userId" label="用户" rules={[{required:true}]}><ForeignInput field={entity!.fields.find(f=>f.name==='userId')!} entities={entities}/></Form.Item><Form.Item name="role" label="授予角色" rules={[{required:true}]}><Select options={['TEACHER','OPERATOR','MODERATOR','SUPPORT','FINANCE','ADMIN'].map(value=>({value,label:value}))}/></Form.Item></>}
        {titleRequired&&<Form.Item label="资源标题" name="resourceTitle" rules={[{required:!editing,max:120}]}><Input /></Form.Item>}
        {editable.map(f=><Form.Item key={f.name} name={f.name} label={`${fieldLabel(f)}${f.writeOnly?'（填写后加密保存，留空保留原值）':''}`} valuePropName={f.type==='boolean'?'checked':'value'} extra={f.reference?'关联：'+f.reference.entity:f.type==='timestamptz'?'例如 2026-10-09T09:00:00+08:00':f.type==='date'?'例如 2026-10-09':f.type==='bigint'?'较大整数请使用十进制文本':undefined} rules={[{required:!editing&&!f.nullable&&!f.default,message:'此项必填'},...(['jsonb','text[]'].includes(f.type)?[{validator:async(_:unknown,v:unknown)=>{if(v==null||v==='')return;try{const parsed=JSON.parse(String(v));if(f.type==='text[]'&&(!Array.isArray(parsed)||parsed.some(x=>typeof x!=='string')))throw Error();}catch{throw Error('请输入有效的'+(f.type==='text[]'?'字符串数组':'JSON'));}}}]:[])]}>
          {f.reference?<ForeignInput field={f} entities={entities}/>:f.choices.length?<Select aria-label={fieldLabel(f)} allowClear options={f.choices.map(value=>({value,label:value}))}/>:f.type==='boolean'?<Switch aria-label={fieldLabel(f)}/>:f.type==='integer'?<InputNumber aria-label={fieldLabel(f)} precision={0} style={{width:'100%'}}/>:['jsonb','text[]'].includes(f.type)?<Input.TextArea aria-label={fieldLabel(f)} autoSize={{minRows:3,maxRows:12}}/>:f.writeOnly?<Input.Password aria-label={fieldLabel(f)} autoComplete="new-password"/>:<Input.TextArea aria-label={fieldLabel(f)} autoSize={{minRows:1,maxRows:5}}/>}
        </Form.Item>)}
        <Form.Item name="_reason" label="操作原因" rules={[{required:true,min:2,max:500}]}><Input.TextArea rows={2}/></Form.Item>
      </Form>
    </Drawer>
    <Drawer title="记录详情" size={720} open={!!detail} onClose={()=>setDetail(undefined)}>
      <Descriptions column={1} bordered items={entity?.fields.filter(f=>f.readable).map(f=>({key:f.name,label:fieldLabel(f),children:<Typography.Text style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{display(detail?.[f.name])}</Typography.Text>}))}/>
    </Drawer>
    <Modal title={key==='user_role'?'撤销角色授权':'删除记录'} open={!!deleting} confirmLoading={saving} okButtonProps={{danger:true,disabled:deleteReason.trim().length<2}} onCancel={()=>setDeleting(undefined)} onOk={()=>void remove()}><Alert title={key==='user_role'?'撤销立即生效，授权历史与审计保留。':'有关联记录时删除会被阻止。删除操作会保留审计记录。'} type="warning" style={{marginBottom:16}}/><Input.TextArea aria-label="删除原因" placeholder="填写操作原因" value={deleteReason} onChange={e=>setDeleteReason(e.target.value)} maxLength={500}/></Modal>
  </PageContainer>;
}
