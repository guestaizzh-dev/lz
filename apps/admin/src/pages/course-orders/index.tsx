import useOrderDeepLink from '@/operations/use-order-deep-link';
import {formatChinaTime} from '@/utils/date-time';
import { PageContainer, ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import { Alert, App, Button, Descriptions, Drawer, Form, Input, Modal, Space, Table, Tag, Tabs, Timeline, Typography } from 'antd';
import { useRef, useState } from 'react';
import { api } from '@/api';
import AppleTransactions from './AppleTransactions';
const channelLabel=(channel:string)=>channel==='APPLE_IAP'?'Apple内购':channel==='ALIPAY_APP'?'支付宝':channel==='WECHAT_APP'?'微信支付':channel;

type Refund = {id:string;version:number;state:string;amount:string;reason:string;reviewNote:string|null;createdAt:string;automatic:boolean};
type Order = {id:string;orderNo:string;state:string;amount:string;paidAmount:string;refundedAmount:string;createdAt:string;paidAt:string|null;nickname:string;access:boolean;channel:string;paymentStatus:string;course:{title:string;teacherName:string;releaseId:string;accessDays:number|null;refundPolicy:string};refunds:Refund[];payments?:{id:string;channel:string;externalTransactionId:string;amount:string;disposition:string;paidAt:string}[];recoveryJobs?:{kind:string;state:string;attempts:number;lastErrorCode:string|null}[]};
const states={PENDING:'待支付',COMPLETED:'已交付',CLOSED:'已关闭'},refundStates={REQUESTED:'待审核',REFUNDING:'原路退款中',SUCCEEDED:'退款已确认',REVERSED:'Apple已撤回退款',FAILED:'退款需处理',REJECTED:'未通过',CANCELLED:'已取消'};
const money=(value:string)=>{const amount=BigInt(value);return'¥'+(amount/100n).toString()+'.'+(amount%100n).toString().padStart(2,'0');};
export default function CourseOrders(){
  const access=useAccess(),{message,modal}=App.useApp(),table=useRef<ActionType>(undefined),sequence=useRef(0),[selected,setSelected]=useState<Order>(),[action,setAction]=useState<{refund:Refund;kind:string}>(),[busy,setBusy]=useState(false),[form]=Form.useForm();
  async function detail(id:string){const revision=++sequence.current;try{const row=await api<Order>('/admin/course-orders/'+id);if(revision===sequence.current)setSelected(row);}catch(e){if(revision===sequence.current)message.error((e as Error).message);}}
  function close(){if(busy)return;sequence.current++;setSelected(undefined);}
  function review(refund:Refund,kind:string){form.resetFields();setAction({refund,kind});}
  function closeReview(){if(busy)return;if(form.isFieldsTouched())modal.confirm({title:'放弃未保存的处理意见？',onOk:()=>setAction(undefined)});else setAction(undefined);}
  async function save(){if(!action||busy)return;try{const values=await form.validateFields();setBusy(true);await api('/admin/course-orders/refunds/'+action.refund.id+'/review','POST',{action:action.kind,expectedVersion:action.refund.version,...values});setAction(undefined);if(selected)await detail(selected.id);table.current?.reload();message.success(action.kind==='REJECT'?'已记录拒绝原因并通知学员':'已进入退款处理队列，渠道确认成功前不标记已退款');}catch(e){if(e instanceof Error)message.error(e.message);}finally{setBusy(false);}}
  async function refresh(){if(!selected||busy)return;setBusy(true);try{const row=await api<Order>('/admin/course-orders/'+selected.id+'/refresh','POST');setSelected({...row,nickname:selected.nickname});table.current?.reload();message.success('已查询并更新渠道结果');}catch(e){message.error((e as Error).message);}finally{setBusy(false);}}
  const columns:ProColumns<Order>[]=[
    {title:'订单编号',dataIndex:'q',render:(_,r)=><Typography.Text copyable>{r.orderNo}</Typography.Text>},
    {title:'支付渠道',dataIndex:'channel',search:false,render:(_,r)=>channelLabel(r.channel)},
    {title:'研习课程',dataIndex:['course','title'],search:false,render:(_,r)=><><Typography.Text strong>{r.course.title}</Typography.Text><br/><Typography.Text type="secondary">{r.course.teacherName}</Typography.Text></>},
    {title:'学员',dataIndex:'nickname',search:false},
    {title:'应付 / 实收',search:false,render:(_,r)=><>{money(r.amount)}<br/><Typography.Text type="secondary">实收 {money(r.paidAmount)}</Typography.Text></>},
    {title:'订单状态',dataIndex:'state',valueEnum:states,render:(_,r)=><Tag color={r.state==='COMPLETED'?'green':r.state==='PENDING'?'gold':undefined}>{BigInt(r.refundedAmount)>0n?'已退款':states[r.state as keyof typeof states]}</Tag>},
    {title:'退款进度',search:false,render:(_,r)=>r.refunds.length?<Space direction="vertical">{r.refunds.map(f=><Tag key={f.id} color={f.state==='REQUESTED'||f.state==='FAILED'?'orange':undefined}>{f.automatic?'异常收款 · ':''}{refundStates[f.state as keyof typeof refundStates]}</Tag>)}</Space>:<Typography.Text type="secondary">无申请</Typography.Text>},
    {title:'创建时间',dataIndex:'createdAt',valueType:'dateTime', render: (_,row)=>formatChinaTime(row.createdAt),search:false},
    {title:'操作',valueType:'option',render:(_,r)=><Button type="link" onClick={()=>void detail(r.id)}>查看与处理</Button>},
  ];
  useOrderDeepLink(detail);
  return <PageContainer title="课程订单" subTitle="录播课程下单、已验证收款、版本交付与原路退款">
    <Alert type="info" showIcon title="收款与退款以支付渠道验签结果为准" description="不提供手动改为已支付。学员默认可在付款七日内、未开始付费章节时申请退课；重复或迟到等异常收款单独处理，不重复发放权益。" style={{marginBottom:20}}/>
    <Tabs items={[{key:"orders",label:"课程订单",children:<ProTable<Order> actionRef={table} rowKey="id" columns={columns} scroll={{x:1200}} pagination={{pageSize:20}} request={async p=>{try{const result=await api<{items:Order[];total:number}>('/admin/course-orders?page='+p.current+'&size='+p.pageSize+(p.state?'&state='+p.state:'')+(p.q?'&q='+encodeURIComponent(p.q):''));return{data:result.items,total:result.total,success:true};}catch(e){message.error((e as Error).message);return{data:[],success:false};}}}/>},{key:'apple',label:'Apple交易与异常',children:<AppleTransactions onOrder={id=>void detail(id)}/>}]} />
    <Drawer title="课程订单详情" width={680} open={!!selected} onClose={close} maskClosable={!busy} extra={<Button loading={busy} onClick={()=>void refresh()}>查询渠道结果</Button>}>
      {selected&&<><Descriptions column={1} bordered items={[
        {key:'no',label:'订单编号',children:<Typography.Text copyable>{selected.orderNo}</Typography.Text>},{key:'channel',label:'支付渠道',children:channelLabel(selected.channel)},{key:'course',label:'课程',children:selected.course.title},{key:'teacher',label:'主讲',children:selected.course.teacherName},{key:'version',label:'交付版本',children:<Typography.Text copyable>{selected.course.releaseId}</Typography.Text>},{key:'days',label:'学习期限',children:selected.course.accessDays?selected.course.accessDays+'天':'已购版本长期有效'},{key:'amount',label:'应付 / 实收 / 已退',children:money(selected.amount)+' / '+money(selected.paidAmount)+' / '+money(selected.refundedAmount)},{key:'access',label:'对应购课权限',children:selected.access?'有效':'未授权 / 已撤销 / 已到期'},{key:'policy',label:'售前退课快照',children:selected.course.refundPolicy}]} />
      <Typography.Title level={5} style={{marginTop:28}}>已验证收款</Typography.Title>
      <Table rowKey="id" size="small" pagination={false} dataSource={selected.payments??[]} columns={[{title:'渠道',dataIndex:'channel',render:v=>channelLabel(v)},{title:'渠道交易编号',dataIndex:'externalTransactionId',render:v=><Typography.Text copyable style={{wordBreak:'break-all'}}>{v}</Typography.Text>},{title:'收款',dataIndex:'amount',render:v=>money(v)},{title:'用途',dataIndex:'disposition',render:v=>({ACCEPTED:'课程交付',DUPLICATE:'重复收款退回',LATE:'迟到收款退回',AMOUNT_MISMATCH:'金额不符退回',REFUND_REQUIRED:'未交付退回'} as Record<string,string>)[v as string]??v}]}/>
      {selected.recoveryJobs?.some(j=>j.state==='DEAD')&&<Alert type="error" showIcon title="自动处理重试已耗尽" description="请查询渠道结果。退款失败可在下方重试；未确认收款的订单不得手动改为已支付。" style={{marginTop:16}}/>}
      <Typography.Title level={5} style={{marginTop:28}}>退课与异常收款</Typography.Title>{!selected.refunds.length?<Typography.Text type="secondary">暂无退款申请</Typography.Text>:<Timeline items={selected.refunds.map(refund=>({key:refund.id,children:<><Typography.Text strong>{refundStates[refund.state as keyof typeof refundStates]} · {money(refund.amount)}</Typography.Text><Typography.Paragraph style={{whiteSpace:'pre-wrap',marginTop:8}}>{refund.reason}</Typography.Paragraph>{refund.reviewNote&&<Typography.Paragraph type="secondary">处理意见：{refund.reviewNote}</Typography.Paragraph>}<Typography.Text type="secondary">{formatChinaTime(refund.createdAt)}</Typography.Text>{access.canFinance&&<Space style={{display:'flex',marginTop:12}}>{refund.state==='REQUESTED'?<><Button type="primary" onClick={()=>review(refund,'APPROVE')}>审核通过并原路退款</Button><Button danger onClick={()=>review(refund,'REJECT')}>拒绝退课</Button></>:['REFUNDING','FAILED'].includes(refund.state)?<Button onClick={()=>review(refund,'RETRY')}>重试 / 重查退款</Button>:null}</Space>}</>}))}/>}</>}
    </Drawer>
    <Modal title={action?.kind==='REJECT'?'拒绝退课申请':'处理课程退款'} open={!!action} confirmLoading={busy} onOk={()=>void save()} onCancel={closeReview} maskClosable={!busy}><Typography.Paragraph>{action?.refund.reason}</Typography.Paragraph><Typography.Paragraph type="secondary">处理意见会通知学员。审核通过进入原路退款队列，不等于渠道已经退回款项。</Typography.Paragraph><Form form={form} layout="vertical"><Form.Item label="处理意见" name="reason" rules={[{required:true,whitespace:true,min:2,max:500}]}><Input.TextArea rows={4} maxLength={500} showCount/></Form.Item></Form></Modal>
  </PageContainer>;
}
