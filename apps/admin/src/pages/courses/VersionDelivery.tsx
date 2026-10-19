import {useEffect,useRef,useState} from 'react';
import {useAccess} from '@umijs/max';
import {Alert,App,Button,Drawer,Form,Input,Modal,Select,Space,Table,Tag,Typography} from 'antd';
import {api} from '@/api';
import {formatChinaTime} from '@/utils/date-time';
type Version={id:string;version:number;title:string;createdAt:string;withdrawnAt:string|null;withdrawalReason:string|null;replacementReleaseId:string|null;deliveryVersion:number};
export default function VersionDelivery({courseId,onClose}:{courseId?:string;onClose:()=>void}){
  const access=useAccess(),{message}=App.useApp(),[items,setItems]=useState<Version[]>([]),[loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState(''),[action,setAction]=useState<{row:Version;kind:'WITHDRAW'|'RESTORE'}>(),[form]=Form.useForm();
  const requestId=useRef(0);
  async function load(){if(!courseId)return;const token=++requestId.current;setLoading(true);try{const rows=await api<Version[]>('/admin/course-versions/'+courseId);if(token===requestId.current){setItems(rows);setError('');}}catch(e){if(token===requestId.current)setError((e as Error).message);}finally{if(token===requestId.current)setLoading(false);}}
  useEffect(()=>{setItems([]);setError('');setAction(undefined);if(courseId)void load();else setLoading(false);return()=>{requestId.current++;};},[courseId]);
  function begin(row:Version){form.resetFields();setAction({row,kind:row.withdrawnAt?'RESTORE':'WITHDRAW'});}
  async function save(){if(!action||saving)return;try{const values=await form.validateFields();setSaving(true);await api('/admin/course-versions/'+action.row.id+'/delivery','POST',{action:action.kind,expectedVersion:action.row.deliveryVersion,reason:values.reason.trim(),...(values.replacementReleaseId?{replacementReleaseId:values.replacementReleaseId}:{})});setAction(undefined);await load();message.success(action.kind==='WITHDRAW'?'已停止交付并加入分批通知队列；用户自主选择替代版或申请退课':'已核查课件并恢复交付，访问权仍按原订单及期限');}catch(e){if(e instanceof Error)message.error(e.message);}finally{setSaving(false);}}
  return <><Drawer title="已发布版本与交付处理" width={820} open={!!courseId} onClose={()=>{if(!saving)onClose();}} maskClosable={!saving}>
    <Alert showIcon type="info" title="下架停止新购，停止交付才阻断已购课件" description="更换发布版本不会自动替换学员已购版本。停止交付会保留内容快照、学习历史和交易记录；替代版本需学员主动确认，退款由财务审核并原路办理。" style={{marginBottom:20}}/>
    {error&&<Alert type="error" showIcon title={error} action={<Button onClick={()=>void load()}>重试</Button>}/>}
    <Table<Version> rowKey="id" loading={loading} dataSource={items} pagination={{pageSize:10}} scroll={{x:720}} columns={[
      {title:'版本',dataIndex:'version',render:v=>'第 '+v+' 版'},
      {title:'课程标题',dataIndex:'title'},
      {title:'发布时间',dataIndex:'createdAt',render:v=>formatChinaTime(v)},
      {title:'交付状态',render:(_,row)=><Space direction="vertical"><Tag color={row.withdrawnAt?'orange':'green'}>{row.withdrawnAt?'停止交付':'按原权限交付'}</Tag>{row.withdrawalReason&&<Typography.Text type="secondary">{row.withdrawalReason}</Typography.Text>}</Space>},
      {title:'操作',render:(_,row)=>access.canCoursesReview?<Button type="link" danger={!row.withdrawnAt} disabled={saving} onClick={()=>begin(row)}>{row.withdrawnAt?'核查并恢复':'停止交付与补偿'}</Button>:<Typography.Text type="secondary">需课程审核权限</Typography.Text>},
    ]}/>
  </Drawer><Modal title={action?.kind==='WITHDRAW'?'停止此版本交付':'恢复此版本交付'} open={!!action} confirmLoading={saving} onOk={()=>void save()} onCancel={()=>{if(!saving)setAction(undefined);}} maskClosable={!saving}>
    <Typography.Paragraph>{action?.row.title} · 第 {action?.row.version} 版</Typography.Paragraph>
    <Typography.Paragraph type="secondary">{action?.kind==='WITHDRAW'?'此操作将阻断该版本的文字和媒体，包括已发播放凭证。不会删除记录或强制升级；处理原因会通知学员。已购学员可选择替代版或申请补偿退课。':'将重新核查课件。恢复不会恢复已退款、已撤销或已到期的个人访问权。'}</Typography.Paragraph>
    <Form form={form} layout="vertical" disabled={saving}><Form.Item name="reason" label="处理原因（审计及学员通知）" rules={[{required:true,whitespace:true,min:2,max:500}]}><Input.TextArea rows={4} maxLength={500} showCount/></Form.Item>{action?.kind==='WITHDRAW'&&<Form.Item name="replacementReleaseId" label="可选替代版本" extra="限同一课程仍可交付的版本，由学员自主确认。可不提供，保留退课处理路径。"><Select allowClear placeholder="不提供替代版" options={items.filter(v=>!v.withdrawnAt&&v.id!==action.row.id).map(v=>({value:v.id,label:'第 '+v.version+' 版 · '+v.title}))}/></Form.Item>}</Form>
  </Modal></>;
}
