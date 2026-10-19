import { Alert, App, Form, Input, InputNumber, Modal, Typography } from 'antd';
import { useState } from 'react';
import { api } from '@/api';
import { formatChinaTime } from '@/utils/date-time';

type Cohort={id:string;version:number;title:string;startsAt:string;endsAt:string;enrollDeadline:string;confirmed:number};
export default function CohortChange({cohort,cancel,onClose,onSaved}:{cohort:Cohort;cancel:boolean;onClose:()=>void;onSaved:()=>void}){
  const {message}=App.useApp(),[form]=Form.useForm(),[busy,setBusy]=useState(false),[error,setError]=useState(''),days=Form.useWatch('days',form)??7;
  const extend=new Date(cohort.startsAt)<=new Date();
  const shifted=(time:string)=>formatChinaTime(new Date(new Date(time).valueOf()+days*86400000).toISOString());
  async function save(values:{days:number;reason:string}){if(busy)return;setBusy(true);setError('');try{await api('/admin/cohorts/'+cohort.id+(cancel?'/cancel':extend?'/extend':'/postpone'),'POST',{expectedVersion:cohort.version,reason:values.reason,...(!cancel?{days:values.days}:{})});message.success(cancel?'本期已取消，通知与付费退款已进入处理队列':'本期安排已更新，请等待学员确认');onSaved();onClose();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <Modal open title={(cancel?'取消营期 · ':extend?'延长结营期限 · ':'延期营期 · ')+cohort.title} confirmLoading={busy} okText={cancel?'确认取消本期':extend?'确认延长':'确认延期'} okButtonProps={{danger:cancel}} onOk={()=>form.submit()} onCancel={()=>{if(!busy)onClose();}}>
    {error&&<Alert type="error" showIcon title={error} style={{marginBottom:16}}/>}
    <Alert showIcon type={cancel?'warning':'info'} title={cancel?'取消后不能重新开放本期':'须由已报名学员确认最新安排'} description={cancel?'免费席位立即释放；付费报名自动全额原路退款，渠道成功后释放。已同意的部分退款先完成原方案，再补退余额；保留学习与教学历史。':extend?'仅延长结营期限；开营、报名截止、章节开放和作业打卡日期保持原安排。学员确认新期限后继续参与，也可选择全额退出。':'整期按天顺延，保持时刻、时长及章节开放日；已发布作业截止和打卡日期一并顺延。付费学员可确认新安排或全额退出。'} style={{marginBottom:16}}/>
    <Typography.Paragraph>已报名 {cohort.confirmed} 人；原开营 {formatChinaTime(cohort.startsAt)}，结营 {formatChinaTime(cohort.endsAt)}（北京时间）。</Typography.Paragraph>
    <Form form={form} layout="vertical" initialValues={{days:7}} onFinish={save} disabled={busy}>
      {!cancel&&<><Form.Item name="days" label={extend?'结营延长天数':'整体顺延天数'} rules={[{required:true}]}><InputNumber min={1} max={3650} precision={0} suffix="天"/></Form.Item><Typography.Paragraph>开营 {extend?formatChinaTime(cohort.startsAt):shifted(cohort.startsAt)}<br/>新结营 {shifted(cohort.endsAt)}<br/>报名截止 {extend?formatChinaTime(cohort.enrollDeadline):shifted(cohort.enrollDeadline)}（北京时间）</Typography.Paragraph></>}
      <Form.Item name="reason" label="通知学员的原因" rules={[{required:true,whitespace:true}]}><Input.TextArea rows={3} maxLength={500} showCount placeholder="清晰说明安排变化，学员将在站内消息中看到此说明"/></Form.Item>
    </Form>
  </Modal>;
}
