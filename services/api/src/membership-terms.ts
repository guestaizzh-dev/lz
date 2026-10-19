import type {MembershipPlan,MembershipPlanVersion} from './generated/prisma/client.js';

export function membershipPlanView(plan:MembershipPlan,version:MembershipPlanVersion|null|undefined):MembershipPlan {
  if(!version)return plan;
  const terms=version.termsSnapshot as {title?:string;price?:number;legacyPrice?:number};
  // Legacy versions never recorded a title; use a stable label instead of the newly edited marketing name.
  return{...plan,title:terms.title??['历史入门会员','历史进阶会员','历史至尊会员'][version.tier-1]!,tier:version.tier,days:version.days,description:version.description,price:terms.price??terms.legacyPrice??plan.price};
}
