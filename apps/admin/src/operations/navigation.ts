import type access from '@/access';

export type AdminAccess = ReturnType<typeof access>;
export type NavigationEntry = {
  path: string;
  title: string;
  summary: string;
  access?: keyof AdminAccess;
  keywords?: string;
};
export type NavigationGroup = { id: string; title: string; entries: NavigationEntry[] };

// Keep existing URLs and route guards; this catalog only organizes their entry points.
const sourceNavigation: NavigationGroup[] = [
  { id: 'work', title: '工作台', entries: [
    { path: '/', title: '工作台首页', summary: '查找业务入口，按流程开始工作' },
    { path: '/dashboard/analysis', title: '数据概览', summary: '查看经营、学习与内容核心指标', access: 'canDashboard' },
    { path: '/guide', title: '操作指南', summary: '发布、开播、发货、售后与权限配置步骤', keywords: '帮助 使用说明' },
  ] },
  { id: 'content', title: '内容运营', entries: [
    {path:'/categories',title:'分类管理',summary:'维护文章、课程、商品与活动分类，调整名称、排序及启停',access:'canConfig'},
    { path: '/content/articles', title: '文章与经典', summary: '正文、注释、授权证据与发布审核', access: 'canContent' },
    { path: '/content/comments', title: '文章评论审核', summary: '审核文章讨论与引用', access: 'canComments' },
    {path:'/community-enhancements',title:'社区活动与授权',summary:'会员置顶、征文品质评选、精选排期与课程案例审核',access:'canCommunity'},
    { path: '/forum', title: '社区与内容治理', summary: '社区话题、举报与内容审核', access: 'canCommunity' },
    { path: '/content/relations', title: '内容联动', summary: '维护文章、课程、直播、活动和商品关联', access: 'canRelations' },
  ] },
  { id: 'education', title: '课程与教学', entries: [
    { path: '/content/courses', title: '课程与名师', summary: '课件、章节、名师与课程版本发布', access: 'canCourses', keywords: '视频 音频 文字 售卖' },
    { path: '/media', title: '音视频媒体库', summary: '上传课件与人工回放，核查处理状态', access: 'canMedia' },
    { path: '/cohorts', title: '训练营管理', summary: '营期、报名、章节排程与学员', access: 'canCourses' },
    {path:'/teaching-cases',title:'课程案例点评',summary:'主讲查看作者授权的选定心得并点评',access:'canTeaching'},
    { path: '/teaching', title: '教学与作业', summary: '教学人员、作业发布与学员点评', access: 'canTeaching' },
    { path: '/practices', title: '研习打卡', summary: '日常研习任务与打卡记录', access: 'canTeaching' },
    { path: '/questions', title: '名师问答', summary: '学员提问、回复与审核', access: 'canQuestions' },
    { path: '/content/course-reviews', title: '课程评价审核', summary: '审核课程评价与反馈', access: 'canCourseReviews' },
  ] },
  { id: 'live', title: '直播管理', entries: [
    { path: '/content/live', title: '直播管理', summary: '管理员发布预告、直接开播、自动录制并生成会员回放', access: 'canAdmin', keywords: '开播 直播预告 录制 回放' },
  ] },
  { id: 'shop', title: '商城运营', entries: [
    { path: '/products', title: '商品与库存', summary: '商品资料、SKU、售价、库存与上架审核', access: 'canProducts' },
    { path: '/delivery', title: '配送计费', summary: '配送区域、运费与配送规则', access: 'canProducts' },
  ] },
  {id:'promotion-services',title:'推广服务',entries:[{path:'/promotion-services',title:'推广服务与广告',summary:'合同报价、银行实收、客户验收、约定退款及广告排期',access:'canPromotionServices',keywords:'广告投放 内容策划 名师推广 活动宣传'}]},
  {id:'marketing',title:'营销运营',entries:[{path:'/charity',title:'公益研习与分成',summary:'真实资质协议、受助资格、免费/优惠交付及月结付款',access:'canCharity'},{path:'/product-promotions',title:'商城促销',summary:'指定规格满减、秒杀、独立库存和限购',access:'canProducts'},{path:'/points-rewards',title:'积分商城',summary:'兑换规则、实际履约、退分和消费奖励核查',access:'canPoints'},{path:'/referrals',title:'课程推广与结算',summary:'推广者审核、首次归因、交付核费及提现付款留证',access:'canReferrals'},{path:'/marketing',title:'营销中心',summary:'课程优惠券发放、领取与冻结核销',access:'canCourses'}]},
  { id: 'membership', title: '会员服务', entries: [
    {path:'/member-gifts',title:'签名礼遇与研学',summary:'签名库存预留、新版权益、领取发货与退货返还、研学优先范围',access:'canProducts'},
    { path: '/memberships', title: '会员与权益', summary: '套餐、权益版本与补偿授权记录', access: 'canMembers' },
  ] },
  { id: 'events', title: '活动与预约', entries: [
    { path: '/events', title: '活动管理', summary: '活动发布、场次、票种、报名与人员委派', access: 'canEvents' },
    { path: '/services', title: '服务与预约', summary: '咨询服务、开放时段与预约处理', access: 'canServices' },
    { path: '/event-workbench', title: '现场工作台', summary: '核对报名、逐人签到与实际履约记录', access: 'canEventWorkbench', keywords: '核销' },
  ] },
  { id: 'orders', title: '订单与售后', entries: [
    { path: '/course-orders', title: '课程订单', summary: '课程收款核查、退课与退款状态', access: 'canViewOrders' },
    { path: '/cohort-orders', title: '训练营订单', summary: '营期收款、退出与争议补偿', access: 'canViewOrders' },
    { path: '/booking-orders', title: '预约与活动订单', summary: '预约报名收款、取消与协商退款', access: 'canViewOrders' },
    { path: '/membership-orders', title: '会员订单', summary: '会员收款、权益开通与退款', access: 'canViewOrders' },
    { path: '/orders', title: '商品订单', summary: '实物商品付款、分包发货、退货与退款', access: 'canViewOrders' },
    { path: '/feedback', title: '客服与反馈', summary: '用户反馈、处理进度与客服回复', access: 'canSupport' },
  ] },
  { id: 'finance', title: '财务中心', entries: [
    { path: '/finance', title: '收退款与账务', summary: '跨业务收款、退款、订单关联和借贷明细核查', access: 'canFinanceRead', keywords: '流水 对账 异常' },
  ] },
  { id: 'system', title: '系统管理', entries: [
    { path: '/operations', title: '任务监控与恢复', summary: '收款查单、退款、交付通知和取消补偿的失败任务', access: 'canOperations', keywords: '异常 重试 死任务' },
    { path: '/system/users', title: '账号与会话', summary: '账号、角色、冻结、密码与会话撤销', access: 'canUsers' },
    { path: '/system/access', title: '角色与权限', summary: '配置角色的查看、编辑、审核与操作权限', access: 'canAccess' },
    { path: '/system/config', title: '系统配置', summary: '书院信息、首页入口与全局参数', access: 'canConfig' },
    { path: '/system/audit', title: '操作审计', summary: '追溯操作人员、原因和变更记录', access: 'canAudit' },
    { path: '/data', title: '高级数据维护', summary: '开发维护用数据工具；日常运营请优先使用业务页面', access: 'canData' },
  ] },

];

