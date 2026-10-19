import type {Prisma} from './generated/prisma/client.js';
export const consumptionPolicy={version:'CONSUMPTION_20261018_V1',pointsUnit:100,growthUnit:1000,pointsDailyLimit:500,growthDailyLimit:20,observationDays:7} as const;
export const consumptionRuleText='新订单按已交付并经过7天观察期的实际保留金额，每满1元得1积分、每满10元得1成长值。运费不计；消费积分每日最多500，成长与学习/审核/打卡合计每日最多20，按北京时间。退款期间冻结，可信退款按原奖励及累计满元基数同比例冲回，余额不足由后续积分抵扣；不提现、不转让、不改变付费会员等级。';
export function validConsumptionPolicy(value:Prisma.JsonValue|undefined|null){const row=value as Record<string,unknown>|null|undefined;return !!row&&Object.entries(consumptionPolicy).every(([key,v])=>row[key]===v);}
// Consumption restorations retain their original allocation day; they must not spend today's cap twice.
export async function dailyGrowthAllocated(tx:Prisma.TransactionClient,userId:string,businessDay:Date){
 const [interactive,consumption]=await Promise.all([tx.growthLedger.aggregate({where:{userId,businessDay,delta:{gt:0},NOT:{eventKey:{startsWith:'consumption.'}}},_sum:{delta:true}}),tx.consumptionAward.aggregate({where:{userId,businessDay},_sum:{growth:true}})]);
 return(interactive._sum.delta??0)+(consumption._sum.growth??0);
}
