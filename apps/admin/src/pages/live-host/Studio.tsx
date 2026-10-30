import {useEffect,useMemo,useRef,useState} from 'react';
import {App,Input,Modal,Select,Space,Steps,Tag,Typography} from 'antd';
import {AudioOutlined,AudioMutedOutlined,VideoCameraOutlined,BorderOutlined,ExpandOutlined,FullscreenOutlined,CloseOutlined,SettingOutlined,CommentOutlined} from '@ant-design/icons';
import {api} from '@/api';
import {formatChinaTime} from '@/utils/date-time';
import StudioTools from './StudioTools';
import './studio.css';

export type StudioSession={id:string;title:string;state:string;version:number;scheduledAt:string;roomId:string;startedAt?:string|null;disconnectedAt?:string|null;accessMode?:string;managedByAdmin?:boolean;viewers?:number;publisher?:string};

const accessLabel:Record<string,string>={PUBLIC:'公开',COURSE:'课程学员',MEMBER:'会员'};

const stateText:Record<string,string>={SCHEDULED:'待开播',PREPARING:'准备中',LIVE:'直播中',ENDED:'已结束',REPLAY_READY:'回放已发布',CANCELLED:'已取消'};

function clock(total:number){const h=Math.floor(total/3600),m=Math.floor(total%3600/60),s=total%60;return [h,m,s].map(v=>String(v).padStart(2,'0')).join(':');}

function Icon({name}:{name:'mic'|'micOff'|'cam'|'camOff'|'fit'|'fill'|'full'|'close'}){
  const icons={mic:AudioOutlined,micOff:AudioMutedOutlined,cam:VideoCameraOutlined,camOff:VideoCameraOutlined,fit:BorderOutlined,fill:ExpandOutlined,full:FullscreenOutlined,close:CloseOutlined},Component=icons[name];
  return <Component aria-hidden style={{fontSize:18,opacity:name==='camOff'?.55:1}}/>;
}

