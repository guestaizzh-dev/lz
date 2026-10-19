import {ProTable} from '@ant-design/pro-components';
import {Alert,Tag} from 'antd';import {Link} from '@umijs/max';import {api} from '@/api';import {businessNames,currencyAmount,orderLink} from '@/operations/business-links';import {formatChinaTime} from '@/utils/date-time';
const states:Record<string,string>={WAIT_DELIVERY:'等待实际交付',OBSERVATION:'观察期内',HELD:'退款或履约核查中',SETTLED:'已结算',REVERSED:'已冲回'};
export default function Consumption(){return <><Alert showIcon type="info" title="按原订单和实际收入自动核对，不能手改积分余额" description="新订单交付后观察7天；运费不计，消费每日最多500积分，成长与学习等合计每日20。退款申请冻结原奖励，确认退款累计同比例冲回；不足由后续积分抵扣。旧订单不补发。任务失败请在运行与恢复中核查原账务后重试。" style={{marginBottom:16}}/><ProTable<any> rowKey="id" request={async p=>{const q=new URLSearchParams({page:String(p.current??1),size:String(p.pageSize??20)});if(p.q)q.set('q',p.q);if(p.state)q.set('state',p.state);const r=await api<{items:any[];total:number}>('/admin/points/consumption?'+q);return{data:r.items,total:r.total,success:true};}} columns={[
{title:'订单号',dataIndex:'q',render:(_,r)=>{const path=orderLink(r.order);return path?<Link to={path}>{r.order.orderNo}</Link>:r.order.orderNo;}},
{title:'业务',search:false,render:(_,r)=>businessNames[r.order.kind]??r.order.kind},
{title:'学员',dataIndex:'userName',search:false},
{title:'状态',dataIndex:'state',valueType:'select',valueEnum:states,render:(_,r)=><Tag color={r.state==='HELD'?'orange':r.state==='SETTLED'?'green':undefined}>{r.statusText??states[r.state]}</Tag>},
{title:'保留奖励基数',search:false,render:(_,r)=>currencyAmount(r.currentAmount)},
{title:'历史最高基数',search:false,render:(_,r)=>currencyAmount(r.peakAmount)},
{title:'当前积分 / 成长',search:false,render:(_,r)=>r.points+' / '+r.growth},
{title:'观察到期（北京）',search:false,render:(_,r)=>r.eligibleAt?formatChinaTime(r.eligibleAt):'待实际交付'},
{title:'最后核对（北京）',search:false,render:(_,r)=>formatChinaTime(r.updatedAt)},
]}/></>;}
