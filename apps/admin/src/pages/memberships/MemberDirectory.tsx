import {useRef,useState} from 'react';
import {ProTable,type ActionType,type ProColumns} from '@ant-design/pro-components';
import {Alert,Button,Card,Space,Tag,Typography} from 'antd';
import {api} from '@/api';
import {formatChinaTime} from '@/utils/date-time';

const names=['注册会员','铜牌会员','银牌会员','金牌会员','钻石会员'];
type Member={id:string;nickname:string;phone:string|null;tier:number;status:string;createdAt:string;lastSeenAt:string|null;endsAt:string|null};
type Summary={registeredTotal:number;activeTotal:number;frozenTotal:number;tiers:{tier:number;count:number}[]};
export default function MemberDirectory({onSelectTier,onView}:{onSelectTier:(tier:number)=>void;onView:(user:{id:string;nickname:string;phone:string|null})=>void}){
  const table=useRef<ActionType>(undefined),[tier,setTier]=useState<number>(),[summary,setSummary]=useState<Summary>(),[error,setError]=useState('');
  const columns:ProColumns<Member>[]=[
    {title:'昵称或完整手机号',dataIndex:'q',hideInTable:true},
    {title:'会员',dataIndex:'nickname',search:false,width:150,ellipsis:true},
    {title:'手机号',dataIndex:'phone',search:false,width:145,renderText:value=>value??'未绑定'},
    {title:'当前档位',dataIndex:'tier',search:false,width:120,render:(_,r)=><Tag color={r.tier?'gold':'default'}>{names[r.tier]}</Tag>},
    {title:'账号状态',dataIndex:'status',width:105,valueEnum:{ACTIVE:{text:'正常',status:'Success'},FROZEN:{text:'已停用',status:'Error'}}},
    {title:'注册时间（北京）',dataIndex:'createdAt',search:false,width:175,render:(_,r)=>formatChinaTime(r.createdAt)},
    {title:'最近访问（北京）',dataIndex:'lastSeenAt',search:false,width:175,render:(_,r)=>r.lastSeenAt?formatChinaTime(r.lastSeenAt):'尚无记录'},
    {title:'当前档位到期',dataIndex:'endsAt',search:false,width:175,render:(_,r)=>r.tier&&r.endsAt?formatChinaTime(r.endsAt):'注册身份长期有效'},
    {title:'操作',valueType:'option',fixed:'right',width:100,render:(_,r)=><Button type="link" onClick={()=>onView(r)}>查看权益</Button>},
  ];
  return <Card title="会员名单" extra={<Button onClick={()=>table.current?.reload()}>刷新名单</Button>} style={{marginBottom:24}}>
    <Typography.Paragraph>全部注册用户 <Typography.Text strong>{summary?.registeredTotal??'—'}</Typography.Text> 人，正常 {summary?.activeTotal??'—'} 人，已停用 {summary?.frozenTotal??'—'} 人。</Typography.Paragraph>
    <Space wrap style={{marginBottom:12}}><Button type={tier===undefined?'primary':'default'} onClick={()=>setTier(undefined)}>全部注册用户</Button>{names.map((name,index)=><Button key={name} type={tier===index?'primary':'default'} onClick={()=>{setTier(index);onSelectTier(index);}}>{name} · {summary?.tiers.find(r=>r.tier===index)?.count??'—'} 人</Button>)}</Space>
    <Typography.Paragraph type="secondary">注册即计入名单，无需购买套餐。每人按当前最高有效档位统计一次；到期、撤销或退款暂停后按其他有效权益计算，没有有效付费权益则为注册会员。已注销账号不计入。</Typography.Paragraph>
    {error&&<Alert type="error" showIcon title={error} action={<Button onClick={()=>table.current?.reload()}>重试</Button>} style={{marginBottom:12}}/>}
    <ProTable<Member> actionRef={table} params={{tier}} rowKey="id" scroll={{x:1250}} columns={columns} search={{labelWidth:'auto',defaultCollapsed:false}} options={false} pagination={{defaultPageSize:20,showSizeChanger:true}} request={async p=>{
      const params=new URLSearchParams({page:String(p.current??1),size:String(p.pageSize??20)});if(tier!==undefined)params.set('tier',String(tier));if(p.q?.trim())params.set('q',p.q.trim());if(p.status)params.set('status',p.status);
      try{const r=await api<{items:Member[];total:number;summary:Summary}>('/admin/memberships/users?'+params);setSummary(r.summary);setError('');return{data:r.items,total:r.total,success:true};}catch(e){setError((e as Error).message);return{data:[],total:0,success:false};}
    }}/>
  </Card>;
}
