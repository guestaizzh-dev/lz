import {readFileSync,writeFileSync} from 'node:fs';
const source=readFileSync('services/api/test/cohort-sales.test.mjs','utf8').replaceAll('\r\n','\n');
const boundary=source.indexOf('  try{\n    await t.test');
if(boundary<0)throw Error('Fixture boundary missing');
const header=source.slice(0,boundary);
const tests=String.raw`
  process.env.COHORT_SALES_ENABLED='true';
  async function change(c,action,days=1){const current=await db.courseCohort.findUniqueOrThrow({where:{id:c.id}}),r=await call('/admin/cohorts/'+c.id+'/'+action,operator,'POST',{expectedVersion:current.version,reason:'核实教学后调整营期安排',...(action==='cancel'?{}:{days})});assert.equal(r.status,201,JSON.stringify(r.body));return r.body;}
  async function purchased(){const c=await cohort(),s=await account(),row=await checkout(s,c);await payment(s,row);return{c,s,row};}
  async function started(c){return db.courseCohort.update({where:{id:c.id},data:{startsAt:new Date(Date.now()-day),enrollDeadline:new Date(Date.now()-2*day)}});}
  async function dispute(row,s){const r=await call('/commerce/cohort-orders/'+row.id+'/dispute',s,'POST',{requestKey:randomUUID(),reason:'开营后的实际交付需要核查'});assert.equal(r.status,201,JSON.stringify(r.body));return db.refund.findFirstOrThrow({where:{orderId:row.id,reasonCode:'COHORT_DISPUTE',state:'REQUESTED'}});}
  async function propose(refund,amount='5000'){const r=await call('/admin/cohort-orders/refunds/'+refund.id+'/review',finance,'POST',{expectedVersion:refund.version,action:'APPROVE',approvedAmount:amount,reason:'核查实际已交付部分；保留款与剩余退出金额待本人同意'});assert.equal(r.status,201,JSON.stringify(r.body));return db.refund.findUniqueOrThrow({where:{id:refund.id}});}
  async function decision(row,s,refund,action='ACCEPT'){return call('/commerce/cohort-orders/'+row.id+'/refunds/'+refund.id+'/decision',s,'POST',{expectedVersion:refund.version,action});}
  async function compensation(){await db.outboxJob.updateMany({where:{kind:{in:['COHORT_REFUND','COHORT_SCHEDULE_COMPENSATION']},state:'READY'},data:{availableAt:new Date(0)}});await sales.runJobs();}
  try{
    await t.test('paid postponement freezes purchase dates, gates delivery and accepts only latest schedule',async()=>{
      const {c,s,row}=await purchased(),old=await sales.detail(row.id,s.user.id),next=await change(c,'postpone',3),detail=await sales.detail(row.id,s.user.id);
      assert.equal(detail.cohort.startsAt,old.cohort.startsAt);assert.equal(Date.parse(detail.currentSchedule.startsAt)-Date.parse(old.cohort.startsAt),3*day);assert.equal(detail.currentSchedule.canAcceptSchedule,true);assert.equal(detail.refundReason,'COHORT_SCHEDULE_RETURN');
      assert.equal((await call('/me/cohorts/'+c.id+'/accept-schedule',s,'POST',{expectedScheduleVersion:next.scheduleVersion-1})).status,409);
      assert.equal((await call('/me/cohorts/'+c.id+'/accept-schedule',s,'POST',{expectedScheduleVersion:next.scheduleVersion})).status,201);assert.equal((await sales.detail(row.id,s.user.id)).currentSchedule.schedulePending,false);
      assert.equal(await db.enrollment.count({where:{userId:s.user.id}}),0);
    });
    await t.test('pending paid participant can refuse postponement after start and receives automatic full refund',async()=>{
      const {c,s,row}=await purchased();await change(c,'postpone');await started(c);const r=await call('/commerce/cohort-orders/'+row.id+'/refund',s,'POST',{requestKey:randomUUID(),reason:'不接受新营期安排，申请全额退出'});assert.equal(r.status,201,JSON.stringify(r.body));await compensation();assert.equal((await sales.detail(row.id,s.user.id)).refundedAmount,'12000');assert.equal((await db.courseCohort.findUniqueOrThrow({where:{id:c.id}})).confirmed,0);
    });
    await t.test('started term only extends its end, preserves lesson dates and needs personal confirmation',async()=>{
      const {c,s,row}=await purchased(),before=await started(c),lessonsBefore=(await call('/cohorts/'+c.id,s)).body.lessonSchedule;
      assert.equal((await call('/admin/cohorts/'+c.id+'/postpone',operator,'POST',{expectedVersion:before.version,days:1,reason:'开营后不能移动日期'})).status,409);
      const next=await change(c,'extend',2);assert.equal(next.startsAt,before.startsAt.toISOString());assert.equal(next.enrollDeadline,before.enrollDeadline.toISOString());assert.equal(Date.parse(next.endsAt)-+before.endsAt,2*day);assert.deepEqual((await call('/cohorts/'+c.id,s)).body.lessonSchedule,lessonsBefore);
      assert.equal((await call('/learning/courses/'+course.id+'?cohortId='+c.id,s)).status,403);assert.equal((await sales.detail(row.id,s.user.id)).currentSchedule.canAcceptSchedule,true);
      assert.equal((await call('/me/cohorts/'+c.id+'/accept-schedule',s,'POST',{expectedScheduleVersion:next.scheduleVersion})).status,201);assert.equal((await call('/learning/courses/'+course.id+'?cohortId='+c.id,s)).status,200);
    });
    await t.test('extension can be refused for full refund; an ended cohort cannot be changed',async()=>{
      const {c,s,row}=await purchased();await started(c);await change(c,'extend');await sales.requestRefund(row.id,s.user.id,{requestKey:randomUUID(),reason:'无法接受延长期限，退出本期'});await compensation();assert.equal((await sales.detail(row.id,s.user.id)).refundedAmount,'12000');const end=await db.courseCohort.update({where:{id:c.id},data:{endsAt:new Date(Date.now()-1000)}});for(const action of ['extend','cancel'])assert.equal((await call('/admin/cohorts/'+c.id+'/'+action,operator,'POST',{expectedVersion:end.version,days:1,reason:'结束后不能变更'})).status,409);
    });
    await t.test('dispute proposal is visible but cannot execute without consent; invalid amount and ownership are rejected',async()=>{
      const {c,s,row}=await purchased();await started(c);const refund=await dispute(row,s),stranger=await account();
      assert.equal((await call('/admin/cohort-orders/refunds/'+refund.id+'/review',support,'POST',{expectedVersion:refund.version,action:'APPROVE',approvedAmount:'5000',reason:'无权操作'})).status,403);
      assert.equal((await call('/admin/cohort-orders/refunds/'+refund.id+'/review',finance,'POST',{expectedVersion:refund.version,action:'APPROVE',approvedAmount:'12001',reason:'超出原实付'})).status,400);
      const proposal=await propose(refund);assert.equal(proposal.state,'APPROVED');await compensation();assert.equal(refunds.has(proposal.channelRequestKey),false);
      assert.equal((await decision(row,stranger,proposal)).status,404);assert.equal((await call('/commerce/cohort-orders/'+row.id+'/refunds/'+refund.id+'/decision',s,'POST',{expectedVersion:1,action:'ACCEPT'})).status,409);
      const view=await sales.detail(row.id,s.user.id);assert.equal(view.refunds[0].assessmentSnapshot.deductionAmount,'7000');assert.ok(view.registration.suspendedAt);
      await assert.rejects(db.refund.update({where:{id:refund.id},data:{state:'REFUNDING'}}));assert.equal((await call('/learning/courses/'+course.id+'?cohortId='+c.id,s)).status,403);
    });
    await t.test('declining is idempotent and restores original term without extending or losing work',async()=>{
      const {c,s,row}=await purchased(),before=await started(c),proposal=await propose(await dispute(row,s));assert.equal((await decision(row,s,proposal,'DECLINE')).status,201);assert.equal((await decision(row,s,proposal,'DECLINE')).status,201);
      assert.equal((await sales.detail(row.id,s.user.id)).registration.suspendedAt,null);assert.equal((await db.courseCohort.findUniqueOrThrow({where:{id:c.id}})).endsAt.toISOString(),before.endsAt.toISOString());assert.equal((await call('/learning/courses/'+course.id+'?cohortId='+c.id,s)).status,200);assert.equal(await db.refundTransaction.count({where:{refundId:proposal.id}}),0);
    });
    await t.test('accepted partial proposal is immutable; retry and duplicate confirmation release only once',async()=>{
      const {c,s,row}=await purchased();await started(c);const proposal=await propose(await dispute(row,s));assert.equal((await decision(row,s,proposal)).status,201);assert.equal((await decision(row,s,proposal)).status,201);
      await assert.rejects(db.refund.update({where:{id:proposal.id},data:{approvedAmount:6000n}}));await assert.rejects(db.refundItem.updateMany({where:{refundId:proposal.id},data:{amount:6000n}}));
      failRefund=true;await compensation();assert.equal((await db.courseCohort.findUniqueOrThrow({where:{id:c.id}})).confirmed,1);failRefund=false;await compensation();const fact=refunds.get(proposal.channelRequestKey);await Promise.all([sales.confirmRefund(fact),sales.confirmRefund(fact)]);assert.equal((await sales.detail(row.id,s.user.id)).refundedAmount,'5000');assert.equal((await db.courseCohort.findUniqueOrThrow({where:{id:c.id}})).confirmed,0);assert.equal(await db.refundTransaction.count({where:{refundId:proposal.id}}),1);
    });
    await t.test('cancellation replaces unaccepted partial proposal with automatic full refund',async()=>{
      const {c,s,row}=await purchased();await started(c);const proposal=await propose(await dispute(row,s));await change(c,'cancel');assert.equal((await decision(row,s,proposal)).status,409);await compensation();const final=await db.refund.findUniqueOrThrow({where:{id:proposal.id}});assert.equal(final.reasonCode,'COHORT_CANCELLED');assert.equal(final.approvedAmount,12000n);assert.equal(final.acceptedAt,null);assert.equal((await sales.detail(row.id,s.user.id)).refundedAmount,'12000');
    });
    await t.test('cancellation during accepted partial refund retains consent and adds remaining funds once',async()=>{
      const {c,s,row}=await purchased();await started(c);const proposal=await propose(await dispute(row,s));await decision(row,s,proposal);await change(c,'cancel');await compensation();await compensation();const frozen=await db.refund.findUniqueOrThrow({where:{id:proposal.id}});assert.equal(frozen.approvedAmount,5000n);assert.ok(frozen.acceptedAt);assert.equal((await sales.detail(row.id,s.user.id)).refundedAmount,'12000');const remainder=await db.refund.findFirstOrThrow({where:{orderId:row.id,reasonCode:'COHORT_CANCEL_REMAINDER'}});assert.equal(remainder.approvedAmount,7000n);assert.equal((await db.courseCohort.findUniqueOrThrow({where:{id:c.id}})).confirmed,0);assert.equal(await db.refund.count({where:{orderId:row.id}}),2);
    });
    await t.test('cancellation after completed partial exit compensates remaining advance without double capacity release',async()=>{
      const {c,s,row}=await purchased();await started(c);const proposal=await propose(await dispute(row,s));await decision(row,s,proposal);await compensation();await change(c,'cancel');await compensation();assert.equal((await sales.detail(row.id,s.user.id)).refundedAmount,'12000');assert.equal((await db.courseCohort.findUniqueOrThrow({where:{id:c.id}})).confirmed,0);const entries=await db.financeEntry.findMany({where:{journalId:{in:(await db.financeJournal.findMany({where:{orderId:row.id},select:{id:true}})).map(j=>j.id)}}});assert.equal(entries.filter(e=>e.accountCode==='COHORT_ADVANCE').reduce((n,e)=>n+e.credit-e.debit,0n),0n);
    });
    await t.test('free cancellation releases now; paid cancellation waits for trusted channel refund',async()=>{
      const free=await cohort(0),freeUser=await account();await call('/me/cohorts/'+free.id+'/join',freeUser,'POST',{});await started(free);await change(free,'cancel');assert.equal((await db.courseCohort.findUniqueOrThrow({where:{id:free.id}})).confirmed,0);
      const {c,s,row}=await purchased();await change(c,'cancel');failRefund=true;await compensation();assert.equal((await db.courseCohort.findUniqueOrThrow({where:{id:c.id}})).confirmed,1);assert.ok((await sales.detail(row.id,s.user.id)).registration.suspendedAt);failRefund=false;await compensation();assert.equal((await db.courseCohort.findUniqueOrThrow({where:{id:c.id}})).confirmed,0);
    });
    await t.test('schedule changes close old pending quotes safely; unknown channel retains reservation and recovers dead jobs',async()=>{
      const c=await cohort(),s=await account(),row=await checkout(s,c);await sales.prepay(row.id,s.user.id);await change(c,'postpone');failQuery=true;await compensation();assert.equal((await db.courseCohort.findUniqueOrThrow({where:{id:c.id}})).reserved,1);await db.outboxJob.updateMany({where:{aggregateId:c.id,kind:'COHORT_SCHEDULE_COMPENSATION'},data:{state:'DEAD',attempts:8}});failQuery=false;await sales.adminRefresh(row.id,{actor:{id:finance.user.id,roles:['FINANCE']}});await compensation();assert.equal((await sales.detail(row.id,s.user.id)).state,'CLOSED');assert.equal((await db.courseCohort.findUniqueOrThrow({where:{id:c.id}})).reserved,0);assert.equal(await db.auditLog.count({where:{resourceId:row.id,action:'cohort.schedule.recovery'}}),1);
    });
    await t.test('concurrent prepay and cancellation keep uncertain initiation reserved until lookup',async()=>{
      const c=await cohort(),s=await account(),row=await checkout(s,c);let arrived,releasePrepay;const signal=new Promise(ok=>{arrived=ok;}),resume=new Promise(ok=>{releasePrepay=ok;});const old=adapter.prepay;adapter.prepay=async(...args)=>{arrived();await resume;return old(...args);};
      try{const paying=sales.prepay(row.id,s.user.id);await signal;await assert.rejects(sales.cancel(row.id,s.user.id));assert.equal((await db.courseCohort.findUniqueOrThrow({where:{id:c.id}})).reserved,1);releasePrepay();await paying;await sales.cancel(row.id,s.user.id);assert.equal((await db.courseCohort.findUniqueOrThrow({where:{id:c.id}})).reserved,0);}finally{releasePrepay();adapter.prepay=old;}
    });
    await t.test('refund retains already earned certificate but cannot issue new completion after exit',async()=>{
      const {c,s,row}=await purchased();await started(c);for(const lesson of release.lessons){const r=await call('/learning/lessons/'+lesson.id+'/progress?cohortId='+c.id,s,'POST',{eventId:randomUUID(),positionSeconds:0,elapsedSeconds:0,completed:true});assert.equal(r.status,201,JSON.stringify(r.body));}
      const original=await call('/learning/courses/'+course.id+'/certificate?cohortId='+c.id,s,'POST',{});assert.equal(original.status,201);const proposal=await propose(await dispute(row,s));await decision(row,s,proposal);await compensation();const history=await call('/learning/courses/'+course.id+'/certificate?cohortId='+c.id,s,'POST',{});assert.equal(history.status,201);assert.equal(history.body.id,original.body.id);assert.equal((await call('/learning/courses/'+course.id+'?cohortId='+c.id,s)).status,403);
      const another=await purchased();await started(another.c);const second=await propose(await dispute(another.row,another.s));await decision(another.row,another.s,second);await compensation();assert.equal((await call('/learning/courses/'+course.id+'/certificate?cohortId='+another.c.id,another.s,'POST',{})).status,403);
    });
  }finally{if(previous===undefined)delete process.env.COHORT_SALES_ENABLED;else process.env.COHORT_SALES_ENABLED=previous;mock.restoreAll();await app.close();await db.$disconnect();}
});
`;
writeFileSync('services/api/test/cohort-compensation.test.mjs',header.replace('paid training cohorts use independent inventory, verified money and term-bound study','paid cohort schedule changes and compensation preserve consent, history and money')+tests);
