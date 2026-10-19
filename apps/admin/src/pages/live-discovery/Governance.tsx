import {useAccess} from '@umijs/max';
import {Alert,App,Button,Drawer,Empty,Form,Input,Modal,Select,Space,Table,Tag,Tabs,Typography} from 'antd';
import {useEffect,useState} from 'react';
import {api} from '@/api';
import {formatChinaTime} from '@/utils/date-time';
type Message={id:string;authorId:string;authorName:string;body:string;quoteSnapshot:string|null;reviewState:string;deletedAt:string|null;version:number;createdAt:string};
type Restriction={id:string;nickname:string;version:number;endsAt:string};
type Report={id:string;version:number;body:string;reasonCode:string;description:string};
type Operation={kind:string;id:string;version?:number;userId?:string;name?:string};
const states:Record<string,string>={PENDING:'待审核',APPROVED:'已公开',REJECTED:'未通过'};
export default function Governance({roomId,sessionId,title,onClose}:{roomId:string;sessionId:string;title:string;onClose:()=>void}){
  const access=useAccess(),{message}=App.useApp(),[items,setItems]=useState<Message[]>([]),[cursor,setCursor]=useState<string|null>(null),[restrictions,setRestrictions]=useState<Restriction[]>([]),[reports,setReports]=useState<Report[]>([]),[state,setState]=useState<string|undefined>('PENDING'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[operation,setOperation]=useState<Operation>(),[form]=Form.useForm();
  async function load(older=false){try{
    const [messages,mutes,issues]=await Promise.all([api<{items:Message[];nextCursor:string|null}>('/admin/live/sessions/'+sessionId+'/messages?size=50'+(state?'&state='+state:'')+(older&&cursor?'&cursor='+cursor:'')),api<{items:Restriction[]}>('/admin/live/rooms/'+roomId+'/restrictions'),api<{items:Report[]}>('/admin/live/rooms/'+roomId+'/reports')]);setItems(older?[...items,...messages.items]:messages.items);setCursor(messages.nextCursor);setRestrictions(mutes.items);setReports(issues.items);setError('');
  }catch(e){setError((e as Error).message);}}
  useEffect(()=>{void load();},[sessionId,state]);
  function choose(value:Operation){form.resetFields();form.setFieldsValue({days:1});setOperation(value);}
  async function save(v:{reason:string;days:number}){if(!operation||busy)return;setBusy(true);try{
    const {kind,id,version,userId}=operation;
    if(kind==='MUTE')await api('/admin/live/rooms/'+roomId+'/mute','POST',{userId,days:v.days,reason:v.reason});
    else if(kind==='UNMUTE')await api('/admin/live/rooms/'+roomId+'/restrictions/'+id+'/review','POST',{expectedVersion:version,reason:v.reason});
    else if(kind==='RESOLVE')await api('/admin/live/rooms/'+roomId+'/reports/'+id+'/review','POST',{expectedVersion:version,reason:v.reason});
    else await api('/admin/live/sessions/'+sessionId+'/messages/'+id+'/review','POST',{state:kind,expectedVersion:version,reason:v.reason});
    setOperation(undefined);await load();message.success('处理已保存并通知房间刷新');
  }catch(e){message.error((e as Error).message);}finally{setBusy(false);}}
  return <><Drawer title={'同窗共研 · '+title} open size={1000} onClose={onClose} extra={<Button onClick={()=>load()}>刷新</Button>}>
    {error&&<Alert type="error" showIcon title={error} style={{marginBottom:16}}/>}
    <Tabs items={[
      {key:'messages',label:'发言审核',children:<><Select value={state??'ALL'} onChange={v=>setState(v==='ALL'?undefined:v)} options={[{value:'PENDING',label:'待审核'},{value:'APPROVED',label:'已公开'},{value:'REJECTED',label:'未通过'},{value:'ALL',label:'全部发言'}]} style={{width:160,marginBottom:16}}/>
        <Table<Message> rowKey="id" dataSource={items} pagination={{pageSize:10}} columns={[
          {title:'同窗',dataIndex:'authorName',width:110},{title:'发言',render:(_,r)=><>{r.quoteSnapshot&&<Typography.Paragraph type="secondary" style={{borderLeft:'2px solid #b7ac95',paddingLeft:10}}>{r.quoteSnapshot}</Typography.Paragraph>}<Typography.Paragraph copyable>{r.body}</Typography.Paragraph></>},
          {title:'状态',width:90,render:(_,r)=><Tag color={r.reviewState==='APPROVED'?'green':'default'}>{r.deletedAt?'已删除':states[r.reviewState]}</Tag>},{title:'时间（北京）',width:165,render:(_,r)=>formatChinaTime(r.createdAt)},
          {title:'操作',width:210,render:(_,r)=>access.canLiveReview?<Space wrap>{!r.deletedAt&&<><Button type="link" onClick={()=>choose({kind:'APPROVED',id:r.id,version:r.version})}>通过</Button><Button type="link" onClick={()=>choose({kind:'REJECTED',id:r.id,version:r.version})}>不通过</Button><Button type="link" danger onClick={()=>choose({kind:'DELETE',id:r.id,version:r.version})}>删除</Button></>}<Button type="link" danger onClick={()=>choose({kind:'MUTE',id:r.id,userId:r.authorId,name:r.authorName})}>房间禁言</Button></Space>:null},
        ]}/>{cursor&&<Button onClick={()=>load(true)}>加载更多发言</Button>}</>},
      {key:'restrictions',label:'房间禁言',children:<Table<Restriction> rowKey="id" dataSource={restrictions} columns={[{title:'同窗',dataIndex:'nickname'},{title:'到期（北京）',render:(_,r)=>formatChinaTime(r.endsAt)},{title:'操作',render:(_,r)=>access.canLiveReview&&<Button type="link" onClick={()=>choose({kind:'UNMUTE',id:r.id,version:r.version,name:r.nickname})}>解除禁言</Button>}]} locale={{emptyText:<Empty description="房间内没有生效的禁言"/>}}/>},
      {key:'reports',label:'待处理举报',children:<Table<Report> rowKey="id" dataSource={reports} columns={[{title:'被举报发言',dataIndex:'body'},{title:'问题',render:(_,r)=>({SPAM:'广告骚扰',INAPPROPRIATE:'不当内容',MISLEADING:'误导信息',COPYRIGHT:'版权问题',OTHER:'其他问题'}[r.reasonCode])},{title:'补充说明',dataIndex:'description'},{title:'操作',render:(_,r)=>access.canLiveReview&&<Button type="link" onClick={()=>choose({kind:'RESOLVE',id:r.id,version:r.version})}>记录处理结果</Button>}]} locale={{emptyText:<Empty description="暂无待处理举报"/>}}/>},
    ]}/>
  </Drawer><Modal title={operation?.kind==='MUTE'?'房间禁言 · '+operation.name:operation?.kind==='UNMUTE'?'解除禁言':'记录审核依据'} open={!!operation} confirmLoading={busy} onCancel={()=>{if(!busy)setOperation(undefined);}} onOk={()=>form.submit()}><Form form={form} layout="vertical" onFinish={save} disabled={busy}>{operation?.kind==='MUTE'&&<Form.Item name="days" label="禁言时长" rules={[{required:true}]}><Select options={[{value:1,label:'1天'},{value:3,label:'3天'},{value:7,label:'7天'},{value:30,label:'30天'}]}/></Form.Item>}<Form.Item name="reason" label="处理依据" rules={[{required:true,whitespace:true,min:2}]}><Input.TextArea rows={3} maxLength={500}/></Form.Item></Form></Modal></>;
}
