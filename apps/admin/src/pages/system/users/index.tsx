import { PageContainer, ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import { useAccess, useModel } from '@umijs/max';
import { Alert, App, Button, Drawer, Form, Input, Modal, Select, Space, Table, Tag, Typography } from 'antd';
import { useRef, useState } from 'react';
import { api } from '@/api';
import { formatChinaTime } from '@/utils/date-time';

type User={id:string;nickname:string;username:string|null;roles:string[];status:string;version:number;createdAt:string};
type Grant={id:string;role:string;reason:string;createdAt:string;_revision:string};
const roles:Record<string,string>={USER:'学员',TEACHER:'老师',OPERATOR:'运营',MODERATOR:'审核',SUPPORT:'客服',FINANCE:'财务',ADMIN:'管理员'};
const statuses={ACTIVE:{text:'正常',status:'Success'},FROZEN:{text:'已停用',status:'Error'},DELETED:{text:'已注销',status:'Default'}};
export default function UsersPage() {
  const access=useAccess(),{initialState}=useModel('@@initialState'),{message,modal}=App.useApp(),table=useRef<ActionType>(undefined),[form]=Form.useForm(),[roleForm]=Form.useForm();
  const [editor,setEditor]=useState<{user?:User;action:string}>(),[roleUser,setRoleUser]=useState<User>(),[grants,setGrants]=useState<Grant[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),sequence=useRef(0);
  async function openRoles(user:User){const turn=++sequence.current;setRoleUser(user);setGrants([]);setError('');roleForm.resetFields();try{const rows=await api<Grant[]>('/admin/users/'+user.id+'/roles');if(turn===sequence.current)setGrants(rows);}catch(e){if(turn===sequence.current)setError((e as Error).message);}}
  function edit(action:string,user?:User){setError('');form.resetFields();setEditor({action,user});}
  async function save(values:Record<string,unknown>){if(!editor||busy)return;setBusy(true);setError('');try{
    await api(editor.user?'/admin/users/'+editor.user.id+'/actions':'/admin/users','POST',{...values,...(editor.user?{action:editor.action,expectedVersion:editor.user.version}:{})});setEditor(undefined);form.resetFields();table.current?.reload();message.success('账号操作已完成');
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function grant(values:Record<string,unknown>){if(!roleUser||busy)return;setBusy(true);setError('');try{await api('/admin/users/'+roleUser.id+'/roles','POST',values);await openRoles(roleUser);table.current?.reload();message.success('角色已授予');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  function revoke(row:Grant){const user=roleUser;if(!user)return;modal.confirm({title:'撤销'+roles[row.role]+'角色？',content:'此账号的后续请求将立即按剩余权限执行。',onOk:async()=>{setBusy(true);try{await api('/admin/data/roles/'+row.id+'/revoke','POST',{expectedRevision:row._revision,reason:'账号管理撤销不再需要的角色'});await openRoles(user);table.current?.reload();}catch(e){message.error((e as Error).message);throw e;}finally{setBusy(false);}}});}
  const columns:ProColumns<User>[]=[
    {title:'昵称 / 账号',dataIndex:'q',render:(_,row)=><><Typography.Text strong ellipsis style={{maxWidth:220}}>{row.nickname}</Typography.Text><div><Typography.Text type="secondary" ellipsis style={{maxWidth:220}}>{row.username??'App学员'}</Typography.Text></div></>},
    {title:'角色',dataIndex:'role',valueType:'select',valueEnum:roles,render:(_,row)=><Space wrap>{row.roles.map(role=><Tag key={role}>{roles[role]}</Tag>)}</Space>},
    {title:'状态',dataIndex:'accountStatus',valueEnum:statuses,render:(_,row)=><Tag color={row.status==='ACTIVE'?'success':row.status==='FROZEN'?'error':'default'}>{statuses[row.status as keyof typeof statuses]?.text}</Tag>},
    {title:'创建时间',search:false,render:(_,row)=>formatChinaTime(row.createdAt)},
    {title:'操作',valueType:'option',render:(_,row)=>row.id===initialState?.currentUser?.userid?<Typography.Text type="secondary">当前账号</Typography.Text>:<Space wrap>
      {access.canAccess&&row.status==='ACTIVE'&&<Button type="link" onClick={()=>void openRoles(row)}>分配角色</Button>}
      {access.canUsersWrite&&row.status!=='DELETED'&&<><Button type="link" danger={row.status==='ACTIVE'} onClick={()=>edit(row.status==='ACTIVE'?'freeze':'restore',row)}>{row.status==='ACTIVE'?'停用':'恢复'}</Button><Button type="link" onClick={()=>edit('revokeSessions',row)}>强制退出</Button>{row.username&&<Button type="link" onClick={()=>edit('resetPassword',row)}>重设密码</Button>}</>}
    </Space>},
  ];
  const actionLabels:Record<string,string>={create:'新建账号',freeze:'停用账号',restore:'恢复账号',revokeSessions:'强制退出全部设备',resetPassword:'重设密码'};
  return <PageContainer title="账号与会话" subTitle="账号状态和会话统一管理，角色变更独立审计；不显示用户联系方式和私人内容">
    <ProTable<User> actionRef={table} rowKey="id" columns={columns} pagination={{pageSize:20}} toolBarRender={()=>access.canUsersWrite?[<Button key="create" type="primary" onClick={()=>edit('create')}>新建账号</Button>]:[]} request={async p=>{
      const q=new URLSearchParams({page:String(p.current??1),size:String(p.pageSize??20)});for(const key of ['q','role','accountStatus'])if(p[key])q.set(key,String(p[key]));const result=await api<{items:User[];total:number}>('/admin/users?'+q);return{data:result.items,total:result.total,success:true};
    }}/>
    <Modal title={actionLabels[editor?.action??'create']} open={!!editor} onOk={()=>form.submit()} confirmLoading={busy} onCancel={()=>{if(busy)return;const close=()=>{form.resetFields();setEditor(undefined);};if(form.isFieldsTouched())modal.confirm({title:'放弃未保存的账号操作？',onOk:close});else close();}}>
      {error&&<Alert type="error" title={error} showIcon style={{marginBottom:16}}/>}{editor?.user&&<Alert showIcon type="warning" title={'操作账号：'+editor.user.nickname} description="冻结、撤销会话和重设密码会使该账号已有登录失效。" style={{marginBottom:16}}/>}
      <Form form={form} layout="vertical" onFinish={save} disabled={busy}>
        {editor?.action==='create'&&<><Form.Item name="username" label="登录账号" rules={[{required:true,pattern:/^[a-zA-Z0-9_.-]{3,80}$/,message:'3至80位字母、数字、点、下划线或短横线'}]}><Input maxLength={80} autoComplete="off"/></Form.Item><Form.Item name="nickname" label="显示名称" rules={[{required:true,whitespace:true,max:80}]}><Input maxLength={80}/></Form.Item></>}
        {['create','resetPassword'].includes(editor?.action??'')&&<Form.Item name="password" label="新密码（至少12位）" rules={[{required:true,min:12,max:200}]}><Input.Password autoComplete="new-password"/></Form.Item>}
        <Form.Item name="reason" label="操作原因" rules={[{required:true,whitespace:true,min:2,max:500}]}><Input.TextArea rows={2} maxLength={500}/></Form.Item>
        {editor?.action==='create'&&<Typography.Text type="secondary">新账号默认为学员。创建后在「角色」中授予管理角色，才能登录后台。</Typography.Text>}
      </Form>
    </Modal>
    <Drawer title={(roleUser?.nickname??'')+' · 角色授权'} open={!!roleUser} size={720} onClose={()=>{if(!busy){sequence.current++;setRoleUser(undefined);}}}>
      {error&&<Alert showIcon type="error" title={error} style={{marginBottom:16}}/>}
      <Table<Grant> rowKey="id" dataSource={grants} pagination={false} columns={[{title:'角色',render:(_,row)=>roles[row.role]},{title:'授予时间',render:(_,row)=>formatChinaTime(row.createdAt)},{title:'原因',dataIndex:'reason'},{title:'操作',render:(_,row)=><Button danger type="link" disabled={busy} onClick={()=>revoke(row)}>撤销</Button>}]}/>
      <Form form={roleForm} layout="vertical" style={{marginTop:24}} onFinish={grant} disabled={busy}><Form.Item name="role" label="授予角色" rules={[{required:true}]}><Select options={Object.entries(roles).filter(([role])=>role!=='USER'&&!grants.some(grant=>grant.role===role)).map(([value,label])=>({value,label}))}/></Form.Item><Form.Item name="reason" label="授权原因" rules={[{required:true,whitespace:true,min:2,max:500}]}><Input.TextArea rows={2} maxLength={500}/></Form.Item><Button htmlType="submit" type="primary" loading={busy}>授予角色</Button></Form>
    </Drawer>
  </PageContainer>;
}
