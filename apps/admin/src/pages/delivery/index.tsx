import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { Alert, App, Button, Form, Input, InputNumber, Modal, Switch,DatePicker,Upload,Typography } from 'antd';
import { useRef, useState } from 'react';
import { api } from '@/api';
import {chinaPickerIso,chinaPickerValue} from '@/utils/date-time';
import MoneyInput from '@/components/MoneyInput';
type Zone={priorityFee:number|null;priorityDescription:string|null;priorityUntil:string|null;priorityProofAssetId:string|null;province:string;fee:number;surcharge:number;freeAbove:number|null;enabled:boolean;version:number};
export default function Delivery(){
  const table=useRef<ActionType|undefined>(undefined),[form]=Form.useForm(),{message,modal}=App.useApp();
  const [editing,setEditing]=useState<Zone|null|undefined>(),[busy,setBusy]=useState(false),[error,setError]=useState('');
  function edit(zone?:Zone){form.resetFields();form.setFieldsValue(zone?{...zone,priorityUntil:zone.priorityUntil?chinaPickerValue(zone.priorityUntil):null}:{fee:0,surcharge:0,freeAbove:null,enabled:false,priorityFee:null});setError('');setEditing(zone??null);}
  async function save(values:Zone&{reason:string}){if(busy)return;setBusy(true);try{const {province,...data}=values;const priorityUntil=chinaPickerIso(data.priorityUntil as any);await api('/admin/delivery-zones/'+encodeURIComponent(province),'PUT',{...data,freeAbove:data.freeAbove??null,priorityFee:data.priorityFee??null,priorityUntil,expectedVersion:editing?.version??0});setEditing(undefined);table.current?.reload();message.success('配送配置已保存');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  const columns:ProColumns<Zone>[]=[{title:'省 / 直辖市',dataIndex:'province'},{title:'基础运费（元）',dataIndex:'fee',render:(_,row)=>'¥'+(row.fee/100).toFixed(2)},{title:'附加费（元）',dataIndex:'surcharge',render:(_,row)=>'¥'+(row.surcharge/100).toFixed(2)},{title:'免基础运费门槛（元）',dataIndex:'freeAbove',render:(_,row)=>row.freeAbove==null?'不免运费':'¥'+(row.freeAbove/100).toFixed(2)},{title:'配送',dataIndex:'enabled',render:(_,row)=>row.enabled?'已开放':'未开放'},{title:'操作',valueType:'option',render:(_,row)=><Button type="link" onClick={()=>edit(row)}>配置</Button>}];
  return <PageContainer title="配送计费" subTitle="按省份配置配送范围；附加费不参与包邮">
    <Alert title="配送规则独立于收款开关；优先配送只在真实覆盖与合同有效期内提供。" type="info" showIcon style={{marginBottom:16}}/>
    {error&&<Alert title={error} type="error" showIcon style={{marginBottom:16}}/>}
    <ProTable<Zone> rowKey="province" columns={columns} actionRef={table} search={false} pagination={false} request={async()=>{try{return {data:await api<Zone[]>('/admin/delivery-zones'),success:true};}catch(e){setError((e as Error).message);return {data:[],success:false};}}} toolBarRender={()=>[<Button key="new" type="primary" onClick={()=>edit()}>添加配送地区</Button>]}/>
    <Modal title="配送配置" open={editing!==undefined} onOk={()=>form.submit()} onCancel={()=>{if(busy)return;if(form.isFieldsTouched())modal.confirm({title:'放弃未保存的配送配置？',onOk:()=>setEditing(undefined)});else setEditing(undefined);}} confirmLoading={busy}>
      {error&&<Alert title={error} type="error" showIcon/>}
      <Form form={form} layout="vertical" onFinish={save} disabled={busy}>
        <Form.Item label="省 / 直辖市完整名称" name="province" rules={[{required:true,whitespace:true},{max:30}]}><Input disabled={!!editing} placeholder="与收货地址一致，例如浙江省"/></Form.Item>
        <Form.Item label="基础运费（元）" name="fee" rules={[{required:true}]}><MoneyInput/></Form.Item>
        <Form.Item label="附加费（元）" name="surcharge" rules={[{required:true}]}><MoneyInput/></Form.Item>
        <Form.Item label="免基础运费门槛（元，空白表示不免运费）" name="freeAbove"><MoneyInput/></Form.Item>
        <Form.Item name="priorityFee" label="优先配送额外运费（留空不提供）"><MoneyInput/></Form.Item><Form.Item name="priorityDescription" label="本省真实覆盖与服务说明"><Input.TextArea rows={3} maxLength={500} placeholder="说明承运商、覆盖范围及服务标准，不能虚构时效。"/></Form.Item><Form.Item name="priorityUntil" label="优先服务合同有效截止（北京）"><DatePicker showTime/></Form.Item><Form.Item name="priorityProofAssetId" label="私有合同 / 覆盖证明"><Input readOnly placeholder="上传PDF或图片后自动填写"/></Form.Item><Upload accept=".pdf,.png,.jpg,.jpeg,.webp" showUploadList={false} beforeUpload={async file=>{try{const body=new FormData();body.append('file',file);const asset=await api<{id:string}>('/admin/delivery-zones/proof','POST',body);form.setFieldValue('priorityProofAssetId',asset.id);message.success('证明已私有保存');}catch(e){message.error((e as Error).message);}return false;}}><Button disabled={busy}>上传覆盖与合同证明</Button></Upload><Typography.Paragraph type="secondary">普通配送、会员基础免邮不包含优先附加费；历史订单按下单时的服务和金额履约。</Typography.Paragraph><Form.Item label="开放配送" name="enabled" valuePropName="checked"><Switch/></Form.Item>
        <Form.Item label="变更原因" name="reason" rules={[{required:true,whitespace:true}]}><Input.TextArea maxLength={500}/></Form.Item>
      </Form>
    </Modal>
  </PageContainer>;
}
