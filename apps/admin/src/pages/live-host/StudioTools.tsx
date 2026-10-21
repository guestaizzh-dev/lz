import {useEffect,useRef,useState} from 'react';
import {useAccess} from '@umijs/max';
import {Alert,App,Avatar,Button,Drawer,Empty,Input,Segmented,Space,Spin,Tag,Typography} from 'antd';
import {AudioOutlined,BookOutlined,CommentOutlined,SendOutlined} from '@ant-design/icons';
import {api,session as authSession} from '@/api';
import ContentRelations from '@/components/ContentRelations';
import {formatChinaTime} from '@/utils/date-time';
import Polls from '../live-discovery/Polls';
import type {StudioSession} from './Studio';

type Chat={id:string;body:string;quoteSnapshot?:string;reviewState:string;version:number;createdAt:string;authorName:string;host:boolean};
type ChatPage={items:Chat[];canPost:boolean;sessionState:string};
type Mic={id:string;state:string;version:number;priority:number;nickname:string};
type Offer={id:string;type:string;title:string;price:number};
const messageState:Record<string,string>={PENDING:'待审核',REJECTED:'未通过'};
const offerType:Record<string,string>={COURSE:'课程',PRODUCT:'商品',EVENT:'活动'};

export default function StudioTools({session,leaseKey,live}:{session:StudioSession;leaseKey:string;live:boolean}){
  const access=useAccess(),{message,modal}=App.useApp();
  const [tab,setTab]=useState('chat'),[filter,setFilter]=useState('all'),[chat,setChat]=useState<ChatPage>(),[mics,setMics]=useState<Mic[]>(),[offers,setOffers]=useState<Offer[]>(),[polls,setPolls]=useState(false),[relations,setRelations]=useState(false),[text,setText]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[loading,setLoading]=useState(true),[unread,setUnread]=useState(0);
  const alive=useRef(true),loadingRef=useRef(false),revision=useRef(0),owner=useRef(authSession?.user.id),submission=useRef<{body:string;key:string}|undefined>(undefined),feed=useRef<HTMLDivElement>(null),stick=useRef(true),lastMessage=useRef<string|undefined>(undefined);
  const valid=()=>alive.current&&owner.current===authSession?.user.id;
  async function load(){
    if(loadingRef.current||!valid())return;loadingRef.current=true;const current=revision.current;
    try{
      if(tab==='chat'){const page=await api<ChatPage>('/admin/live-host/'+session.id+'/messages?size=50');if(valid()&&current===revision.current){const newest=page.items[0]?.id;if(!stick.current&&lastMessage.current&&newest!==lastMessage.current)setUnread(v=>v+1);lastMessage.current=newest;setChat(page);}}
      else if(tab==='mic'&&live){const page=await api<{items:Mic[]}>('/admin/live/mics','POST',{key:leaseKey,action:'LIST'});if(valid()&&current===revision.current)setMics(page.items);}
      else if(tab==='courses'){const page=await api<{items:Offer[]}>('/admin/live-host/'+session.id+'/offers');if(valid()&&current===revision.current)setOffers(page.items);}
      if(valid()&&current===revision.current)setError('');
    }catch(e){if(valid()&&current===revision.current){setError((e as Error).message);if([401,403,404].includes((e as {status:number}).status)){setChat(undefined);setMics(undefined);setOffers(undefined);}}}
    finally{if(current===revision.current)loadingRef.current=false;if(valid()&&current===revision.current)setLoading(false);}
  }
  useEffect(()=>{alive.current=true;loadingRef.current=false;setError('');setLoading(true);void load();const timer=setInterval(()=>void load(),tab==='courses'?15000:3000);return()=>{alive.current=false;revision.current++;clearInterval(timer);};},[session.id,tab,live]);
  useEffect(()=>{if(stick.current&&feed.current)feed.current.scrollTop=feed.current.scrollHeight;},[chat,filter]);
  async function send(){
    const body=text.trim();if(!body||busy||!chat?.canPost||error||!valid())return;
    if(submission.current?.body!==body)submission.current={body,key:crypto.randomUUID()};
    setBusy(true);try{await api('/admin/live-host/'+session.id+'/messages','POST',{body,requestKey:submission.current.key});if(valid()){setText('');submission.current=undefined;stick.current=true;await load();}}
    catch(e){if(valid())message.error((e as Error).message);}finally{if(valid())setBusy(false);}
  }
  async function micAction(row:Mic,action:string){
    if(busy||!valid())return;setBusy(true);
    try{const result=await api<{items:Mic[]}>('/admin/live/mics','POST',{key:leaseKey,action,requestId:row.id,expectedVersion:row.version});if(valid()){setMics(result.items);message.success(action==='APPROVE'?'邀请已发出，等待学员确认开麦':action==='REJECT'?'申请已婉拒':'连麦已结束');}}
    catch(e){if(valid()){message.error((e as Error).message);await load();}}finally{if(valid())setBusy(false);}
  }
  async function review(row:Chat,state:string){
    if(busy||!valid())return;
    if(state==='APPROVED'){
      setBusy(true);
      try{await api('/admin/live/sessions/'+session.id+'/messages/'+row.id+'/review','POST',{state,expectedVersion:row.version,reason:'课堂发言核查通过'});if(valid())await load();}
      catch(e){if(valid())message.error((e as Error).message);}
      finally{if(valid())setBusy(false);}
      return;
    }
    let reason='';modal.confirm({title:state==='APPROVED'?'通过这条发言？':state==='DELETE'?'移除这条发言？':'不通过这条发言？',zIndex:1400,content:<><Typography.Paragraph ellipsis={{rows:3}}>{row.body}</Typography.Paragraph><Input.TextArea placeholder={state==='APPROVED'?'通过说明（选填）':'处理原因，至少2个字'} maxLength={500} onChange={e=>{reason=e.target.value;}}/></>,okText:'确认处理',cancelText:'取消',onOk:async()=>{if(!valid())throw new Error('会话已变化');if(state!=='APPROVED'&&reason.trim().length<2){message.warning('请填写至少2个字的处理原因');throw new Error('请填写原因');}try{await api('/admin/live/sessions/'+session.id+'/messages/'+row.id+'/review','POST',{state,expectedVersion:row.version,reason:reason.trim()||(state==='APPROVED'?'课堂发言核查通过':'')});if(valid())await load();}catch(e){if(valid())message.error((e as Error).message);throw e;}}});
  }
  const canReview=access.canLiveReview&&(authSession?.user.roles.some(role=>['ADMIN','MODERATOR'].includes(role))??false);
  const pending=(chat?.items??[]).filter(row=>row.reviewState==='PENDING').length;
  const items=(chat?.items??[]).filter(row=>filter==='all'||row.reviewState==='PENDING').slice().reverse();
  return <aside className="studio-tools">
    <div className="studio-tools-head"><div><b>课堂互动</b><span>与学员同在一间课堂</span></div><Button size="small" onClick={()=>setPolls(true)}>投票 / 问卷</Button></div>
    <div className="studio-tabs" role="tablist" aria-label="直播间工具">
      {[['chat','发言',<CommentOutlined/>],['mic','连麦',<AudioOutlined/>],['courses','课程',<BookOutlined/>]].map(([key,label,icon])=><button key={String(key)} role="tab" aria-label={String(label)} aria-selected={tab===key} className={tab===key?'is-active':''} onClick={()=>setTab(String(key))}>{icon}{label}{key==='mic'&&mics?.some(m=>m.state==='WAITING')&&<i/>}</button>)}
    </div>
    {error&&<Alert className="studio-tools-error" type="error" showIcon title={error} action={<Button size="small" onClick={()=>void load()}>重试</Button>}/>}
    {tab==='chat'&&<>
      <div className="studio-chat-filter"><Segmented size="small" value={filter} onChange={v=>{stick.current=true;setFilter(String(v));}} options={[{value:'all',label:'全部发言'},{value:'pending',label:'待审核'+(pending?' '+pending:'')}]}/><span>最近 50 条</span></div>
      <div className="studio-feed" ref={feed} onScroll={e=>{const node=e.currentTarget;stick.current=node.scrollHeight-node.scrollTop-node.clientHeight<60;if(stick.current)setUnread(0);}} role="log" aria-label="课堂发言">
        {loading&&!chat?<Spin/>:!items.length&&!error?<Empty image={null} description={filter==='pending'?'没有待审核的发言':'静候第一条发言'}/>:null}
        {items.map(row=><article key={row.id} className={'studio-chat-item'+(row.host?' is-host':'')+(row.reviewState==='PENDING'?' is-pending':'')}><Avatar size={30}>{row.authorName.slice(0,1)}</Avatar><div className="studio-chat-content"><header><b>{row.authorName}</b>{row.host&&<Tag>主播</Tag>}<time>{formatChinaTime(row.createdAt).slice(-5)}</time></header><p>{row.body}</p>{row.quoteSnapshot&&<blockquote>{row.quoteSnapshot}</blockquote>}{row.reviewState!=='APPROVED'&&<Tag color={row.reviewState==='PENDING'?'orange':'default'}>{messageState[row.reviewState]}</Tag>}{canReview&&<div className="studio-chat-actions">{row.reviewState==='PENDING'&&<><Button size="small" type="link" disabled={busy} onClick={()=>void review(row,'APPROVED')}>通过</Button><Button size="small" type="link" disabled={busy} onClick={()=>void review(row,'REJECTED')}>不通过</Button></>}<Button size="small" type="link" danger disabled={busy} onClick={()=>void review(row,'DELETE')}>移除</Button></div>}</div></article>)}
      </div>
      {unread>0&&<button className="studio-new-messages" onClick={()=>{stick.current=true;setUnread(0);if(feed.current)feed.current.scrollTop=feed.current.scrollHeight;}}>有新发言 · 回到最新 ↓</button>}
      <div className="studio-compose"><Input.TextArea aria-label="主播发言" placeholder={chat?.canPost?'向学员说点什么…':'开播后可发送发言'} autoSize={{minRows:2,maxRows:4}} maxLength={1000} value={text} disabled={busy||!chat?.canPost||!!error} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send();}}}/><div><span>Enter 发送 · Shift + Enter 换行</span><Button type="primary" aria-label="发送" icon={<SendOutlined/>} disabled={!text.trim()||!chat?.canPost||!!error} loading={busy} onClick={()=>void send()}>发送</Button></div></div>
    </>}
    {tab==='mic'&&<div className="studio-tool-scroll"><div className="studio-tool-note">学员申请 → 邀请上麦 → 本人确认<br/>同一时间可与一位学员连麦。</div>{!live?<Empty image={null} description="开播后接收连麦申请"/>:loading&&!mics?<Spin/>:!mics?.length&&!error?<Empty image={null} description="暂无连麦申请"/>:null}{mics?.map(row=><div key={row.id} className="studio-mic-person"><Avatar size={36} icon={<AudioOutlined/>}/><div><b>{row.nickname}</b><span>{row.priority?'会员优先 · ':''}{({WAITING:'等候邀请',APPROVED:'等待学员确认',CONNECTED:'正在连麦'} as Record<string,string>)[row.state]}</span></div><Space direction="vertical" size={4}>{row.state==='WAITING'?<><Button size="small" type="primary" disabled={busy||!!error} onClick={()=>void micAction(row,'APPROVE')}>邀请上麦</Button><Button size="small" type="text" disabled={busy||!!error} onClick={()=>void micAction(row,'REJECT')}>婉拒</Button></>:<Button size="small" danger disabled={busy||!!error} onClick={()=>void micAction(row,'REMOVE')}>{row.state==='CONNECTED'?'结束连麦':'撤回邀请'}</Button>}</Space></div>)}</div>}
    {tab==='courses'&&<div className="studio-tool-scroll"><div className="studio-tool-note">下列内容来自本直播间已发布的关联。学员点「课程」即可查看，实际价格以本人结算页为准。</div>{access.canLive&&<Button block onClick={()=>setRelations(true)} style={{marginBottom:16}}>管理关联与展示顺序</Button>}{loading&&!offers?<Spin/>:!offers?.length&&!error?<Empty image={null} description="尚无可展示的课程或商品"/>:null}{offers?.map((row,i)=><div key={row.type+row.id} className="studio-offer"><span className="studio-offer-number">{String(i+1).padStart(2,'0')}</span><div><Tag>{offerType[row.type]}</Tag><b>{row.title}</b><span>{row.price===0?'免费':'¥'+Number(row.price).toFixed(2)}</span></div></div>)}</div>}
    {polls&&<Polls sessionId={session.id} title={session.title} host canEdit={access.canTeachingWrite} zIndex={1350} onClose={()=>setPolls(false)}/>}
    <Drawer title="直播间课程与关联" open={relations} size={720} zIndex={1350} onClose={()=>{setRelations(false);void load();}} destroyOnHidden>{relations&&<ContentRelations resourceId={session.roomId} kind="LIVE"/>}</Drawer>
  </aside>;
}
