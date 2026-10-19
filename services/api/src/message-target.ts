type Message = {kind:string;resourceId?:string|null;orderId?:string|null;cohortId?:string|null;appointmentId?:string|null;registrationId?:string|null};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function messageTarget(row:Message){
  const id=row.resourceId&&uuid.test(row.resourceId)?row.resourceId:null,order=row.orderId&&uuid.test(row.orderId)?row.orderId:null,cohort=row.cohortId&&uuid.test(row.cohortId)?row.cohortId:null;
  const target=(path:string,label:string)=>({path:'/pages/'+path,label});
  switch(row.kind){
    case 'PRODUCT_ORDER':return target(order?'shop/order-detail?id='+order:'shop/orders','查看商品订单');
    case 'COURSE_ORDER':return target(order?'course/purchase?orderId='+order:'course/orders','查看购课订单');
    case 'MEMBERSHIP_ORDER':return target(order?'membership/purchase?orderId='+order:'membership/orders','查看会员订单');
    case 'COHORT_ORDER':return target(order?'cohort/purchase?orderId='+order:'cohort/index','查看训练营订单');
    case 'BOOKING':{const booking=row.appointmentId??row.registrationId;return target(order?'booking/purchase?orderId='+order:booking&&uuid.test(booking)?'booking/mine?bookingId='+booking:'booking/mine','查看预约与报名');}
    case 'BOOKING_STAFF':return target('booking/workbench','查看服务工作台');
    case 'COHORT':return target(cohort?'cohort/detail?id='+cohort:'cohort/index','查看训练营安排');
    case 'LIVE':return id?target('live/detail?id='+id,'查看直播安排'):null;
    case 'CHARITY':return target('marketing/charity?tab=mine','查看公益研习与资格');
    case 'COMMUNITY_CASE':return target('marketing/community','查看课程案例授权与点评');
    case 'FORUM_REVIEW':return id?target('community/detail?id='+id,'查看帖子与审核结果'):null;
    case 'FEEDBACK_REPLY':return target('profile/feedback','查看客服回复');
    case 'TEACHER_ANSWER':return id?target('teacher/questions?teacherId='+id,'查看老师答复'):null;
    case 'COURSE_VERSION':return id?target('course/versions?id='+id,'查看课程版本与处理方案'):null;
    case 'COURSE_REVIEW':return id?target('course/detail?id='+id+'&tab=reviews','查看课程评价'):null;
    case 'PRACTICE_REVIEW':case 'ASSIGNMENT_REVIEW':return id?target('course/'+(row.kind==='PRACTICE_REVIEW'?'checkin':'practice')+'?id='+id+(cohort?'&cohortId='+cohort:''),'查看研习点评'):null;
    default:return null;
  }
}
export function messageCategory(kind:string):'transactions'|'learning'|'community'{
  return ['PRODUCT_ORDER','COURSE_ORDER','MEMBERSHIP_ORDER','COHORT_ORDER','BOOKING','BOOKING_STAFF','FEEDBACK_REPLY'].includes(kind)?'transactions':['COMMUNITY_CASE','FORUM_REVIEW','TEACHER_ANSWER','COURSE_REVIEW'].includes(kind)?'community':'learning';
}
