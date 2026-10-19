export default function access(initialState: { currentUser?: API.CurrentUser } | undefined) {
  const user=initialState?.currentUser;
  const has=(code:string)=>user?.permissions?.includes(code)??false;
  return {
    canPromotionServices:has('courses.read')||has('finance.read')||has('content.read'),
    canCharity:has('finance.read')||has('members.write'),
    canReferrals:has('courses.read')||has('finance.read'),
    canFinanceRead:has('finance.read'), canOperations:has('operations.read'), canOperationsRetry:has('operations.retry'),
    canServices:has('courses.read')||has('teaching.read'), canRelations:['content.read','courses.read','products.read','live.read','events.read'].some(has),
    canFulfill:has('orders.fulfill'), canOrderAddress:has('orders.address'),
    canComments:has('content.read')&&(user?.roles?.some(role=>['ADMIN','MODERATOR'].includes(role))??false),
    canCourseReviews:has('courses.read')&&(user?.roles?.some(role=>['ADMIN','MODERATOR'].includes(role))??false),
    canCommunityModeration:has('community.read')&&(user?.roles?.some(role=>['ADMIN','MODERATOR'].includes(role))??false),
    canDashboard:has('dashboard.read'), canContent:has('content.read'), canContentEdit:has('content.write'), canContentReview:has('content.review'),
    canCourses:has('courses.read'), canCoursesEdit:has('courses.write'), canCoursesReview:has('courses.review'),
    canProducts:has('products.read'), canProductsEdit:has('products.write'), canProductsReview:has('products.review'),
    canLive:has('live.read'), canLiveEdit:has('live.write'), canLiveReview:has('live.review'),
    canCommunity:has('community.read'), canCommunityEdit:has('community.write'), canCommunityReview:has('community.review'),
    canEventWorkbench:has('events.read')||has('teaching.read'), canTeaching:has('teaching.read'), canTeachingWrite:has('teaching.write'),
    canQuestions:has('questions.read'), canQuestionsWrite:has('questions.write'), canQuestionsReview:has('questions.review'),
    canSupport:has('support.read'), canSupportWrite:has('support.write'), canViewOrders:has('orders.read'), canFinance:has('finance.refund'),
    canPoints:has('members.read')||has('finance.read'), canMembers:has('members.read'), canMembersWrite:has('members.write'), canEvents:has('events.read'), canEventsEdit:has('events.write'), canEventsReview:has('events.review'),
    canMedia:has('media.read'), canMediaWrite:has('media.write'), canData:has('data.read'), canUsers:has('users.read'), canUsersWrite:has('users.write'),
    canAccess:has('access.manage'), canAudit:has('audit.read'), canConfig:has('config.read'), canConfigWrite:has('config.write'),
    canSystem:has('users.read')||has('access.manage')||has('audit.read')||has('config.read'),
    canAdmin:user?.roles?.includes('ADMIN')??false,
    canManageContent:has('content.read')||has('courses.read')||has('live.read')||has('events.read')||has('products.read'),
  };
}
