import {readFile,writeFile} from 'node:fs/promises';
async function edit(path,from,to){const text=await readFile(path,'utf8');if(!text.includes(from))throw Error('Missing match: '+path+' '+from.slice(0,60));await writeFile(path,text.replace(from,to));}
const api='services/api/src/cohort-sales.ts';
await edit(api,"!release.withdrawnAt&&(!media.length","!release.withdrawnAt&&release.lessons.length>0&&(!media.length");
await edit(api,".channel;if(expected!==channel)throw new BadRequestException('收款渠道与原订单不一致');",".channel;");
await edit(api,'async adminRefresh(id:string){const order=await this.owned(id);await this.refresh(id,order.userId);return this.adminDetail(id);}',`async adminRefresh(id:string,req:AuthRequest){
    const order=await this.owned(id);
    await this.db.$transaction(async tx=>{await this.lock(tx,order);const current=await tx.tradeOrder.findUniqueOrThrow({where:{id}});
      const resumed=await tx.outboxJob.updateMany({where:{kind:'COHORT_PAYMENT_CHECK',aggregateId:id,state:'DEAD'},data:{state:current.state==='PENDING'?'READY':'DONE',attempts:0,lockedUntil:null,availableAt:new Date(),lastErrorCode:null,...(current.state==='PENDING'?{}:{completedAt:new Date()})}});
      if(resumed.count)await tx.auditLog.create({data:{actorId:req.actor.id,action:'cohort.payment.recovery',resource:'trade_order',resourceId:id,changes:{resumed:resumed.count}}});
    });await this.refresh(id,order.userId);return this.adminDetail(id);
  }`);
await edit(api,'return this.sales.adminRefresh(id);','return this.sales.adminRefresh(id,req);');
await edit('services/api/src/cohorts.ts','canAcceptSchedule:schedulePending&&row.startsAt>now','canAcceptSchedule:schedulePending&&!mine?.suspendedAt&&row.startsAt>now');
await edit('services/api/src/cohorts.ts','items:rows.map(r=>({id:r.id,nickname:','items:rows.map(r=>({id:r.id,source:r.source,suspended:!!r.suspendedAt,nickname:');
await edit('apps/admin/src/pages/cohorts/index.tsx','type Student={schedulePending:boolean;','type Student={source:string;suspended:boolean;schedulePending:boolean;');
await edit('apps/admin/src/pages/cohorts/index.tsx',"{title:'学员',dataIndex:'nickname'},{title:'安排确认'","{title:'学员',dataIndex:'nickname'},{title:'报名状态',render:(_,r)=>r.suspended?'售后中 · 本期暂停':r.source==='COHORT_PURCHASE'?'付费报名':'免费报名'},{title:'安排确认'");
await edit('services/api/test/cohort-sales.test.mjs',"if(process.env.NODE_ENV!=='test')", "import {mkdir,writeFile} from 'node:fs/promises';import {resolve} from 'node:path';\nif(process.env.NODE_ENV!=='test')");
const testPath='services/api/test/cohort-sales.test.mjs';let test=await readFile(testPath,'utf8');
test=test.replaceAll("{where:{journal:{orderId:row.id}}}","{where:{journalId:{in:(await db.financeJournal.findMany({where:{orderId:row.id},select:{id:true}})).map(j=>j.id)}}}");
await writeFile(testPath,test);
