import AppleRefundReview from './AppleRefundReview';
import {useRef,useState} from 'react';
import {useAccess} from '@umijs/max';
import {ProTable,type ActionType,type ProColumns} from '@ant-design/pro-components';
import {Alert,App,Button,Space,Tag,Typography} from 'antd';
import {api} from '@/api';
import {formatChinaTime} from '@/utils/date-time';
type Receipt={kind:string;id:string;transactionId:string;appScope:string;productId:string;amount:string;state:string;issueCode:string|null;queryFailureCode:string|null;orderId:string|null;latestSignedAt:string;lastCheckedAt:string};
const states={PENDING:'待处理',DELIVERED:'已确认交付',REVOKED:'Apple已撤销',REVIEW:'需核查'};
const issues:Record<string,string>={ACCOUNT_NOT_BOUND:'未绑定书院账号',PRODUCT_NOT_MAPPED:'产品尚未映射',MAPPING_OR_PRICE_MISMATCH:'映射、停售时间或金额不符',OFFER_NOT_VALID_AT_PURCHASE:'购买时售卖版本无效',PRODUCT_TYPE_NOT_SUPPORTED:'当前不支持此产品类型',DELIVERY_NOT_SUPPORTED:'课程交付类型不符',DUPLICATE:'重复购买，需向Apple申请退款',REFUND_REQUIRED:'无法交付，需向Apple申请退款',REVOCATION_AMOUNT_REQUIRES_REVIEW:'已撤权，退款金额需核实',REFUND_REVERSAL_REQUIRES_REVIEW:'旧退款撤回待再次核查',REFUND_CYCLE_CONFLICT:'撤销时间与已撤回退款冲突',REFUND_REVERSAL_ACCOUNT_UNAVAILABLE:'退款已撤回，账号不可恢复',REFUND_REVERSAL_DELIVERY_UNAVAILABLE:'退款已撤回，课程暂不可交付',REFUND_REVERSAL_GRANT_CONFLICT:'退款已撤回，保留当前授权待核查',APPLE_QUERY_RETRY:'Apple查询失败，待重试'};
export default function AppleTransactions({onOrder}:{onOrder:(id:string)=>void}){
  const access=useAccess(),{message}=App.useApp(),table=useRef<ActionType>(undefined),[refreshing,setRefreshing]=useState<string>(),[reviewReceipt,setReviewReceipt]=useState<string>();
  async function refresh(row:Receipt){if(refreshing)return;setRefreshing(row.id);try{const result=await api<{state:string;explanation:string}>('/admin/apple-transactions/'+row.id+'/refresh','POST');table.current?.reload();message.info(result.explanation);}catch(e){message.error((e as Error).message);}finally{setRefreshing(undefined);}}
  const columns:ProColumns<Receipt>[]=[
    {title:'Apple交易编号',dataIndex:'transactionId',search:false,render:(_,r)=><Typography.Text copyable>{r.transactionId}</Typography.Text>},
    {title:'产品 / 应用环境',search:false,render:(_,r)=><Space direction="vertical"><Typography.Text>{r.productId}</Typography.Text><Typography.Text type="secondary">{r.appScope}</Typography.Text></Space>},
    {title:'已验证金额',dataIndex:'amount',search:false,renderText:v=>'¥'+(Number(v)/100).toFixed(2)},
    {title:'处理状态',dataIndex:'state',valueEnum:states,render:(_,r)=><Tag color={r.state==='DELIVERED'?'green':r.state==='REVIEW'?'orange':undefined}>{states[r.state as keyof typeof states]}</Tag>},
    {title:'待办原因',dataIndex:'issueCode',search:false,render:(_,r)=><Space direction="vertical"><Typography.Text>{r.issueCode?(issues[r.issueCode]??'未知异常，请核查渠道事实'):'—'}</Typography.Text>{r.queryFailureCode&&<Typography.Text type="warning">{issues[r.queryFailureCode]??'渠道查询待重试'}</Typography.Text>}</Space>},
    {title:'签名修订 / 最近查询（北京时间）',search:false,render:(_,r)=><Space direction="vertical"><Typography.Text>{formatChinaTime(r.latestSignedAt)}</Typography.Text><Typography.Text type="secondary">{formatChinaTime(r.lastCheckedAt)}</Typography.Text></Space>},
    {title:'操作',valueType:'option',render:(_,r)=><Space>{r.orderId&&<Button type="link" onClick={()=>onOrder(r.orderId!)}>订单详情</Button>}{access.canFinance&&r.kind!=='GIFT'&&r.orderId&&<Button type="link" onClick={()=>setReviewReceipt(r.id)}>退款金额核查</Button>}{access.canFinance&&<Button type="link" loading={refreshing===r.id} disabled={!!refreshing} onClick={()=>void refresh(r)}>向Apple核实</Button>}</Space>},
  ];
  return <><Alert showIcon type="info" title="保留已验签交易；退款由Apple审核" description="未映射或未绑定的凭证不会丢弃或假装已交付。全额撤销按签名事实入账；退款撤回新增冲销分录并恢复原授权，保留学习历史。比例金额不明、账号关闭、停止交付或授权冲突保留核查。请使用原书院账号恢复购买，或协助学员从Apple报告问题页面申请退款。" style={{marginBottom:20}}/>
    <ProTable<Receipt> actionRef={table} rowKey="id" columns={columns} scroll={{x:1250}} pagination={{pageSize:20}} request={async p=>{try{const result=await api<{items:Receipt[];total:number}>('/admin/apple-transactions?page='+p.current+'&size='+p.pageSize+(p.state?'&state='+p.state:''));return{data:result.items,total:result.total,success:true};}catch(e){message.error((e as Error).message);return{data:[],success:false};}}}/>
    <AppleRefundReview receiptId={reviewReceipt} onClose={()=>setReviewReceipt(undefined)} onChanged={()=>table.current?.reload()}/>
  </>;
}
