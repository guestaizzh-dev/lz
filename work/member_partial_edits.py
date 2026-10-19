from pathlib import Path

root = Path(__file__).resolve().parents[1]
p = root / 'services/api/src/membership-sales.ts'
s = p.read_text(encoding='utf-8')
old = 'canRefund:status.allowed,refundUrl:'
assert old in s
s = s.replace(old, 'canRefund:status.allowed,canRequestReview:status.manual,refundAssessment:status.manual&&member?await this.refundAssessment(this.db,member.id,status.payment!.amount):null,refundUrl:')
s = s.replace("reasonCode:true,description:true,reviewNote:true,createdAt:true,failureCode:true", "reasonCode:true,description:true,reviewNote:true,createdAt:true,failureCode:true,approvedAmount:true,assessmentSnapshot:true,acceptedAt:true")
start = s.index('  async requestRefund(')
end = s.index('  private validateRefundFact(', start)
s = s[:start] + '''  async requestRefund(id:string,userId:string,dto:RefundDto){
    const order=await this.owned(id,userId);
    await this.db.$transaction(async tx=>{
      await this.lock(tx,order);if(!await tx.user.findFirst({where:{id:userId,status:'ACTIVE'}}))throw new ForbiddenException('账号不可用，请通过客服核查');
      const old=await tx.refund.findFirst({where:{userId,requestKey:dto.requestKey}});if(old){if(old.orderId!==id||old.description!==dto.reason.trim())throw new ConflictException('请求标识已用于其他申请');return;}
      const current=await tx.tradeOrder.findUniqueOrThrow({where:{id}}),status=await this.refundable(tx,current);
      if(!status.manual)throw new ConflictException('已有退款申请、会员已结束或此渠道需另行核查，请查看订单说明');
      const partial=!status.allowed,assessment=partial?await this.refundAssessment(tx,status.member!.id,status.payment!.amount):null;
      const refund=await tx.refund.create({data:{orderId:id,userId,requestKey:dto.requestKey,kind:'REFUND_ONLY',state:'REQUESTED',requestedAmount:status.payment!.amount,reasonCode:partial?'MEMBERSHIP_PARTIAL':'MEMBERSHIP_RETURN',description:dto.reason.trim(),paymentTransactionId:status.payment!.id,channelRequestKey:'R'+randomUUID().replaceAll('-','').slice(0,31),...(assessment?{assessmentSnapshot:assessment}:{})}}),item=await tx.tradeOrderItem.findFirstOrThrow({where:{orderId:id}});
      await tx.refundItem.create({data:{refundId:refund.id,orderItemId:item.id,quantity:1,amount:status.payment!.amount,revokeQuantity:1}});
      await tx.auditLog.create({data:{actorId:userId,action:'membership.refund.request',resource:'refund',resourceId:refund.id,changes:{orderId:id,mode:partial?'NEGOTIATED':'FULL_FUTURE_PERIOD'}}});
    });return this.detail(id,userId);
  }
  async reviewRefund(id:string,req:AuthRequest,dto:ReviewDto){
    requireRoles(req,['FINANCE']);const refund=await this.db.refund.findUnique({where:{id}});if(!refund)throw new NotFoundException('退款申请不存在');const order=await this.owned(refund.orderId,refund.userId);
    if(dto.action==='CANCEL')return this.cancelFailedRefund(refund,order,req,dto);
    await this.db.$transaction(async tx=>{
      await this.lock(tx,order);const current=await tx.refund.findUniqueOrThrow({where:{id}});
      if(current.version!==dto.expectedVersion||(dto.action==='RETRY'?!['FAILED','REFUNDING'].includes(current.state):current.state!=='REQUESTED'))throw new ConflictException('退款状态已变化，请刷新');
      const payment=await tx.paymentTransaction.findUniqueOrThrow({where:{id:current.paymentTransactionId!}});
      if(payment.channel==='APPLE_IAP')throw new BadRequestException('Apple退款不能从其他渠道审批');
      const partial=current.reasonCode==='MEMBERSHIP_PARTIAL';let approvedAmount=current.approvedAmount??current.requestedAmount,assessment=current.assessmentSnapshot;
      if(dto.action!=='APPROVE'&&dto.approvedAmount!==undefined)throw new BadRequestException('此操作不能改变退款金额');
      if(dto.action==='APPROVE'){
        const member=await tx.membership.findFirst({where:{orderItemId:{in:(await tx.refundItem.findMany({where:{refundId:id}})).map(i=>i.orderItemId)}}});
        if(!member||member.revokedAt||payment.disposition!=='ACCEPTED')throw new ConflictException('原会员权益或付款不可用于此退款，请核查');
        if(partial){
          if(!dto.approvedAmount)throw new BadRequestException('请填写经核实、待学员确认的原路退款金额');
          approvedAmount=BigInt(dto.approvedAmount);const currentOrder=await tx.tradeOrder.findUniqueOrThrow({where:{id:order.id}});
          if(approvedAmount<=0n||approvedAmount>current.requestedAmount||approvedAmount>payment.amount-currentOrder.refundedTotal)throw new BadRequestException('退款金额须大于零且不能超过原实付可退余额');
          const basis=await this.refundAssessment(tx,member.id,payment.amount);
          if(basis.usage.some(u=>u.state==='HELD'))throw new ConflictException('本段仍有占用中的服务权益，请先处理对应服务，不能直接退订');
          assessment={...basis,proposalAmount:String(approvedAmount),deductionAmount:String(payment.amount-approvedAmount),proposalVersion:current.version+1,reviewNote:dto.reason.trim()};
          await tx.refundItem.updateMany({where:{refundId:id},data:{amount:approvedAmount,version:{increment:1}}});
        }else if(member.startsAt<=new Date()||Date.now()-payment.paidAt.getTime()>7*day||await tx.benefitUsage.count({where:{periodId:member.id,state:{in:['HELD','CONSUMED']}}}))throw new ConflictException('会员已生效或消费权益，请拒绝原申请后重新提交核查申请');
        else if(dto.approvedAmount!==undefined&&BigInt(dto.approvedAmount)!==current.requestedAmount)throw new BadRequestException('未来整段退款不能擅自扣款');
      }
      const state=dto.action==='REJECT'?'REJECTED':partial&&dto.action==='APPROVE'?'APPROVED':'REFUNDING';
      if(dto.action==='RETRY'&&partial&&!current.acceptedAt)throw new ConflictException('学员尚未确认退款方案，不能发起退款');
      await tx.refund.update({where:{id},data:{state,approvedAmount:state==='REJECTED'?null:approvedAmount,...(assessment?{assessmentSnapshot:assessment}:{}),reviewerId:req.actor.id,reviewNote:dto.reason.trim(),failureCode:null,updatedAt:new Date(),version:{increment:1}}});
      if(state==='REFUNDING')await this.refundJob(tx,id);
      await tx.auditLog.create({data:{actorId:req.actor.id,action:'membership.refund.'+dto.action.toLowerCase(),resource:'refund',resourceId:id,reason:dto.reason.trim(),changes:{state,approvedAmount:String(approvedAmount)}}});
      await tx.notification.create({data:{userId:order.userId,kind:'MEMBERSHIP_ORDER',orderId:order.id,eventKey:'membership.refund.review:'+id+':'+(current.version+1),title:state==='REJECTED'?'会员退款申请未通过':state==='APPROVED'?'请确认会员退款方案':'会员退款正在办理',body:state==='APPROVED'?'请在会员订单查看具体退款金额及扣除依据，确认后才发起原路退款。'+dto.reason.trim():dto.reason.trim()}});
    });return this.detail(order.id,order.userId);
  }
  async decideRefund(orderId:string,id:string,userId:string,dto:RefundDecisionDto){
    const order=await this.owned(orderId,userId);
    await this.db.$transaction(async tx=>{
      await this.lock(tx,order);const refund=await tx.refund.findFirst({where:{id,orderId,userId,reasonCode:'MEMBERSHIP_PARTIAL'}});
      if(!refund)throw new NotFoundException('退款方案不存在');
      const assessment=refund.assessmentSnapshot as {proposalVersion?:number}|null;
      if(assessment?.proposalVersion===dto.expectedVersion&&(dto.action==='ACCEPT'&&refund.acceptedAt||dto.action==='DECLINE'&&refund.state==='CANCELLED'))return;
      if(refund.state!=='APPROVED'||refund.version!==dto.expectedVersion||assessment?.proposalVersion!==dto.expectedVersion)throw new ConflictException('退款方案已变化，请重新查看金额与说明');
      const state=dto.action==='ACCEPT'?'REFUNDING':'CANCELLED';
      await tx.refund.update({where:{id},data:{state,acceptedAt:dto.action==='ACCEPT'?new Date():null,version:{increment:1},updatedAt:new Date()}});
      if(state==='REFUNDING')await this.refundJob(tx,id);
      await tx.auditLog.create({data:{actorId:userId,action:'membership.refund.'+dto.action.toLowerCase(),resource:'refund',resourceId:id,changes:{state,proposalVersion:dto.expectedVersion,amount:String(refund.approvedAmount)}}});
      await tx.notification.create({data:{userId,kind:'MEMBERSHIP_ORDER',orderId,eventKey:'membership.refund.decision:'+id,title:state==='REFUNDING'?'会员退款方案已确认':'已保留原会员',body:state==='REFUNDING'?'原路退款正在办理，完成时间以支付渠道为准；本段权益暂停，其他已确认会员不变。':'退款方案已拒绝，恢复本段原有效期限，不产生退款或自动延长。'}});
    });return this.detail(orderId,userId);
  }
''' + s[end:]
s = s.replace("refund.reasonCode!=='MEMBERSHIP_RETURN'", "!['MEMBERSHIP_RETURN','MEMBERSHIP_PARTIAL'].includes(refund.reasonCode)")
needle = "if(current.state==='SUCCEEDED')return true;if(!['REFUNDING','FAILED'].includes(current.state))"
assert needle in s
s = s.replace(needle, "if(current.state==='SUCCEEDED')return true;if(current.reasonCode==='MEMBERSHIP_PARTIAL'&&!current.acceptedAt)throw new ConflictException('退款方案尚未获学员确认');if(!['REFUNDING','FAILED'].includes(current.state))")
needle = "  @Post('membership-orders/:id/refund')"
assert needle in s
s = s.replace(needle, "  @Post('membership-orders/:id/refunds/:refundId/decision') @UseGuards(UserGuard) decision(@Param('id',ParseUUIDPipe) id:string,@Param('refundId',ParseUUIDPipe) refundId:string,@Req() req:AuthRequest,@Body() dto:RefundDecisionDto){return this.sales.decideRefund(id,refundId,req.actor.id,dto);}\n" + needle)
p.write_text(s, encoding='utf-8')
