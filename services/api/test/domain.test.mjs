import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {createApp} from '../dist/main.js';
import {Database} from '../dist/database.js';
import {passwordHash} from '../dist/auth.js';
import {domains,access,writable} from '../dist/domain-policy.js';

const dbUrl=new URL(process.env.DATABASE_URL??'');
if(process.env.NODE_ENV==='production'||!['127.0.0.1','localhost'].includes(dbUrl.hostname))throw new Error('Domain fixtures require a local development database');
const q=name=>'"'+name+'"';

test('all domain tables and every editable entity use real database CRUD',async t=>{
  process.env.CORS_ORIGINS='http://127.0.0.1:5173';
  const db=new Database(),pool=new Pool({connectionString:process.env.DATABASE_URL,options:'-c timezone=UTC'}),app=await createApp(false);
  await app.listen(0,'127.0.0.1');const base=await app.getUrl();
  const tag='qa-domain-'+randomUUID(),password=randomUUID()+'!A',rows=[],cache=new Map();
  let clock=0;
  const when=(seconds=0)=>new Date(Date.UTC(2027,0,1)+seconds*1000+(++clock)*60000).toISOString();
  const root=await db.user.create({data:{username:tag,nickname:tag,roles:['ADMIN'],passwordHash:await passwordHash(password)}});
  const other=await db.user.create({data:{nickname:tag+'-other',roles:['USER']}});
  rows.push(['app_user',root.id],['app_user',other.id]);cache.set('app_user',{id:root.id});
  async function call(path,method='GET',body,session=auth,headers={}){
    const result=await fetch(base+'/api/v1'+path,{method,headers:{'Content-Type':'application/json',Origin:process.env.CORS_ORIGINS,...(session?{Cookie:session.cookie,'X-CSRF-Token':session.csrfToken}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
    return{status:result.status,body:await result.json(),cookies:result.headers.getSetCookie()};
  }
  let auth;
  const login=await call('/admin/auth/login','POST',{username:root.username,password},null);
  assert.equal(login.status,200);auth={cookie:login.cookies.map(x=>x.split(';')[0]).join('; '),csrfToken:login.body.csrfToken};

  async function sample(f){
    if(f.reference)return(await fixture(f.reference.entity)).id;
    if(f.choices.length)return f.choices[0];
    if(f.type==='boolean')return false;
    if(f.type==='integer')return f.name==='days'?30:f.name==='tier'?3:10;
    if(f.type==='bigint')return'100';
    if(f.type==='jsonb')return{};
    if(f.type==='text[]')return['测试'];
    if(f.type==='char(3)')return'CNY';
    if(f.type==='date')return'2027-01-01';
    if(f.type==='timestamptz')return when();
    if(f.name==='day')return'2027-01-01';
    if(f.name==='cover')return'/static/art/books.svg';
    return tag+'-'+f.name+'-'+randomUUID().slice(0,8);
  }
  async function payload(e,raw=false){
    const data={};
    for(const f of e.fields.filter(f=>!f.nullable&&!f.default&&f.name!=='id'&&(raw||writable(e,f))))data[f.name]=await sample(f);
    switch(e.key){
      case 'resource': Object.assign(data,{kind:'ARTICLE',title:tag,summary:'fixture',publishState:'DRAFT',visibility:'PUBLIC'});break;
      case 'article':data.blocks=[{id:'p1',type:'paragraph',text:'测试正文'}];break;
      case 'media_asset': Object.assign(data,{status:'READY',visibility:'PRIVATE',sha256:'a'.repeat(64),mime:'image/png'});break;
      case 'course_release':data.version=1;break;
      case 'teacher_review':data.submissionId=(await fixture('submission')).id;if(raw)Object.assign(data,{reviewerId:root.id,reviewedAt:when()});break;
      case 'submission':if(raw)data.submittedAt=when();break;
      case 'forum_section':Object.assign(data,{scope:'PUBLIC',courseId:null});break;
      case 'forum_thread':Object.assign(data,{resourceTitle:tag,blocks:[{type:'paragraph',text:'测试帖子'}]});break;
      case 'live_room':Object.assign(data,{resourceTitle:tag});break;
      case 'report':data.resourceId=(await fixture('resource')).id;break;
      case 'content_relation':data.toId=(await fixture('article')).id;break;
      case 'user_block':data.blockedId=other.id;break;
      case 'sale_offer':Object.assign(data,{kind:'PHYSICAL',skuId:(await fixture('product_sku')).id});break;
      case 'points_reward':data.offerId=(await fixture('sale_offer')).id;break;
      case 'attachment_binding':data.resourceId=(await fixture('resource')).id;break;
      case 'reaction':data.resourceId=(await fixture('article')).id;break;
      case 'appointment_slot': {const offering=await fixture('service_offering');data.teacherId=offering.teacherId;break;}
    }
    if(data.startsAt)data.endsAt=new Date(Date.parse(data.startsAt)+86400000).toISOString();
    if(data.enrollDeadline)data.enrollDeadline=new Date(Date.parse(data.startsAt)-86400000).toISOString();
    if(data.publicOpenAt)data.publicOpenAt=new Date(Date.parse(data.startsAt)-86400000).toISOString();
    if(data.cancelDeadline)data.cancelDeadline=new Date(Date.parse(data.startsAt)-3600000).toISOString();
    return data;
  }
  async function fixture(key){
    if(cache.has(key))return cache.get(key);
    const e=domains.find(e=>e.key===key),data=await payload(e,true),id=randomUUID();
    delete data.resourceTitle;
    for(const f of e.fields.filter(f=>['createdAt','updatedAt'].includes(f.name)))data[f.name]=new Date();
    const names=['id',...Object.keys(data)],values=[id,...Object.entries(data).map(([k,v])=>e.fields.find(f=>f.name===k)?.type==='jsonb'?JSON.stringify(v):v)];
    const result=await pool.query(`INSERT INTO ${q(e.table)} (${names.map(q).join(',')}) VALUES (${names.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING *`,values);
    const row=result.rows[0];rows.push([key,id]);cache.set(key,row);return row;
  }
  async function removeFixtures(){
    await db.auditLog.deleteMany({where:{actorId:root.id}});
    await db.authSession.deleteMany({where:{userId:root.id}});
    let pending=[...rows].reverse();
    for(let round=0;pending.length&&round<rows.length+1;round++){
      const next=[];
      for(const[key,id]of pending){
        const e=domains.find(e=>e.key===key),client=await pool.connect();
        try{
          await client.query('BEGIN');
          if(key==='membership_plan'){await client.query('UPDATE "MembershipPlan" SET "currentVersionId"=NULL WHERE id=$1',[id]);await client.query('DELETE FROM "MembershipPlanVersion" WHERE "planId"=$1',[id]);}
          if(key==='product_sku')await client.query('DELETE FROM "SaleOffer" WHERE id=$1',['sku-offer-'+id]);
          if(key==='course')await client.query('UPDATE "Course" SET "publishedReleaseId"=NULL WHERE id=$1',[id]);
          await client.query(`DELETE FROM ${q(e.table)} WHERE id=$1`,[id]);await client.query('COMMIT');
        }catch(error){await client.query('ROLLBACK');if(error.code!=='23503')throw error;next.push([key,id]);}finally{client.release();}
      }
      if(next.length===pending.length)throw new Error('Fixture cleanup cannot resolve references: '+next.map(x=>x[0]).join(','));
      pending=next;
    }
    await db.rateLimit.deleteMany({where:{key:{contains:tag}}});
  }
  try{
    await t.test('metadata and all 144 list endpoints match actual tables; secrets are absent',async()=>{
      const schema=await call('/admin/data/schema');assert.equal(schema.status,200);assert.equal(schema.body.length,144);
      for(const e of domains){
        const columns=(await pool.query('SELECT column_name FROM information_schema.columns WHERE table_schema=\'public\' AND table_name=$1',[e.table])).rows.map(r=>r.column_name);
        assert.ok(e.fields.every(f=>columns.includes(f.name)),e.key+' metadata must match DB columns');
        const result=await call('/admin/data/'+e.key);assert.equal(result.status,200,e.key);
        for(const row of result.body.items){assert.equal(Object.keys(row).some(k=>/Cipher$|Hash$|Secret|Token|StorageRef$/.test(k)),false,e.key);}
      }
      assert.equal((await call('/admin/data/tag','GET',undefined,null)).status,401);
      assert.equal((await call('/admin/data/tag?sort=passwordHash')).status,400);
      assert.equal((await call('/admin/data/tag?size=500')).status,400);
      assert.equal((await call('/admin/data/auth_session?filters='+encodeURIComponent(JSON.stringify({accessHash:'secret'})))).status,400);
    });
    for(const e of domains.filter(e=>access(e,['ADMIN']).create)){
      await t.test(e.key+': create, list, detail, update, stale revision, delete',async()=>{
        const data=await payload(e),created=await call('/admin/data/'+e.key,'POST',{data,reason:'逐表 CRUD 测试'});
        assert.equal(created.status,201,e.key+': '+JSON.stringify(created.body));rows.push([e.key,created.body.id]);
        const detail=await call(`/admin/data/${e.key}/${created.body.id}`);assert.equal(detail.status,200);
        assert.ok((await call('/admin/data/'+e.key+'?filters='+encodeURIComponent(JSON.stringify({id:created.body.id})))).body.items.some(x=>x.id===created.body.id));
        let edit={};
        const field=e.fields.find(f=>writable(e,f)&&!f.reference&&['title','name','text','body','description','label','question','caption','purpose','providerRoomId'].includes(f.name));
        if(field)edit[field.name]=String(created.body[field.name]??'测试')+' 已更新';
        else if(e.key==='user_tag'||e.key==='resource_tag'){
          const replacement=await db.tag.create({data:{code:randomUUID(),name:'替代标签'}});rows.push(['tag',replacement.id]);edit.tagId=replacement.id;
        }else if(e.key==='forum_thread')edit.resourceTitle=tag+' 主题更新';
        else if(e.key==='reaction')edit.kind='FAVORITE';
        else if(e.key==='user_block')edit.blockedId=(await fixture('teacher')).userId??(await db.user.create({data:{nickname:tag+'第三用户'}})).id,rows.push(['app_user',edit.blockedId]);
        else if(e.key==='appointment_slot')Object.assign(edit,{startsAt:new Date(Date.parse(created.body.startsAt)+172800000).toISOString(),endsAt:new Date(Date.parse(created.body.endsAt)+172800000).toISOString()});
        else if(e.key==='live_reservation')edit.cancelledAt=when();
        else if(e.key==='course_staff')edit.role='ASSISTANT';
        else if(e.key==='teacher_staff'||e.key==='event_staff')edit.scopeCodes=['VIEW'];
        else if(e.key==='promotion_offer')edit.perUserLimit=2;
        else if(e.key==='content_relation')edit.rank=2;
        else if(e.key==='delivery_zone')edit.baseFee='200';
        else if(e.key==='event_session')edit.location='活动地点更新';
        else if(e.key==='ad_campaign')edit.state='DRAFT';
        else if(e.key==='sale_offer'||e.key==='channel_product_mapping')edit.price=undefined,edit=e.key==='sale_offer'?{price:'200'}:{externalProductId:randomUUID()};
        else if(e.key==='cart_item')edit.quantity=2;
        else if(e.key==='live_replay')edit.reviewState='REVIEW';
        else throw new Error('No meaningful update fixture for '+e.key);
        const changed=await call(`/admin/data/${e.key}/${created.body.id}`,'PATCH',{data:edit,reason:'更新验证',expectedRevision:detail.body._revision});
        assert.equal(changed.status,200,e.key+': '+JSON.stringify(changed.body));
        const latest=await call(`/admin/data/${e.key}/${created.body.id}`);assert.equal(latest.status,200);assert.notEqual(latest.body._revision,detail.body._revision);
        for(const[k,v]of Object.entries(edit))assert.deepEqual(k==='resourceTitle'?(await db.resource.findUnique({where:{id:created.body.id}})).title:latest.body[k],v,e.key+'.'+k);
        if(e.key==='reaction'){
          assert.equal(await db.favorite.count({where:{userId:root.id,articleId:data.resourceId}}),1);
          assert.equal((await call(`/admin/data/${e.key}/${created.body.id}`,'PATCH',{data:{kind:'FAVORITE'},reason:'幂等收藏编辑',expectedRevision:latest.body._revision})).status,200);
          assert.equal(await db.reaction.count({where:{id:created.body.id}}),1);
        }
        assert.equal((await call(`/admin/data/${e.key}/${created.body.id}`,'PATCH',{data:edit,reason:'过期版本',expectedRevision:detail.body._revision})).status,409);
        const deleted=await call(`/admin/data/${e.key}/${created.body.id}`,'DELETE',{reason:'清理 CRUD 测试',expectedRevision:latest.body._revision});assert.equal(deleted.status,200,e.key+': '+JSON.stringify(deleted.body));
        assert.equal((await call(`/admin/data/${e.key}/${created.body.id}`)).status,404);
      });
    }
    await t.test('permissions, ownership, FK, checks, transactions and immutable facts fail closed',async()=>{
      const operator=await db.user.create({data:{username:tag+'-operator',nickname:tag,roles:['OPERATOR'],passwordHash:await passwordHash(password)}});rows.push(['app_user',operator.id]);
      const signed=await call('/admin/auth/login','POST',{username:operator.username,password},null);
      const op={cookie:signed.cookies.map(x=>x.split(';')[0]).join('; '),csrfToken:signed.body.csrfToken};
      assert.equal((await call('/admin/data/app_user','GET',undefined,op)).status,403);
      assert.equal((await call('/admin/data/payment_transaction','POST',{data:{},reason:'不能伪造交易'})).status,403);
      assert.equal((await call('/admin/data/tag','POST',{data:{code:randomUUID(),name:'bad',roles:['ADMIN']},reason:'字段白名单'})).status,400);
      assert.equal((await call('/admin/data/tag','POST',{data:{code:randomUUID(),name:'bad'},reason:'CSRF 检查'},auth,{'X-CSRF-Token':''})).status,403);
      assert.equal((await call('/admin/data/resource_tag','POST',{data:{resourceId:randomUUID(),tagId:(await fixture('tag')).id},reason:'无效外键'})).status,409);
      assert.equal((await call('/admin/data/service_offering','POST',{data:{...await payload(domains.find(e=>e.key==='service_offering')),durationMinutes:0},reason:'约束校验'})).status,400);
      const privateLog=await db.practiceLog.create({data:{userId:other.id,day:'2027-02-02',text:'PRIVATE_SENTINEL'}});rows.push(['practice_log',privateLog.id]);
      assert.equal((await call('/admin/data/practice_log/'+privateLog.id)).status,404);
      assert.equal(JSON.stringify((await call('/admin/data/practice_log')).body).includes('PRIVATE_SENTINEL'),false);
      const snapshots=await db.membershipPlan.create({data:{title:tag,tier:2,days:90,price:100,description:'旧权益'}});rows.push(['membership_plan',snapshots.id]);
      const firstVersion=await db.membershipPlanVersion.findFirst({where:{planId:snapshots.id}});
      await db.membershipPlan.update({where:{id:snapshots.id},data:{price:200,description:'新权益'}});
      assert.equal((await db.membershipPlanVersion.findUnique({where:{id:firstVersion.id}})).description,'旧权益');
      assert.equal(await db.membershipPlanVersion.count({where:{planId:snapshots.id}}),2);
      assert.equal((await call('/admin/data/feedback','POST',{data:{userId:root.id,kind:'TEST',body:'反馈',state:'OPEN',contactCipher:'PRIVATE_CIPHER_SENTINEL'},reason:'加密测试'})).status,201);
      const feedback=(await db.feedback.findFirst({where:{contactCipher:{startsWith:'v1:'},userId:root.id}}));rows.push(['feedback',feedback.id]);
      assert.equal(feedback.contactCipher.includes('PRIVATE_CIPHER_SENTINEL'),false);
      assert.equal(JSON.stringify((await call('/admin/data/feedback/'+feedback.id)).body).includes('PRIVATE_CIPHER_SENTINEL'),false);
      await db.authSession.deleteMany({where:{userId:operator.id}});
    });
    await t.test('role grant/revoke uses the same authorization and audit transaction',async()=>{
      assert.equal((await call('/admin/data/roles/grant','POST',{userId:root.id,role:'OPERATOR',reason:'自改角色拒绝'})).status,403);
      const grant=await call('/admin/data/roles/grant','POST',{userId:other.id,role:'MODERATOR',reason:'审核岗位授权'});assert.equal(grant.status,201);rows.push(['user_role',grant.body.id]);
      assert.ok((await db.user.findUnique({where:{id:other.id}})).roles.includes('MODERATOR'));
      const row=await call('/admin/data/user_role/'+grant.body.id);
      assert.equal((await call('/admin/data/roles/'+grant.body.id+'/revoke','POST',{reason:'撤销测试角色',expectedRevision:row.body._revision})).status,201);
      assert.equal((await db.user.findUnique({where:{id:other.id}})).roles.includes('MODERATOR'),false);
      assert.equal((await db.auditLog.count({where:{actorId:root.id,action:{in:['role.grant','role.revoke']}}})),2);
    });
  }finally{
    try{await removeFixtures();}finally{await app.close();await pool.end();await db.$disconnect();}
  }
});
