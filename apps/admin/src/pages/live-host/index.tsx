import {PageContainer,ProTable,type ActionType,type ProColumns} from '@ant-design/pro-components';
import {useAccess} from '@umijs/max';
import {Alert,App,Button,Card,Form,Input,Modal,Space,Steps,Tag,Typography} from 'antd';
import {useEffect,useRef,useState} from 'react';
import {api} from '@/api';
import Polls from '../live-discovery/Polls';
import {formatChinaTime} from '@/utils/date-time';
import Studio,{type StudioSession} from './Studio';

type Session=StudioSession;
const states:Record<string,string>={SCHEDULED:'直播预告',PREPARING:'准备开播',LIVE:'直播中',ENDED:'已结束',REPLAY_READY:'回放已发布',CANCELLED:'已取消'};

export default function LiveHost(){
  const access=useAccess(),{message}=App.useApp(),table=useRef<ActionType>(undefined),[error,setError]=useState(''),[busy,setBusy]=useState(false),[action,setAction]=useState<{row:Session;verb:string}>(),[studio,setStudio]=useState<{row:Session;player:string}|null>(null),[form]=Form.useForm(),key=useRef('');
  const [pollSession,setPollSession]=useState<Session>();

  async function leave(){
    const current=key.current;key.current='';setStudio(null);
    if(current)try{await api('/live/rtc/leave','POST',{key:current});}catch{}
    table.current?.reload();
  }
  useEffect(()=>()=>{const current=key.current;if(current)void api('/live/rtc/leave','POST',{key:current}).catch(()=>{});},[]);

  async function host(row:Session){
    if(busy)return;setBusy(true);setError('');
    try{
      await leave();
      const response=await api<{key:string;playerPath:string}>('/admin/live-host/'+row.id+'/host','POST',{});
      key.current=response.key;
      setStudio({row,player:'/api/v1'+response.playerPath});
    }catch(e){setError((e as Error).message);}
    finally{setBusy(false);}
  }

  async function save(values:{reason:string}){
    if(!action||busy)return;setBusy(true);setError('');
    try{
      await api('/admin/live-host/'+action.row.id+'/state','POST',{action:action.verb,expectedVersion:action.row.version,reason:values.reason});
      if(action.verb==='END')await leave();
      setAction(undefined);table.current?.reload();
      message.success(action.verb==='END'?'本场已结束，学员观看权限已关闭':'可以进入开播台');
    }catch(e){setError((e as Error).message);table.current?.reload();}
    finally{setBusy(false);}
  }

  const columns:ProColumns<Session>[]=[
    {title:'研习主题',dataIndex:'title',ellipsis:true,width:240},
    {title:'开播时间（北京）',dataIndex:'scheduledAt',render:(_,row)=>formatChinaTime(row.scheduledAt)},
    {title:'状态',dataIndex:'state',render:(_,row)=><Space><Tag color={row.state==='LIVE'?'green':'default'}>{states[row.state]??'待核查'}</Tag>{row.disconnectedAt&&<Tag color="orange">断线恢复中</Tag>}</Space>},
    {title:'操作',valueType:'option',render:(_,row)=>access.canTeachingWrite?<Space wrap>
      {!['ENDED','CANCELLED','REPLAY_READY'].includes(row.state)&&<Button type="link" onClick={()=>setPollSession(row)}>投票与问卷</Button>}
      {row.state==='SCHEDULED'&&<Button type="link" disabled={busy} onClick={()=>{form.resetFields();setError('');setAction({row,verb:'PREPARE'});}}>准备开播</Button>}
      {['PREPARING','LIVE'].includes(row.state)&&<>
        <Button type="primary" ghost disabled={busy} onClick={()=>void host(row)}>进入开播台</Button>
        <Button type="link" danger disabled={busy} onClick={()=>{form.resetFields();setError('');setAction({row,verb:'END'});}}>结束本场</Button>
      </>}
    </Space>:null},
  ];

  return <PageContainer title="我的直播" subTitle="仅显示委派给你的场次，使用电脑摄像头与麦克风开播">
    <Card style={{marginBottom:24}} styles={{body:{padding:'22px 24px'}}}>
      <Typography.Title level={5} style={{margin:'0 0 6px'}}>开播工作流程</Typography.Title>
      <Typography.Paragraph type="secondary" style={{marginBottom:22}}>在下方选择场次，进入开播台后确认设备，再开始向学员直播。</Typography.Paragraph>
      <Steps size="small" items={[{title:'选择场次',content:'确认主题与授课时间'},{title:'检查画面和声音',content:'本人允许摄像头与麦克风'},{title:'开始直播',content:'授课完成后结束本场'}]}/>
    </Card>
    {error&&<Alert type="error" showIcon title={error} style={{marginBottom:16}}/>}
    <ProTable<Session> actionRef={table} rowKey="id" columns={columns} search={false} scroll={{x:850}} headerTitle="我的开播安排"
      request={async()=>{try{return{data:await api<Session[]>('/admin/live-host'),success:true};}catch(e){setError((e as Error).message);return{data:[],success:false};}}}
      pagination={{pageSize:10}}/>
    {pollSession&&<Polls key={pollSession.id} sessionId={pollSession.id} title={pollSession.title} host canEdit={access.canTeachingWrite} onClose={()=>setPollSession(undefined)}/>}
    <Modal title={action?.verb==='END'?'结束本场直播':'准备开播'} open={!!action} confirmLoading={busy} onOk={()=>form.submit()} onCancel={()=>{if(!busy)setAction(undefined);}}>
      {error&&<Alert type="error" showIcon title={error} style={{marginBottom:16}}/>}
      <Typography.Paragraph>{action?.row.title}</Typography.Paragraph>
      {action?.verb==='END'&&<Typography.Paragraph type="secondary">结束后停止直播观看。完整视频可由运营上传并审核为回放。</Typography.Paragraph>}
      <Form form={form} layout="vertical" onFinish={save}>
        <Form.Item name="reason" label="操作说明" rules={[{required:true,whitespace:true}]}><Input.TextArea maxLength={500} rows={3}/></Form.Item>
      </Form>
    </Modal>
    {studio&&<Studio session={studio.row} player={studio.player} leaseKey={key.current} onClose={()=>void leave()} onEnded={()=>void leave()}/>}
  </PageContainer>;
}
