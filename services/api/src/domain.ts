import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, Injectable, NotFoundException, OnModuleDestroy, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Pool, types, type PoolClient } from 'pg';
import { createCipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { AdminGuard, type AuthRequest } from './auth.js';
import { access, domains, hidden, resourceKinds, writable, type Entity, type Field } from './domain-policy.js';

const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
const revision = (row: Record<string, unknown>) => createHash('sha256').update(JSON.stringify(row)).digest('hex');
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('需要 JSON 对象');
  return value as Record<string, unknown>;
};
const bounded = (value: unknown, fallback: number, max: number) => {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > max) throw new BadRequestException('分页参数不合法');
  return number;
};

@Injectable()
export class DomainService implements OnModuleDestroy {
  private pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5, connectionTimeoutMillis: 5000, options: '-c timezone=UTC -c statement_timeout=10000', types: { getTypeParser: (oid, format) => {
    if(format!=='binary'&&oid===1082)return (value:string)=>value; // Business dates must never shift with the Windows timezone.
    if(format!=='binary'&&oid===1114)return (value:string)=>new Date(value.replace(' ','T')+'Z'); // Existing Prisma timestamps store UTC without an offset.
    return types.getTypeParser(oid,format);
  } } });
  private encryptionKey?: Buffer;
  async onModuleDestroy() { await this.pool.end(); }
  entity(key: string, req: AuthRequest, operation: 'read' | 'create' | 'update' | 'delete' = 'read') {
    const entity = domains.find(item => item.key === key);
    if (!entity) throw new NotFoundException('数据模块不存在');
    if (!access(entity, req.actor.roles)[operation]) throw new ForbiddenException('无此操作权限；业务事实请通过对应业务流程处理');
    return entity;
  }
  schema(req: AuthRequest) {
    return domains.filter(e => access(e, req.actor.roles).read).map(e => ({
      ...e, permissions: access(e, req.actor.roles), fields: e.fields.filter(f => !hidden(f) || f.name.endsWith('Cipher')).map(f => ({ ...f, readable: !hidden(f), writable: writable(e, f), writeOnly: hidden(f) }))
    }));
  }
  present(e: Entity, row: Record<string, unknown>) {
    return { ...Object.fromEntries(e.fields.filter(f => !hidden(f)).map(f => [f.name, row[f.name]])), _revision: revision(row) };
  }
  owner(e: Entity, req: AuthRequest) {
    if (!access(e, req.actor.roles).ownerOnly) return undefined;
    return e.fields.find(f => ['userId','authorId'].includes(f.name))?.name;
  }
  filters(e: Entity, req: AuthRequest, query: Record<string, unknown>) {
    const allowed = new Set(['page','size','q','filters','sort','direction']);
    if (Object.keys(query).some(k => !allowed.has(k))) throw new BadRequestException('未知查询参数');
    const args: unknown[] = [], where: string[] = [];
    const bind = (value: unknown) => { args.push(value); return '$' + args.length; };
    const owner = this.owner(e, req);
    if (owner) where.push(`${quote(owner)}=${bind(req.actor.id)}`);
    if (query.q !== undefined) {
      if (typeof query.q !== 'string' || query.q.length > 100) throw new BadRequestException('搜索关键词过长');
      const names = e.fields.filter(f => !hidden(f) && ['title','name','code','nickname','orderNo','description'].includes(f.name));
      if (names.length) { const param = bind('%' + query.q.replaceAll('\\', '\\\\').replaceAll('%','\\%').replaceAll('_','\\_') + '%'); where.push('(' + names.map(f => `${quote(f.name)} ILIKE ${param}`).join(' OR ') + ')'); }
    }
    if (query.filters !== undefined) {
      let filter: Record<string, unknown>;
      try { filter = object(JSON.parse(String(query.filters))); } catch { throw new BadRequestException('筛选条件不是 JSON 对象'); }
      if (Object.keys(filter).length > 8) throw new BadRequestException('筛选条件最多 8 个');
      for (const [name, value] of Object.entries(filter)) {
        const field = e.fields.find(f => f.name === name && !hidden(f));
        if (!field) throw new BadRequestException('不支持该筛选字段');
        where.push(value === null ? `${quote(name)} IS NULL` : `${quote(name)}=${bind(this.value(field, value))}`);
      }
    }
    return { args, clause: where.length ? ' WHERE ' + where.join(' AND ') : '' };
  }
  async list(req: AuthRequest, key: string, query: Record<string, unknown>) {
    const e = this.entity(key, req), page = bounded(query.page, 1, 10000), size = bounded(query.size, 20, 50);
    const { args, clause } = this.filters(e, req, query);
    const sort = typeof query.sort === 'string' ? e.fields.find(f => f.name === query.sort && !hidden(f)) : e.fields.find(f => f.name === 'createdAt');
    if (query.sort && !sort || query.direction && !['asc','desc'].includes(String(query.direction))) throw new BadRequestException('排序参数不合法');
    const order = `${quote(sort?.name ?? 'id')} ${query.direction === 'asc' ? 'ASC' : 'DESC'}${sort?.name === 'id' ? '' : ',id DESC'}`;
    // Repeatable read keeps total and rows from the same snapshot.
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const total = await client.query(`SELECT count(*)::integer AS total FROM ${quote(e.table)}${clause}`, args);
      const rows = await client.query(`SELECT * FROM ${quote(e.table)}${clause} ORDER BY ${order} LIMIT $${args.length+1} OFFSET $${args.length+2}`, [...args,size,(page-1)*size]);
      await client.query('COMMIT');
      return { items: rows.rows.map(row => this.present(e, row)), total: total.rows[0].total, page, size };
    } catch (error) { await client.query('ROLLBACK'); throw this.databaseError(error); } finally { client.release(); }
  }
  async load(client: PoolClient, e: Entity, req: AuthRequest, id: string, lock = false) {
    if (!/^[a-zA-Z0-9_-]{1,150}$/.test(id)) throw new BadRequestException('数据标识不合法');
    const owner = this.owner(e, req);
    const result = await client.query(`SELECT * FROM ${quote(e.table)} WHERE id=$1${owner ? ' AND ' + quote(owner) + '=$2' : ''}${lock ? ' FOR UPDATE' : ''}`, owner ? [id,req.actor.id] : [id]);
    if (!result.rows[0]) throw new NotFoundException('记录不存在或不可访问');
    return result.rows[0] as Record<string, unknown>;
  }
  async detail(req: AuthRequest, key: string, id: string) {
    const e = this.entity(key, req), client = await this.pool.connect();
    try { return this.present(e, await this.load(client,e,req,id)); } finally { client.release(); }
  }
  value(f: Field, value: unknown): unknown {
    if (value === null) { if (!f.nullable) throw new BadRequestException(`${f.name} 不能为空`); return null; }
    if (f.choices.length && !(f.choices as string[]).includes(String(value))) throw new BadRequestException(`${f.name} 选项不合法`);
    if (f.type === 'integer') { if (!Number.isInteger(value) || Number(value) < -2147483648 || Number(value) > 2147483647) throw new BadRequestException(`${f.name} 需要整数`); }
    else if (f.type === 'bigint') {
      if (!(typeof value === 'string' && /^-?\d{1,19}$/.test(value)) && !(typeof value === 'number' && Number.isSafeInteger(value))) throw new BadRequestException(`${f.name} 需要整数或整数字符串`);
      if (BigInt(value as string) < -(2n**63n) || BigInt(value as string) >= 2n**63n) throw new BadRequestException(`${f.name} 超出范围`);
      return String(value);
    }
    else if (f.type === 'boolean') { if (typeof value !== 'boolean') throw new BadRequestException(`${f.name} 需要布尔值`); }
    else if (f.type === 'jsonb') { if (JSON.stringify(value).length > 100000) throw new BadRequestException(`${f.name} JSON 过大`); return JSON.stringify(value); }
    else if (f.type === 'text[]') { if (!Array.isArray(value) || value.length > 100 || value.some(v => typeof v !== 'string' || v.length > 500)) throw new BadRequestException(`${f.name} 需要字符串数组`); }
    else if (f.type === 'timestamptz' || f.type === 'date') {
      if (typeof value !== 'string' || !(f.type === 'date' ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/).test(value) || !Number.isFinite(Date.parse(value)) || f.type === 'date' && new Date(value).toISOString().slice(0,10) !== value) throw new BadRequestException(`${f.name} 日期格式不合法（时间必须带时区）`);
    }
    else if (typeof value !== 'string' || value.length > 20000 || value.includes('\0') || f.type === 'char(3)' && !/^[A-Z]{3}$/.test(value)) throw new BadRequestException(`${f.name} 文本格式不合法`);
    if (f.reference && (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,150}$/.test(value))) throw new BadRequestException(`${f.name} 外键标识不合法`);
    return value;
  }
  encrypt(value: string) {
    if (!this.encryptionKey) {
      const configured = process.env.DOMAIN_ENCRYPTION_KEY;
      if (configured) {
        if (!/^[a-fA-F0-9]{64}$/.test(configured)) throw new Error('DOMAIN_ENCRYPTION_KEY must be a 32-byte hex key');
        this.encryptionKey = Buffer.from(configured,'hex');
      } else {
        if (process.env.NODE_ENV === 'production') throw new Error('Production requires DOMAIN_ENCRYPTION_KEY');
        const path = resolve('../../.runtime/domain-encryption.key'); mkdirSync(dirname(path),{ recursive:true });
        if (!existsSync(path)) writeFileSync(path,randomBytes(32),{ flag:'wx',mode:0o600 });
        this.encryptionKey = readFileSync(path);
        if (this.encryptionKey.length !== 32) throw new Error('Invalid local domain encryption key');
      }
    }
    const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',this.encryptionKey,iv);
    const body=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
    return `v1:${iv.toString('hex')}:${body.toString('base64')}:${cipher.getAuthTag().toString('hex')}`;
  }
  data(req: AuthRequest, e: Entity, input: unknown, create: boolean) {
    const raw = object(input), data: Record<string, unknown> = {};
    if (Object.keys(raw).length > e.fields.length+1) throw new BadRequestException('字段过多');
    for (const [name, value] of Object.entries(raw)) {
      if (name === 'resourceTitle' && resourceKinds[e.key]) { if (typeof value !== 'string' || value.trim().length < 1 || value.length > 120) throw new BadRequestException('标题需要 1—120 字'); data[name]=value; continue; }
      const f = e.fields.find(item => item.name === name);
      if (!f || !writable(e,f)) throw new BadRequestException(`${name} 字段不可写`);
      data[name] = this.value(f,value);
      if (f.name.endsWith('Cipher') && value !== null) data[name]=this.encrypt(String(value));
      if (['status','reviewState','state'].includes(name) && ['PUBLISHED','APPROVED','VERIFIED'].includes(String(value)) && !req.actor.roles.some(r=>['ADMIN','MODERATOR'].includes(r))) throw new ForbiddenException('审核发布需要审核角色');
    }
    const owner = this.owner(e,req);
    if (owner) data[owner]=req.actor.id;
    if (create) for (const name of ['authorId','reporterId','reviewerId']) {
      const field=e.fields.find(f=>f.name===name);
      if (field && !field.nullable) data[name]=req.actor.id;
    }
    if(create&&e.key==='teacher_review')data.reviewedAt=new Date().toISOString();
    if(create&&e.key==='submission')data.submittedAt=new Date().toISOString();
    if(e.key==='article'&&data.blocks!==undefined){
      const blocks=JSON.parse(String(data.blocks));
      if(!Array.isArray(blocks)||blocks.length<1||blocks.length>100||blocks.some(b=>!b||typeof b.id!=='string'||! /^[a-zA-Z0-9_-]{1,80}$/.test(b.id)||!['paragraph','quote'].includes(b.type)||typeof b.text!=='string'||b.text.length<1||b.text.length>10000)||new Set(blocks.map(b=>b.id)).size!==blocks.length)throw new BadRequestException('文章段落格式不合法');
    }
    if(['teacher_answer','feedback_reply','comment','forum_thread'].includes(e.key)&&data.authorId!==undefined&&data.authorId!==req.actor.id)throw new ForbiddenException('不能以其他用户身份写入内容');
    if (create) {
      for (const f of e.fields.filter(f => !f.nullable && !f.default && f.name !== 'id')) {
        if (data[f.name] === undefined) throw new BadRequestException(`缺少必填字段 ${f.name}`);
      }
      if (resourceKinds[e.key] && !data.title && !data.name && !data.resourceTitle) throw new BadRequestException('需要资源标题');
    }
    if (e.key==='article' || e.key==='course' || e.key==='product' || e.key==='teacher' || e.key==='event') {
      if (data.status !== undefined && data.status !== 'DRAFT') throw new BadRequestException('内容状态请使用原有审核发布流程');
    }
    return data;
  }
  async foreignOwners(client: PoolClient, req: AuthRequest, e: Entity, data: Record<string, unknown>) {
    for (const f of e.fields) {
      if (!f.reference || data[f.name] == null) continue;
      const ref=domains.find(x=>x.key===f.reference!.entity)!;
      if (access(ref,req.actor.roles).ownerOnly) await this.load(client,ref,req,String(data[f.name]));
    }
  }
  async mutate(req: AuthRequest, key: string, input: unknown, id?: string, remove = false) {
    const e=this.entity(key,req,remove?'delete':id?'update':'create'), body=object(input);
    if (Object.keys(body).some(k=>!['data','reason','expectedRevision'].includes(k))) throw new BadRequestException('未知请求字段');
    if (typeof body.reason !== 'string' || body.reason.trim().length < 2 || body.reason.length > 500) throw new BadRequestException('请填写 2—500 字操作原因');
    const data=remove?{}:this.data(req,e,body.data,!id);
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN');
      let old: Record<string,unknown> | undefined;
      if (id) {
        old=await this.load(client,e,req,id,true);
        if (body.expectedRevision!==revision(old)) throw new ConflictException('记录已变化，请重新加载后操作');
        if (resourceKinds[e.key] && old.status && !['DRAFT','REJECTED','ARCHIVED'].includes(String(old.status))) throw new ConflictException('当前内容需通过原有流程下架或修订');
        if (e.key==='app_user' && data.status !== undefined && (old.roles as string[]).includes('ADMIN')) throw new ForbiddenException('管理员冻结或注销需使用账号管理流程');
        if(e.key==='sale_offer'&&id.startsWith('sku-offer-'))throw new ConflictException('该销售项由商品规格同步，请在商品规格中修改或删除');
      }
      await this.foreignOwners(client,req,e,data);
      const title=data.resourceTitle; delete data.resourceTitle;
      let row: Record<string,unknown>;
      if (remove) {
        // Auto-generated draft offers and snapshots may be removed only when their FKs permit it.
        if(e.key==='product_sku')await client.query('DELETE FROM "SaleOffer" WHERE id=$1',['sku-offer-'+id]);
        if(e.key==='membership_plan'){
          await client.query('UPDATE "MembershipPlan" SET "currentVersionId"=NULL WHERE id=$1',[id]);
          await client.query('DELETE FROM "MembershipPlanVersion" WHERE "planId"=$1',[id]);
        }
        row=(await client.query(`DELETE FROM ${quote(e.table)} WHERE id=$1 RETURNING *`,[id])).rows[0];
      }
      else if (id) {
        const names=Object.keys(data);
        if (!names.length && !title) throw new BadRequestException('没有需要修改的字段');
        const sets=names.map((k,i)=>`${quote(k)}=$${i+1}`);
        if (e.fields.some(f=>f.name==='updatedAt')) sets.push('"updatedAt"=now()');
        if (e.versioned) sets.push('version=version+1');
        if (title) await client.query('UPDATE "Resource" SET title=$1,"updatedAt"=now(),version=version+1 WHERE id=$2',[title,id]);
        row=sets.length?(await client.query(`UPDATE ${quote(e.table)} SET ${sets.join(',')} WHERE id=$${names.length+1} RETURNING *`,[...names.map(k=>data[k]),id])).rows[0]:old!;
      } else {
        id=randomUUID();
        if (resourceKinds[e.key]) await client.query('INSERT INTO "Resource" (id,kind,title,"categoryCode") VALUES ($1,$2,$3,$4)',[id,resourceKinds[e.key],title??data.title??data.name,data.categoryCode??data.category??'']);
        // Existing Prisma @updatedAt columns have no PostgreSQL DEFAULT.
        for (const field of e.fields.filter(f=>['createdAt','updatedAt'].includes(f.name))) data[field.name]=new Date();
        const names=['id',...Object.keys(data)];
        row=(await client.query(`INSERT INTO ${quote(e.table)} (${names.map(quote).join(',')}) VALUES (${names.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING *`,[id,...Object.values(data)])).rows[0];
      }
      await client.query('INSERT INTO "AuditLog"(id,"actorId",action,resource,"resourceId",changes,"resourceType","resourceKey","requestId",reason,"beforeSnapshot","afterSnapshot") VALUES ($1,$2,$3,$4,$5,$6,$4,$5,$7,$8,$9,$10)',[randomUUID(),req.actor.id,`data.${remove?'delete':old?'update':'create'}`,e.key,id,JSON.stringify({fields:Object.keys(data)}),randomUUID(),body.reason,JSON.stringify(old?{revision:revision(old)}:{}),JSON.stringify(remove?{}:{revision:revision(row)})]);
      await client.query('COMMIT');
      return remove?{success:true}:this.present(e,row);
    } catch(error) { await client.query('ROLLBACK'); throw this.databaseError(error); } finally { client.release(); }
  }
  databaseError(error: unknown) {
    const code=(error as {code?:string}).code;
    if (code==='23503') return new ConflictException('引用的记录不存在，或该记录仍被其他业务引用');
    if (code==='23505') return new ConflictException('唯一字段重复，请检查编码或关联组合');
    if (code==='23P01') return new ConflictException('时段与已有记录重叠');
    if (['23514','23502','22P02','22007','22008','22003','22001'].includes(code??'')) return new BadRequestException('字段值不满足数据约束，请检查必填、范围和业务状态');
    if (code) return new ConflictException('数据库未完成操作，请重试');
    return error;
  }
  async roleAction(req: AuthRequest, input: unknown, revokeId?:string) {
    if(!req.actor.roles.includes('ADMIN')) throw new ForbiddenException('只有管理员可变更角色');
    const body=object(input);
    if(Object.keys(body).some(k=>!(revokeId?['reason','expectedRevision']:['userId','role','reason']).includes(k)))throw new BadRequestException('未知请求字段');
    if(typeof body.reason!=='string'||body.reason.trim().length<2||body.reason.length>500)throw new BadRequestException('请填写操作原因');
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(761029001)');
      const actor=await client.query('SELECT id FROM "User" WHERE id=$1 AND status=\'ACTIVE\' AND \'ADMIN\'=ANY(roles)',[req.actor.id]);
      if(!actor.rowCount)throw new ForbiddenException('管理员角色已变化');
      let targetId:string, role:string, recordId:string, previous:Record<string,unknown>|undefined;
      if(revokeId){
        previous=await this.load(client,this.entity('user_role',req),req,revokeId,true);
        if(body.expectedRevision!==revision(previous))throw new ConflictException('授权记录已变化，请重新加载');
        targetId=String(previous.userId);recordId=revokeId;
        role=(await client.query('SELECT code FROM "AccessRole" WHERE id=$1',[previous.roleId])).rows[0].code;
      }else{
        if(typeof body.userId!=='string'||typeof body.role!=='string'||!['TEACHER','OPERATOR','MODERATOR','SUPPORT','FINANCE','ADMIN'].includes(body.role))throw new BadRequestException('请选择有效用户与管理角色');
        targetId=body.userId;role=body.role;recordId=randomUUID();
      }
      if(targetId===req.actor.id)throw new ForbiddenException('不能变更自己的管理角色');
      const target=await client.query('SELECT roles,status FROM "User" WHERE id=$1 FOR UPDATE',[targetId]);
      if(!target.rowCount||target.rows[0].status!=='ACTIVE')throw new BadRequestException('目标账号不可用');
      if(revokeId){
        if(previous!.revokedAt)throw new ConflictException('该授权已撤销');
        const administrators=role==='ADMIN'?(await client.query('SELECT id FROM "User" WHERE status=\'ACTIVE\' AND \'ADMIN\'=ANY(roles)')).rowCount:undefined;
        if(administrators!==undefined&&administrators!==null&&administrators<=1)throw new ConflictException('不能撤销最后一名有效管理员');
        await client.query('UPDATE "UserRole" SET "revokedAt"=now(),"updatedAt"=now(),version=version+1 WHERE id=$1',[recordId]);
      }else{
        const roleId=(await client.query('SELECT id FROM "AccessRole" WHERE code=$1 AND active=true',[role])).rows[0]?.id;
        if(!roleId)throw new BadRequestException('该角色未启用');
        if((target.rows[0].roles as string[]).includes(role))throw new ConflictException('用户已拥有该角色');
        await client.query('INSERT INTO "UserRole"(id,"userId","roleId","grantedBy",reason) VALUES($1,$2,$3,$4,$5)',[recordId,targetId,roleId,req.actor.id,body.reason]);
      }
      await client.query('INSERT INTO "AuditLog"(id,"actorId",action,resource,"resourceId",changes,reason) VALUES($1,$2,$3,\'user_role\',$4,$5,$6)',[randomUUID(),req.actor.id,revokeId?'role.revoke':'role.grant',recordId,JSON.stringify({userId:targetId,role}),body.reason]);
      await client.query('COMMIT'); return {success:true,id:recordId};
    }catch(error){await client.query('ROLLBACK');throw this.databaseError(error);}finally{client.release();}
  }
}

