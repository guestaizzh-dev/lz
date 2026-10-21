import {Body,Controller,Post,Req,UseGuards} from '@nestjs/common';
import {IsIn,IsInt,IsOptional,IsString,IsUUID,Length,Matches,Max,Min} from 'class-validator';
import {AuthService,UserGuard} from './auth.js';
import type {AuthRequest} from './auth.js';
import {Database} from './database.js';
class DiagnosticDto {
  @IsIn(['RUNTIME','API_5XX']) kind!:string;
  @IsString() @Matches(/^pages\/[a-z0-9_/-]{1,100}$|^unknown$/i) route!:string;
  @IsString() @Length(1,40) @Matches(/^[a-z0-9._-]+$/i) build!:string;
  @IsIn(['Error','TypeError','RangeError','ReferenceError','SyntaxError','Unknown']) errorType!:string;
  @IsString() @Matches(/^[a-f0-9]{8}$/) fingerprint!:string;
  @IsOptional() @IsUUID() requestId?:string;
  @IsOptional() @IsInt() @Min(500) @Max(599) status?:number;
}
@Controller('diagnostics') @UseGuards(UserGuard)
export class ClientDiagnosticsController {
  constructor(private readonly db:Database,private readonly auth:AuthService){}
  @Post()
  async record(@Req() req:AuthRequest,@Body() dto:DiagnosticDto){
    await this.auth.rateLimit('client-diagnostics:'+req.actor.id,20,3600000);
    const row=await this.db.auditLog.create({data:{actorId:req.actor.id,action:'client.error',resource:'app_client',requestId:dto.requestId??req.requestId??'',changes:{...dto}}});
    return {id:row.id};
  }
}
