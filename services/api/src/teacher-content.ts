import type {Database} from './database.js';
import {publicContentScope} from './public-content.js';
import type {ArticleMediaBlock} from './article-media.js';

// Curated introductions reuse reviewed articles and their existing media/access checks.
export async function teacherContent(db:Database,id:string) {
  const now=new Date(),scope=await publicContentScope(db);
  const relations=await db.contentRelation.findMany({where:{OR:[{fromId:id},{toId:id}],approvedBy:{not:null},AND:[{OR:[{startsAt:null},{startsAt:{lte:now}}]},{OR:[{endsAt:null},{endsAt:{gt:now}}]}]},orderBy:[{rank:'asc'},{id:'asc'}]});
  const own=relations.filter(r=>r.fromId===id),targets=relations.map(r=>r.fromId===id?r.toId:r.fromId);
  const [courses,articles,events,rooms,offerings]=await Promise.all([
    db.course.findMany({where:{id:{in:own.filter(r=>r.relationType==='TEACHER_COURSE').map(r=>r.toId)},teacherId:id,...scope},include:{teacher:{select:{id:true,name:true,title:true,bio:true,expertise:true,portrait:true,isDemo:true}}}}),
    db.article.findMany({where:{id:{in:own.filter(r=>['TEACHER_ARTICLE_INTRODUCTION','TEACHER_ARTICLE_INTERPRETATION'].includes(r.relationType)).map(r=>r.toId)},...scope},select:{id:true,title:true,summary:true,visibility:true,membershipTier:true,blocks:true}}),
    db.event.findMany({where:{OR:[{id:{in:targets}},{teacherId:id}],...scope},select:{id:true,title:true}}),
    db.liveRoom.findMany({where:{teacherId:id},select:{id:true}}),
    db.serviceOffering.findMany({where:{teacherId:id,active:true},select:{id:true,title:true,leadMinutes:true}}),
  ]);
  const mediaBlocks=articles.flatMap(a=>Array.isArray(a.blocks)?a.blocks as ArticleMediaBlock[]:[]).filter(b=>['audio','video'].includes(b.type)&&b.mediaId);
  const assets=await db.mediaAsset.findMany({where:{id:{in:mediaBlocks.map(b=>b.mediaId!)},status:'READY'},select:{id:true,mime:true,variants:true}});
  const playable=(b:ArticleMediaBlock)=>assets.some(a=>a.id===b.mediaId&&!(a.variants as {uploadPurpose?:string}|null)?.uploadPurpose&&(b.type==='video'?a.mime==='video/mp4':['audio/mpeg','audio/mp4','audio/wav'].includes(a.mime)));
  const publicRooms=await db.resource.findMany({where:{id:{in:rooms.map(r=>r.id)},kind:'LIVE',publishState:'PUBLISHED',...(scope.isDemo===false?{isDemo:false}:{})},select:{id:true}});
  const [live,sessions,slots]=await Promise.all([
    db.liveSession.findMany({where:{roomId:{in:publicRooms.map(r=>r.id)},OR:[{state:'SCHEDULED',scheduledAt:{gte:now}},{state:'LIVE'}]},orderBy:[{scheduledAt:'asc'},{id:'asc'}],take:31,select:{id:true,roomId:true,title:true,scheduledAt:true,state:true}}),
    db.eventSession.findMany({where:{eventId:{in:events.map(e=>e.id)},state:'OPEN',endsAt:{gt:now}},orderBy:[{startsAt:'asc'},{id:'asc'}],take:31,select:{id:true,eventId:true,startsAt:true,endsAt:true,location:true}}),
    db.appointmentSlot.findMany({where:{teacherId:id,offeringId:{in:offerings.map(o=>o.id)},state:'OPEN',startsAt:{gt:now}},orderBy:[{startsAt:'asc'},{id:'asc'}],take:200,select:{id:true,offeringId:true,startsAt:true,endsAt:true,capacity:true,confirmed:true,reserved:true}}),
  ]);
  const schedule=[
    ...live.map(s=>({id:s.id,kind:'LIVE',resourceId:s.roomId,title:s.title,startsAt:s.scheduledAt,endsAt:null,location:'在线直播',state:s.state})),
    ...sessions.map(s=>({id:s.id,kind:'EVENT',resourceId:s.eventId,title:events.find(e=>e.id===s.eventId)!.title,startsAt:s.startsAt,endsAt:s.endsAt,location:s.location,state:'OPEN'})),
    ...slots.flatMap(s=>{const offering=offerings.find(o=>o.id===s.offeringId)!;return s.startsAt>new Date(+now+offering.leadMinutes*60000)&&s.capacity>s.confirmed+s.reserved?[{id:s.id,kind:'CONSULTATION',resourceId:id,title:offering.title,startsAt:s.startsAt,endsAt:s.endsAt,location:'咨询 / 见面',state:'OPEN'}]:[];}),
  ].sort((a,b)=>(Number(b.state==='LIVE')-Number(a.state==='LIVE'))||(+a.startsAt-+b.startsAt)||a.id.localeCompare(b.id));
  const curated=(purpose:string)=>own.filter(r=>r.relationType==='TEACHER_ARTICLE_'+purpose).flatMap(r=>{
    const a=articles.find(a=>a.id===r.toId);if(!a||purpose==='INTERPRETATION'&&a.visibility!=='MEMBER'||purpose==='INTRODUCTION'&&(a.visibility!=='PUBLIC'||!Array.isArray(a.blocks)||!(a.blocks as ArticleMediaBlock[]).some(playable)))return [];
    return [{id:a.id,title:a.title,summary:a.summary,visibility:a.visibility,membershipTier:a.membershipTier}];
  });
  return {representativeCourses:own.flatMap(r=>r.relationType==='TEACHER_COURSE'?courses.filter(c=>c.id===r.toId):[]),introductions:curated('INTRODUCTION'),interpretations:curated('INTERPRETATION'),schedule:schedule.slice(0,30),scheduleHasMore:schedule.length>30};
}
