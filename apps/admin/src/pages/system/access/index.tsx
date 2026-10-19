import { PageContainer, ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import { Alert, App, Button, Checkbox, Form, Input, Modal, Space, Switch, Tag, Typography } from 'antd';
import { useRef, useState } from 'react';
import { api } from '@/api';

type Role={id:string;code:string;name:string;version:number;active:boolean;permissionCodes:string[]};
type Policies={roles:Role[];permissions:[string,string][];ceilings:Record<string,string[]>};
export default function AccessPage() {
  const previousCodes=useRef<string[]>([]),table=useRef<ActionType>(undefined),{message,modal}=App.useApp(),[data,setData]=useState<Policies>(),[selected,setSelected]=useState<Role>(),[form]=Form.useForm(),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const columns:ProColumns<Role>[]=[{title:'角色',dataIndex:'name'},{title:'编码',dataIndex:'code'},{title:'状态',render:(_,row)=><Tag color={row.active?'success':'default'}>{row.active?'启用':'停用'}</Tag>},{title:'权限数',render:(_,row)=>row.permissionCodes.length},{title:'操作',valueType:'option',render:(_,row)=>!['ADMIN','USER'].includes(row.code)?<Button type="link" onClick={()=>{previousCodes.current=row.permissionCodes;form.setFieldsValue({permissionCodes:row.permissionCodes,active:row.active,reason:''});setError('');setSelected(row);}}>设置权限</Button>:<Typography.Text type="secondary">系统保留</Typography.Text>}];
  async function save(values:{permissionCodes:string[];active:boolean;reason:string}) {
    if(!selected||busy)return;setBusy(true);setError('');
    try{await api('/admin/access/'+selected.code,'PATCH',{...values,expectedVersion:selected.version});setSelected(undefined);table.current?.reload();message.success('策略已生效，后续请求按新权限执行');window.dispatchEvent(new Event('daoxue:permissions-changed'));}catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  const choices=data?.permissions.filter(([code])=>selected&&data.ceilings[selected.code]?.includes(code)).map(([value,label])=>({value,label}))??[];
  return <PageContainer title="角色与权限" subTitle="角色范围内分别配置查看、编辑、审核权限；菜单和操作按钮同步依据策略显示">
    <Alert type="info" showIcon title="管理员拥有完整管理权限，普通用户无法登录后台。老师仍只能处理所属课程和本人问答；权限设置不能扩大业务归属范围。" style={{marginBottom:16}}/>
    <ProTable<Role> rowKey="id" actionRef={table} columns={columns} search={false} pagination={false} request={async()=>{const result=await api<Policies>('/admin/access');setData(result);return {data:result.roles,success:true};}}/>
    <Modal title={selected?.name+' · 权限策略'} open={!!selected} width={860} confirmLoading={busy} onOk={()=>form.submit()} onCancel={()=>{if(busy)return;if(form.isFieldsTouched())modal.confirm({title:'放弃未保存的权限变更？',onOk:()=>setSelected(undefined)});else setSelected(undefined);}}>
      {error&&<Alert type="error" title={error} showIcon style={{marginBottom:16}}/>}
      <Form form={form} layout="vertical" onFinish={save} disabled={busy}>
        <Form.Item name="active" label="启用此管理角色" valuePropName="checked"><Switch/></Form.Item>
        <Form.Item name="permissionCodes" label="菜单与操作权限"><Checkbox.Group options={choices} style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:'12px 16px'}} onChange={values=>{
          const current=previousCodes.current;
          const added=values.filter(code=>!current.includes(String(code)));
          const codes=new Set(values.map(String));
          for(const code of added)if(/\.(write|review)$/.test(String(code)))codes.add(String(code).split('.')[0]+'.read');
          for(const code of current)if(code.endsWith('.read')&&!codes.has(code))for(const action of ['write','review'])codes.delete(code.split('.')[0]+'.'+action);
          previousCodes.current=[...codes];form.setFieldValue('permissionCodes',[...codes]);
        }}/></Form.Item>
        <Form.Item name="reason" label="修改原因" rules={[{required:true,whitespace:true,min:2,max:500}]}><Input.TextArea rows={2} maxLength={500}/></Form.Item>
        <Space><Button onClick={()=>{previousCodes.current=data?.ceilings[selected?.code??'']??[];form.setFieldValue('permissionCodes',previousCodes.current);}}>恢复本角色默认权限</Button><Button onClick={()=>{previousCodes.current=[];form.setFieldValue('permissionCodes',[]);}}>清空权限</Button></Space>
      </Form>
    </Modal>
  </PageContainer>;
}
