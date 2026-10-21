import {useEffect,useState} from 'react';
import {Alert,App,Button,Drawer,Form,Input,InputNumber,Select,Space,Table,Typography,Upload} from 'antd';
import {api} from '@/api';
import {useAccess} from '@umijs/max';
import {formatChinaTime} from '@/utils/date-time';

type File={id:string;name:string;mime:string;bytes:number};
type Release={id:string;releaseNo:number;description:string;accessDays:number|null;files:File[]};
export default function DigitalPack({product,onClose}:{product:{id:string;title:string};onClose:()=>void}){
  const {message}=App.useApp(),access=useAccess(),[form]=Form.useForm(),[files,setFiles]=useState<File[]>([]),[releases,setReleases]=useState<Release[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
  async function load(){setLoading(true);try{const [pack,assets]=await Promise.all([api<{items:Release[]}>('/admin/products/'+product.id+'/digital-releases'),api<File[]>('/admin/products/'+product.id+'/digital-files')]);setReleases(pack.items);setFiles(assets.filter(a=>['application/pdf','image/png','image/jpeg','image/webp','video/mp4','audio/mpeg','audio/mp4'].includes(a.mime)));setError('');}catch(e){setError((e as Error).message);}finally{setLoading(false);}}
  useEffect(()=>{void load();},[product.id]);
  async function save(){const values=await form.validateFields();setBusy(true);try{await api('/admin/products/'+product.id+'/digital-releases','POST',values);form.resetFields();await load();message.success('新资料版本已保存，历史订单仍交付原版本');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <Drawer title={product.title+' · 数字资料包'} open size={760} onClose={()=>{if(!busy)onClose();}} extra={access.canProductsEdit&&<Button type="primary" disabled={loading} loading={busy} onClick={save}>保存新版本</Button>}>
    <Alert type="info" showIcon title="上传资料、保存版本，再回到商品列表上架" description="首次保存自动建立标准规格，售价沿用商品展示价。新版本仅用于新订单，已购资料不被覆盖。领取开始后不支持默认未领取退款，质量或无法交付问题按原订单处理。" style={{marginBottom:20}}/>
    {error&&<Alert type="error" title={error} action={<Button onClick={load}>重试</Button>} style={{marginBottom:16}}/>}
    {access.canProductsEdit&&<Form name="digital-pack" layout="vertical" form={form} disabled={busy}>
      <Form.Item label="本版资料说明" name="description" rules={[{required:true,message:'请说明本版资料内容'}]}><Input.TextArea rows={3} maxLength={2000}/></Form.Item>
      <Form.Item label="领取有效天数" name="accessDays" extra="留空为长期；从本单付款确认时开始计算。"><InputNumber min={1} max={3650}/></Form.Item>
      <Form.Item label="资料文件" name="assetIds" rules={[{required:true,message:'请选择至少一个资料文件'}]}><Select mode="multiple" showSearch optionFilterProp="label" maxCount={20} options={files.map(f=>({value:f.id,label:f.name+' · '+(f.bytes/1024/1024).toFixed(1)+'MB'}))}/></Form.Item>
      <Space wrap><Upload accept="application/pdf,image/png,image/jpeg,image/webp" showUploadList={false} disabled={busy} beforeUpload={async file=>{if(file.size>8*1024*1024){message.error('PDF或图片资料每份不超过8MB；音视频请到音视频媒体库上传');return false;}setBusy(true);try{const body=new FormData();body.append('file',file);const asset=await api<File>('/admin/products/'+product.id+'/digital-files','POST',body);setFiles(old=>[asset,...old]);form.setFieldValue('assetIds',[...new Set([...(form.getFieldValue('assetIds')??[]),asset.id])]);message.success('资料已上传并选中');}catch(e){setError((e as Error).message);}finally{setBusy(false);}return false;}}><Button loading={busy}>上传本地PDF或图片</Button></Upload><Typography.Text type="secondary">音视频复用媒体库已处理的私有文件，私人凭证不可作为商品资料。</Typography.Text></Space>
    </Form>}
    <Typography.Title level={5} style={{marginTop:28}}>历史版本</Typography.Title>
    <Table rowKey="id" loading={loading} dataSource={releases} pagination={false} columns={[{title:'版本',dataIndex:'releaseNo',width:70},{title:'说明',dataIndex:'description'},{title:'有效期',render:(_,r)=>r.accessDays?r.accessDays+'天':'长期'},{title:'文件',render:(_,r)=><Space orientation="vertical">{r.files.map(f=><Typography.Text key={f.id}>{f.name}</Typography.Text>)}</Space>}]} />
  </Drawer>;
}
