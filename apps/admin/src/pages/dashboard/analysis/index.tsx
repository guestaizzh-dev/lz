import { GridContent } from '@ant-design/pro-components';
import { Column } from '@ant-design/plots';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Empty, Table, Row, Space, Tag, Typography } from 'antd';
import { history, useAccess } from '@umijs/max';
import { api } from '@/api';
import { moneyText } from '@/utils/money';
import ChartCard from './components/Charts/ChartCard';
import Field from './components/Charts/Field';

type Overview={articles:number|null;courses:number|null;products:number|null;teachers:number|null;published:number|null;publishedCourses:number|null;learners:number|null;development:boolean;activity:{day:string;readers:number;checkins:number}[];tasks:{title:string;count:number;path:string}[];finance:null|{orders:number;paidOrders:number;paid:string;refunded:string;net:string;trend:{day:string;paid:string;refunded:string}[]}};
export default function Analysis(){
  const access=useAccess();
  const {data,error,isFetching,refetch}=useQuery({queryKey:['academy-overview',access],queryFn:()=>api<Overview>('/admin/overview'),enabled:access.canDashboard});
  const metrics=[
    ...(access.canContent?[{title:'已发布文章',value:data?.published,footer:'全部文章',total:data?.articles}]:[]),
    ...(access.canCourses?[{title:'已发布课程',value:data?.publishedCourses,footer:'全部课程',total:data?.courses},{title:'参与学习人数',value:data?.learners,footer:'按学习进度中的账号去重',total:null}]:[]),
    ...(access.canProducts?[{title:'商品资源',value:data?.products,footer:'包含草稿和已发布商品',total:null}]:[]),
    ...(data?.finance?[{title:'课程、会员与商品实收',value:moneyText(data.finance.paid),footer:'已确认收款订单',total:data.finance.paidOrders},{title:'课程、会员与商品退款',value:moneyText(data.finance.refunded),footer:'已确认原路退款',total:null},{title:'课程、会员与商品净额',value:moneyText(data.finance.net),footer:'累计实收减退款，非利润',total:null},{title:'课程、会员与商品订单数',value:data.finance.orders,footer:'全部状态的课程、会员与商品订单',total:null}]:[]),
  ];
  const trend=data?.activity.flatMap(row=>[{day:row.day,count:row.readers,type:'登录阅读人数'},{day:row.day,count:row.checkins,type:'有效打卡人数'}])??[];
  const financialTrend=data?.finance?.trend.flatMap(row=>[{day:row.day,amount:Number(row.paid)/100,type:'实收'},{day:row.day,amount:Number(row.refunded)/100,type:'退款'}])??[];
  const shortcuts=[{allowed:access.canCourses,label:'课程与名师',path:'/content/courses'},{allowed:access.canTeaching,label:'教学与作业',path:'/teaching'},{allowed:access.canQuestions,label:'名师问答',path:'/questions'},{allowed:access.canSupport,label:'客服反馈',path:'/feedback'},{allowed:access.canViewOrders,label:'课程订单',path:'/course-orders'},{allowed:access.canEvents,label:'活动管理',path:'/events'}].filter(row=>row.allowed);
  return <GridContent>
    {error&&<Alert type="error" showIcon title="工作台数据加载失败" description={(error as Error).message} action={<Button onClick={()=>void refetch()}>重试</Button>} style={{marginBottom:24}}/>}
    {data?.development&&<Alert type="info" showIcon title="当前为开发环境。请录入实际内容；真实支付和外部服务接入尚未启用。" style={{marginBottom:24}}/>}
    <Card variant="borderless" title="开始使用后台" style={{marginBottom:24}}>
      <Typography.Paragraph>文章：新建草稿 → 提交审核 → 审核发布。课程：录入名师 → 创建课程 → 添加图文、音频或视频章节 → 发布课程。</Typography.Paragraph>
      <Typography.Paragraph>学员账号在「账号与会话」管理，人员分工在「角色与权限」设置，书院名称和客服联系方式在「系统配置」维护。</Typography.Paragraph>
      <Typography.Text type="secondary">没有内容时，列表为空、指标为零是正常状态。高级数据维护用于排查和字典维护，不需要逐张数据表录入。</Typography.Text>
    </Card>
    <Row gutter={24}>{metrics.map(metric=><Col key={metric.title} xs={24} sm={12} xl={6} style={{marginBottom:24}}><ChartCard variant="borderless" loading={isFetching&&!data} title={metric.title} total={metric.value??'—'} footer={<Field label={metric.footer} value={metric.total??''}/>} contentHeight={32}><Typography.Text type="secondary">来自书院数据库</Typography.Text></ChartCard></Col>)}</Row>
    <Row gutter={24}><Col xs={24} xl={16} style={{marginBottom:24}}>
      {access.canContent&&<Card variant="borderless" title="近30日阅读与实践" extra={<Button loading={isFetching} onClick={()=>void refetch()}>刷新</Button>}><Typography.Paragraph type="secondary">按北京时间，每个账号每天仅计一次；阅读与打卡分别统计。</Typography.Paragraph>{data?<Column data={trend} xField="day" yField="count" colorField="type" group height={300} axis={{x:{title:false},y:{title:'人数'}}}/>:<Empty description="等待数据加载"/>}</Card>}
      {data?.finance&&<Card variant="borderless" title="近30日已接受收款与退款" style={{marginTop:access.canContent?24:0}} extra={<Button loading={isFetching} onClick={()=>void refetch()}>刷新</Button>}><Typography.Paragraph type="secondary">按渠道确认的收款与退款时间统计，北京时间，单位：元。含课程、会员、商品及预约活动预收款；异常重复收款的自动退款不计入。收款不代表服务已履约，也不是可提现余额。</Typography.Paragraph><Column data={financialTrend} xField="day" yField="amount" colorField="type" group height={300} axis={{x:{title:false},y:{title:'元'}}}/></Card>}
      <Card variant="borderless" title="业务入口" style={{marginTop:access.canContent||data?.finance?24:0}}><Space wrap>{shortcuts.map(row=><Button key={row.path} onClick={()=>history.push(row.path)}>{row.label}</Button>)}</Space>{!shortcuts.length&&<Empty description="当前账号没有已启用的业务入口"/>}</Card>
    </Col><Col xs={24} xl={8} style={{marginBottom:24}}><Card variant="borderless" title="待办事项"><Table<{title:string;count:number;path:string}> rowKey="path" size="small" showHeader={false} pagination={false} loading={isFetching&&!data} dataSource={data?.tasks??[]} locale={{emptyText:'当前权限范围内暂无待办模块'}} columns={[{dataIndex:'title'},{dataIndex:'count',render:count=><Tag color={count?'orange':'default'}>{count}</Tag>},{render:(_,task)=><Button type="link" onClick={()=>history.push(task.path)}>前往处理</Button>}]}/></Card>{access.canCourses&&<Card variant="borderless" title="内容资源" style={{marginTop:24}}><Tag>名师 {data?.teachers??'—'}</Tag></Card>}</Col></Row>
  </GridContent>;
}