@Controller('admin/data') @UseGuards(AdminGuard)
export class DomainController {
  constructor(private readonly service: DomainService) {}
  @Get('schema') schema(@Req() req: AuthRequest) { return this.service.schema(req); }
  @Post('roles/grant') grantRole(@Req() req:AuthRequest,@Body() body:unknown){return this.service.roleAction(req,body);}
  @Post('roles/:id/revoke') revokeRole(@Req() req:AuthRequest,@Param('id') id:string,@Body() body:unknown){return this.service.roleAction(req,body,id);}
  @Get(':entity') list(@Req() req: AuthRequest,@Param('entity') entity:string,@Query() query:Record<string,unknown>) { return this.service.list(req,entity,query); }
  @Get(':entity/:id') detail(@Req() req: AuthRequest,@Param('entity') entity:string,@Param('id') id:string) { return this.service.detail(req,entity,id); }
  @Post(':entity') create(@Req() req: AuthRequest,@Param('entity') entity:string,@Body() body:unknown) { return this.service.mutate(req,entity,body); }
  @Patch(':entity/:id') update(@Req() req: AuthRequest,@Param('entity') entity:string,@Param('id') id:string,@Body() body:unknown) { return this.service.mutate(req,entity,body,id); }
  @Delete(':entity/:id') delete(@Req() req: AuthRequest,@Param('entity') entity:string,@Param('id') id:string,@Body() body:unknown) { return this.service.mutate(req,entity,body,id,true); }
}
