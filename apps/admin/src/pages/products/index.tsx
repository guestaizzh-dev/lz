import Editorial from '../table-list/Editorial';
import {formatChinaTime} from '@/utils/date-time';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import { Alert, App, Button, Drawer, Form, Input, InputNumber, Modal, Select, Space, Switch, Typography } from 'antd';
import { useRef, useState } from 'react';
import { api } from '@/api';
import MoneyInput from '@/components/MoneyInput';

type Sku = {id:string;title:string;price:number;stock:number;reserved:number;active:boolean;version:number;serviceOfferingId:string|null};
type Product = {id:string;version:number;title:string;subtitle:string;description:string;category:string;type:string;cover:string;price:number;culturalOrigin:string;featured:boolean;memberDiscountEligible:boolean;status:string;updatedAt:string;skus:Sku[]};
type Audit={id:string;action:string;changes:unknown;createdAt:string};
const states={DRAFT:{text:'草稿',status:'Default'},REVIEW:{text:'待审核',status:'Processing'},PUBLISHED:{text:'已发布',status:'Success'},REJECTED:{text:'已驳回',status:'Error'},ARCHIVED:{text:'已下架',status:'Default'}};
const labels:Record<string,string>={submit:'提交审核',publish:'发布',reject:'驳回',archive:'下架',revise:'转草稿'};
export default function Products() {
  const access=useAccess(), {message,modal}=App.useApp(), table=useRef<ActionType|undefined>(undefined);
  const [form]=Form.useForm(),[skuForm]=Form.useForm(),[offerings,setOfferings]=useState<{id:string;title:string;mode:string;durationMinutes:number}[]>([]);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[editing,setEditing]=useState<Product|null|undefined>(),[inventory,setInventory]=useState<Product>(),[sku,setSku]=useState<Sku|null|undefined>(),[transition,setTransition]=useState<{product:Product;action:string}>(),[reason,setReason]=useState(''),[audit,setAudit]=useState<Audit[]>(),[editorial,setEditorial]=useState<Product>();
  function edit(product?:Product){form.resetFields();form.setFieldsValue(product?{title:product.title,subtitle:product.subtitle,description:product.description,category:product.category,type:product.type,cover:product.cover,price:product.price,culturalOrigin:product.culturalOrigin,featured:product.featured,memberDiscountEligible:product.memberDiscountEligible}:{category:'经典典籍',type:'PHYSICAL',price:0,cover:'/static/art/books.svg',featured:false,memberDiscountEligible:false});setError('');setEditing(product??null);}
  async function save(values:unknown){if(busy)return;setBusy(true);try{await api(editing?'/admin/products/'+editing.id:'/admin/products',editing?'PATCH':'POST',{...(values as object),...(editing?{expectedVersion:editing.version}:{})});setEditing(undefined);table.current?.reload();message.success('商品草稿已保存');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  function editSku(row?:Sku){skuForm.resetFields();skuForm.setFieldsValue(row?{title:row.title,price:row.price,stock:row.stock,active:row.active,serviceOfferingId:row.serviceOfferingId}:{price:inventory?.price??0,stock:0,active:false});setSku(row??null);setError('');if(inventory?.type==='SERVICE')void api<typeof offerings>('/admin/products/service-offerings').then(setOfferings).catch(e=>setError((e as Error).message));}
  async function refreshInventory(){setInventory(await api<Product>('/admin/products/'+inventory!.id));table.current?.reload();}
  async function saveSku(values:unknown){if(busy||!inventory)return;setBusy(true);try{await api('/admin/products/'+inventory.id+'/skus'+(sku?'/'+sku.id:''),sku?'PATCH':'POST',{...(values as object),...(sku?{expectedVersion:sku.version}:{})});setSku(undefined);await refreshInventory();message.success('规格已保存');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function changeStatus(){if(!transition||busy)return;if(!reason.trim()){setError('请填写原因');return;}setBusy(true);try{await api('/admin/products/'+transition.product.id+'/transition','POST',{action:transition.action,expectedVersion:transition.product.version,reason});setTransition(undefined);table.current?.reload();message.success('商品状态已更新');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  const columns:ProColumns<Product>[]=[{title:'商品',dataIndex:'title'},{title:'分类',dataIndex:'category',search:false},{title:'类型',dataIndex:'type',valueEnum:{PHYSICAL:'实物',DIGITAL:'数字资料',SERVICE:'服务'},search:false},{title:'状态',dataIndex:'status',valueEnum:states},{title:'规格数',search:false,render:(_,row)=>row.skus.length},{title:'更新时间',dataIndex:'updatedAt',valueType:'dateTime', render: (_,row)=>formatChinaTime(row.updatedAt),search:false},{title:'操作',valueType:'option',render:(_,row)=>{
    const verbs=access.canProductsEdit&&['DRAFT','REJECTED'].includes(row.status)?['submit']:access.canProductsReview&&row.status==='REVIEW'?['publish','reject']:access.canProductsEdit&&row.status==='PUBLISHED'?['archive']:access.canProductsEdit&&row.status==='ARCHIVED'?['revise']:[];
    return [<Button type="link" key="evidence" onClick={()=>setEditorial(row)}>来源与质量 / 配套课程</Button>,<Button type="link" key="sku" onClick={()=>{setInventory(row);setError('');}}>规格与库存</Button>,...(access.canProductsEdit&&['DRAFT','REJECTED'].includes(row.status)?[<Button type="link" key="edit" onClick={()=>edit(row)}>编辑</Button>]:[]),...verbs.map(action=><Button type="link" key={action} danger={['reject','archive'].includes(action)} onClick={()=>{setTransition({product:row,action});setReason('');setError('');}}>{labels[action]}</Button>),<Button type="link" key="audit" onClick={async()=>{try{setAudit(await api('/admin/products/'+row.id+'/audit'));}catch(e){setError((e as Error).message);}}}>记录</Button>];
  }}];
  return <PageContainer title="商品与库存" subTitle="商品审核、可售规格与库存变更记录">
    {error&&<Alert title={error} type="error" showIcon style={{marginBottom:16}} closable onClose={()=>setError('')}/>}
    <ProTable<Product> rowKey="id" actionRef={table} columns={columns} request={async params=>{try{const result=await api<{items:Product[];total:number}>(`/admin/products?page=${params.current??1}&size=${params.pageSize??20}&q=${encodeURIComponent(params.title??'')}${params.status?'&status='+params.status:''}`);return {data:result.items,total:result.total,success:true};}catch(e){setError((e as Error).message);return {data:[],success:false};}}} toolBarRender={()=>access.canProductsEdit?[<Button type="primary" key="new" onClick={()=>edit()}>新建商品</Button>]:[]}/>
    <Modal title="商品草稿" open={editing!==undefined} width={720} onOk={()=>form.submit()} onCancel={()=>{if(busy)return;if(form.isFieldsTouched())modal.confirm({title:'放弃未保存的商品？',onOk:()=>setEditing(undefined)});else setEditing(undefined);}} confirmLoading={busy}>
      {error&&<Alert title={error} type="error" showIcon/>}
      <Form form={form} name="product-editor" layout="vertical" onFinish={save} disabled={busy}>
        <Form.Item label="商品名称" name="title" rules={[{required:true,whitespace:true}]}><Input maxLength={120}/></Form.Item>
        <Form.Item label="副标题" name="subtitle" rules={[{required:true,whitespace:true}]}><Input maxLength={200}/></Form.Item>
        <Space><Form.Item label="分类" name="category" rules={[{required:true}]}><Select style={{width:160}} options={['经典典籍','文创','养生用品','修行工具','线下服务'].map(value=>({value,label:value}))}/></Form.Item><Form.Item label="交付类型" name="type" rules={[{required:true}]}><Select style={{width:160}} options={[{value:'PHYSICAL',label:'实物'},{value:'DIGITAL',label:'数字资料（筹备）'},{value:'SERVICE',label:'服务（筹备）'}]}/></Form.Item><Form.Item label="展示价（元）" name="price" rules={[{required:true}]}><MoneyInput/></Form.Item></Space>
        <Form.Item label="封面" name="cover" rules={[{required:true}]}><Input placeholder="HTTPS图片或已有/static/art图片"/></Form.Item>
        <Form.Item label="商品详情" name="description" rules={[{required:true,whitespace:true}]}><Input.TextArea rows={4} maxLength={10000}/></Form.Item>
        <Form.Item label="文化溯源与依据" name="culturalOrigin" rules={[{required:true,whitespace:true}]}><Input.TextArea rows={3} maxLength={3000}/></Form.Item>
        <Form.Item label="推荐" name="featured" valuePropName="checked"><Switch/></Form.Item>
        <Form.Item label="实物商品参与会员折扣" name="memberDiscountEligible" valuePropName="checked" extra="结账时按学员原会员版本计算；不改变已下单金额。数字资料及预约服务不使用此折扣。"><Switch/></Form.Item>
      </Form>
    </Modal>
    <Drawer title={inventory?.title+' · 规格与库存'} open={!!inventory} size={740} onClose={()=>{if(!busy){setInventory(undefined);setSku(undefined);}}}>
      <Typography.Paragraph type="secondary">库存为实存总量，可售量=库存−预占。购物车不预占库存。规格停用后保留购物车记录并显示不可购买；订单确认时预占，渠道确认付款后扣减；库存调整不能低于预占数量。</Typography.Paragraph>
      {error&&<Alert title={error} type="error" showIcon/>}
      <ProTable<Sku> rowKey="id" search={false} pagination={false} dataSource={inventory?.skus??[]} columns={[{title:'规格',dataIndex:'title'},{title:'价格',dataIndex:'price',renderText:value=>'¥'+(value/100).toFixed(2)},{title:'库存',dataIndex:'stock'},{title:'预占',dataIndex:'reserved'},{title:'可售',render:(_,row)=>row.stock-row.reserved},{title:'状态',dataIndex:'active',renderText:value=>value?'启用':'停用'},{title:'操作',valueType:'option',render:(_,row)=>access.canProductsEdit&&<Button type="link" onClick={()=>editSku(row)}>编辑</Button>}]} toolBarRender={()=>access.canProductsEdit?[<Button key="add" type="primary" onClick={()=>editSku()}>新增规格</Button>]:[]}/>
    </Drawer>
    <Modal title="规格配置" open={sku!==undefined} onOk={()=>skuForm.submit()} onCancel={()=>{if(busy)return;if(skuForm.isFieldsTouched())modal.confirm({title:'放弃未保存的规格？',onOk:()=>setSku(undefined)});else setSku(undefined);}} confirmLoading={busy}>
      {error&&<Alert title={error} type="error" showIcon/>}
      <Form form={skuForm} name="sku-editor" layout="vertical" onFinish={saveSku} disabled={busy}><Form.Item label="规格名称" name="title" rules={[{required:true,whitespace:true}]}><Input maxLength={80}/></Form.Item><Space><Form.Item label="价格（元）" name="price" rules={[{required:true}]}><MoneyInput/></Form.Item><Form.Item label="库存" name="stock" rules={[{required:true}]}><InputNumber min={sku?.reserved??0} max={1000000}/></Form.Item></Space><Form.Item hidden={inventory?.type!=='SERVICE'} label="绑定统一预约服务" name="serviceOfferingId"><Select allowClear options={offerings.map(o=>({value:o.id,label:o.title+' · '+o.mode+' · '+o.durationMinutes+'分钟'}))}/></Form.Item><Form.Item label="启用" name="active" valuePropName="checked"><Switch/></Form.Item><Form.Item label="变更原因" name="reason" rules={[{required:true,whitespace:true}]}><Input.TextArea rows={3} maxLength={500}/></Form.Item></Form>
    </Modal>
    <Modal title={transition?labels[transition.action]+'商品':''} open={!!transition} onOk={changeStatus} onCancel={()=>{if(!busy)setTransition(undefined);}} confirmLoading={busy}>{error&&<Alert title={error} type="error"/>}<Input.TextArea aria-label="操作原因" value={reason} onChange={event=>setReason(event.target.value)} maxLength={500} placeholder="填写审核或操作原因"/></Modal>
    <Drawer title={editorial?.title+' · 来源与配套'} open={!!editorial} size={740} onClose={()=>setEditorial(undefined)}>{editorial&&<Editorial articleId={editorial.id} resourceKind="product"/>}</Drawer>
    <Drawer title="商品操作记录" open={!!audit} size={740} onClose={()=>setAudit(undefined)}><ProTable<Audit> rowKey="id" dataSource={audit} search={false} pagination={false} columns={[{title:'时间',dataIndex:'createdAt',valueType:'dateTime', render: (_,row)=>formatChinaTime(row.createdAt)},{title:'操作',dataIndex:'action'},{title:'变更',render:(_,row)=><Typography.Text>{JSON.stringify(row.changes)}</Typography.Text>}]}/></Drawer>
  </PageContainer>;
}
