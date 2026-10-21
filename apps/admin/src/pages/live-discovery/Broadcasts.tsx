import ImagePicker from '@/components/ImagePicker';
import {useUploads} from '@/components/ImagePicker/use-uploads';
import {PageContainer,ProTable,type ProColumns,type ActionType} from '@ant-design/pro-components';
import {App,Alert,Button,DatePicker,Empty,Form,Input,Modal,Radio,Segmented,Space,Tag,Typography} from 'antd';
import {useEffect,useRef,useState} from 'react';
import {Link} from '@umijs/max';
import {api,session as auth} from '@/api';
import {chinaPickerIso,chinaPickerValue,formatChinaTime} from '@/utils/date-time';
import Studio,{type StudioSession} from '../live-host/Studio';
import './broadcasts.css';

type Broadcast=StudioSession&{summary:string;cover:string;viewers:number;reservations:number;recordingState:string|null;recordingMessage:string;replayState:string|null;durationSeconds:number|null;};
type Result={items:Broadcast[];recording:{ready:boolean;reason:string}};
const labels:Record<string,string>={SCHEDULED:'待开播',PREPARING:'准备中',LIVE:'直播中',ENDED:'已结束',REPLAY_READY:'可回放',CANCELLED:'已取消'};
const recordingLabels:Record<string,string>={WAITING:'等待录制',STARTING:'录制连接中',ARMED:'录制已就绪',RECORDING:'服务端录制中',PROCESSING:'回放处理中',READY:'回放已生成',FAILED:'录制需处理'};
export default function Broadcasts(){
  const {uploading,track}=useUploads();
  const{message,modal}=App.useApp(),table=useRef<ActionType>(undefined),[data,setData]=useState<Result>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[filter,setFilter]=useState('全部'),[editing,setEditing]=useState<Broadcast|null|undefined>(),[studio,setStudio]=useState<{row:Broadcast;player:string;key:string}>(),[preview,setPreview]=useState(''),[form]=Form.useForm();
  const owner=useRef(auth?.user.id),alive=useRef(true),loading=useRef(false),requestKey=useRef(''),lease=useRef('');
  const valid=()=>alive.current&&owner.current===auth?.user.id;
  async function reload(){if(loading.current||!valid())return;loading.current=true;try{const result=await api<Result>('/admin/live/broadcasts');if(valid()){setData(result);setError('');}}catch(e){if(valid())setError((e as Error).message);}finally{loading.current=false;}}
  useEffect(()=>{alive.current=true;void reload();const timer=setInterval(()=>{if(!document.hidden)void reload();},8000);return()=>{alive.current=false;clearInterval(timer);const key=lease.current;lease.current='';if(key)void api('/live/rtc/leave','POST',{key}).catch(()=>{});};},[]);
  async function run(action:()=>Promise<void>){if(busy||!valid())return;setBusy(true);try{await action();}catch(e){if(valid())message.error((e as Error).message);}finally{if(valid()){setBusy(false);void reload();}}}
  async function fresh(row:Broadcast){const latest=await api<Result>('/admin/live/broadcasts'),found=latest.items.find(r=>r.id===row.id);if(!found)throw Error('直播不存在，请刷新');if(valid())setData(latest);return found;}
  async function operate(row:Broadcast,action:string){const current=await fresh(row);return api<{key:string;playerPath:string}>('/admin/live/broadcasts/'+row.id+'/action','POST',{action,expectedVersion:current.version});}
  async function leave(){const key=lease.current;lease.current='';setStudio(undefined);if(key)try{await api('/live/rtc/leave','POST',{key});}catch{}void reload();}
  function edit(row?:Broadcast){requestKey.current=crypto.randomUUID();form.resetFields();form.setFieldsValue(row?{title:row.title,summary:row.summary,scheduledAt:chinaPickerValue(row.scheduledAt),cover:row.cover}:{cover:''});setEditing(row??null);}
  async function save(values:{title:string;summary:string;cover:string;scheduledAt:Parameters<typeof chinaPickerIso>[0]}){if(uploading)return;await run(async()=>{await api('/admin/live/broadcasts'+(editing?'/'+editing.id:''),'POST',{...values,scheduledAt:chinaPickerIso(values.scheduledAt),requestKey:requestKey.current,...(editing?{expectedVersion:editing.version}:{})});if(valid()){setEditing(undefined);message.success(editing?'直播预告已更新':'直播预告已发布，会员可在 App 查看');}});}
  function confirm(row:Broadcast,action:string){const cancel=action==='CANCEL',end=action==='END',hide=action==='HIDE_REPLAY';modal.confirm({title:cancel?'取消这场直播？':end?'结束本场直播？':hide?'撤下这场回放？':'确认发布回放？',content:cancel?'预约会员会收到取消通知。':end?'停止推流后，服务器会整理已录视频；处理完成后正常回放自动开放。':hide?'会员将暂时无法观看本场回放，可以随后重新发布。':'请先完整预览，确认内容和音画正常后发布给会员。',okText:cancel?'取消直播':end?'结束直播':hide?'撤下回放':'确认发布',cancelText:'返回',okButtonProps:{danger:cancel||end||hide},onOk:async()=>{await operate(row,action);await reload();}});}
  async function openStudio(row:Broadcast){await run(async()=>{if(lease.current)await leave();const result=await operate(row,'ENTER');if(!valid()){await api('/live/rtc/leave','POST',{key:result.key});return;}lease.current=result.key;setStudio({row:{...row,state:row.state==='SCHEDULED'?'PREPARING':row.state},key:result.key,player:'/api/v1'+result.playerPath});});}
  async function replay(row:Broadcast){await run(async()=>{const result=await api<{path:string}>('/admin/live/sessions/'+row.id+'/replay/review/preview','POST');if(valid())setPreview('/api/v1'+result.path);});}
  const visible=(data?.items??[]).filter(r=>filter==='全部'||filter==='待开播'&&['SCHEDULED','PREPARING'].includes(r.state)||filter==='直播中'&&r.state==='LIVE'||filter==='已结束'&&['ENDED','REPLAY_READY','CANCELLED'].includes(r.state));
  const columns:ProColumns<Broadcast>[]=[
    {title:'直播内容',dataIndex:'title',render:(_,r)=><div className="broadcast-title"><b>{r.title}</b><span>{r.summary}</span></div>},
    {title:'开播时间（北京）',dataIndex:'scheduledAt',width:175,render:(_,r)=>formatChinaTime(r.scheduledAt)},
    {title:'状态',width:125,render:(_,r)=><Space orientation="vertical" size={4}><Tag color={r.state==='LIVE'?'red':r.state==='REPLAY_READY'?'green':'default'}>{labels[r.state]}</Tag>{r.disconnectedAt&&<Tag color="orange">断线恢复中</Tag>}</Space>},
    {title:'预约 / 在线',width:105,render:(_,r)=><span className="broadcast-numbers">{r.reservations} / {r.state==='LIVE'?r.viewers:'—'}</span>},
    {title:'录制与回放',width:175,render:(_,r)=><div className={'broadcast-recording'+(r.recordingState==='FAILED'?' is-error':'')}><span>{r.recordingState?recordingLabels[r.recordingState]:'开播后自动录制'}</span>{r.recordingMessage&&<small>{r.recordingMessage}</small>}{r.recordingState==='FAILED'&&<Button type="link" size="small" disabled={busy} onClick={()=>void run(async()=>{await operate(r,'RETRY_RECORDING');message.success('已安排恢复任务');})}>重试处理</Button>}</div>},
    {title:'操作',valueType:'option',width:230,render:(_,r)=><Space wrap size={4}>
      {['SCHEDULED','PREPARING','LIVE'].includes(r.state)&&<Button type="primary" disabled={busy||!data?.recording.ready} onClick={()=>void openStudio(r)}>{r.state==='LIVE'?'返回直播间':'进入开播台'}</Button>}
      {r.state==='SCHEDULED'&&<Button type="link" onClick={()=>edit(r)}>编辑预告</Button>}
      {['SCHEDULED','PREPARING'].includes(r.state)&&<Button type="text" danger onClick={()=>confirm(r,'CANCEL')}>取消</Button>}
      {r.state==='LIVE'&&<Button type="text" danger onClick={()=>confirm(r,'END')}>结束</Button>}
      {r.replayState&&<Button onClick={()=>void replay(r)}>预览回放</Button>}
      {r.replayState&&r.state!=='CANCELLED'&&<Button type="link" onClick={()=>confirm(r,r.state==='REPLAY_READY'?'HIDE_REPLAY':'PUBLISH_REPLAY')}>{r.state==='REPLAY_READY'?'撤下':'发布回放'}</Button>}
    </Space>},
  ];
  return <PageContainer title="直播管理" subTitle="发布预告，准时开播，结束后会员可观看回放" extra={<Link to="/guide?workflow=live">操作指南</Link>}>
    <div className="broadcast-intro"><div><span className="broadcast-eyebrow">书院 · 会员直播</span><h2>一场相聚，从这里开始</h2><p>全部有效会员均可观看，无需分配老师或流转审核。</p></div><Button type="primary" size="large" onClick={()=>edit()}>发布直播预告</Button></div>
    {error&&<Alert type="error" showIcon title="直播列表加载失败" description={error} action={<Button onClick={()=>void reload()}>重试</Button>} style={{marginBottom:16}}/>}
    {data&&!data.recording.ready&&<Alert type="warning" showIcon title="录制服务需要配置" description={data.recording.reason+' 仍可发布预告，修复后即可开播。'} style={{marginBottom:16}}/>}
    <div className="broadcast-tabs"><Segmented options={['全部','待开播','直播中','已结束']} value={filter} onChange={v=>setFilter(String(v))}/><Typography.Text type="secondary">会员观看 · 无礼物 · 服务端自动录制</Typography.Text></div>
    <ProTable<Broadcast> actionRef={table} rowKey="id" columns={columns} dataSource={visible} loading={!data&&!error} search={false} scroll={{x:1040}} options={false} pagination={{pageSize:10,showSizeChanger:true}} locale={{emptyText:<Empty description="还没有直播安排"><Button onClick={()=>edit()}>发布第一场直播</Button></Empty>}}/>
    <Typography.Paragraph type="secondary" style={{marginTop:16}}>录制在服务器进行；开播台关闭后直播推流会中断，请使用「结束本场」正常结束。恢复过的录制须先预览确认再发布。<Link to="/content/live/history">历史课程直播</Link></Typography.Paragraph>
    <Modal title={editing?'编辑直播预告':'发布直播预告'} open={editing!==undefined} confirmLoading={busy} onOk={()=>form.submit()} onCancel={()=>{if(!busy)setEditing(undefined);}} okText={editing?'保存预告':'立即发布'} cancelText="取消" destroyOnHidden>
      <Form form={form} layout="vertical" onFinish={save} disabled={busy} style={{paddingTop:12}}>
        <Form.Item name="title" label="直播主题" rules={[{required:true,whitespace:true,message:'请填写直播主题'}]}><Input maxLength={120} showCount placeholder="例如：道德经中的生活智慧"/></Form.Item>
        <Form.Item name="scheduledAt" label="开播时间（北京时间）" rules={[{required:true,message:'请选择开播时间'}]}><DatePicker showTime format="YYYY-MM-DD HH:mm" style={{width:'100%'}}/></Form.Item>
        <Form.Item name="summary" label="主要内容" rules={[{required:true,whitespace:true,message:'请介绍本次直播内容'}]}><Input.TextArea rows={5} maxLength={500} showCount placeholder="介绍讲解主题、学习要点和参与方式，让会员提前了解。"/></Form.Item>
        <Form.Item name="cover" label="直播封面" extra="上传本地图片，也可留空使用书院默认封面。"><ImagePicker onBusyChange={value=>track("cover",value)}/></Form.Item>
        <Alert type="info" showIcon title="全部有效会员均可观看直播和回放" description="发布后即出现在 App，会员可预约提醒；不预约也能观看。"/>
      </Form>
    </Modal>
    <Modal title="直播回放预览" open={!!preview} footer={null} width={960} onCancel={()=>setPreview('')} destroyOnHidden><video src={preview||undefined} controls playsInline style={{width:'100%',maxHeight:'70vh',background:'#101718'}}/><Typography.Paragraph type="secondary">仅管理员可预览；播放凭证五分钟有效，过期请关闭后重新打开。</Typography.Paragraph></Modal>
    {studio&&<Studio onRetryRecording={()=>void run(async()=>{await operate(studio.row,'RETRY_RECORDING');message.success('正在恢复录制');})} recording={{state:data?.items.find(r=>r.id===studio.row.id)?.recordingState??null,message:data?.items.find(r=>r.id===studio.row.id)?.recordingMessage??''}} session={{...(data?.items.find(r=>r.id===studio.row.id)??studio.row),managedByAdmin:true}} player={studio.player} leaseKey={studio.key} onClose={()=>void leave()} onEnded={()=>void leave()}/>}
  </PageContainer>;
}
