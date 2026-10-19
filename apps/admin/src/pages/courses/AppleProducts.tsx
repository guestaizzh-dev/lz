import {useEffect,useRef,useState} from 'react';
import {useAccess} from '@umijs/max';
import {Alert,App,Button,Descriptions,Drawer,Form,Input,Modal,Select,Space,Table,Tag,Typography} from 'antd';
import {api} from '@/api';
import {formatChinaTime} from '@/utils/date-time';
type Mapping={id:string;version:number;offerId:string;appScope:string;externalProductId:string;priceMinor:string;active:boolean;deactivatedAt:string|null;createdAt:string};
type Offer={id:string;price:string;active:boolean;release:{id?:string;version?:number;releaseNo?:number;title?:string;days?:number;accessDays:number|null}};
type Data={items:Mapping[];offers:Offer[];enabled:boolean;nativeReady:boolean;plan?:{id:string;title:string;price:number;days:number;active:boolean};currentVersion?:{id:string;releaseNo:number;description:string}};
const money=(value:string)=>'¥'+(Number(value)/100).toFixed(2);
export default function AppleProducts({courseId,planId,onClose}:{courseId?:string;planId?:string;onClose:()=>void}){
  const member=!!planId,resourceId=planId??courseId,endpoint=member?'/admin/apple-memberships':'/admin/apple-products';
  const access=useAccess(),{message,modal}=App.useApp(),[data,setData]=useState<Data>(),[loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState(''),[creating,setCreating]=useState(false),[form]=Form.useForm(),sequence=useRef(0);
  async function load(){if(!resourceId)return;const revision=++sequence.current;setLoading(true);try{const result=await api<Data>(endpoint+(member?'/':'/courses/')+resourceId);if(revision===sequence.current){setData(result);setError('');}}catch(e){if(revision===sequence.current)setError((e as Error).message);}finally{if(revision===sequence.current)setLoading(false);}}
  useEffect(()=>{setData(undefined);setError('');setCreating(false);if(resourceId)void load();return()=>{sequence.current++;};},[resourceId,member]);
  async function save(){if(saving)return;try{const values=await form.validateFields(),offer=data?.offers.find(o=>o.id===values.offerId);if(member?!data?.currentVersion||!data?.plan?.active:!offer){message.error(member?'此套餐未启用或权益尚未发布':'请选择课程售卖版本');return;}setSaving(true);await api(endpoint,'POST',{...values,...(member?{planId,planVersionId:data!.currentVersion!.id,priceMinor:data!.plan!.price}:{priceMinor:Number(offer!.price)})});setCreating(false);await load();message.success('已保存不可改绑的产品映射；核查渠道配置后单独启用');}catch(e){if(e instanceof Error)message.error(e.message);}finally{setSaving(false);}}
  function activation(row:Mapping){let reason='';modal.confirm({title:row.active?'停止此Apple产品新购？':'启用此Apple产品映射？',content:<Space direction="vertical"><Typography.Text>{row.externalProductId}</Typography.Text><Typography.Paragraph type="secondary">{row.active?'旧凭证仍可恢复。停售时间将固定；再次售卖须使用新产品编号。':'须在App Store配置相同应用、环境、'+(member?'非续期订阅':'非消耗型')+'产品及价格；原生未验收时仍不会开放购买入口。'}</Typography.Paragraph><Input.TextArea maxLength={500} placeholder="处理原因（至少2字）" onChange={e=>{reason=e.target.value;}}/></Space>,onOk:async()=>{if(reason.trim().length<2){message.error('请填写处理原因');throw Error('请填写处理原因');}setSaving(true);try{await api(endpoint+'/'+row.id+'/activation','POST',{active:!row.active,expectedVersion:row.version,reason:reason.trim()});await load();message.success(row.active?'已停售，原购买事实保留':'映射已启用，原生购买仍受验收门禁控制');}catch(e){message.error((e as Error).message);throw e;}finally{setSaving(false);}}});}
  return <><Drawer title={member?"Apple会员产品映射":"Apple课程产品映射"} width={850} open={!!resourceId} onClose={()=>{if(!saving)onClose();}} maskClosable={!saving} extra={(member?access.canMembersWrite:access.canCoursesReview)&&<Button type="primary" disabled={saving} onClick={()=>{form.resetFields();form.setFieldsValue({environment:'Production'});setCreating(true);}}>新增产品映射</Button>}>
    <Alert showIcon type="info" title={member?"固定天数会员使用非续期订阅，不自动续费":"每个Apple产品固定对应一个长期课程版本"} description={member?"产品绑定当前已发布的套餐与权益版本。新购前确认固定天数和排队期限；旧产品、旧订单与会员日期保持不变，改价改版需配置新产品。退款由Apple审核。":"限真实、已发布、可交付课程。价格以App Store返回结果为准，映射价格须与课程售卖版本一致；旧购买版本、产品编号和价格不允许改绑。限期课程与会员需对应订阅流程，不复用此非消耗型配置。"} style={{marginBottom:20}}/>
    {data&&!data.enabled&&<Alert showIcon type="warning" title="Apple渠道尚未配置，当前不会收费" description="可准备产品映射；启用仍需正式应用、签名密钥与环境核验，购买入口还需原生验收。" style={{marginBottom:16}}/>}
    {error&&<Alert type="error" showIcon title={error} action={<Button onClick={()=>void load()}>重试</Button>}/>}
    <Table<Mapping> rowKey="id" loading={loading} dataSource={data?.items??[]} scroll={{x:780}} pagination={{pageSize:10}} columns={[
      {title:'Apple产品编号',dataIndex:'externalProductId',render:v=><Typography.Text copyable>{v}</Typography.Text>},
      {title:'应用与环境',dataIndex:'appScope'},
      {title:member?'权益版本 / 价格':'课程版本 / 价格',render:(_,row)=>{const release=data?.offers.find(o=>o.id===row.offerId)?.release;return <>{member?release?.releaseNo:release?.version} 版 · {money(row.priceMinor)}</>;}},
      {title:'状态',render:(_,row)=><Tag color={row.active?'green':row.deactivatedAt?'orange':undefined}>{row.active?'映射启用':row.deactivatedAt?'已停售，保留恢复':'待核查启用'}</Tag>},
      {title:'创建时间',dataIndex:'createdAt',render:v=>formatChinaTime(v)},
      {title:'操作',render:(_,row)=>(member?access.canMembersWrite:access.canCoursesReview)?<Button type="link" disabled={saving||!row.active&&(!data?.enabled||!!row.deactivatedAt)} danger={row.active} onClick={()=>activation(row)}>{row.active?'停售':'核查并启用'}</Button>:null},
    ]}/>
  </Drawer><Modal title={member?"新增Apple非续期会员产品":"新增Apple非消耗型课程产品"} open={creating} confirmLoading={saving} onOk={()=>void save()} onCancel={()=>{if(!saving)setCreating(false);}} maskClosable={!saving}>
    <Form form={form} layout="vertical" disabled={saving}>
      {member?<Descriptions column={1} bordered size="small" style={{marginBottom:20}} items={[{key:'plan',label:'套餐',children:data?.plan?.title},{key:'days',label:'固定有效期',children:(data?.plan?.days??0)+'天'},{key:'version',label:'权益版本',children:data?.currentVersion?.releaseNo??'尚未发布'},{key:'price',label:'商店核对价格',children:money(String(data?.plan?.price??0))}]}/>:<Form.Item name="offerId" label="课程售卖版本" rules={[{required:true}]} extra="只列出长期有效的版本，服务端会再次验证真实内容和课件交付状态。"><Select options={data?.offers.filter(o=>o.active&&o.release.accessDays===null).map(o=>({value:o.id,label:'第 '+o.release.version+' 版 · '+o.release.title+' · '+money(o.price)}))}/></Form.Item> }
      <Form.Item name="bundleId" label="Bundle ID" rules={[{required:true,pattern:/^[\w-]+(?:\.[\w-]+)+$/}]}><Input placeholder="与正式App的Bundle ID一致" maxLength={180}/></Form.Item>
      <Form.Item name="environment" label="Apple环境" rules={[{required:true}]}><Select options={[{value:'Production',label:'正式环境'},{value:'Sandbox',label:'沙箱环境（正式服务拒绝）'}]}/></Form.Item>
      <Form.Item name="externalProductId" label="App Store产品编号" rules={[{required:true,pattern:/^[-\w.]{1,255}$/}]}><Input maxLength={255}/></Form.Item>
      <Form.Item name="reason" label="配置依据与处理原因" rules={[{required:true,whitespace:true,min:2,max:500}]}><Input.TextArea rows={3} maxLength={500} showCount/></Form.Item>
    </Form>
  </Modal></>;
}
