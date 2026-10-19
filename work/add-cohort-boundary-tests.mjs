import {readFile,writeFile} from 'node:fs/promises';
const path='services/api/test/cohort-sales.test.mjs';let text=await readFile(path,'utf8');
const extra=`
    await t.test('admin query revives exhausted expiration tasks with audit and safely releases only unpaid capacity',async()=>{
      const c=await cohort(),s=await account(),row=await checkout(s,c);await sales.prepay(row.id,s.user.id);
      await db.tradeOrder.update({where:{id:row.id},data:{expiresAt:new Date(0)}});
      await db.outboxJob.updateMany({where:{aggregateId:row.id,kind:'COHORT_PAYMENT_CHECK'},data:{state:'DEAD',attempts:8}});
      failQuery=true;assert.equal((await call('/admin/cohort-orders/'+row.id+'/refresh',operator,'POST',{})).status,500);failQuery=false;
      assert.equal((await db.outboxJob.findFirstOrThrow({where:{aggregateId:row.id,kind:'COHORT_PAYMENT_CHECK'}})).state,'READY');
      assert.equal(await db.auditLog.count({where:{resourceId:row.id,action:'cohort.payment.recovery'}}),1);
      await sales.runJobs();assert.equal((await sales.detail(row.id,s.user.id)).state,'CLOSED');assert.equal((await db.courseCohort.findUniqueOrThrow({where:{id:c.id}})).reserved,0);
    });
    await t.test('mixed term delivery checks every media asset before collecting money and suspends previously issued tickets',async()=>{
      const root=resolve(process.env.MEDIA_DIR??'.media');await mkdir(root,{recursive:true});
      const wav=Buffer.alloc(164);wav.write('RIFF');wav.writeUInt32LE(156,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(120,40);
      const key='cohort-sales-'+randomUUID()+'.wav';await writeFile(resolve(root,key),wav);
      const asset=await db.mediaAsset.create({data:{ownerId:operator.user.id,originalName:'经典诵读.wav',mime:'audio/wav',bytes:BigInt(wav.length),storageKey:key,status:'READY'}});
      const audio=await db.lesson.create({data:{releaseId:release.id,sourceId:randomUUID(),title:'原文诵读',position:3,format:'AUDIO',durationSeconds:60,mediaId:asset.id,required:true,trial:false}});
      const c=await cohort(),s=await account(),row=await checkout(s,c);assert.deepEqual(row.cohort.contentFormats,['TEXT','AUDIO']);
      await db.mediaAsset.update({where:{id:asset.id},data:{status:'FAILED'}});
      assert.equal((await sales.detail(row.id,s.user.id)).canPay,false);assert.equal((await call('/commerce/cohort-orders/'+row.id+'/payment',s,'POST',{})).status,409);
      await db.mediaAsset.update({where:{id:asset.id},data:{status:'READY'}});await payment(s,row);
      await sales.requestRefund(row.id,s.user.id,{requestKey:randomUUID(),reason:'开营前申请退出本期'});
      await db.courseCohort.update({where:{id:c.id},data:{startsAt:new Date(Date.now()-60000)}});
      assert.equal((await call('/learning/lessons/'+audio.id+'/media?cohortId='+c.id,s,'POST',{})).status,403);
      const refund=await db.refund.findFirstOrThrow({where:{orderId:row.id}});await sales.reviewRefund(refund.id,{actor:{id:finance.user.id,roles:['FINANCE']}},{expectedVersion:refund.version,action:'REJECT',reason:'已与本人确认保留原营期'});
      const ticket=(await call('/learning/lessons/'+audio.id+'/media?cohortId='+c.id,s,'POST',{}));assert.equal(ticket.status,201,JSON.stringify(ticket.body));
      assert.equal((await fetch(base+ticket.body.path,{headers:{Range:'bytes=0-31'}})).status,206);
      await db.cohortRegistration.updateMany({where:{cohortId:c.id,userId:s.user.id},data:{suspendedAt:new Date()}});
      assert.equal((await fetch(base+ticket.body.path)).status,403);
    });
`;
const marker='  }finally{if(previous===undefined)';if(!text.includes(marker))throw Error('Test insertion missing');text=text.replace(marker,extra+marker);await writeFile(path,text);
