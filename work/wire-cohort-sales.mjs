import assert from 'node:assert/strict';import {readFile,writeFile,mkdir} from 'node:fs/promises';
async function edit(path,changes){const original=await readFile(path,'utf8'),eol=original.includes('\r\n')?'\r\n':'\n';let body=original.replace(/\r\n/g,'\n');for(const [from,to] of changes){if(body.includes(to))continue;assert.ok(body.includes(from),path+': '+from.slice(0,75));body=body.replace(from,to);}await writeFile(path,body.replace(/\n/g,eol));}
await edit('services/api/src/main.ts',[
  ['controllers: [BookingSalesController','controllers: [CohortSalesController,CohortOrdersAdminController,BookingSalesController'],
  ['providers: [BookingSalesService','providers: [CohortSalesService,{provide:"COHORT_SALES",useExisting:CohortSalesService},BookingSalesService']]);
await edit('services/api/src/personal.ts',[
  ['private readonly bookingSales:BookingSalesService)','private readonly bookingSales:BookingSalesService,private readonly cohortSales:CohortSalesService)'],
  ['    await this.db.$transaction(async tx => {\n      const users = await tx.$queryRaw',"    const cohortOrders=await this.db.tradeOrder.findMany({where:{userId:req.actor.id,kind:'COHORT',state:'PENDING'},select:{id:true}});\n    for(const row of cohortOrders)await this.cohortSales.cancel(row.id,req.actor.id,'ACCOUNT_CLOSURE');\n    await this.db.$transaction(async tx => {\n      const users = await tx.$queryRaw"]]);
await edit('services/api/src/cohorts.ts',[
  ['    return rows.flatMap(({reserved,confirmed,...r})=>',"    const offers=await this.db.saleOffer.findMany({where:{kind:'COHORT',cohortId:{in:rows.map(r=>r.id)},active:true}});\n    return rows.flatMap(({reserved,confirmed,...r})=>"],
  ['return [{...r,course,available:r.capacity-reserved-confirmed,confirmed,bookingEnabled:course.price===0',"const price=offers.find(o=>o.cohortId===r.id)?.price;return [{...r,course,price:price===undefined?null:String(price),paid:price!==undefined&&price>0n,available:r.capacity-reserved-confirmed,confirmed,bookingEnabled:price===0n"],
  ['    const schedulePending=!!mine',"    const offer=await this.db.saleOffer.findFirst({where:{kind:'COHORT',cohortId:id,active:true}}),price=offer?.price;\n    const orderId=mine?.orderItemId?(await this.db.tradeOrderItem.findUniqueOrThrow({where:{id:mine.orderItemId}})).orderId:null;\n    const schedulePending=!!mine"],
  ['mine&&!mine.revokedAt&&!schedulePending&&row.endsAt>now','mine&&!mine.revokedAt&&!mine.suspendedAt&&!schedulePending&&row.endsAt>now'],
  ['return {...row,originalSchedule:',"return {...row,price:price===undefined?null:String(price),paid:price!==undefined&&price>0n,orderId,suspended:!!mine?.suspendedAt,purchaseAvailable:!!course&&!!price&&price>0n&&!mine&&row.state==='OPEN'&&row.enrollDeadline>now&&!release.withdrawnAt,originalSchedule:"],
  ['canCancel:!!mine&&!mine.revokedAt&&','canCancel:!!mine&&!mine.orderItemId&&!mine.revokedAt&&'],
  ['canStudy:!!mine&&!mine.revokedAt&&!schedulePending','canStudy:!!mine&&!mine.revokedAt&&!mine.suspendedAt&&!schedulePending'],
  ['bookingEnabled:!!course&&course.price===0','bookingEnabled:!!course&&price===0n'],
  ["if(!row||row.revokedAt)throw new NotFoundException('有效报名不存在');","if(!row||row.revokedAt||row.suspendedAt)throw new NotFoundException('有效报名不存在或正在售后');"],
  ["where:{cohortId:id,userId:req.actor.id,source:'COHORT_FREE'}","where:{cohortId:id,userId:req.actor.id}"],
  ["if(enrollment.revokedAt)return {success:true};","if(enrollment.revokedAt)return {success:true};\n      if(enrollment.orderItemId)throw new ConflictException('付费营期请从原订单申请退出与退款，不能按免费报名释放席位');"]]);
await edit('services/api/src/cohort-sales.ts',[
  [",expected=(order.pricingSnapshot as {channel:string}).channel;if(expected!==channel)throw new BadRequestException('收款渠道与原订单不一致');",",expected=(order.pricingSnapshot as {channel:string}).channel;"],
  ["!attempt||order.state!=='PENDING'||registration", "expected!==channel||!attempt||order.state!=='PENDING'||registration"]]);
await mkdir('outputs/cohort-sales-2026-10-13',{recursive:true});
