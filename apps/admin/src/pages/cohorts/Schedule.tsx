import { Alert, App, Button, Drawer, Form, Input, InputNumber, Space, Spin, Table, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { api } from '@/api';
import { formatChinaTime } from '@/utils/date-time';

type Lesson={id:string;title:string;position:number;format:string;opensOnDay:number|null;opensAt:string|null};
type Schedule={cohort:{id:string;version:number;title:string;startsAt:string;endsAt:string};editable:boolean;lessons:Lesson[]};
export default function ScheduleDrawer({id,canEdit,onClose,onSaved}:{id:string;canEdit:boolean;onClose:()=>void;onSaved:()=>void}) {
  const {message}=App.useApp(),[data,setData]=useState<Schedule>(),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[form]=Form.useForm();
  const days=Form.useWatch('days',form) as Record<string,number>|undefined;
  async function load(){setLoading(true);setError('');try{const result=await api<Schedule>('/admin/cohorts/'+id+'/schedule');setData(result);form.setFieldsValue({days:Object.fromEntries(result.lessons.map(l=>[l.id,l.opensOnDay])),reason:''});}catch(e){setError((e as Error).message);}finally{setLoading(false);}}
  useEffect(()=>{load();},[id]);
  async function save(values:{days:Record<string,number>;reason:string}){if(busy||!data)return;setBusy(true);setError('');try{await api('/admin/cohorts/'+id+'/schedule','POST',{expectedVersion:data.cohort.version,lessons:data.lessons.map(l=>({lessonId:l.id,opensOnDay:values.days[l.id]})),reason:values.reason});message.success('章节安排已保存');onSaved();await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  const editable=!!data?.editable&&canEdit;
  return <Drawer title={'章节安排 · '+(data?.cohort.title??'')} open size={880} onClose={()=>{if(!busy)onClose();}} extra={<Button disabled={busy||loading} onClick={load}>重新读取</Button>}>
    {error&&<Alert type="error" showIcon title={error} description="重新读取会以当前保存的安排替换表单；有并发修改时请核对后再保存。" style={{marginBottom:16}}/>}
    <Spin spinning={loading}>{data&&<>
      <Typography.Paragraph>开营：{formatChinaTime(data.cohort.startsAt)}；结营：{formatChinaTime(data.cohort.endsAt)}（北京时间）。</Typography.Paragraph>
      <Alert type="info" showIcon title={data.editable?'草稿期可配置，首次开放报名后永久冻结':'本期学习安排已冻结'} description="第1天在开营时刻开放，第2天为开营24小时后，以此类推。同日可安排多讲，顺序不能倒退，所有章节须在结营前开放。" style={{marginBottom:20}}/>
      <Form form={form} layout="vertical" onFinish={save} disabled={!editable||busy||loading}>
        <Table<Lesson> rowKey="id" dataSource={data.lessons} pagination={false} scroll={{x:650}} columns={[
          {title:'章节',render:(_,l)=>l.position+'. '+l.title},
          {title:'课件',render:(_,l)=>({TEXT:'图文',AUDIO:'音频',VIDEO:'视频'} as Record<string,string>)[l.format]??l.format},
          {title:'开营第几天',width:150,render:(_,l)=><Form.Item name={['days',l.id]} rules={[{required:true,message:'请填写开放日'}]} style={{marginBottom:0}}><InputNumber min={1} max={3660} precision={0} suffix="天" aria-label={'第'+l.position+'讲开放日'}/></Form.Item>},
          {title:'开放时间（北京）',width:210,render:(_,l)=>{const day=days?.[l.id]??l.opensOnDay;return day?formatChinaTime(new Date(new Date(data.cohort.startsAt).getTime()+(day-1)*86400000).toISOString()):'待安排';}},
        ]}/>
        {editable&&<><Form.Item name="reason" label="调整说明" rules={[{required:true,whitespace:true,message:'请填写调整说明'}]} style={{marginTop:20}}><Input.TextArea maxLength={500} showCount rows={2} placeholder="说明本期章节节奏，供操作审计追溯"/></Form.Item><Space><Button type="primary" htmlType="submit" loading={busy}>保存章节安排</Button><Typography.Text type="secondary">保存后可从列表开放报名。</Typography.Text></Space></>}
      </Form>
    </>}</Spin>
  </Drawer>;
}
