import {useEffect,useState} from 'react';
import {Alert,App,Button,Drawer,Form,Input,InputNumber,Select} from 'antd';
import {api} from '@/api';
import MoneyInput from '@/components/MoneyInput';
export default function ConsultationBenefits({plan,onClose,onSaved}:{plan:{id:string;version:number;title:string};onClose:()=>void;onSaved:()=>void}){
 const {message}=App.useApp(),[form]=Form.useForm(),[services,setServices]=useState<{id:string;title:string}[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),quota=Form.useWatch('monthlyConsultations',form);
 useEffect(()=>{let active=true;void api<{id:string;title:string;active:boolean}[]>('/admin/services').then(r=>{if(active)setServices(r.filter(s=>s.active));}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[]);
 async function save(){const values=await form.validateFields();setBusy(true);try{await api('/admin/membership-benefits/plans/'+plan.id+'/consultations','POST',{...values,expectedVersion:plan.version,...(!values.monthlyConsultations?{amountMinor:0,serviceIds:[]}:{})});message.success('咨询权益新版本已发布，已售会员保持原权益');onSaved();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <Drawer title={plan.title+' · 新售咨询权益'} open size={650} onClose={()=>{if(!busy)onClose();}} extra={<Button type="primary" loading={busy} onClick={save}>保存新权益版本</Button>}>
  <Alert type="info" showIcon title="仅影响之后购买的新会员版本" description="每北京时间自然月按次数抵扣指定服务，单次不超过设置金额，不折现、不叠加。预约预占，实际履约计次，取消或未交付返回原份额。已确认预约不因会员到期取消；旧会员不会被自动追加权益。" style={{marginBottom:20}}/>
  {error&&<Alert type="error" title={error} style={{marginBottom:16}}/>}<Form name="membership-consultation-benefits" layout="vertical" form={form} initialValues={{monthlyConsultations:0,amountMinor:0,serviceIds:[]}} disabled={busy}><Form.Item label="每自然月咨询次数" name="monthlyConsultations" rules={[{required:true}]} extra="设为0，表示新售版本不含咨询抵扣。"><InputNumber min={0} max={100}/></Form.Item>{quota>0&&<><Form.Item label="每次最多抵扣（元）" name="amountMinor" rules={[{required:true}]}><MoneyInput min={1}/></Form.Item><Form.Item label="适用服务" name="serviceIds" rules={[{required:true,message:'请选择实际开放的服务'}]}><Select mode="multiple" showSearch optionFilterProp="label" options={services.map(s=>({value:s.id,label:s.title}))}/></Form.Item></>}<Form.Item label="调整说明" name="reason" rules={[{required:true,min:2}]}><Input.TextArea rows={3} maxLength={500}/></Form.Item></Form>
 </Drawer>;
}
