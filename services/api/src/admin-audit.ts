import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { catchError, concatMap, from, type Observable, throwError } from 'rxjs';
import { Database } from './database.js';
import type { AuthRequest } from './auth.js';

@Injectable()
export class AdminAudit implements NestInterceptor {
  private readonly logger = new Logger(AdminAudit.name);
  constructor(private readonly db:Database) {}
  intercept(context:ExecutionContext,next:CallHandler):Observable<unknown> {
    const req=context.switchToHttp().getRequest<AuthRequest>();
    if(!req.actor||!req.path.startsWith('/api/v1/admin/')||['GET','HEAD','OPTIONS'].includes(req.method))return next.handle();
    const record=async(outcome:string,status:number)=>{
      // Business changes already write transactional audits; this entry correlates the HTTP result without recording a request body.
      try{await this.db.auditLog.create({data:{actorId:req.actor.id,action:'admin.request',resource:'admin_api',requestId:req.requestId??'',changes:{method:req.method,path:req.path,outcome,status}}});}
      catch{this.logger.error(`Request audit unavailable: ${req.requestId}`);}
    };
    return next.handle().pipe(concatMap(value=>from(record('SUCCESS',context.switchToHttp().getResponse().statusCode)).pipe(concatMap(()=>[value]))),catchError(error=>from(record('FAILED',typeof error.getStatus==='function'?error.getStatus():500)).pipe(concatMap(()=>throwError(()=>error)))));
  }
}
