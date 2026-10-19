from pathlib import Path

root = Path(__file__).resolve().parents[1]

def edit(path, replacements):
    p=root/path
    s=p.read_text(encoding='utf-8')
    for old,new in replacements:
        assert old in s, (path,old)
        s=s.replace(old,new)
    p.write_text(s,encoding='utf-8')

edit('apps/mobile/lib/membership-sales.ts', [
    ('canRefund:boolean;refundUrl:', 'canRefund:boolean;canRequestReview:boolean;refundUrl:'),
    ('requestedAmount:string;description:', 'requestedAmount:string;approvedAmount:string|null;acceptedAt:string|null;assessmentSnapshot:{suggestedAmount:string;deductionAmount?:string;startsAt:string;endsAt:string;assessedAt:string;usage:{name:string;quantity:number;state:string}[]}|null;description:'),
    ("Number(order.refundedAmount)>0?'已退款'", "Number(order.refundedAmount)>0?(Number(order.refundedAmount)<Number(order.paidAmount)?'部分退款 · 已退订':'已退款')")
])
edit('apps/mobile/pages/membership/purchase.uvue', [
    ("v-if=\"order!.canRefund\"", "v-if=\"order!.canRefund||order!.canRequestReview\""),
    ('申请退未来整段会员 ›', "{{order!.canRefund?'申请退未来整段会员':'申请退订与退款核查'}} ›"),
    ('subtitle="仅退符合规则的未来整段会员，说明原因即可"', 'subtitle="说明退订原因；已生效或已使用权益需核查金额，并由你确认退款方案"'),
    ('{{refundLabel(refund.state)}}', "{{refund.state==='APPROVED'?'请确认退款方案':refundLabel(refund.state)}}"),
    ('{{money(Number(refund.requestedAmount))}}', '{{money(Number(refund.approvedAmount??refund.requestedAmount))}}'),
    ('<text class="footer-note">{{formatChinaTime(refund.createdAt)}}</text></view>', '''<view v-if="refund.assessmentSnapshot" class="member-notice"><text class="body-copy">退款方案须经你确认，确认后退订此次购买的剩余会员；其他购买保持不变。</text><text v-if="refund.approvedAmount" class="body-copy">拟原路退回 ¥{{money(Number(refund.approvedAmount))}} · 扣除 ¥{{money(Number(refund.assessmentSnapshot.deductionAmount??'0'))}}</text><text class="footer-note">核查于 {{formatChinaTime(refund.assessmentSnapshot.assessedAt)}} · 原期限 {{formatChinaTime(refund.assessmentSnapshot.startsAt)}} 至 {{formatChinaTime(refund.assessmentSnapshot.endsAt)}}</text><text v-for="(use,index) in refund.assessmentSnapshot.usage" :key="index" class="footer-note">{{use.name}} · {{use.quantity}}次 · {{use.state==='HELD'?'占用中':'已使用'}}</text><view v-if="refund.state==='APPROVED'" class="member-links"><button class="text-action" :disabled="busy" @click="decideRefund(refund.id,refund.version,'DECLINE')">不同意，保留会员</button><button class="text-action" :disabled="busy" @click="decideRefund(refund.id,refund.version,'ACCEPT')">确认金额并退订</button></view><text v-if="refund.acceptedAt" class="footer-note">已于 {{formatChinaTime(refund.acceptedAt)}} 确认退款方案</text></view><text class="footer-note">{{formatChinaTime(refund.createdAt)}}</text></view>'''),
    ('function copyAppleRefund()', '''function decideRefund(id:string,version:number,action:string){if(busy.value||!order.value)return;const proposal=order.value.refunds.find(r=>r.id===id);if(!proposal)return;uni.showModal({title:action==='ACCEPT'?'确认退款并退订？':'保留原会员？',content:action==='ACCEPT'?'本次原路退回 ¥'+money(Number(proposal.approvedAmount))+'。确认后暂停本段权益，退款成功后结束此次购买的剩余会员；其他购买不变。':'拒绝本次方案，按原生效时间和到期日期恢复会员，不产生退款。',confirmText:action==='ACCEPT'?'确认退订':'保留会员',success:async result=>{if(!result.confirm||busy.value)return;busy.value=true;notice.value='';try{order.value=await request<MembershipOrder>('/commerce/membership-orders/'+orderId+'/refunds/'+id+'/decision',{method:'POST',body:{expectedVersion:version,action}});notice.value=action==='ACCEPT'?'方案已确认，正在办理原路退款。':'已保留原会员及原有效期限。';}catch(e){notice.value=(e as Error).message;}finally{busy.value=false;}}});}
function copyAppleRefund()''')
])
edit('apps/admin/src/pages/membership-orders/index.tsx', [
    ("REQUESTED:'待审核',", "REQUESTED:'待审核',APPROVED:'待学员确认方案',"),
    ('requestedAmount:string;reasonCode:', 'requestedAmount:string;approvedAmount:string|null;acceptedAt:string|null;assessmentSnapshot:{suggestedAmount:string;deductionAmount?:string;assessedAt:string;usage:{name:string;quantity:number;state:string}[]}|null;reasonCode:'),
    ('form.resetFields();setAction({refund,kind});', "form.resetFields();if(refund.assessmentSnapshot)form.setFieldValue('amountYuan',(Number(refund.assessmentSnapshot.suggestedAmount)/100).toFixed(2));setAction({refund,kind});"),
    ("const values=await form.validateFields();setBusy(true);await api", "const values=await form.validateFields();const body:{reason:string;approvedAmount?:string}={reason:values.reason};if(action.kind==='APPROVE'&&action.refund.reasonCode==='MEMBERSHIP_PARTIAL'){const [whole,fraction='']=String(values.amountYuan).split('.');body.approvedAmount=String(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')));}setBusy(true);await api"),
    ('expectedVersion:action.refund.version,...values', 'expectedVersion:action.refund.version,...body'),
    ("Number(row.refundedAmount)>0?'已退款'", "Number(row.refundedAmount)>0?(Number(row.refundedAmount)<Number(row.paidAmount)?'部分退款 · 已退订':'已退款')"),
    ('已生效或部分消费须经客服核查。', '已生效或部分消费由财务核查金额与扣除依据，学员确认方案后才发起退款。'),
    ('{money(r.requestedAmount)}</Typography.Text>', '{money(r.approvedAmount??r.requestedAmount)}</Typography.Text>'),
    ('{r.reviewNote&&<Typography.Paragraph', '''{r.assessmentSnapshot&&<><Typography.Paragraph type="secondary">核查时间：{formatChinaTime(r.assessmentSnapshot.assessedAt)} · 未使用时长参考金额 {money(r.assessmentSnapshot.suggestedAmount)}（非最终退款承诺）</Typography.Paragraph>{r.assessmentSnapshot.usage.map((u,i)=><Typography.Paragraph key={i}>{u.name} · {u.quantity}次 · {u.state==='HELD'?'占用中':'已使用'}</Typography.Paragraph>)}{r.assessmentSnapshot.deductionAmount&&<Typography.Paragraph>已核查扣除：{money(r.assessmentSnapshot.deductionAmount)}</Typography.Paragraph>}{r.acceptedAt&&<Typography.Paragraph type="secondary">学员确认于 {formatChinaTime(r.acceptedAt)}</Typography.Paragraph>}</>}{r.reviewNote&&<Typography.Paragraph'''),
    ('>审核通过并原路退款</Button>', ">{r.reasonCode==='MEMBERSHIP_PARTIAL'?'提出退款方案':'审核通过并原路退款'}</Button>"),
    ("r.reasonCode==='MEMBERSHIP_RETURN'", "['MEMBERSHIP_RETURN','MEMBERSHIP_PARTIAL'].includes(r.reasonCode)"),
    ('<Form.Item name="reason" label="已核实的处理意见"', '''{action?.kind==='APPROVE'&&action.refund.reasonCode==='MEMBERSHIP_PARTIAL'&&<><Alert type="info" showIcon title="提交方案后等待学员确认" description="请核对使用期限、权益用量和售前约定，在处理意见中说明每项扣除依据。时长金额仅供参考，不能替代实际服务核查。存在占用中的服务须先处理。" style={{marginBottom:16}}/><Form.Item name="amountYuan" label="经核查拟原路退款金额（元）" rules={[{required:true,pattern:/^(0|[1-9][0-9]{0,14})(\\.[0-9]{1,2})?$/,message:'请输入有效金额，最多两位小数'}]}><Input inputMode="decimal" suffix="元" disabled={busy}/></Form.Item></>}<Form.Item name="reason" label="已核实的处理意见与扣除依据"''')
])
