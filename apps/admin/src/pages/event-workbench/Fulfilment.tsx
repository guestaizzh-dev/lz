import { Alert, App, Button, Form, Input, InputNumber, Modal, Space, Tag, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/api';
import { formatChinaTime } from '@/utils/date-time';

export type FulfilmentFact={id:string;revision:number;outcome:string;deliveredCount:number;attendanceCount:number;quantity:number;evidence:string;publicSummary:string;reason:string;createdAt:string};
export const outcomes:Record<string,string>={COMPLETED:'服务已完成',PARTIAL:'部分完成',NOT_DELIVERED:'到场未交付',NO_SHOW:'未到场'};
export default function Fulfilment({id,name,checkedCount,quantity,canWrite,base,onClose,onSaved}:{id:string;name:string;checkedCount:number;quantity:number;canWrite:boolean;base:string;onClose:()=>void;onSaved:()=>void}){
  const {message}=App.useApp(),[history,setHistory]=useState<FulfilmentFact[]>([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[form]=Form.useForm();
  const attempt=useRef<Record<string,unknown>|undefined>(undefined),[uncertain,setUncertain]=useState(false);
  const url=base+'/registrations/'+id+'/fulfilments';
  async function load(){setLoading(true);setError('');try{setHistory(await api<FulfilmentFact[]>(url));}catch(e){setError((e as Error).message);}finally{setLoading(false);}}
  useEffect(()=>{load();},[id]);
  async function save(values:Record<string,unknown>){if(busy)return;setBusy(true);setError('');attempt.current??={...values,expectedRevision:history[0]?.revision??0,requestKey:crypto.randomUUID()};
    try{await api(url,'POST',attempt.current);attempt.current=undefined;setUncertain(false);form.resetFields();onSaved();await load();message.success('履约结果已保存并通知学员');}
    catch(e){setError((e as Error).message);const status=(e as Error&{status?:number}).status;if(status&&status>=400&&status<500&&status!==408){attempt.current=undefined;setUncertain(false);}else setUncertain(true);}
    finally{setBusy(false);}
  }
  return <Modal open title={name+' · 履约记录'} width={760} onCancel={()=>{if(!busy&&!uncertain)onClose();}} footer={<Button disabled={busy||uncertain} onClick={onClose}>关闭</Button>}>
    <Typography.Paragraph type="secondary">有效到场 {checkedCount} / {quantity} 人。签到代表到场，服务结束后另行记录实际交付。更正会生成新版本，保留原记录并再次通知学员；免费活动不生成消费积分或结算。</Typography.Paragraph>
    {error&&<Alert showIcon type="error" title={error} style={{marginBottom:16}}/>}
    <Button onClick={load} loading={loading} disabled={busy||uncertain}>刷新履约记录</Button>
    {!loading&&!history.length&&<Typography.Paragraph type="secondary" style={{marginTop:16}}>尚未记录实际履约结果</Typography.Paragraph>}
    {history.map((h,i)=><div key={h.id} style={{marginTop:16,padding:16,background:i?'#fafafa':'#f6f9f7',border:'1px solid #e8e8e8',borderRadius:6}}><Space wrap><Tag color={i?undefined:'green'}>{i?'历史版本':'当前结果'} · {h.revision}</Tag><Typography.Text strong>{outcomes[h.outcome]}</Typography.Text><Typography.Text type="secondary">{formatChinaTime(h.createdAt)}</Typography.Text></Space><Typography.Paragraph style={{marginTop:12}}>实际完成 {h.deliveredCount} / {h.quantity} 人 · {h.publicSummary}</Typography.Paragraph><Typography.Paragraph type="secondary">内部依据：{h.evidence}</Typography.Paragraph><Typography.Text type="secondary">记录／更正原因：{h.reason}</Typography.Text></div>)}
    {canWrite&&!loading&&<Form form={form} name="event-fulfilment" layout="vertical" onFinish={save} initialValues={{deliveredCount:checkedCount}} style={{marginTop:24}} disabled={busy||uncertain}>
      <Typography.Title level={5}>{history.length?'更正履约结果':'记录实际履约'}</Typography.Title>
      <Form.Item name="deliveredCount" label="实际完成服务人数" rules={[{required:true}]} extra="不得超过有效签到人数。未交付、部分完成和未到场会分别记录。"><InputNumber aria-label="实际完成服务人数" min={0} max={checkedCount} precision={0}/></Form.Item>
      <Form.Item name="publicSummary" label="学员可见结果" rules={[{required:true,whitespace:true,min:5,max:500}]}><Input.TextArea aria-label="学员可见结果" maxLength={500} rows={3} placeholder="说明已交付内容；如未能完整交付，说明后续处理安排"/></Form.Item>
      <Form.Item name="evidence" label="内部履约依据" rules={[{required:true,whitespace:true,min:10,max:1000}]} extra="仅授权工作人员可见；填写实际执行内容、交付方式及可追溯凭据，不填虚构证明。"><Input.TextArea aria-label="内部履约依据" maxLength={1000} rows={3}/></Form.Item>
      <Form.Item name="reason" label={history.length?'更正原因':'记录说明'} rules={[{required:true,whitespace:true,max:500}]}><Input aria-label="履约记录原因" maxLength={500}/></Form.Item>
      <Button type="primary" htmlType="submit" loading={busy}>{history.length?'保存更正并通知学员':'保存结果并通知学员'}</Button>
    </Form>}
    {uncertain&&<Alert type="warning" showIcon title="上次提交结果尚未确认" description={<><Typography.Paragraph>请再次提交核实，沿用原请求编号防止重复记录。</Typography.Paragraph><Button loading={busy} onClick={()=>save({})}>重试原提交</Button></>}/>}
    {!canWrite&&<Typography.Paragraph type="secondary" style={{marginTop:16}}>当前只可查看。由运营在活动结束后记录实际履约结果。</Typography.Paragraph>}
  </Modal>;
}