export default function Studio({session,player,leaseKey,onClose,onEnded,recording,onRetryRecording,obs}:{session:StudioSession;player:string;leaseKey:string;onClose:()=>void;onEnded:()=>void;recording?:{state:string|null;message:string};onRetryRecording?:()=>void;obs?:{url:string;service:string;tokenRequired:boolean}}){
  const frame=useRef<HTMLIFrameElement|null>(null);
  const root=useRef<HTMLDivElement|null>(null);
  const {message,modal}=App.useApp();
  const [live,setLive]=useState(false);
  const [starting,setStarting]=useState(false);
  const [mic,setMic]=useState(true);
  const [ready,setReady]=useState(false);
  const [soundRequired,setSoundRequired]=useState(false);
  const [camera,setCamera]=useState(true);
  const [fit,setFit]=useState<'cover'|'contain'>('contain');
  const [status,setStatus]=useState('正在连接开播台…');
  const [seconds,setSeconds]=useState(0);
  const [busy,setBusy]=useState(false);
  const [ending,setEnding]=useState(false);
  const [reason,setReason]=useState('');
  const [error,setError]=useState('');
  const [connection,setConnection]=useState('CONNECTING'),[toolsVisible,setToolsVisible]=useState(true),[deviceOpen,setDeviceOpen]=useState(false),[switching,setSwitching]=useState(false);
  const [devices,setDevices]=useState<{cameras:{id:string;label:string}[];microphones:{id:string;label:string}[]}>({cameras:[],microphones:[]});
  const [cameraId,setCameraId]=useState(''),[microphoneId,setMicrophoneId]=useState('');
  const endingRequest=useRef(false),startRequest=useRef(false);

  const send=(action:string,data:Record<string,string>={})=>{frame.current?.contentWindow?.postMessage({type:'studio',action,...data},location.origin);};

  useEffect(()=>{
    function onMessage(event:MessageEvent){
      if(event.origin!==location.origin||event.source!==frame.current?.contentWindow)return;
      const data=event.data as {type?:string;live?:boolean;mic?:boolean;camera?:boolean;status?:string;state?:string;ready?:boolean;starting?:boolean;soundRequired?:boolean;devices?:typeof devices;cameraId?:string;microphoneId?:string;switching?:boolean}|null;
      if(!data||data.type!=='studio-state')return;
      if(typeof data.live==='boolean'&&!obs)setLive(data.live);
      if(typeof data.starting==='boolean'){setStarting(data.starting);startRequest.current=data.starting;}
      if(typeof data.mic==='boolean')setMic(data.mic);
      if(typeof data.camera==='boolean')setCamera(data.camera);
      if(typeof data.ready==='boolean')setReady(data.ready);
      if(typeof data.soundRequired==='boolean')setSoundRequired(data.soundRequired);
      if(data.status)setStatus(data.status);
      if(data.state)setConnection(data.state);
      if(data.devices)setDevices(data.devices);
      if(typeof data.cameraId==='string')setCameraId(data.cameraId);
      if(typeof data.microphoneId==='string')setMicrophoneId(data.microphoneId);
      if(typeof data.switching==='boolean')setSwitching(data.switching);
    }
    window.addEventListener('message',onMessage);
    return ()=>window.removeEventListener('message',onMessage);
  },[]);
  useEffect(()=>{if(obs)setLive(session.state==='LIVE');},[obs,session.state]);

  useEffect(()=>{
    if(!live)return;
    const origin=session.startedAt?new Date(session.startedAt).getTime():Date.now();
    const tick=()=>setSeconds(Math.max(0,Math.floor((Date.now()-origin)/1000)));tick();
    const timer=setInterval(tick,1000);
    return ()=>clearInterval(timer);
  },[live,session.startedAt]);

  useEffect(()=>{
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!ending&&!document.querySelector('.ant-modal-wrap,.ant-drawer-open'))leave();};
    window.addEventListener('keydown',escape);
    return ()=>window.removeEventListener('keydown',escape);
  });

  function leave(){
    if(live||starting){
      modal.confirm({title:'离开开播台？',content:obs?'OBS 会继续推流。结束授课请先在 OBS 停止推流，再回到这里结束本场。':'离开会停止推流，但场次不会自动结束。建议先点「结束本场」，再关闭。',okText:'仍然离开',cancelText:'继续直播',zIndex:1300,onOk:onClose});
      return;
    }
    onClose();
  }

  async function end(){
    if(endingRequest.current)return;endingRequest.current=true;
    setBusy(true);setError('');
    try{
      const rows=await api<StudioSession[]>('/admin/live-host');
      const fresh=rows.find(r=>r.id===session.id);
      await api('/admin/live-host/'+session.id+'/state','POST',{action:'END',expectedVersion:fresh?.version??session.version,reason:reason.trim()||'开播台结束本场'});
      message.success('本场已结束，学员观看权限已关闭');
      setEnding(false);
      onEnded();
    }catch(e){setError((e as Error).message);}
    finally{endingRequest.current=false;setBusy(false);}
  }


  useEffect(()=>{const warn=(event:BeforeUnloadEvent)=>{if(live){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[live]);
  async function fullscreen(){
    try{if(document.fullscreenElement)await document.exitFullscreen();else await root.current?.requestFullscreen();}catch{message.info('当前浏览器不支持全屏');}
  }

  const time=useMemo(()=>formatChinaTime(session.scheduledAt),[session.scheduledAt]);
  const recorderReady=!session.managedByAdmin||['ARMED','RECORDING'].includes(recording?.state??'');
  const recorderText=({WAITING:'准备服务端录制',STARTING:'连接录制服务',ARMED:'服务端录制已就绪',RECORDING:'服务器正在录制',PROCESSING:'回放处理中',READY:'回放已生成',FAILED:'录制异常，请检查'} as Record<string,string>)[recording?.state??'']??'等待录制服务';
  const interrupted=['CONNECTING','ERROR'].includes(connection),label=obs?(live?'OBS 直播中':'等待 OBS 推流'):starting?'正在开播':interrupted?(connection==='ERROR'?'连接需处理':'连接恢复中'):live?'直播中':session.state==='LIVE'?'等待恢复推流':stateText[session.state]??'待核查';
  function reconnect(){const retry=()=>{startRequest.current=false;setStarting(false);send('retry');};if(live||starting)modal.confirm({title:'重新连接设备和直播？',content:'将短暂停止当前推流，重连后需再次点击开始直播。网络短暂波动通常会自动恢复。',okText:'重新连接',cancelText:'继续等待',zIndex:1300,onOk:retry});else retry();}
  useEffect(()=>{const previous=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.body.style.overflow=previous;};},[]);

  return <div className={'studio-mask'+(!toolsVisible?' studio-focus':'')} ref={root}>
    <div className="studio-head">
      <div className="studio-brand"><span className="studio-mark">道</span><b>书院开播台</b></div>
      <div className="studio-sep"/>
      <div className="studio-heading"><div className="studio-title">{session.title}</div><div className="studio-meta">{time}（北京） · {accessLabel[session.accessMode??'PUBLIC']??'公开'}</div></div>
      <span className={'studio-state'+(live&&!interrupted?' is-live':'')} role="status"><i/>{label}</span>
      {live&&<span className="studio-clock">{clock(seconds)}</span>}
      {typeof session.viewers==='number'&&<span className="studio-viewers">在线 {session.viewers}</span>}
      <div className="studio-spacer"/>
      {session.managedByAdmin&&<span className={'studio-recording'+(recording?.state==='FAILED'?' is-error':'')} role="status" title={recording?.message}><i/>{recorderText}</span>}
      <button className="studio-icon-btn" title="全屏" aria-label="全屏开播台" onClick={fullscreen}><Icon name="full"/></button>
      <button className="studio-icon-btn" title="关闭开播台" aria-label="关闭开播台" onClick={leave}><Icon name="close"/></button>
    </div>

    <div className="studio-body">
      <div className="studio-main">
        {obs?<div className="studio-obs"><div><b>OBS 开播</b><span>OBS 30+ → 设置 → 直播 → 服务选择 WHIP；Bearer 令牌留空。</span></div><Typography.Paragraph copyable={{text:obs.url}} className="studio-obs-url">{obs.url}</Typography.Paragraph><Steps size="small" current={live?2:recorderReady?1:0} items={[{title:'录制准备'},{title:'OBS 开始直播'},{title:'会员观看'}]}/><small>推荐 720p、30fps、H.264、B 帧 0、关键帧间隔 2 秒，音频 48kHz。保留此页监看；结束时先在 OBS 停止推流，再结束本场。</small></div>:!live&&<div className="studio-preflight" role="status"><div><b>开播准备</b><span>确认预览与声音正常后，再开始直播</span></div><span className={ready?'is-ready':''}>{ready?'设备已就绪':'等待设备授权'}</span>{session.managedByAdmin&&<span className={recorderReady?'is-ready':''}>{recorderReady?'录制已就绪':recorderText}</span>}</div>}
        <div className="studio-stage">
          {player?<iframe ref={frame} title="书院开播台" src={player} allow={obs?'autoplay; fullscreen':'camera; microphone; autoplay; fullscreen'} referrerPolicy="no-referrer" onLoad={()=>{send(fit==='cover'?'fill':'fit');send('state');}}/>:<div className="studio-stage-idle"><b>开播台准备中</b><span>正在获取推流凭证…</span></div>}
          {live&&!interrupted?<span className="studio-live-tag"><i/>正在向学员直播</span>:<span className="studio-preview-tag">{obs?'OBS 监看画面':interrupted?'连接恢复中 · 请查看下方状态':'预览 · 未推流'}</span>}
          <span className="studio-watermark">老子道学书院</span>{recording?.state==='FAILED'&&<div className="studio-recording-alert" role="alert"><span>{recording.message||'录制中断，直播仍在进行，请及时处理。'}</span>{onRetryRecording&&<button onClick={onRetryRecording}>重试录制</button>}</div>}
        </div>

        <div className="studio-bar">
          {!obs&&<><button className={'studio-toggle'+(mic?'':' is-off')} aria-label={mic?'关闭麦克风':'开启麦克风'} aria-pressed={!mic} disabled={!ready||starting} onClick={()=>send('mic')} title={mic?'关闭麦克风':'开启麦克风'}><Icon name={mic?'mic':'micOff'}/>{mic?'麦克风':'已静音'}</button>
          <button className={'studio-toggle'+(camera?'':' is-off')} aria-label={camera?'关闭摄像头':'开启摄像头'} aria-pressed={!camera} disabled={!ready||starting} onClick={()=>send('camera')} title={camera?'关闭摄像头':'开启摄像头'}><Icon name={camera?'cam':'camOff'}/>{camera?'摄像头':'已关闭'}</button></>}
          <button className="studio-toggle" onClick={()=>{const next=fit==='cover'?'contain':'cover';setFit(next);send(next==='cover'?'fill':'fit');}} title="切换画面填充方式"><Icon name={fit==='cover'?'fill':'fit'}/>{fit==='cover'?'填充':'适应'}</button>
          {!obs&&<button className="studio-toggle" aria-label="设备" disabled={!ready||starting} onClick={()=>{setDeviceOpen(true);send('devices');}}><SettingOutlined aria-hidden/>设备</button>}
          <button className="studio-toggle" aria-label={toolsVisible?'收起互动':'展开互动'} aria-pressed={toolsVisible} onClick={()=>setToolsVisible(!toolsVisible)}><CommentOutlined aria-hidden/>{toolsVisible?'收起互动':'展开互动'}</button>
          <div className="studio-spacer"/>
          <span className="studio-hint" role="status" title={status}>{status}</span><button className="studio-retry" onClick={reconnect}>重连</button>
          {soundRequired&&<button className="studio-retry" onClick={()=>send('sound')}>开启连麦声音</button>}
          <div className="studio-spacer"/>
          {live||obs?<button className="studio-go is-end" disabled={busy} onClick={()=>{setReason('');setError('');setEnding(true);}}>结束本场</button>:<button className="studio-go" disabled={busy||starting||!ready||!recorderReady} onClick={()=>{if(startRequest.current)return;startRequest.current=true;setStarting(true);send('start');}}>{starting?'正在开播…':'开始直播'}</button>}
        </div>
      </div>

      <StudioTools session={session} leaseKey={leaseKey} live={live}/>

    </div>

    <Modal title="设备设置" open={deviceOpen} footer={null} zIndex={1300} onCancel={()=>setDeviceOpen(false)}>
      <Typography.Paragraph type="secondary">选择授课使用的设备。切换前请确认设备已连接，外接设备和 OBS 虚拟摄像头启动后可刷新列表。</Typography.Paragraph>
      <Typography.Paragraph>摄像头</Typography.Paragraph><Select aria-label="选择摄像头" placeholder="当前默认摄像头" style={{width:'100%',marginBottom:16}} value={cameraId||undefined} disabled={switching||!ready} options={devices.cameras.map(d=>({value:d.id,label:d.label}))} onChange={id=>send('device',{kind:'camera',id})}/>
      <Typography.Paragraph>麦克风</Typography.Paragraph><Select aria-label="选择麦克风" placeholder="当前默认麦克风" style={{width:'100%',marginBottom:16}} value={microphoneId||undefined} disabled={switching||!ready} options={devices.microphones.map(d=>({value:d.id,label:d.label}))} onChange={id=>send('device',{kind:'microphone',id})}/>
      <button className="studio-device-refresh" disabled={switching} onClick={()=>send('devices')}>刷新设备列表</button><Typography.Paragraph role="status" style={{marginTop:12}}>{switching?'正在切换设备…':status}</Typography.Paragraph><Typography.Paragraph type="secondary">虚拟摄像头只传画面；声音需单独选择麦克风或已安装的虚拟音频设备。</Typography.Paragraph>
    </Modal>
    <Modal title="结束本场直播" open={ending} zIndex={1300} confirmLoading={busy} okText="确认结束" okButtonProps={{danger:true}} cancelText="继续直播" onOk={()=>void end()} onCancel={()=>{if(!busy)setEnding(false);}}>
      {obs&&<Typography.Paragraph strong>请先在 OBS 点击停止直播，避免结束场次后 OBS 仍继续向服务商推流。</Typography.Paragraph>}
      <Typography.Paragraph type="secondary">结束后停止直播，服务器会自动整理录制文件；处理完成后，正常回放向会员开放。如录制经历恢复，需要预览确认后发布。</Typography.Paragraph>
      {error&&<Typography.Paragraph type="danger">{error}</Typography.Paragraph>}
      <Typography.Paragraph>结束原因（选填）</Typography.Paragraph>
      <Input.TextArea value={reason} onChange={e=>setReason(e.target.value)} maxLength={200} rows={3} placeholder="例如：本场研习已讲完"/>
      <Space/>
      <Tag color="default">场次：{session.title}</Tag>
    </Modal>
  </div>;
}
