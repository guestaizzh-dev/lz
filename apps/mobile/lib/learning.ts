export const membershipTierNames=['注册会员','铜牌会员','银牌会员','金牌会员','钻石会员'];
export type SubtitleCue={start:number;end:number;text:string};
export type StudyProgress = { positionSeconds: number; watchedSeconds: number; completedAt: string | null; updatedAt?:string;lastEventAt?:string|null };
export type LiveLessonState = {id:string;roomId:string;title:string;state:string;scheduledAt:string;replayReady?:boolean;disconnected?:boolean};
export type LessonSummary = {live?:LiveLessonState|null; id: string; title: string; position: number; format: string; durationSeconds: number; trial: boolean; accessible: boolean; opensAt?:string|null; opensOnDay?:number|null; lockedReason?:string|null; required: boolean; progress: StudyProgress | null };
export type Curriculum = { learningLocked?:boolean;releaseWindow?:{phase:string;memberEarlyAccess:boolean;earlyAccessAt:string|null;publicOpenAt:string|null;lockedReason:string|null}|null; cohort?:{id:string;title:string;endsAt:string}|null; course: { id: string; title: string; cover: string; refundPolicy: string; accessDays: number | null }; access: string; releaseId: string | null; lessons: LessonSummary[];deliveryBlocked?:boolean;deliveryReason?:string|null };
export type LessonDetail = LessonSummary & { releaseId:string; body: string; hasMedia: boolean; subtitles:SubtitleCue[] };
export type Membership = { tier: number; startsAt: string; endsAt: string; plan: { title: string; description: string } };
export type MembershipPlan = { contentTier?:number; id: string; title: string; tier: number; days: number; price: number; description: string; purchaseReady?:boolean; purchaseUnavailableReason?:string; termLabel?:string };
export const duration = (seconds: number): string => Math.floor(seconds / 60) + ':' + String(Math.floor(seconds) % 60).padStart(2, '0');
export const lessonType = (format: string): string => ({ TEXT: '图文', AUDIO: '音频', VIDEO: '视频', LIVE:'直播' } as Record<string, string>)[format] ?? '课件';
export function contentFormats(lessons: Pick<LessonSummary, 'format'>[]): string[] {
  return ['TEXT', 'AUDIO', 'VIDEO', 'LIVE'].filter(format => lessons.some(lesson => lesson.format === format));
}
export function contentLabel(lessons: Pick<LessonSummary, 'format'>[]): string { return contentFormats(lessons).map(lessonType).join(' · '); }
// Retry identifier only, never used for authentication or payment.
export const studyEventId = (): string => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.floor(Math.random() * 16); return (c === 'x' ? r : (r & 3) | 8).toString(16); });

export type MembershipBenefits = { memberships: {id:string;state:string;startsAt:string;endsAt:string;plan:{title:string};benefits:{code:string;name:string;parameters:{contentTier?:number;basisPoints?:number;minimumSubtotal?:number}}[]}[]; membershipTotal:number; quotas:{periodId:string|null;grantId:string|null;name:string;quota:number;used:number;remaining:number}[];usage:{items:{id:string;name:string;quantity:number;state:string;createdAt:string}[];total:number} };
export const membershipContentLabel=(tier:number):string=>['不包含会员文章与课程','铜牌及以下会员内容','银牌及以下会员内容','金牌及以下会员内容','钻石及以下会员内容'][tier]??'内容权益待核查';
export const benefitUsageLabel=(state:string):string=>({HELD:'已预占',CONSUMED:'已使用',RELEASED:'预占已释放',REVERSED:'用量已退回'} as Record<string,string>)[state]??'处理中';

export function membershipBenefitLabel(benefit:MembershipBenefits['memberships'][number]['benefits'][number]):string{
  if(benefit.code==='CONTENT_ACCESS')return membershipContentLabel(benefit.parameters.contentTier??0);
  if(benefit.code==='EVENT_DISCOUNT')return benefit.parameters.basisPoints===0?'参与活动票种可免费报名':'参与活动票种按原价'+(benefit.parameters.basisPoints??10000)/100+'%计费';
  if(benefit.code==='COURSE_DISCOUNT')return '参与课程按原价'+(benefit.parameters.basisPoints??10000)/100+'%计费，与优惠券及公益价择优';
  if(benefit.code==='COURSE_EARLY_ACCESS')return '公布窗口内提前研习新课，仍须具备该课内容权限';
  if(benefit.code==='PRODUCT_DISCOUNT'&&benefit.parameters.basisPoints!=null)return '参与折扣的实物商品按原价'+benefit.parameters.basisPoints!/100+'%计费';
  if(benefit.code==='SHIPPING_WAIVER'&&benefit.parameters.minimumSubtotal!=null)return '折后商品满¥'+(benefit.parameters.minimumSubtotal!/100).toFixed(2)+'免基础配送费，地区附加费另计';
  return benefit.name;
}
