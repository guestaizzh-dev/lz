import { Alert, App, DatePicker, Form, Input, Modal, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { api } from '@/api';
import { chinaPickerIso, chinaPickerValue, formatChinaTime } from '@/utils/date-time';

type Schedule={id:string;version:number;startsAt:string;endsAt:string;location?:string};
export default function BookingScheduleChange({selection,base,onClose,onSaved}:{selection?:{row:Schedule;cancel:boolean};base:string;onClose:()=>void;onSaved:()=>void}) {
  const [form]=Form.useForm(),[busy,setBusy]=useState(false),[error,setError]=useState(''),{message}=App.useApp();
  const event=base.includes('/events/'),cancel=selection?.cancel;
  useEffect(()=>{setError('');form.resetFields();if(selection)form.setFieldsValue({startsAt:chinaPickerValue(selection.row.startsAt),endsAt:chinaPickerValue(selection.row.endsAt),location:selection.row.location});},[selection]);
  async function save(v:Record<string,any>){
    if(!selection||busy)return;setBusy(true);setError('');
    try{await api(base+'/'+selection.row.id+'/'+(cancel?'cancel':'reschedule'),'POST',{expectedVersion:selection.row.version,reason:v.reason,...(!cancel?{startsAt:chinaPickerIso(v.startsAt),...(event?{endsAt:chinaPickerIso(v.endsAt),location:v.location}:{})}:{})});onClose();onSaved();message.success(cancel?'安排已取消，学员通知正在发送':'延期已保存，请等待学员确认新安排');}catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <Modal zIndex={1200} title={cancel?'取消整个'+(event?'场次':'时段'):'延期'+(event?'活动场次':'服务时段')} open={!!selection} confirmLoading={busy} okText={cancel?'确认取消':'保存延期'} okButtonProps={{danger:cancel}} onOk={()=>form.submit()} onCancel={()=>{if(!busy)onClose();}}>
    {error&&<Alert showIcon type="error" title={error} style={{marginBottom:16}}/>}
    <Typography.Paragraph>原安排：{formatChinaTime(selection?.row.startsAt)} — {formatChinaTime(selection?.row.endsAt)}</Typography.Paragraph>
    <Alert showIcon type={cancel?'warning':'info'} title={cancel?'取消后释放免费名额；已付名额保留至原路退款成功。付费退款由持久任务自动办理，保留原订单与报名记录。':'已报名学员须确认新安排；不接受延期可退出，付费全额原路退款。未确认不能签到或履约。'} style={{marginBottom:20}}/>
    <Form name="booking-schedule-change" form={form} layout="vertical" disabled={busy} onFinish={save}>
      {!cancel&&<><Form.Item name="startsAt" label="新开始时间（北京时间）" rules={[{required:true}]}><DatePicker showTime format="YYYY-MM-DD HH:mm"/></Form.Item>{event&&<><Form.Item name="endsAt" label="新结束时间（北京时间）" rules={[{required:true}]}><DatePicker showTime format="YYYY-MM-DD HH:mm"/></Form.Item><Form.Item name="location" label="新场地" rules={[{required:true,whitespace:true}]}><Input maxLength={200}/></Form.Item></>}</>}
      <Form.Item name="reason" label="通知学员的原因" rules={[{required:true,whitespace:true}]}><Input.TextArea rows={3} maxLength={500} showCount placeholder="说明原因及后续安排，学员将在消息与预约记录中看到。"/></Form.Item>
      <Typography.Text type="secondary">处理未开始、未签到的免费及已付安排。有待支付占位请先查单、关闭订单；正在退约的安排只能整场取消，不能延期。权益预占与已履约记录须通过对应售后流程处理。活动周期会随延期同步调整，其他场次不改动。</Typography.Text>
    </Form>
  </Modal>;
}
