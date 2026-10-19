import {ProTable,type ActionType,type ProColumns} from '@ant-design/pro-components';
import {useAccess} from '@umijs/max';
import {Alert,App,Button,DatePicker,Drawer,Empty,Form,Input,Modal,Select,Space,Tag,Typography} from 'antd';
import {useEffect,useRef,useState} from 'react';
import {api,session} from '@/api';
import {chinaPickerIso,chinaPickerValue,formatChinaTime} from '@/utils/date-time';
import ContentRelations from '@/components/ContentRelations';
import Governance from './Governance';
import Polls from './Polls';
const categories:Record<string,string>={CULTURE:'文化讲解',QA:'研习答疑',PRACTICE:'实践教学',MEMBER:'会员专属',EVENT:'活动同步'};
const states:Record<string,string>={SCHEDULED:'直播预告',PREPARING:'准备开播',LIVE:'直播中',ENDED:'已结束',REPLAY_READY:'回放已发布',CANCELLED:'已取消'};
type Room={id:string;title:string;publishState:string;room?:{categoryCode:string;teacherId:string;accessRule:{mode:string;tier?:number}}};
type LiveSession={id:string;title:string;version:number;state:string;scheduledAt:string;disconnectedAt:string|null;hostUserId:string;reservations:number;replay:{version:number;reviewState:string;assetId:string;durationSeconds:number|null;subtitleText:string;notes:string}|null};
type Options={teachers:{id:string;name:string;userId:string|null}[];hosts:{id:string;nickname:string;roles:string[]}[];courses:{id:string;title:string;teacherId:string}[];rtcReady:boolean};
type Operation={kind:string;row?:LiveSession};
export default function Workbench(){
  const access=useAccess(),{message}=App.useApp(),table=useRef<ActionType>(undefined),[error,setError]=useState(''),[busy,setBusy]=useState(false),[room,setRoom]=useState<Room>(),[rows,setRows]=useState<LiveSession[]>([]),[options,setOptions]=useState<Options>(),[operation,setOperation]=useState<Operation>(),[player,setPlayer]=useState(''),[assets,setAssets]=useState<{value:string;label:string}[]>([]),[form]=Form.useForm();
  const mode=Form.useWatch('accessMode',form),teacherId=Form.useWatch('teacherId',form),[discussion,setDiscussion]=useState<LiveSession>();
  const [pollSession,setPollSession]=useState<LiveSession>();
  const playerKey=useRef('');const [reviewVideo,setReviewVideo]=useState('');
  const mediaTimer=useRef<ReturnType<typeof setTimeout>>(undefined),mediaRequest=useRef(0);
  useEffect(()=>()=>{if(mediaTimer.current)clearTimeout(mediaTimer.current);mediaRequest.current++;const key=playerKey.current;if(key)void api('/live/rtc/leave','POST',{key}).catch(()=>{});},[]);
  async function searchMedia(q=''){
    const version=++mediaRequest.current;
    try{const media=await api<{items:{id:string;name:string}[]}>('/admin/media-library?mime=video%2Fmp4&assetStatus=READY&size=50&q='+encodeURIComponent(q));if(version===mediaRequest.current)setAssets(media.items.map(m=>({value:m.id,label:m.name})));}
    catch(e){if(version===mediaRequest.current)message.error((e as Error).message);}
  }
  async function load(id=room?.id){if(id)setRows(await api<LiveSession[]>('/admin/live/rooms/'+id+'/sessions'));}
  async function run(fn:()=>Promise<void>){if(busy)return;setBusy(true);setError('');try{await fn();}catch(e){setError((e as Error).message);message.error((e as Error).message);}finally{setBusy(false);}}
  async function open(r:Room){await run(async()=>{setOptions(await api<Options>('/admin/live/options'));setRoom(r);await load(r.id);});}
  async function choose(kind:string,row?:LiveSession){await run(async()=>{
    const value=options??await api<Options>('/admin/live/options');setOptions(value);form.resetFields();
    form.setFieldsValue({title:kind==='ROOM'?'':room?.title,categoryCode:'CULTURE',accessMode:'PUBLIC',hostUserId:value.teachers.find(t=>t.id===room?.room?.teacherId)?.userId??session?.user.id});
    if(kind==='RESCHEDULE'&&row)form.setFieldValue('scheduledAt',chinaPickerValue(row.scheduledAt));
    setReviewVideo('');
    if(kind==='REPLAY'){setAssets([]);await searchMedia();const replay=row?.replay;form.setFieldsValue({assetId:replay?.assetId,subtitleText:replay?.subtitleText??'',notes:replay?.notes??'',durationText:replay?.durationSeconds===86400?'24:00:00':replay?.durationSeconds?new Date(replay.durationSeconds*1000).toISOString().slice(11,19):undefined});}
    if(kind==='APPROVED'&&row){const ticket=await api<{path:string}>(`/admin/live/sessions/${row.id}/replay/review/preview`,'POST');setReviewVideo('/api/v1'+ticket.path);}
    setOperation({kind,row});
  });}
  async function save(v:Record<string,unknown>){if(!operation)return;await run(async()=>{const {kind,row}=operation;
    if(kind==='ROOM')await api('/admin/live','POST',{title:v.title,summary:v.summary,teacherId:v.teacherId,categoryCode:v.categoryCode,accessMode:v.accessMode,...(v.courseId?{courseId:v.courseId}:{}),...(v.accessMode==='MEMBER'?{membershipTier:v.membershipTier}:{})});
    else if(kind==='SESSION'&&room)await api('/admin/live/rooms/'+room.id+'/sessions','POST',{title:v.title,hostUserId:v.hostUserId,scheduledAt:chinaPickerIso(v.scheduledAt as Parameters<typeof chinaPickerIso>[0])});
    else if(row){const base='/admin/live/sessions/'+row.id;
      if(kind==='REPLAY'){const [hours,minutes,seconds]=(v.durationText as string).split(':').map(Number);await api(base+'/replay','POST',{assetId:v.assetId,durationSeconds:hours*3600+minutes*60+seconds,subtitleText:v.subtitleText??'',notes:v.notes??'',expectedVersion:row.version,reason:v.reason});}
      else if(['APPROVED','REJECTED'].includes(kind))await api(base+'/replay/review','POST',{state:kind,expectedVersion:row.replay?.version,reason:v.reason});
      else if(kind==='RESCHEDULE')await api(base+'/reschedule','POST',{scheduledAt:chinaPickerIso(v.scheduledAt as Parameters<typeof chinaPickerIso>[0]),expectedVersion:row.version,reason:v.reason});
      else await api(base+'/state','POST',{action:kind,expectedVersion:row.version,reason:v.reason});
    }
    setOperation(undefined);setReviewVideo('');table.current?.reload();await load();message.success(kind==='ROOM'?'直播间已建立，请在展示审核页发布':'场次已更新');
  });}
  async function leavePlayer(){const key=playerKey.current;playerKey.current='';setPlayer('');if(key)await api('/live/rtc/leave','POST',{key});await load();}
  async function broadcast(row:LiveSession){await run(async()=>{await leavePlayer();const r=await api<{key:string;playerPath:string}>('/admin/live/sessions/'+row.id+'/host','POST');playerKey.current=r.key;setPlayer('/api/v1'+r.playerPath);});}
  const columns:ProColumns<Room>[]=[{title:'直播主题',dataIndex:'title'},{title:'类型',render:(_,r)=>categories[r.room?.categoryCode??'']??'待规范资料'},{title:'准入',render:(_,r)=>({PUBLIC:'公开研习',COURSE:'对应课程',MEMBER:'会员等级 '+r.room?.accessRule.tier}[r.room?.accessRule.mode??'']??'待配置')},{title:'展示',render:(_,r)=><Tag color={r.publishState==='PUBLISHED'?'green':'default'}>{r.publishState==='PUBLISHED'?'已发布':r.publishState==='ARCHIVED'?'已下架':'草稿'}</Tag>},{title:'操作',valueType:'option',render:(_,r)=><Button type="link" onClick={()=>open(r)}>场次与回放</Button>}];
  const sessionColumns:ProColumns<LiveSession>[]=[{title:'场次',dataIndex:'title'},{title:'开播（北京）',render:(_,r)=>formatChinaTime(r.scheduledAt)},{title:'状态',render:(_,r)=><Tag color={r.state==='LIVE'?'green':'default'}>{r.disconnectedAt?'断流 · 待恢复':states[r.state]}</Tag>},{title:'预约',dataIndex:'reservations'},{title:'操作',valueType:'option',render:(_,r)=><Space wrap>
    {access.canLiveEdit&&r.state==='SCHEDULED'&&<Button type="link" onClick={()=>choose('PREPARE',r)}>准备开播</Button>}
    {access.canLiveEdit&&r.state==='SCHEDULED'&&<Button type="link" onClick={()=>choose('RESCHEDULE',r)}>调整预告时间</Button>}
    <Button type="link" onClick={()=>setPollSession(r)}>投票与问卷</Button>
    {['LIVE','ENDED','REPLAY_READY'].includes(r.state)&&<Button type="link" onClick={()=>setDiscussion(r)}>同窗共研</Button>}
    {access.canLiveEdit&&['PREPARING','LIVE'].includes(r.state)&&<><Button type="link" disabled={r.hostUserId!==session?.user.id} onClick={()=>broadcast(r)}>进入开播台</Button><Button type="link" onClick={()=>run(async()=>{const result=await api<{active:boolean}>('/admin/live/sessions/'+r.id+'/reconcile','POST');await load();message.info(result.active?'ZEGO 确认流活跃':'ZEGO 当前没有活跃流');})}>核查推流</Button><Button type="link" onClick={()=>choose('END',r)}>结束场次</Button></>}
    {access.canLiveEdit&&['SCHEDULED','PREPARING'].includes(r.state)&&<Button type="link" danger onClick={()=>choose('CANCEL',r)}>取消</Button>}
    {access.canLiveEdit&&['ENDED','REPLAY_READY'].includes(r.state)&&<Button type="link" onClick={()=>choose('REPLAY',r)}>提交回放</Button>}
    {access.canLiveReview&&r.replay&&<><Button type="link" onClick={()=>choose('APPROVED',r)}>审核回放</Button><Button type="link" danger onClick={()=>choose('REJECTED',r)}>撤下回放</Button></>}
  </Space>}];
  const titles:Record<string,string>={ROOM:'新增直播间',SESSION:'安排直播场次',RESCHEDULE:'调整预告时间',PREPARE:'准备开播',END:'结束场次',CANCEL:'取消场次',REPLAY:'提交回放视频',APPROVED:'审核发布回放',REJECTED:'撤下回放'};
  return <>
    {error&&<Alert type="error" showIcon title={error} closable onClose={()=>setError('')} style={{marginBottom:16}}/>}
    <Typography.Paragraph type="secondary">先建立直播间并审核发布，再安排场次与主播。授课结束后，从媒体库提交完整回放，审核通过后学员即可回顾。</Typography.Paragraph>
    <ProTable<Room> actionRef={table} rowKey="id" columns={columns} search={false} request={async()=>({data:await api<Room[]>('/admin/live'),success:true})} toolBarRender={()=>access.canLiveEdit?[<Button key="new" type="primary" onClick={()=>choose('ROOM')}>新增直播间</Button>]:[]}/>
    <Drawer title={'场次与回放 · '+(room?.title??'')} size={1080} open={!!room} onClose={()=>setRoom(undefined)} extra={<Space><Button onClick={()=>run(()=>load())}>刷新场次</Button>{access.canLiveEdit&&<Button type="primary" onClick={()=>choose('SESSION')}>新增场次</Button>}</Space>}>
      {error&&<Alert type="error" showIcon title={error} style={{marginBottom:16}}/>}
      {options&&!options.rtcReady&&<Alert type="warning" showIcon title="ZEGO 项目权限认证或连接配置尚未核验，暂不发放播放凭证" style={{marginBottom:16}}/>}
      {!rows.length?<Empty description="安排第一场直播，让学员提前预约"/>:<ProTable<LiveSession> rowKey="id" columns={sessionColumns} scroll={{x:980}} dataSource={rows} search={false} options={false} pagination={{pageSize:10}}/>}
      {room&&<ContentRelations resourceId={room.id} kind="LIVE"/>}
    </Drawer>
    <Modal title={titles[operation?.kind??'']} open={!!operation} confirmLoading={busy} onOk={()=>form.submit()} onCancel={()=>{if(!busy){setOperation(undefined);setReviewVideo('');}}}>{error&&<Alert type="error" showIcon title={error} style={{marginBottom:16}}/>}{operation?.row&&<Typography.Paragraph type="secondary">{operation.row.title}</Typography.Paragraph>}{operation?.kind==='CANCEL'&&<Alert type="warning" showIcon title="取消后，本场预约将关闭" description="如果本场已被课程版本承诺为授课内容，相关版本会停止交付，并进入已购学员通知与补偿流程。请先确认影响范围。" style={{marginBottom:16}}/>}<Form form={form} layout="vertical" onFinish={save} disabled={busy}>
      {['ROOM','SESSION'].includes(operation?.kind??'')&&<Form.Item name="title" label="直播主题" rules={[{required:true,whitespace:true}]}><Input maxLength={120}/></Form.Item>}
      {operation?.kind==='ROOM'&&<>
        <Form.Item name="summary" label="研习简介" rules={[{required:true,whitespace:true}]}><Input.TextArea rows={3} maxLength={500}/></Form.Item><Form.Item name="teacherId" label="主讲名师" rules={[{required:true}]}><Select showSearch optionFilterProp="label" options={options?.teachers.map(t=>({value:t.id,label:t.name}))} onChange={()=>form.setFieldValue('courseId',undefined)}/></Form.Item>
        <Form.Item name="categoryCode" label="直播类型" rules={[{required:true}]}><Select options={Object.entries(categories).map(([value,label])=>({value,label}))} onChange={v=>{if(v==='MEMBER')form.setFieldsValue({accessMode:'MEMBER',membershipTier:1});}}/></Form.Item><Form.Item name="accessMode" label="观看准入" rules={[{required:true}]}><Select options={[{value:'PUBLIC',label:'公开研习'},{value:'COURSE',label:'有效购课 / 课程会员权益'},{value:'MEMBER',label:'会员专属'}]}/></Form.Item>
        <Form.Item name="courseId" label={mode==='COURSE'?'准入课程':'相关课程（可选）'} rules={[{required:mode==='COURSE'}]}><Select allowClear showSearch optionFilterProp="label" options={options?.courses.filter(c=>c.teacherId===teacherId).map(c=>({value:c.id,label:c.title}))}/></Form.Item>{mode==='MEMBER'&&<Form.Item name="membershipTier" label="最低内容权益等级" rules={[{required:true}]}><Select options={[{value:1,label:'初级及以上'},{value:2,label:'中级及以上'},{value:3,label:'高级'}]}/></Form.Item>}
      </>}
      {operation?.kind==='SESSION'&&<><Form.Item name="hostUserId" label="授权主播账号" extra="须使用该名师关联账号或管理员，开播账号须与本场授权一致。" rules={[{required:true}]}><Select showSearch optionFilterProp="label" options={options?.hosts.filter(h=>h.roles.includes('ADMIN')||h.id===options.teachers.find(t=>t.id===room?.room?.teacherId)?.userId).map(h=>({value:h.id,label:h.nickname}))}/></Form.Item><Form.Item name="scheduledAt" label="开播时间（北京时间）" rules={[{required:true}]}><DatePicker showTime format="YYYY-MM-DD HH:mm" style={{width:'100%'}}/></Form.Item></>}
      {operation?.kind==='RESCHEDULE'&&<><Alert type="info" showIcon title={'原安排：'+formatChinaTime(operation.row?.scheduledAt)} style={{marginBottom:16}}/><Form.Item name="scheduledAt" label="新开播时间（北京时间）" rules={[{required:true}]}><DatePicker showTime format="YYYY-MM-DD HH:mm" style={{width:'100%'}}/></Form.Item></>}
      {operation?.kind==='REPLAY'&&<Form.Item name="assetId" label="回放视频" extra="在媒体库上传完整视频后选择；可输入文件名搜索，提交后须独立审核。" rules={[{required:true}]}><Select showSearch filterOption={false} onSearch={q=>{if(mediaTimer.current)clearTimeout(mediaTimer.current);mediaTimer.current=setTimeout(()=>void searchMedia(q),300);}} options={assets}/></Form.Item>}
      {operation?.kind==='REPLAY'&&<Form.Item name="durationText" label="完整视频时长" extra="按时:分:秒填写，例如 01:30:00 表示 1 小时 30 分钟。最长 24 小时，用于计算课程学习进度。" rules={[{required:true,message:'请填写完整视频时长'},{pattern:/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$|^24:00:00$/,message:'请按时:分:秒填写，例如 01:30:00'},{validator:(_,value)=>value==='00:00:00'?Promise.reject(new Error('视频时长须大于零')):Promise.resolve()}]}><Input placeholder="01:30:00" maxLength={8} style={{fontVariantNumeric:'tabular-nums'}}/></Form.Item>}
      {operation?.kind==='REPLAY'&&<><Form.Item name="subtitleText" label="同步字幕（可选）" extra="粘贴纯文本 SRT / WebVTT；时间轴不能超出视频时长，修改后须重新审核。"><Input.TextArea rows={5} maxLength={200000} placeholder={'1\n00:00:00,000 --> 00:00:05,000\n上善若水。'}/></Form.Item><Form.Item name="notes" label="回放研习资料（可选）" extra="填写原文、要点或练习说明，仅有观看权限的学员可阅读和复制。"><Input.TextArea rows={4} maxLength={50000}/></Form.Item></>}
      {operation?.kind==='APPROVED'&&<><video src={reviewVideo||undefined} controls style={{width:'100%',maxHeight:280}}/><Typography.Paragraph type="secondary">请试看视频并核对实际时长、字幕与资料后发布。预览凭证有效五分钟，过期请重新打开。</Typography.Paragraph><Typography.Text strong>字幕原稿</Typography.Text><pre style={{whiteSpace:'pre-wrap',maxHeight:180,overflow:'auto'}}>{operation.row?.replay?.subtitleText||'未配置字幕'}</pre><Typography.Text strong>研习资料</Typography.Text><Typography.Paragraph style={{whiteSpace:'pre-wrap',maxHeight:180,overflow:'auto'}}>{operation.row?.replay?.notes||'未配置资料'}</Typography.Paragraph></>}
      {!['ROOM','SESSION'].includes(operation?.kind??'')&&<Form.Item name="reason" label="操作依据" rules={[{required:true,whitespace:true}]}><Input.TextArea rows={3} maxLength={500}/></Form.Item>}
    </Form></Modal>
    <Modal title="书院开播台" width={1000} open={!!player} footer={<Button onClick={()=>{void run(leavePlayer);}}>离开开播台</Button>} onCancel={()=>{void run(leavePlayer);}} destroyOnHidden><Typography.Paragraph type="secondary">请允许摄像头与麦克风后点击「开始直播」。离开开播台会停止当前推流，结束授课请使用「结束场次」。</Typography.Paragraph><iframe title="ZEGO RTC 开播台" src={player||undefined} allow="camera; microphone; autoplay; fullscreen" referrerPolicy="no-referrer" style={{width:'100%',height:600,border:0,borderRadius:8}}/></Modal>
    {pollSession&&<Polls key={pollSession.id} sessionId={pollSession.id} title={pollSession.title} canEdit={access.canLiveEdit} onClose={()=>setPollSession(undefined)}/>}
    {discussion&&room&&<Governance roomId={room.id} sessionId={discussion.id} title={discussion.title} onClose={()=>setDiscussion(undefined)}/>}
  </>;
}
