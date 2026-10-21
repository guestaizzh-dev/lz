import {ForbiddenException, Injectable} from '@nestjs/common';
import {Database} from './database.js';

export const permissions = [
  ['dashboard.read','查看工作台'], ['content.read','查看文章'], ['content.write','编辑文章'], ['content.review','审核文章'],
  ['courses.read','查看课程与名师'], ['courses.write','编辑课程与名师'], ['courses.review','审核课程与名师'],
  ['products.read','查看商品与配送'], ['products.write','编辑商品与配送'], ['products.review','审核商品'],
  ['live.read','查看直播资料'], ['live.write','编辑直播资料'], ['live.review','发布直播资料'],
  ['community.read','查看社区'], ['community.write','维护社区'], ['community.review','审核社区'],
  ['teaching.read','查看所属教学'], ['teaching.write','处理所属教学'],
  ['questions.read','查看问答'], ['questions.write','答复所属问答'], ['questions.review','审核公开问答'],
  ['support.read','查看客服反馈'], ['support.write','处理客服反馈'], ['orders.read','查看订单'], ['finance.refund','审核与重试退款'],
  ['members.read','查看会员权益'], ['members.write','管理会员权益'],
  ['events.read','查看活动'], ['events.write','编辑活动'], ['events.review','审核活动'],
  ['media.read','查看媒体库'], ['media.write','上传媒体'], ['data.read','查询业务数据'], ['data.write','维护允许编辑的数据'],
  ['users.read','查看账号'], ['users.write','管理账号与会话'], ['access.manage','管理角色权限与授权'],
  ['audit.read','查看全局审计'], ['config.read','查看系统配置'], ['config.write','更新系统配置'],
  ['orders.fulfill','处理商品发货与退货收货'], ['orders.address','授权查看配送地址'],
  ['finance.read','查看统一财务流水与账务明细'], ['operations.read','查看持久任务与运行异常'], ['operations.retry','核查并重试失败任务'],
] as const;
export const permissionCodes = permissions.map(([code]) => code);
export const rolePermissions: Record<string,string[]> = {
  ADMIN: [...permissionCodes], USER: [],
  OPERATOR: ['dashboard.read','content.read','content.write','courses.read','courses.write','products.read','products.write','live.read','live.write','community.read','community.write','events.read','events.write','media.read','media.write','data.read','data.write','orders.read','orders.fulfill','orders.address'],
  MODERATOR: ['dashboard.read','content.read','content.review','courses.read','courses.review','products.read','products.review','live.read','live.review','community.read','community.review','questions.read','questions.review','events.read','events.review','media.read','data.read'],
  TEACHER: ['dashboard.read','teaching.read','teaching.write','questions.read','questions.write'],
  SUPPORT: ['dashboard.read','support.read','support.write','orders.read','users.read','data.read','orders.address'],
  FINANCE: ['dashboard.read','orders.read','finance.read','finance.refund','data.read'],
};

// Capability policies narrow each existing role; resource ownership checks still run in its service.
@Injectable()
export class AdminPermissions {
  constructor(private readonly db:Database){}
  async resolve(roles:string[]):Promise<string[]> {
    if(roles.includes('ADMIN'))return [...permissionCodes];
    const rows=await this.db.accessRole.findMany({where:{code:{in:roles},active:true},select:{code:true,permissionCodes:true}});
    return [...new Set(rows.flatMap(row=>row.permissionCodes.filter(code=>rolePermissions[row.code]?.includes(code))))];
  }
  async assert(roles:string[],method:string,path:string,body?:Record<string,unknown>){
    const effective=await this.resolve(roles),needed=routePermission(method,path,body);
    if(needed&&!effective.includes(needed))throw new ForbiddenException('无此操作权限，请联系管理员');
    return effective;
  }
}

