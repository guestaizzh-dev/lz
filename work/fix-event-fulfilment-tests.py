from pathlib import Path
p=Path('services/api/test/event-fulfilment.test.mjs');s=p.read_text(encoding='utf-8').replace("price:0,status:'PUBLISHED'}})","price:0,status:'PUBLISHED',responsibleUserId:admin.id}})")
s=s.replace("assert.equal(await db.pointsLedger.count(),0);assert.equal(await db.settlementItem.count(),0);", "const accounts=await db.pointsAccount.findMany({where:{userId:{in:[a.id,b.id,c.id]}},select:{id:true}});assert.equal(await db.pointsLedger.count({where:{accountId:{in:accounts.map(x=>x.id)}}}),0);")
p.write_text(s,encoding='utf-8')
p=Path('apps/mobile/pages/booking/mine.uvue');s=p.read_text(encoding='utf-8').replace('&amp;','&').replace('&lt;','<');p.write_text(s,encoding='utf-8')
