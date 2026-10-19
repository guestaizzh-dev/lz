import {PageContainer,ProTable,type ActionType,type ProColumns} from '@ant-design/pro-components';
import {useAccess} from '@umijs/max';
import {Alert,App,Button,Form,Input,Modal,Space,Tag,Typography} from 'antd';
import {useEffect,useRef,useState} from 'react';
import {api} from '@/api';
import Polls from '../live-discovery/Polls';
import {formatChinaTime} from '@/utils/date-time';

type Session={id:string;title:string;state:string;version:number;scheduledAt:string;disconnectedAt:string|null};
const states:Record<string,string>={SCHEDULED:'直播预告',PREPARING:'准备开播',LIVE:'直播中',ENDED:'已结束',REPLAY_READY:'回放已发布',CANCELLED:'已取消'};
export default function LiveHost(){
  const access=useAccess(),{message}=App.useApp(),table=useRef<ActionType>(undefined),[error,setError]=useState(''),[busy,setBusy]=useState(false),[action,setAction]=useState<{row:Session;verb:string}>(),[player,setPlayer]=useState(''),[form]=Form.useForm(),key=useRef('');
  const [pollSession,setPollSession]=useState<Session>();
  async function leave(){const current=key.current;key.current='';setPlayer('');if(current)try{await api('/live/rtc/leave','POST',{key:current});}catch{}table.current?.reload();}
  useEffect(()=>()=>{const current=key.current;if(current)void api('/live/rtc/leave','POST',{key:current}).catch(()=>{});},[]);
  async function host(row:Session){if(busy)return;setBusy(true);setError('');try{await leave();const response=await api<{key:string;playerPath:string}>('/admin/live-host/'+row.id+'/host','POST',{});key.current=response.key;setPlayer('/api/v1'+response.playerPath);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function save(values:{reason:string}){if(!action||busy)return;setBusy(true);setError('');try{await api('/admin/live-host/'+action.row.id+'/state','POST',{action:action.verb,expectedVersion:action.row.version,reason:values.reason});if(action.verb==='END')await leave();setAction(undefined);table.current?.reload();message.success(action.verb==='END'?'本场已结束，学员观看权限已关闭':'可以进入开播台');}catch(e){setError((e as Error).message);table.current?.reload();}finally{setBusy(false);}}
  const columns:ProColumns<Session>[]=[{title:'研习主题',dataIndex:'title',ellipsis:true,width:240},{title:'开播时间（北京）',dataIndex:'scheduledAt',render:(_,row)=>formatChinaTime(row.scheduledAt)},{title:'状态',dataIndex:'state',render:(_,row)=><Space><Tag color={row.state==='LIVE'?'green':'default'}>{states[row.state]??'待核查'}</Tag>{row.disconnectedAt&&<Tag color="orange">断线恢复中</Tag>}</Space>},{title:'操作',valueType:'option',render:(_,row)=>access.canTeachingWrite?<Space wrap><Button type="link" onClick={()=>setPollSession(row)}>投票与问卷</Button>{row.state==='SCHEDULED'&&<Button type="link" disabled={busy} onClick={()=>{form.resetFields();setError('');setAction({row,verb:'PREPARE'});}}>准备开播</Button>}{['PREPARING','LIVE'].includes(row.state)&&<><Button type="link" disabled={busy} onClick={()=>host(row)}>进入开播台</Button><Button type="link" danger disabled={busy} onClick={()=>{form.resetFields();setError('');setAction({row,verb:'END'});}}>结束本场</Button></>}</Space>:null}];
  return <PageContainer title="我的直播" subTitle="仅显示委派给你的场次，使用电脑摄像头与麦克风开播">
    <Alert type="info" showIcon title="开播前，请确认摄像头、麦克风和网络正常" description="准备开播 → 进入开播台 → 允许摄像头和麦克风 → 点击开始直播。授课完成后，请在场次列表结束本场。" style={{marginBottom:20}}/>
    {error&&<Alert type="error" showIcon title={error} style={{marginBottom:16}}/>}
    <ProTable<Session> actionRef={table} rowKey="id" columns={columns} search={false} scroll={{x:850}} headerTitle="我的开播安排" request={async()=>{try{return{data:await api<Session[]>('/admin/live-host'),success:true};}catch(e){setError((e as Error).message);return{data:[],success:false};}}} pagination={{pageSize:10}}/>
    {pollSession&&<Polls key={pollSession.id} sessionId={pollSession.id} title={pollSession.title} host canEdit={access.canTeachingWrite} onClose={()=>setPollSession(undefined)}/>}
    <Modal title={action?.verb==='END'?'结束本场直播':'准备开播'} open={!!action} confirmLoading={busy} onOk={()=>form.submit()} onCancel={()=>{if(!busy)setAction(undefined);}}>{error&&<Alert type="error" showIcon title={error} style={{marginBottom:16}}/>}<Typography.Paragraph>{action?.row.title}</Typography.Paragraph>{action?.verb==='END'&&<Typography.Paragraph type="secondary">结束后停止直播观看。完整视频可由运营上传并审核为回放。</Typography.Paragraph>}<Form form={form} layout="vertical" onFinish={save}><Form.Item name="reason" label="操作说明" rules={[{required:true,whitespace:true}]}><Input.TextArea maxLength={500} rows={3}/></Form.Item></Form></Modal>
    <Modal title="书院开播台" width={1000} open={!!player} destroyOnHidden onCancel={()=>void leave()} footer={<Button onClick={()=>void leave()}>离开开播台</Button>}><Typography.Paragraph type="secondary">首次开播请允许浏览器使用摄像头和麦克风。离开开播台会停止当前推流；结束授课请使用场次列表的「结束本场」。</Typography.Paragraph><iframe title="我的直播摄像头" src={player||undefined} allow="camera; microphone; autoplay; fullscreen" referrerPolicy="no-referrer" style={{width:'100%',height:600,border:0}}/></Modal>
  </PageContainer>;
}
