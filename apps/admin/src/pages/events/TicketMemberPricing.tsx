import {Alert,App,Form,Input,Modal,Select,Switch,Typography} from 'antd';
import {useState} from 'react';
import {api} from '@/api';
type Ticket={id:string;version:number;title:string;price:number|null;memberDiscountEligible:boolean};
export default function TicketMemberPricing({tickets,onClose,onSaved}:{tickets:Ticket[];onClose:()=>void;onSaved:()=>void}){
  const {message,modal}=App.useApp(),[form]=Form.useForm(),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function save(){if(busy)return;try{const v=await form.validateFields(),ticket=tickets.find(t=>t.id===v.ticketId);if(!ticket)throw Error('请选择有效票种');setBusy(true);setError('');await api('/admin/events/tickets/'+ticket.id+'/member-pricing','POST',{expectedVersion:ticket.version,eligible:v.eligible,reason:v.reason});message.success('新报价已更新，原订单与已确认报名保留原价格');onSaved();}catch(e){if(e instanceof Error)setError(e.message);}finally{setBusy(false);}}
  function close(){if(busy)return;if(form.isFieldsTouched())modal.confirm({title:'放弃未保存的票种优惠设置？',onOk:onClose});else onClose();}
  return <Modal open title="票种会员优惠" onCancel={close} onOk={()=>void save()} confirmLoading={busy} okText="保存票种优惠">
    <Typography.Paragraph>票种原价不变。只影响之后的新报价，会员还须拥有适用的已购活动权益；不改变原订单、已确认报名与名额。</Typography.Paragraph>
    {error&&<Alert showIcon type="error" title={error} style={{marginBottom:12}}/>}
    <Form form={form} layout="vertical" disabled={busy} initialValues={{ticketId:tickets[0]?.id,eligible:tickets[0]?.memberDiscountEligible??false}}>
      <Form.Item name="ticketId" label="活动票种" rules={[{required:true}]}><Select options={tickets.map(t=>({value:t.id,label:t.title+' · '+(t.price===null?'尚无有效报价':'¥'+(t.price/100).toFixed(2))}))} onChange={id=>form.setFieldValue('eligible',tickets.find(t=>t.id===id)?.memberDiscountEligible??false)}/></Form.Item>
      <Form.Item name="eligible" label="参与会员活动票价权益" valuePropName="checked" extra="原本免费的票种不需要启用优惠。"><Switch/></Form.Item>
      <Form.Item name="reason" label="调整原因" rules={[{required:true,whitespace:true,min:2,max:500}]}><Input.TextArea rows={3} maxLength={500}/></Form.Item>
    </Form>
  </Modal>;
}
