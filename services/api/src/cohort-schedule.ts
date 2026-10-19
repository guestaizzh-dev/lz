export function cohortLessonOpensAt(startsAt:Date,opensOnDay:number):Date {
  return new Date(startsAt.valueOf()+(opensOnDay-1)*86400000);
}
export function cohortLessonLockedReason(opensAt:Date):string {
  return '本章将于'+opensAt.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})+'（北京时间）开放';
}
export function cohortTeachingDate(date:Date|null,anchor:Date|null,startsAt?:Date):Date|null {
  return date&&anchor&&startsAt?new Date(date.valueOf()+startsAt.valueOf()-anchor.valueOf()):date;
}
export function cohortPracticeDate(date:Date|null,anchor:Date|null,startsAt?:Date):Date|null {
  const chinaDay=(value:Date)=>new Date(value.toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'})+'T00:00:00Z').valueOf();
  return date&&anchor&&startsAt?new Date(date.valueOf()+chinaDay(startsAt)-chinaDay(anchor)):date;
}
