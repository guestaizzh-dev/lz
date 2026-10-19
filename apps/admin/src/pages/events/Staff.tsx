import { Alert, App, Button, Checkbox, Form, Input, Modal, Select, Space, Table, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { api } from '@/api';
type Staff={id:string;version:number;scopeCodes:string[];revokedAt:string|null;user?:{nickname:string;status:string}};
export default function EventStaff({id,onClose}:{id:string;onClose:()=>void}){
  const {message,modal}=App.useApp(),[rows,setRows]=useState<Staff[]>([]),[users,setUsers]=useState<{id:string;nickname:string}[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[form]=Form.useForm();
  async function load(){try{setRows(await api<Staff[]>('/admin/events/sessions/'+id+'/staff'));}catch(e){setError((e as Error).message);}}
  async function search(q=''){try{setUsers(await api('/admin/events/workers?q='+encodeURIComponent(q)));}catch(e){setError((e as Error).message);}}
  useEffect(()=>{load();search();},[id]);
  async function grant(values:Record<string,unknown>){if(busy)return;setBusy(true);setError('');try{await api('/admin/events/sessions/'+id+'/staff','POST',values);form.resetFields();await load();message.success('本场次委派已保存');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  function revoke(row:Staff){let reason='';modal.confirm({title:'撤销此工作人员的本场次权限？',content:<Input.TextArea aria-label="撤销委派原因" maxLength={500} onChange={e=>{reason=e.target.value;}} placeholder="填写撤销原因"/>,onOk:async()=>{if(!reason.trim())throw new Error('请填写撤销原因');await api('/admin/events/sessions/'+id+'/staff/'+row.id+'/revoke','POST',{expectedVersion:row.version,reason});await load();}});}
  return <Modal open title="本场次工作人员" width={760} footer={<Button onClick={()=>{if(!busy)onClose();}}>关闭</Button>} onCancel={()=>{if(!busy)onClose();}}>
    {error&&<Alert type="error" showIcon title={error} style={{marginBottom:16}}/>}
    <Typography.Paragraph type="secondary">选择已授予老师角色的有效账号。委派只适用于本场次；现场人员可从 App「我的 → 现场工作台」扫码或粘贴凭证，或使用后台现场工作台。撤销签到需要单独授权。</Typography.Paragraph>
    <Table<Staff> rowKey="id" dataSource={rows} pagination={false} columns={[{title:'工作人员',render:(_,r)=>r.user?.nickname??'已注销'},{title:'权限',render:(_,r)=>r.scopeCodes.includes('REVOKE')?'签到、撤销签到':'签到'},{title:'状态',render:(_,r)=>r.revokedAt?'已撤销':r.user?.status==='ACTIVE'?'有效':'账号已停用'},{title:'操作',render:(_,r)=>!r.revokedAt&&<Button type="link" danger onClick={()=>revoke(r)}>撤销委派</Button>}]}/>
    <Form form={form} layout="vertical" disabled={busy} initialValues={{scopeCodes:['CHECKIN']}} onFinish={grant} style={{marginTop:24}}>
      <Form.Item name="userId" label="工作人员账号" rules={[{required:true}]}><Select showSearch filterOption={false} onSearch={search} options={users.map(u=>({value:u.id,label:u.nickname}))} placeholder="选择老师或助教账号"/></Form.Item>
      <Form.Item name="scopeCodes" label="本场次权限" rules={[{required:true}]}><Checkbox.Group options={[{label:'签到核销',value:'CHECKIN',disabled:true},{label:'撤销误签到',value:'REVOKE'}]}/></Form.Item>
      <Form.Item name="reason" label="委派说明" rules={[{required:true,whitespace:true}]}><Input aria-label="委派说明" maxLength={500}/></Form.Item><Space><Button type="primary" htmlType="submit" loading={busy}>保存委派</Button></Space>
    </Form>
  </Modal>;
}
