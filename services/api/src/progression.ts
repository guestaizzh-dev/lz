import { Controller, Get, Param, ParseUUIDPipe, Query, Req, UseGuards } from '@nestjs/common';
import {ConsumptionPage,ConsumptionRewards} from './consumption-rewards.js';
import {consumptionRuleText} from './consumption-policy.js';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { UserGuard, type AuthRequest } from './auth.js';
import { Database } from './database.js';
class ProgressionPage {
  @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(10000) page=1;
  @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(50) size=20;
}
@Controller('me/progression') @UseGuards(UserGuard)
export class ProgressionController {
  constructor(private readonly db:Database,private readonly consumption:ConsumptionRewards){}
  @Get() async summary(@Req() req:AuthRequest){
    const {processing}=await this.consumption.refresh(req.actor.id);
    const [account,growth]=await this.db.$transaction([this.db.pointsAccount.findUnique({where:{userId:req.actor.id}}),this.db.growthLedger.aggregate({where:{userId:req.actor.id},_sum:{delta:true}})]);
    const value=Math.max(0,growth._sum.delta??0);
    return{processing,consumptionRule:consumptionRuleText,points:String(account?.balance??0),reserved:String(account?.reserved??0),available:String(processing||account?.debt?0n:(account?.balance??0n)-(account?.reserved??0n)),debt:String(account?.debt??0n),growth:value,level:value>=500?'实践者':value>=100?'研习者':'初学者',nextLevelAt:value>=500?null:value>=100?500:100,redemptionAvailable:await this.db.pointsReward.count({where:{active:true,stock:{gt:0}}})>0};
  }
  @Get('points') async points(@Req() req:AuthRequest,@Query() query:ProgressionPage){
    await this.consumption.refresh(req.actor.id);
    const account=await this.db.pointsAccount.findUnique({where:{userId:req.actor.id}});if(!account)return{items:[],total:0};
    const where={accountId:account.id};const [rows,total]=await this.db.$transaction([this.db.pointsLedger.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(query.page-1)*query.size,take:query.size,select:{id:true,delta:true,balanceAfter:true,debtDelta:true,debtAfter:true,reason:true,createdAt:true,ruleSnapshot:true}}),this.db.pointsLedger.count({where})]);return{items:rows.map(({ruleSnapshot,debtDelta,...r})=>({...r,order:this.sourceOrder(ruleSnapshot),delta:String(r.delta-debtDelta),balanceChange:String(r.delta),debtChange:String(debtDelta),debtAfter:String(r.debtAfter),balanceAfter:String(r.balanceAfter)})),total};
  }
  @Get('growth') async growth(@Req() req:AuthRequest,@Query() query:ProgressionPage){
    await this.consumption.refresh(req.actor.id);
    const where={userId:req.actor.id};const [items,total]=await this.db.$transaction([this.db.growthLedger.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(query.page-1)*query.size,take:query.size,select:{id:true,delta:true,reason:true,createdAt:true,ruleSnapshot:true}}),this.db.growthLedger.count({where})]);return{items:items.map(({ruleSnapshot,...r})=>({...r,order:this.sourceOrder(ruleSnapshot)})),total};
  }
  @Get('consumption') async rewards(@Req() req:AuthRequest,@Query() query:ConsumptionPage){await this.consumption.refresh(req.actor.id);return this.consumption.list(query,req.actor.id);}
  @Get('consumption/:id') order(@Req() req:AuthRequest,@Param('id',ParseUUIDPipe) id:string){return this.consumption.order(req.actor.id,id);}
  private sourceOrder(snapshot:unknown){const row=snapshot as {orderId?:string;orderKind?:string}|null;return row?.orderId&&row.orderKind?{id:row.orderId,kind:row.orderKind}:null;}
}
