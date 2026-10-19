import { PageContainer, ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import { Button, Descriptions, Drawer, Tabs, Tag, Typography } from 'antd';
import { useRef, useState } from 'react';
import { api } from '@/api';
import { formatChinaTime } from '@/utils/date-time';

type Audit={id:string;action:string;resource:string;resourceId:string;requestId:string;reason:string;changes:Record<string,unknown>;beforeSnapshot:unknown;afterSnapshot:unknown;actor:{nickname:string;username?:string};createdAt:string};
const modules:Record<string,string>={system:'系统维护',admin_api:'后台访问',auth_session:'账号登录',app_user:'账号',user:'账号',access_role:'角色权限',user_role:'角色授权',feature_config:'系统配置',article:'文章',course:'课程',teacher:'名师',product:'商品',membership:'会员权益',membershipPlan:'会员套餐',enrollment:'课程授权',event:'活动',media:'课程媒体',forum:'社区',feedback:'客服反馈',data:'高级数据维护'};
const verbs:Record<string,string>={create:'新建',edit:'编辑',update:'更新',delete:'删除',submit:'提交审核',publish:'审核发布',reject:'审核退回',archive:'下架',revise:'重新修订',grant:'授予权限',revoke:'撤销权限',upload:'上传',freeze:'停用账号',restore:'恢复账号',revokeSessions:'强制退出',resetPassword:'重设密码'};
const actions:Record<string,string>={'fixture.cleanup':'清理测试数据','auth.login':'登录后台','auth.logout':'退出登录','access.denied':'访问被拒绝','admin.request':'后台操作结果','access.policy':'调整角色权限','config.update':'修改系统配置','role.baseline':'登记已有角色','role.grant':'授予角色','role.revoke':'撤销角色',
  'manual.fixture.user.create':'初始化测试学员', 'manual.fixture.label':'标记测试内容', 'manual.fixture.membership.expired':'设置会员到期测试场景', 'manual.fixture.live.create':'初始化测试直播预告', 'manual.fixture.live.schedule':'安排测试直播场次'};
function actionLabel(action:string){const [module,verb]=action.split('.');return actions[action]??(modules[module]&&verbs[verb]?modules[module]+' · '+verbs[verb]:action);}
export default function AuditPage() {
  const table=useRef<ActionType>(undefined),[selected,setSelected]=useState<Audit>();
  const columns:ProColumns<Audit>[]=[
    {title:'行为',dataIndex:'action',valueType:'select',valueEnum:Object.fromEntries([...Object.entries(actions),...Object.keys(modules).flatMap(module=>Object.keys(verbs).map(verb=>[module+'.'+verb,actionLabel(module+'.'+verb)]))]),render:(_,row)=>actionLabel(row.action)}, {title:'业务模块',dataIndex:'resource',valueType:'select',valueEnum:modules,render:(_,row)=>modules[row.resource]??row.resource},
    {title:'操作人（昵称 / 账号）',dataIndex:'actorId',render:(_,row)=>row.actor.nickname},
    {title:'记录 / 请求编号',dataIndex:'q',hideInTable:true},
    {title:'请求编号',dataIndex:'requestId',search:false,ellipsis:true},
    {title:'结果',search:false,render:(_,row)=>row.action==='access.denied'?<Tag color="error">权限拒绝</Tag>:row.action==='admin.request'?<Tag color={row.changes.outcome==='FAILED'?'error':'success'}>{row.changes.outcome==='FAILED'?'操作失败':'操作成功'}</Tag>:<Tag>业务记录</Tag>},
    {title:'记录时间（北京时间）',dataIndex:'createdAt',valueType:'dateTimeRange',render:(_,row)=>formatChinaTime(row.createdAt)},
    {title:'操作',valueType:'option',render:(_,row)=><Button type="link" onClick={()=>setSelected(row)}>查看追溯</Button>},
  ];
  return <PageContainer title="操作审计" subTitle="关键变更、登录与权限拒绝可追溯；私人内容和凭据在返回前脱敏">
    <ProTable<Audit> actionRef={table} rowKey="id" columns={columns} pagination={{pageSize:20}} request={async p=>{
      const query=new URLSearchParams({page:String(p.current??1),size:String(p.pageSize??20)});
      for(const key of ['action','resource','actorId','q'])if(p[key])query.set(key,String(p[key]));
      if(p.createdAt){query.set('from',new Date(String(p.createdAt[0]).replace(' ','T')+'+08:00').toISOString());query.set('to',new Date(String(p.createdAt[1]).replace(' ','T')+'+08:00').toISOString());}
      const result=await api<{items:Audit[];total:number}>('/admin/audit?'+query);return {data:result.items,total:result.total,success:true};
    }}/>
    <Drawer title="操作追溯" open={!!selected} onClose={()=>setSelected(undefined)} size={760}>{selected&&<>
      <Descriptions column={1} bordered items={[{key:'actor',label:'操作人',children:selected.actor.nickname},{key:'action',label:'行为',children:actionLabel(selected.action)},{key:'time',label:'北京时间',children:formatChinaTime(selected.createdAt)},{key:'record',label:'关联记录',children:<Typography.Text copyable>{selected.resourceId??'—'}</Typography.Text>},{key:'request',label:'请求编号',children:<Typography.Text copyable>{selected.requestId||'历史记录未关联请求'}</Typography.Text>},{key:'reason',label:'原因',children:selected.reason||'—'}]}/>
      <Tabs style={{marginTop:24}} items={['changes','beforeSnapshot','afterSnapshot'].map((key,i)=>({key,label:['变更摘要','变更前','变更后'][i],children:<pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',background:'#f5f5f5',padding:16,borderRadius:6}}>{JSON.stringify(selected[key as 'changes'],null,2)}</pre>}))}/>
    </>}</Drawer>
  </PageContainer>;
}
