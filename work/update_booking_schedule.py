from pathlib import Path
p=Path('services/api/src/bookings.ts')
s=p.read_text(encoding='utf-8')
start=s.index('    const checks=await this.db.eventCheckin.groupBy')
end=s.index('  private async owns',start)
s=s[:start]+'''    const [checks,slots,tickets]=await Promise.all([
      this.db.eventCheckin.groupBy({by:['registrationId'],where:{registrationId:{in:registrations.map(r=>r.id)}},_count:true}),
      this.db.appointmentSlot.findMany({where:{id:{in:appointments.map(r=>r.slotId)}}}),
      this.db.eventTicketType.findMany({where:{id:{in:registrations.map(r=>r.ticketTypeId)}}}),
    ]);
    const sessions=await this.db.eventSession.findMany({where:{id:{in:tickets.map(t=>t.sessionId)}}}),now=new Date();
    const items=[...appointments.map(a=>{
      const s=json(a.serviceSnapshot),slot=slots.find(t=>t.id===a.slotId)!;
      const schedule=a.state==='CONFIRMED'?this.schedule(slot):a.scheduleSnapshot?json(a.scheduleSnapshot):s;
      const changed=(s.scheduleVersion??1)<(schedule.scheduleVersion??1),cancelAt=changed?new Date(schedule.startsAt):new Date(new Date(s.startsAt).getTime()-s.cancelBeforeMinutes*60000);
      return {id:a.id,kind:'appointment',title:s.title,startsAt:schedule.startsAt,endsAt:schedule.endsAt,originalStartsAt:s.startsAt,originalEndsAt:s.endsAt,changeReason:schedule.changeReason??a.cancelReason??null,scheduleVersion:slot.scheduleVersion,schedulePending:a.state==='CONFIRMED'&&a.acceptedScheduleVersion<slot.scheduleVersion,location:s.locationPolicy,policy:s.deliveryPolicy,cancelAt,canCancel:a.state==='CONFIRMED'&&!a.orderItemId&&!a.benefitUsageId&&cancelAt>now,checkedCount:0,quantity:1,state:a.state,version:a.version,createdAt:a.createdAt};
    }),...registrations.map(a=>{
      const s=JSON.parse(decryptPrivate(a.attendeeSnapshotCipher)),session=sessions.find(t=>t.id===tickets.find(t=>t.id===a.ticketTypeId)!.sessionId)!;
      const schedule=a.state==='CONFIRMED'?this.schedule(session):a.scheduleSnapshot?json(a.scheduleSnapshot):s;
      const changed=(s.scheduleVersion??1)<(schedule.scheduleVersion??1),cancelAt=changed?schedule.startsAt:s.cancelDeadline,checkedCount=checks.find(c=>c.registrationId===a.id)?._count??0;
      return {id:a.id,kind:'registration',title:s.title,startsAt:schedule.startsAt,endsAt:schedule.endsAt,originalStartsAt:s.startsAt,originalEndsAt:s.endsAt,changeReason:schedule.changeReason??null,scheduleVersion:session.scheduleVersion,schedulePending:a.state==='CONFIRMED'&&a.acceptedScheduleVersion<session.scheduleVersion,location:schedule.location??s.location,policy:'免费活动报名',cancelAt,canCancel:a.state==='CONFIRMED'&&!a.orderItemId&&!a.benefitUsageId&&!checkedCount&&new Date(cancelAt)>now,checkedCount,quantity:a.quantity,state:a.state,version:a.version,createdAt:a.createdAt};
    })];
    return {items:visible.map(k=>items.find(i=>i.id===k.id)!),hasMore:keys.length>q.size,serverTime:now};
  }
  async cancel(req: AuthRequest,kind: 'appointment'|'registration',id: string,dto: CancelDto) {
    return this.db.$transaction(async tx=>{
      await this.lockUser(tx,req.actor.id);
      if(kind==='appointment'){
        const initial=await tx.appointment.findFirst({where:{id,userId:req.actor.id}});if(!initial)throw new NotFoundException('预约不存在');
        const found=await tx.appointmentSlot.findUniqueOrThrow({where:{id:initial.slotId}});await this.lockOffering(tx,found.offeringId);
        const row=await tx.appointment.findUniqueOrThrow({where:{id}}),slot=await tx.appointmentSlot.findUniqueOrThrow({where:{id:row.slotId}});
        if(row.state==='CANCELLED')return {success:true};
        const s=json(row.serviceSnapshot),cancelAt=(s.scheduleVersion??1)<slot.scheduleVersion?+slot.startsAt:new Date(s.startsAt).getTime()-s.cancelBeforeMinutes*60000;
        if(row.state!=='CONFIRMED'||row.orderItemId||row.benefitUsageId||cancelAt<=Date.now())throw new ConflictException('已超过自助取消期限或已履约，请联系书院');
        await tx.appointment.update({where:{id},data:{state:'CANCELLED',cancelReason:dto.reason,scheduleSnapshot:this.schedule(slot),version:{increment:1}}});
        await tx.appointmentSlot.update({where:{id:slot.id},data:{confirmed:{decrement:1},version:{increment:1}}});
        const teacher=await tx.teacher.findUnique({where:{id:slot.teacherId},select:{userId:true}});
        if(teacher?.userId&&teacher.userId!==req.actor.id)await this.notice(tx,teacher.userId,kind,id,'cancelled','服务预约已取消','学员已取消本次预约，名额已释放。');
      }else{
        const initial=await tx.eventRegistration.findFirst({where:{id,userId:req.actor.id}});if(!initial)throw new NotFoundException('报名不存在');
        const ticket=await tx.eventTicketType.findUniqueOrThrow({where:{id:initial.ticketTypeId}}),found=await tx.eventSession.findUniqueOrThrow({where:{id:ticket.sessionId}});await this.lockEvent(tx,found.eventId);
        const row=await tx.eventRegistration.findUniqueOrThrow({where:{id}}),session=await tx.eventSession.findUniqueOrThrow({where:{id:ticket.sessionId}});
        if(row.state==='CANCELLED')return {success:true};
        const s=JSON.parse(decryptPrivate(row.attendeeSnapshotCipher)),cancelAt=(s.scheduleVersion??1)<session.scheduleVersion?session.startsAt:new Date(s.cancelDeadline);
        if(row.state!=='CONFIRMED'||row.orderItemId||row.benefitUsageId||cancelAt<=new Date()||await tx.eventCheckin.count({where:{registrationId:id}}))throw new ConflictException('报名已签到或超过取消期限，请联系书院');
        await tx.eventRegistration.update({where:{id},data:{state:'CANCELLED',cancelledAt:new Date(),scheduleSnapshot:this.schedule(session),version:{increment:1}}});
        await tx.eventTicketType.update({where:{id:ticket.id},data:{confirmed:{decrement:row.quantity},version:{increment:1}}});
      }
      await this.notice(tx,req.actor.id,kind,id,'cancelled','预约 / 报名已取消','名额已释放，你可以重新选择其他安排。');
      await this.audit(tx,req,kind+'.cancel',id,{reason:dto.reason});return {success:true};
    });
  }
''' +s[end:]
s=s.replace('a."cancelReason",t.name','a."cancelReason",a."acceptedScheduleVersion",a."scheduleSnapshot",s."startsAt",s."endsAt",s."scheduleVersion",s."changeReason",t.name')
s=s.replace('cancelReason:string|null}[]','cancelReason:string|null;acceptedScheduleVersion:number;scheduleSnapshot:Prisma.JsonValue;startsAt:Date;endsAt:Date;scheduleVersion:number;changeReason:string|null}[]')
s=s.replace('startsAt:s.startsAt,endsAt:s.endsAt,teacherName:r.teacherName,cancelReason:r.cancelReason','startsAt:r.state===\'CONFIRMED\'?r.startsAt:json(r.scheduleSnapshot??r.serviceSnapshot).startsAt,endsAt:r.state===\'CONFIRMED\'?r.endsAt:json(r.scheduleSnapshot??r.serviceSnapshot).endsAt,schedulePending:r.state===\'CONFIRMED\'&&r.acceptedScheduleVersion<r.scheduleVersion,changeReason:r.changeReason,teacherName:r.teacherName,cancelReason:r.cancelReason')
s=s.replace('const slot=await tx.appointmentSlot.findUniqueOrThrow({where:{id:row.slotId}});await this.lockOffering(tx,slot.offeringId);\n      if(new Date(json(row.serviceSnapshot).endsAt)>new Date())', 'const found=await tx.appointmentSlot.findUniqueOrThrow({where:{id:row.slotId}});await this.lockOffering(tx,found.offeringId);\n      const slot=await tx.appointmentSlot.findUniqueOrThrow({where:{id:row.slotId}}),current=await tx.appointment.findUniqueOrThrow({where:{id}});\n      if(slot.state===\'CANCELLED\'||current.acceptedScheduleVersion<slot.scheduleVersion)throw new ConflictException(\'学员尚未确认新安排或时段已取消，不可记录履约\');\n      if(slot.endsAt>new Date())')
s=s.replace('data:{state:dto.state,completedAt:new Date(),version:{increment:1}}','data:{state:dto.state,completedAt:new Date(),scheduleSnapshot:this.schedule(slot),version:{increment:1}}')
s=s.replace('const ticket=await tx.eventTicketType.findUniqueOrThrow({where:{id:row.ticketTypeId}}),session=await tx.eventSession.findUniqueOrThrow({where:{id:ticket.sessionId}});await this.lockEvent(tx,session.eventId);','const ticket=await tx.eventTicketType.findUniqueOrThrow({where:{id:row.ticketTypeId}}),found=await tx.eventSession.findUniqueOrThrow({where:{id:ticket.sessionId}});await this.lockEvent(tx,found.eventId);\n      const session=await tx.eventSession.findUniqueOrThrow({where:{id:ticket.sessionId}});')
s=s.replace("if(!['CONFIRMED','COMPLETED'].includes(current.state)","if(session.state==='CANCELLED'||current.acceptedScheduleVersion<session.scheduleVersion||!['CONFIRMED','COMPLETED'].includes(current.state)")
s=s.replace("data:{state:'COMPLETED',version:{increment:1}}","data:{state:'COMPLETED',scheduleSnapshot:this.schedule(session),version:{increment:1}}")
start=s.index('    return {items:rows.map(r=>{const s=JSON.parse(decryptPrivate(r.attendeeSnapshotCipher));')
end=s.index('\n  }',start)
s=s[:start]+'''    return {items:rows.map(r=>{const s=JSON.parse(decryptPrivate(r.attendeeSnapshotCipher)),session=sessions.find(t=>t.id===tickets.find(t=>t.id===r.ticketTypeId)!.sessionId)!,schedule=r.state==='CONFIRMED'?this.schedule(session):r.scheduleSnapshot?json(r.scheduleSnapshot):s;return {id:r.id,state:r.state,version:r.version,quantity:r.quantity,name:s.name,phone:s.phone.slice(0,3)+'****'+s.phone.slice(-4),title:s.title,startsAt:schedule.startsAt,endsAt:schedule.endsAt,schedulePending:r.state==='CONFIRMED'&&r.acceptedScheduleVersion<session.scheduleVersion,changeReason:schedule.changeReason,checkedAttendees:checks.filter(c=>c.registrationId===r.id).map(c=>c.attendeeNo)};}),total};''' +s[end:]
p.write_text(s,encoding='utf-8')