const entries = sourceNavigation.flatMap(group => group.entries);
const extra: Record<string,string[]> = {
  education:['/marketing','/referrals','/charity'], shop:['/product-promotions','/promotion-services'],
  membership:['/points-rewards'], orders:['/finance'],
};
export const navigation: NavigationGroup[] = sourceNavigation.filter(group=>!['marketing','promotion-services','finance'].includes(group.id)).map(group=>({
  ...group,title:({content:'内容管理',education:'课程与教学',shop:'商城管理',membership:'用户与会员',events:'活动与咨询',orders:'订单与售后'} as Record<string,string>)[group.id]??group.title,
  entries:[...group.entries,...entries.filter(entry=>(extra[group.id]??[]).includes(entry.path))],
}));

export function visibleNavigation(permissions: AdminAccess): NavigationGroup[] {
  return navigation.map(group => ({ ...group, entries: group.entries.filter(entry => !entry.access || permissions[entry.access]) }))
    .filter(group => group.entries.length > 0);
}

export function pageEntry(path: string) {
  return [...navigation.flatMap(group => group.entries),{path:'/content/live/history',title:'历史课程直播',summary:'原有课程与老师直播安排',access:'canLive'} as NavigationEntry,{path:'/live-host/assigned',title:'历史授权开播',summary:'本人被委派的历史场次',access:'canTeaching'} as NavigationEntry].find(entry => entry.path === (path==='/live-host'?'/content/live':path));
}

export function canOpenPage(path: string, permissions: AdminAccess) {
  const entry = pageEntry(path);
  return !!entry && (!entry.access || permissions[entry.access]);
}

export function matchesEntry(entry: NavigationEntry, query: string) {
  return `${entry.title} ${entry.summary} ${entry.keywords ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
}
