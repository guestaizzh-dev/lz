from pathlib import Path

p = Path(__file__).resolve().parents[1] / 'services/api/test/membership-sales.test.mjs'
s = p.read_text(encoding='utf-8')
marker = "    await t.test('stopped sales refuse prepay"
assert marker in s
tests = '''    await t.test('active consumed membership requires an explicit amount and customer acceptance before partial refund',async()=>{
      const s=await session(),finance=await session('FINANCE'),support=await session('SUPPORT'),outsider=await session();
      const {row,data}=await paid(s),{row:queued}=await paid(s),member=await db.membership.findFirstOrThrow({where:{orderItemId:(await db.tradeOrderItem.findFirstOrThrow({where:{orderId:row.id}})).id}}),future=await db.membership.findFirstOrThrow({where:{orderItemId:(await db.tradeOrderItem.findFirstOrThrow({where:{orderId:queued.id}})).id}});
      const definition=await db.benefitDefinition.findUniqueOrThrow({where:{code:'CONTENT_ACCESS'}});
      await db.benefitUsage.create({data:{userId:s.user.id,periodId:member.id,definitionId:definition.id,windowStart:new Date(member.startsAt.toISOString().slice(0,10)),windowEnd:new Date(member.endsAt.toISOString().slice(0,10)),quantity:1,businessKey:tag+'-partial-use',state:'CONSUMED',parametersSnapshot:{}}});
      const detail=(await call('/commerce/membership-orders/'+row.id,s)).body;assert.equal(detail.canRefund,false);assert.equal(detail.canRequestReview,true);
      const request={requestKey:randomUUID(),reason:'已学习一部分，申请核查退订剩余会员'};assert.equal((await call('/commerce/membership-orders/'+row.id+'/refund',s,'POST',request)).status,201);
      assert.equal((await call('/commerce/membership-orders/'+row.id+'/refund',s,'POST',request)).status,201);
      let refund=await db.refund.findFirstOrThrow({where:{orderId:row.id}});assert.equal(refund.reasonCode,'MEMBERSHIP_PARTIAL');
      const path='/admin/membership-orders/refunds/'+refund.id+'/review',approved=BigInt(row.amount)-100n,review={expectedVersion:refund.version,action:'APPROVE',approvedAmount:String(approved),reason:'已核查期限与已用内容，双方协商扣除1元，其余退回'};
      assert.equal((await call(path,support,'POST',review)).status,403);
      assert.equal((await call(path,finance,'POST',{...review,approvedAmount:String(BigInt(row.amount)+1n)})).status,400);
      assert.equal((await call(path,finance,'POST',{...review,approvedAmount:undefined})).status,400);
      assert.equal((await call(path,finance,'POST',review)).status,201);
      refund=await db.refund.findUniqueOrThrow({where:{id:refund.id}});assert.equal(refund.state,'APPROVED');assert.equal(refund.acceptedAt,null);assert.equal(refund.approvedAmount,approved);assert.equal(refund.assessmentSnapshot.usage[0].quantity,1);
      assert.deepEqual(await membershipRefundHolds(s.user.id,db),[member.id]);assert.equal(await db.outboxJob.count({where:{eventKey:'membership.refund:'+refund.id}}),0);
      await runJobs();assert.equal(await db.refundTransaction.count({where:{refundId:refund.id}}),0);
      await assert.rejects(sales.confirmRefund({...identity,out_trade_no:row.orderNo,transaction_id:data.transaction_id,out_refund_no:refund.channelRequestKey,refund_id:'not-yet-authorized',status:'SUCCESS',success_time:new Date().toISOString(),amount:{refund:Number(approved),total:Number(row.amount),currency:'CNY'}}),/未获学员确认/);
      const decisionPath='/commerce/membership-orders/'+row.id+'/refunds/'+refund.id+'/decision',decision={expectedVersion:refund.version,action:'ACCEPT'};
      assert.equal((await call(decisionPath,outsider,'POST',decision)).status,404);
      assert.equal((await call(decisionPath,s,'POST',{...decision,expectedVersion:refund.version-1})).status,409);
      const accepted=await Promise.all([call(decisionPath,s,'POST',decision),call(decisionPath,s,'POST',decision)]);assert.ok(accepted.every(r=>r.status===201),JSON.stringify(accepted));
      assert.equal((await call(decisionPath,s,'POST',{...decision,action:'DECLINE'})).status,409);
      fail=true;await runJobs();assert.equal((await db.refund.findUniqueOrThrow({where:{id:refund.id}})).state,'REFUNDING');assert.equal((await db.membership.findUniqueOrThrow({where:{id:member.id}})).revokedAt,null);
      fail=false;await runJobs();refund=await db.refund.findUniqueOrThrow({where:{id:refund.id}});assert.equal(refund.state,'SUCCEEDED');assert.ok(refund.acceptedAt);
      await Promise.all([sales.confirmRefund(refunds.get(refund.channelRequestKey)),sales.confirmRefund(refunds.get(refund.channelRequestKey))]);assert.equal(await db.refundTransaction.count({where:{refundId:refund.id}}),1);
      assert.equal((await db.tradeOrder.findUniqueOrThrow({where:{id:row.id}})).refundedTotal,approved);assert.equal((await db.tradeOrderItem.findFirstOrThrow({where:{orderId:row.id}})).refundedAmount,approved);
      const original=await db.membership.findUniqueOrThrow({where:{id:member.id}}),next=await db.membership.findUniqueOrThrow({where:{id:future.id}});assert.ok(original.revokedAt);assert.equal(original.startsAt.getTime(),member.startsAt.getTime());assert.equal(original.endsAt.getTime(),member.endsAt.getTime());assert.equal(next.revokedAt,null);assert.equal(next.startsAt.getTime(),future.startsAt.getTime());assert.equal(next.endsAt.getTime(),future.endsAt.getTime());
      assert.equal(await db.benefitUsage.count({where:{periodId:member.id,state:'CONSUMED'}}),1);
      assert.equal((await call('/commerce/membership-orders/'+row.id,s)).body.refunds[0].assessmentSnapshot.deductionAmount,'100');
    });
    await t.test('declining a negotiated refund restores original dates without channel or money effects',async()=>{
      const s=await session(),finance=await session('FINANCE'),{row}=await paid(s),member=await db.membership.findFirstOrThrow({where:{userId:s.user.id}});
      await call('/commerce/membership-orders/'+row.id+'/refund',s,'POST',{requestKey:randomUUID(),reason:'希望退订，请核查金额'});let refund=await db.refund.findFirstOrThrow({where:{orderId:row.id}});
      assert.equal((await call('/admin/membership-orders/refunds/'+refund.id+'/review',finance,'POST',{expectedVersion:refund.version,action:'APPROVE',approvedAmount:String(BigInt(row.amount)-1n),reason:'核查原期限及学习事实，建议扣1分'})).status,201);
      refund=await db.refund.findUniqueOrThrow({where:{id:refund.id}});const path='/commerce/membership-orders/'+row.id+'/refunds/'+refund.id+'/decision',dto={expectedVersion:refund.version,action:'DECLINE'};
      assert.equal((await call(path,s,'POST',dto)).status,201);assert.equal((await call(path,s,'POST',dto)).status,201);assert.deepEqual(await membershipRefundHolds(s.user.id,db),[]);
      const after=await db.membership.findUniqueOrThrow({where:{id:member.id}});assert.equal(after.startsAt.getTime(),member.startsAt.getTime());assert.equal(after.endsAt.getTime(),member.endsAt.getTime());assert.equal(after.revokedAt,null);
      assert.equal(await db.refundTransaction.count({where:{refundId:refund.id}}),0);assert.equal(await db.outboxJob.count({where:{eventKey:'membership.refund:'+refund.id}}),0);
      assert.equal((await call('/commerce/membership-orders/'+row.id+'/refund',s,'POST',{requestKey:randomUUID(),reason:'另有情况，重新申请核查'})).status,201);
    });
    await t.test('occupied service rights block a partial refund proposal until the owning workflow releases them',async()=>{
      const s=await session(),finance=await session('FINANCE'),{row}=await paid(s),member=await db.membership.findFirstOrThrow({where:{userId:s.user.id}}),definition=await db.benefitDefinition.findUniqueOrThrow({where:{code:'CONTENT_ACCESS'}});
      const usage=await db.benefitUsage.create({data:{userId:s.user.id,periodId:member.id,definitionId:definition.id,windowStart:new Date(member.startsAt.toISOString().slice(0,10)),windowEnd:new Date(member.endsAt.toISOString().slice(0,10)),quantity:1,businessKey:tag+'-partial-held',state:'HELD',parametersSnapshot:{}}});
      await call('/commerce/membership-orders/'+row.id+'/refund',s,'POST',{requestKey:randomUUID(),reason:'服务尚未结束，申请退款核查'});const refund=await db.refund.findFirstOrThrow({where:{orderId:row.id}}),path='/admin/membership-orders/refunds/'+refund.id+'/review',dto={expectedVersion:refund.version,action:'APPROVE',approvedAmount:row.amount,reason:'按实际服务情况提出退款'};
      assert.equal((await call(path,finance,'POST',dto)).status,409);assert.equal((await db.refund.findUniqueOrThrow({where:{id:refund.id}})).state,'REQUESTED');assert.deepEqual(await membershipRefundHolds(s.user.id,db),[]);
      await db.benefitUsage.update({where:{id:usage.id},data:{state:'RELEASED',version:{increment:1}}});assert.equal((await call(path,finance,'POST',dto)).status,201);
    });
'''
s=s.replace(marker, tests+marker)
p.write_text(s,encoding='utf-8')
