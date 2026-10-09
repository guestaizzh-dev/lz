import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { Alert, App, Button, Form, Input, InputNumber, Modal, Switch } from 'antd';
import { useRef, useState } from 'react';
import { api } from '@/api';
type Zone={province:string;fee:number;surcharge:number;freeAbove:number|null;enabled:boolean;version:number};
export default function Delivery(){
  const table=useRef<ActionType|undefined>(undefined),[form]=Form.useForm(),{message}=App.useApp();
  const [editing,setEditing]=useState<Zone|null|undefined>(),[busy,setBusy]=useState(false),[error,setError]=useState('');
  function edit(zone?:Zone){form.resetFields();form.setFieldsValue(zone??{fee:0,surcharge:0,freeAbove:null,enabled:false});setError('');setEditing(zone??null);}
  async function save(values:Zone&{reason:string}){if(busy)return;setBusy(true);try{const {province,...data}=values;await api('/admin/delivery-zones/'+encodeURIComponent(province),'PUT',{...data,freeAbove:data.freeAbove??null,expectedVersion:editing?.version??0});setEditing(undefined);table.current?.reload();message.success('配送配置已保存');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  const columns:ProColumns<Zone>[]=[{title:'省 / 直辖市',dataIndex:'province'},{title:'基础运费（分）',dataIndex:'fee'},{title:'附加费（分）',dataIndex:'surcharge'},{title:'免基础运费门槛（分）',dataIndex:'freeAbove',render:(_,row)=>row.freeAbove??'不免运费'},{title:'配送',dataIndex:'enabled',render:(_,row)=>row.enabled?'已开放':'未开放'},{title:'操作',valueType:'option',render:(_,row)=><Button type="link" onClick={()=>edit(row)}>配置</Button>}];
  return <PageContainer title="配送计费" subTitle="按省份配置配送范围；附加费不参与包邮">
    <Alert title="订单与支付尚未开放；这里配置配送规则，不会自动开启交易。" type="info" showIcon style={{marginBottom:16}}/>
    {error&&<Alert title={error} type="error" showIcon style={{marginBottom:16}}/>}
    <ProTable<Zone> rowKey="province" columns={columns} actionRef={table} search={false} pagination={false} request={async()=>{try{return {data:await api<Zone[]>('/admin/delivery-zones'),success:true};}catch(e){setError((e as Error).message);return {data:[],success:false};}}} toolBarRender={()=>[<Button key="new" type="primary" onClick={()=>edit()}>添加配送地区</Button>]}/>
    <Modal title="配送配置" open={editing!==undefined} onOk={()=>form.submit()} onCancel={()=>{if(!busy)setEditing(undefined);}} confirmLoading={busy}>
      {error&&<Alert title={error} type="error" showIcon/>}
      <Form form={form} layout="vertical" onFinish={save} disabled={busy}>
        <Form.Item label="省 / 直辖市完整名称" name="province" rules={[{required:true,whitespace:true},{max:30}]}><Input disabled={!!editing} placeholder="与收货地址一致，例如浙江省"/></Form.Item>
        <Form.Item label="基础运费（分）" name="fee" rules={[{required:true}]}><InputNumber min={0} max={100000000} precision={0}/></Form.Item>
        <Form.Item label="附加费（分）" name="surcharge" rules={[{required:true}]}><InputNumber min={0} max={100000000} precision={0}/></Form.Item>
        <Form.Item label="免基础运费门槛（分，空白表示不免运费）" name="freeAbove"><InputNumber min={0} max={100000000} precision={0}/></Form.Item>
        <Form.Item label="开放配送" name="enabled" valuePropName="checked"><Switch/></Form.Item>
        <Form.Item label="变更原因" name="reason" rules={[{required:true,whitespace:true}]}><Input.TextArea maxLength={500}/></Form.Item>
      </Form>
    </Modal>
  </PageContainer>;
}
