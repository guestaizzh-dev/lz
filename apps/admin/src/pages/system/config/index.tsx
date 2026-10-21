import { PageContainer } from '@ant-design/pro-components';
import { useAccess, useModel } from '@umijs/max';
import { Alert, App, Button, Card, Descriptions, Drawer, Empty, Form, Input, InputNumber, Space, Spin, Switch, Tabs, Timeline } from 'antd';
import { useEffect, useState } from 'react';
import { api } from '@/api';
import { formatChinaTime } from '@/utils/date-time';

type Config={key:string;revision:number;value:Record<string,string|number|boolean>};
type Revision={id:string;revision:number;value:unknown;reason:string;effectiveAt:string};
const labels:Record<string,string>={release:'App版本与下载',androidVersion:'Android版本号',androidCode:'Android构建号',androidUrl:'Android下载HTTPS地址',iosVersion:'iOS版本号',iosCode:'iOS构建号',iosUrl:'App Store下载HTTPS地址',notes:'版本更新说明',site:'书院与客服信息',catalog:'首页内容展示',community:'公共讨论区',presentation:'演示内容展示',showDemoContent:'公开展示规范演示内容',academyName:'书院名称',description:'书院简介',supportPhone:'客服电话',supportEmail:'客服邮箱',supportHours:'服务时间',homeArticles:'文章数量',homeCourses:'课程数量',homeProducts:'商品数量',homeEvents:'活动数量',publicPostingEnabled:'允许公共讨论区发布新帖'};
function ConfigForm({item,reload,onDirty}:{item:Config;reload:()=>Promise<void>;onDirty:(value:boolean)=>void}) {
  const {setInitialState}=useModel('@@initialState'),access=useAccess(),{message,modal}=App.useApp(),[form]=Form.useForm(),[busy,setBusy]=useState(false),[history,setHistory]=useState<Revision[]>(),[error,setError]=useState('');
  useEffect(()=>{form.resetFields();form.setFieldsValue({...item.value,reason:''});onDirty(false);},[item,form,onDirty]);
  async function save(values:Record<string,unknown>){
    if(busy)return;
    modal.confirm({title:'确认立即生效？',content:'将保存为新版本，历史配置保留。',onOk:async()=>{
      setBusy(true);setError('');
      try{const {reason,...value}=values;await api('/admin/config/'+item.key,'PUT',{expectedRevision:item.revision,value,reason});if(item.key==='site')await setInitialState(state=>({...state,settings:{...state?.settings,title:String(value.academyName)}}));await reload();message.success('配置已生效');}catch(e){setError((e as Error).message);throw e;}finally{setBusy(false);}
    }});
  }
  return <Card title={labels[item.key]} extra={<Space><span>版本 {item.revision}</span><Button onClick={async()=>{try{setHistory(await api<Revision[]>('/admin/config/'+item.key+'/history'));}catch(e){message.error((e as Error).message);}}}>查看历史</Button></Space>}>
    {error&&<Alert type="error" showIcon title={error} style={{marginBottom:16}}/>}
    {item.key==='presentation'&&<Alert type="info" showIcon title="仅展示已发布的示例。开启后首页、搜索与学习入口保持一致，会员和私人内容仍需授权，示例课程不能真实收款。" style={{marginBottom:16}}/>}
    <Form form={form} layout="vertical" onFinish={save} onValuesChange={()=>onDirty(true)} disabled={busy||!access.canConfigWrite} style={{maxWidth:680}}>
      {Object.entries(item.value).map(([key,value])=><Form.Item key={key} name={key} label={labels[key]} valuePropName={typeof value==='boolean'?'checked':'value'} rules={typeof value==='boolean'?[]:[{required:typeof value==='number'||key==='academyName',...(typeof value==='string'?{max:['description','notes'].includes(key)?500:key.endsWith('Url')?1000:100}:{})},...(key==='supportEmail'?[{type:'email' as const}]:[])]}>
        {typeof value==='boolean'?<Switch/>:typeof value==='number'?<InputNumber min={item.key==='release'?0:1} max={item.key==='release'?2147483647:12} precision={0}/>:['description','notes'].includes(key)?<Input.TextArea rows={3} maxLength={500} showCount/>:<Input maxLength={key.endsWith('Url')?1000:100}/>}
      </Form.Item>)}
      {access.canConfigWrite&&<><Form.Item name="reason" label="修改原因" rules={[{required:true,whitespace:true,min:2,max:500}]}><Input.TextArea rows={2} maxLength={500}/></Form.Item><Button htmlType="submit" type="primary" loading={busy}>保存配置</Button></>}
    </Form>
    <Drawer title={labels[item.key]+' · 最近50个版本'} open={!!history} size={660} onClose={()=>setHistory(undefined)}>{history?.length===0&&<Empty description="尚未保存配置，当前使用默认设置"/>}<Timeline items={history?.map(row=>({children:<><strong>版本 {row.revision}</strong> · {formatChinaTime(row.effectiveAt)}<p>{row.reason}</p><Descriptions column={1} size="small" bordered items={Object.entries(row.value as object).map(([key,value])=>({key,label:labels[key]??key,children:typeof value==='boolean'?(value?'开启':'关闭'):String(value)}))}/></>}))}/></Drawer>
  </Card>;
}
export default function ConfigPage(){
  const {modal}=App.useApp(),[active,setActive]=useState('site'),[dirty,setDirty]=useState(false);
  const [items,setItems]=useState<Config[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  async function load(){setLoading(true);setError('');try{setItems(await api<Config[]>('/admin/config'));}catch(e){setError((e as Error).message);}finally{setLoading(false);}}
  useEffect(()=>{void load();},[]);
  return <PageContainer title="系统配置" subTitle="只管理已接入业务的全局参数；变更即时生效并保留版本历史">{error&&<Alert type="error" showIcon title={error} action={<Button onClick={()=>void load()}>重试</Button>}/>}<Spin spinning={loading}><Tabs activeKey={active} onChange={key=>{if(dirty)modal.confirm({title:'放弃未保存的配置？',onOk:()=>{setDirty(false);setActive(key);}});else setActive(key);}} destroyOnHidden items={items.map(item=>({key:item.key,label:labels[item.key],children:<ConfigForm item={item} reload={load} onDirty={setDirty}/>}))}/></Spin></PageContainer>;
}
