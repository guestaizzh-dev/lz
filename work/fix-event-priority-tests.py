from pathlib import Path
p=Path('services/api/test/event-priority.test.mjs');s=p.read_text(encoding='utf-8')
s=s.replace("const otherTicket=await db.eventTicketType.findFirstOrThrow({where:{sessionId:{not:session.id}}});", "const otherSession=await db.eventSession.findFirstOrThrow({where:{eventId:other.id}}),otherTicket=await db.eventTicketType.findFirstOrThrow({where:{sessionId:otherSession.id}});")
s=s.replace("db.planBenefit.findFirstOrThrow({where:{planVersionId:ma.planVersionId,definition:{code:'EVENT_PRIORITY'}}}).catch(()=>db.planBenefit.findFirstOrThrow({where:{planVersionId:ma.planVersionId,definitionId:priority.definitionId}}))", "db.planBenefit.findFirstOrThrow({where:{planVersionId:ma.planVersionId,definitionId:priority.definitionId}})")
p.write_text(s,encoding='utf-8')
