import type {Database} from './database.js';
import {membershipRefundHolds} from './membership-benefits.js';
import type {Prisma} from './generated/prisma/client.js';

export type MemberPriceSource={periodId:string;planVersionId:string;benefitId:string;code:string;parameters:Prisma.JsonValue;endsAt:Date;scopes:{resourceId:string|null;offerId:string|null;categoryCode:string|null}[]};
export async function memberPriceSources(userId:string,store:Database|Prisma.TransactionClient,codes=['PRODUCT_DISCOUNT','SHIPPING_WAIVER']){
  const now=new Date(),suspended=await membershipRefundHolds(userId,store),members=await store.membership.findMany({where:{userId,revokedAt:null,id:{notIn:suspended},startsAt:{lte:now},endsAt:{gt:now}},orderBy:[{endsAt:'asc'},{id:'asc'}]}),sources:MemberPriceSource[]=[];
  const definitions=await store.benefitDefinition.findMany({where:{code:{in:codes},active:true}});
  const benefits=await store.planBenefit.findMany({where:{planVersionId:{in:members.flatMap(m=>m.planVersionId?[m.planVersionId]:[])},definitionId:{in:definitions.map(d=>d.id)}}});
  const scopes=await store.benefitScope.findMany({where:{planBenefitId:{in:benefits.map(b=>b.id)}}});
  for(const m of members)for(const b of benefits.filter(b=>b.planVersionId===m.planVersionId))sources.push({periodId:m.id,planVersionId:m.planVersionId!,benefitId:b.id,code:definitions.find(d=>d.id===b.definitionId)!.code,parameters:b.parameters,endsAt:m.endsAt,scopes:scopes.filter(s=>s.planBenefitId===b.id).map(({resourceId,offerId,categoryCode})=>({resourceId,offerId,categoryCode}))});
  return sources;
}
export function sourceApplies(source:MemberPriceSource,resourceId:string,categoryCode:string){return !source.scopes.length||source.scopes.some(s=>s.resourceId===resourceId||s.categoryCode===categoryCode);}
export function discountedAmount(amount:number,basisPoints:number){return Number((BigInt(amount)*BigInt(basisPoints)+9999n)/10000n);}
export function productMemberPrice(amount:number,product:{id:string;category:string;memberDiscountEligible:boolean},sources:MemberPriceSource[]){
  let payable=amount,source:MemberPriceSource|null=null,basisPoints=10000;
  if(product.memberDiscountEligible)for(const candidate of sources.filter(s=>s.code==='PRODUCT_DISCOUNT'&&sourceApplies(s,product.id,product.category))){
    const rate=(candidate.parameters as {basisPoints?:number}).basisPoints;
    if(!Number.isInteger(rate)||rate!<1000||rate!>=10000)continue;
    const price=discountedAmount(amount,rate!);if(price<payable){payable=price;source=candidate;basisPoints=rate!;}
  }
  return{payable,discount:amount-payable,basisPoints,source:source?{periodId:source.periodId,planVersionId:source.planVersionId,benefitId:source.benefitId,endsAt:source.endsAt.toISOString()}:null};
}