export function routePermission(method:string,path:string,body?:Record<string,unknown>):string|null {
  const route=path.replace(/^\/api\/v1\//,'').replace(/^\//,'');
  const parts=route.split('/'),root=parts[1],read=['GET','HEAD','OPTIONS'].includes(method);
  if(root==='auth')return null;
  if(['partner-finance','reconciliation'].includes(root??''))return read?'finance.read':'finance.refund';
  if(root==='digital-orders')return read?'orders.read':'finance.refund';
  if(root==='categories')return read?'config.read':'config.write';
  if(root==='media'&&parts.at(-1)==='preview')return 'media.read';
  if(root==='images')return read?'media.read':'media.write';
  if(root==='payments')return 'finance.refund';
  if(root==='community-enhancements'){if(parts[2]==='cases'&&parts.at(-1)==='comment')return 'teaching.write';return read?'community.read':parts.includes('review')||parts.includes('judge')?'community.review':'community.write';}
  if(root==='member-gifts')return read||parts.at(-1)==='proof'&&parts.length===5?'products.read':parts[2]==='plans'?'members.write':'products.write';
  if(root==='advertising')return read?'content.read':parts.at(-1)==='state'&&parts[2]==='campaigns'&&['APPROVE','REJECT'].includes(String(body?.action))?'content.review':'content.write';
  if(root==='operating-services'){if(parts.at(-1)==='proof'&&parts.length===5)return parts[2]==='deliveries'?null:'finance.read';if(parts[2]==='finance-proof')return 'finance.refund';if(read&&['orders','order-options'].includes(parts[2]??''))return null;if(['contracts','clients','partners','receipts','refunds','deliveries'].includes(parts[2]??'')||parts.includes('receipts')||parts.includes('refunds'))return read?'finance.read':'finance.refund';return read?'courses.read':'courses.write';}
  if(root==='charity'){if(parts.length===5&&parts.at(-1)?.endsWith('proof'))return 'finance.read';if(parts[2]==='applications')return 'members.write';return read?'finance.read':'finance.refund';}
  if(root==='product-promotions')return read?'products.read':'products.write';
  if(root==='service-deliveries')return read||parts.length===4&&parts.at(-1)==='proof'?'orders.read':parts.at(-1)==='review'?'finance.refund':parts.length===3&&parts.at(-1)==='proof'?'media.write':'orders.fulfill';
  if(root==='points'&&parts[2]==='consumption')return read?'finance.read':null;
  if(root==='points')return read||parts.length===5&&parts.at(-1)==='proof'?'members.read':'members.write';
  if(root==='referrals'){if(parts.length===5&&parts.at(-1)==='proof')return parts[2]==='promoters'?'courses.read':'finance.read';if(parts[2]==='proof')return 'courses.write';if(parts[2]==='withdrawals'||parts[2]==='accruals')return read?'finance.read':'finance.refund';return read?'courses.read':'courses.write';}
  if(root==='marketing')return read?'courses.read':'courses.write';
  if(root==='content-relations')return null; // Source resource capability is checked by the controller.
  if(root==='overview')return 'dashboard.read';
  if(root==='access'||root==='users'&&parts.includes('roles'))return 'access.manage';
  if(root==='users')return read?'users.read':'users.write';
  if(root==='audit')return 'audit.read';
  if(root==='finance')return 'finance.read';
  if(root==='gifts')return read||parts.at(-1)==='proof'?'finance.read':'finance.refund';
  if(root==='operations')return read?'operations.read':'operations.retry';
  if(root==='config')return read?'config.read':'config.write';
  if(root==='data'&&parts[2]==='roles')return 'access.manage';
  if(root==='data')return read?'data.read':'data.write';
  if(root==='product-orders')return parts.at(-1)==='tracking'?'orders.read':parts.at(-1)==='address'?'orders.address':['ship','exchange'].includes(parts.at(-1)??'')||parts.includes('review')&&body?.action==='RECEIVED'?'orders.fulfill':read||parts.at(-1)==='refresh'?'orders.read':'finance.refund';
  if(root==='course-orders'||root==='membership-orders'||root==='booking-orders'||root==='cohort-orders')return read||parts.at(-1)==='refresh'?'orders.read':'finance.refund';
  if(root==='course-versions')return read?'courses.read':'courses.review';
  if(root==='membership-benefits')return read?'members.read':'members.write';
  if(root==='apple-products')return read?'courses.read':'courses.review';
  if(root==='apple-memberships')return read?'members.read':'members.write';
  if(root==='apple-transactions')return read&&parts.at(-1)==='refund-review'||parts.at(-1)==='proof'?'finance.read':read?'orders.read':'finance.refund';
  if(root==='orders')return 'orders.read';
  if(root==='live-host')return read?'teaching.read':'teaching.write';
  if(root==='live'&&parts[2]==='mics')return 'teaching.write'; // A valid host lease and ownership are required by LiveMics.
  if(root==='live')return read?'live.read':parts.includes('review')||parts.includes('mute')?'live.review':'live.write';
  const module:Record<string,string>={cohorts:'courses',services:'courses',articles:'content',comments:'content','course-reviews':'courses',teachers:'courses',courses:'courses',products:'products','delivery-zones':'products',memberships:'members',entitlements:'members',enrollments:'members',events:'events',media:'media','media-library':'media','live-discovery':'live',forum:'community',feedback:'support',teaching:'teaching',questions:'questions'};
  const scope=module[root??''];
  if(!scope)throw new ForbiddenException('管理接口未登记权限');
  if(read)return scope+'.read';
  if(root==='articles'&&parts.includes('blocks')&&parts.includes('media'))return 'content.read';
  if(['articles','products','teachers'].includes(root??'')&&parts.at(-1)==='proof')return scope+'.read';
  if(root==='course-reviews'||root==='comments')return scope+'.review';
  if(root==='forum'&&(parts.includes('reports')||parts.includes('restrictions')||parts.includes('restrict')))return 'community.review';
  if(['articles','products'].includes(root??'')&&parts.includes('relations'))return scope+'.review';
  if(['articles','products','teachers'].includes(root??'')&&!parts.includes('review')&&parts.includes('evidence'))return scope+'.write';
  if(parts.includes('images')&&scope==='teaching')return 'teaching.read';
  if((parts.includes('images')||parts.includes('media'))&&scope==='community')return 'community.read';
  const review=parts.includes('review')||parts.includes('moderate')||['publish','reject','APPROVE','REJECT','HIDE','RESTORE'].includes(String(body?.action))||root==='live-discovery'&&parts.includes('publication');
  return scope+(review&&['content','courses','products','live','community','questions','events'].includes(scope)?'.review':'.write');
}

export const resourceScopes:Record<string,string>={ARTICLE:'content',THREAD:'community',COURSE:'courses',TEACHER:'courses',PRODUCT:'products',LIVE:'live',EVENT:'events'};

export function entityPermission(key:string,write=false):string {
  if(key==='access_role'||key==='user_role')return 'access.manage';
  if(key==='audit_log')return 'audit.read';
  if(key==='feature_config')return write?'config.write':'config.read';
  if(key==='media_asset')return write?'media.write':'media.read';
  if(/^(trade_order|order_item|payment_|refund|finance_|reconciliation|settlement|commission_|withdrawal)/.test(key))return write?'finance.refund':'orders.read';
  const scope=/^(article|source_evidence|resource_evidence|content_relation|comment)/.test(key)?'content':/^(course|teacher|lesson|assignment|submission|practice_task|practice_checkin)/.test(key)?'courses':/^(product|inventory|delivery_zone)/.test(key)?'products':/^event/.test(key)?'events':/^live/.test(key)?'live':/^(membership|plan_benefit|benefit_scope)/.test(key)?'members':key==='app_user'?'users':/^(feedback|report)/.test(key)?'support':/^(forum|user_block)/.test(key)?'community':null;
  return scope?scope+(write?'.write':'.read'):write?'data.write':'data.read';
}

