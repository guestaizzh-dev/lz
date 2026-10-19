import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApp} from '../dist/main.js';
import {Database} from '../dist/database.js';
import {AuthService} from '../dist/auth.js';
import {uploadName} from '../dist/upload-name.js';

test('multipart filenames preserve Chinese, accented names and safe display text',()=>{
  for(const name of ['授权原件.pdf','lesson.mp4','café.png','静心😀.jpg'])assert.equal(uploadName(Buffer.from(name).toString('latin1')),name);
  assert.equal(uploadName('café.png'),'café.png');assert.equal(uploadName('授权原件.pdf'),'授权原件.pdf');assert.equal(uploadName('C:\\folder\\授权\u0000.pdf'),'授权.pdf');
});

test('evidence operations: controlled originals, manual review, validity and publication',async t=>{
  const db=new Database(),app=await createApp(false);await app.listen(0,'127.0.0.1');const base=(await app.getUrl())+'/api/v1',auth=app.get(AuthService);
  async function actor(role,kind='ADMIN'){
    const user=await db.user.create({data:{nickname:randomUUID(),roles:[role]}}),c=auth.credentials(),csrfToken=randomUUID();await db.authSession.create({data:{userId:user.id,kind,accessHash:c.accessHash,refreshHash:c.refreshHash,accessExpiresAt:c.accessExpiresAt,expiresAt:new Date(Date.now()+86400000),csrfToken}});
    return {id:user.id,...(kind==='APP'?{Authorization:'Bearer '+c.access}:{Cookie:'daoxue_access='+c.access,'X-CSRF-Token':csrfToken})};
  }
  async function call(path,who,method='GET',data){const multipart=data instanceof FormData,headers={Origin:'http://127.0.0.1:5173',...(!multipart?{'Content-Type':'application/json'}:{}),...(who??{})};delete headers.id;const r=await fetch(base+path,{method,headers,...(data===undefined?{}:{body:multipart?data:JSON.stringify(data)})});return {status:r.status,body:await r.json()};}
  let admin,operator,moderator,student,other,article,root,proof,evidence,oldTicket;
  const dto=(overrides={})=>({kind:'LICENSE',title:'道德经研习授权',author:'测试核发单位',edition:'隔离版一',sourceUrl:'https://example.org/edition',rightsHolder:'测试权利人',licenseScope:'仅用于隔离验收，不代表真实授权',validFrom:'2020-01-01',validUntil:'2039-12-31',...overrides});
  async function post(path,data,who=admin){const r=await call(path,who,'POST',data);assert.equal(r.status,201,JSON.stringify(r.body));return r.body;}
  async function review(row,state='APPROVED',who=moderator){return post(root+'/evidence/'+row.id+'/review',{state,expectedVersion:row.version,reason:'实际核查原件与授权范围',proofReviewed:true},who);}
  async function transition(action,expected=201){const r=await call('/admin/articles/'+article.id+'/transition',admin,'POST',{action,expectedVersion:article.version,reason:'核查文章发布与证据'});assert.equal(r.status,expected,JSON.stringify(r.body));if(expected===201)article=r.body;}
  try{
    admin=await actor('ADMIN');operator=await actor('OPERATOR');moderator=await actor('MODERATOR');student=await actor('USER','APP');other=await actor('OPERATOR');
    article=await post('/admin/articles',{title:'经典溯源测试',summary:'来源核查',category:'经典原文',author:'测试作者',source:'测试资料',cover:'/static/art/books.svg',tags:[],visibility:'PUBLIC',membershipTier:1,featured:false,blocks:[{id:'p1',type:'paragraph',text:'道法自然。'}]});root='/admin/articles/'+article.id+'/editorial';
    await t.test('real proof upload validates format and uploader ownership; invalid dates cannot create evidence',async()=>{
      const invalid=new FormData();invalid.append('file',new Blob(['<html>fake</html>'],{type:'image/png'}),'fake.png');assert.equal((await call(root+'/evidence-files',operator,'POST',invalid)).status,400);
      const file=new FormData();file.append('file',new Blob(['%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF'],{type:'application/pdf'}),'授权原件.pdf');proof=await post(root+'/evidence-files',file,operator);
      assert.ok(proof.id);assert.equal(proof.name,'授权原件.pdf');assert.equal('storageKey' in proof,false);
      assert.equal((await call(root+'/evidence',other,'POST',dto({proofAssetId:proof.id}))).status,400);
      for(const changes of [{validUntil:'2030-02-30'},{validFrom:'2026-02-30'},{validFrom:'2040-01-01'},{title:'   '},{kind:'QUALITY'}])assert.equal((await call(root+'/evidence',operator,'POST',dto(changes))).status,400);
      evidence=await post(root+'/evidence',dto({proofAssetId:proof.id}),operator);assert.equal(evidence.reviewState,'PENDING');
      assert.equal((await call(root+'/evidence/'+evidence.id+'/proof',student,'POST',{})).status,403);
      oldTicket=await post(root+'/evidence/'+evidence.id+'/proof',{},moderator);const fileResult=await fetch(base+oldTicket.path);assert.equal(fileResult.status,200);assert.match(fileResult.headers.get('Content-Disposition'),/attachment/);assert.equal(fileResult.headers.get('X-Content-Type-Options'),'nosniff');assert.match(await fileResult.text(),/^%PDF/);
    });
    await t.test('publication waits for effective reviewed evidence, with explicit original-file confirmation',async()=>{
      await transition('submit',400);assert.equal((await db.article.findUniqueOrThrow({where:{id:article.id}})).status,'DRAFT');
      assert.equal((await call(root+'/evidence/'+evidence.id+'/review',moderator,'POST',{state:'APPROVED',expectedVersion:1,reason:'未核查原件'})).status,400);
      assert.equal((await call(root+'/evidence/'+evidence.id+'/review',operator,'POST',{state:'APPROVED',expectedVersion:1,reason:'无审核权限',proofReviewed:true})).status,403);
      const reviews=await Promise.all([1,2].map(()=>call(root+'/evidence/'+evidence.id+'/review',moderator,'POST',{state:'APPROVED',expectedVersion:1,reason:'核对授权原件及范围',proofReviewed:true})));assert.deepEqual(reviews.map(r=>r.status).sort(),[201,409]);evidence=reviews.find(r=>r.status===201).body;
      assert.equal((await fetch(base+oldTicket.path)).status,404);await transition('submit');await transition('publish');
      const visible=(await call('/discovery/articles/'+article.id+'/context')).body.evidence[0];assert.equal(visible.edition,'隔离版一');assert.equal(visible.isDemo,false);
      for(const field of ['proofAssetId','reviewNote','reviewerId','storageKey'])assert.equal(field in visible,false);
      await db.mediaAsset.update({where:{id:proof.id},data:{status:'REJECTED'}});assert.deepEqual((await call('/discovery/articles/'+article.id+'/context')).body.evidence,[]);await db.mediaAsset.update({where:{id:proof.id},data:{status:'READY'}});
    });
    await t.test('expiry removes public summaries and blocks republishing; a new valid edition preserves old records',async()=>{
      await db.sourceEvidence.update({where:{id:evidence.id},data:{validUntil:new Date(Date.now()-1000)}});assert.deepEqual((await call('/discovery/articles/'+article.id+'/context')).body.evidence,[]);
      await transition('archive');await transition('revise');await transition('submit',400);
      const next=await post(root+'/evidence',dto({edition:'隔离版二'}),operator);await review(next);await transition('submit');await transition('publish');
      assert.equal((await call(root,operator)).body.evidence.length,2);assert.equal((await call('/discovery/articles/'+article.id+'/context')).body.evidence[0].edition,'隔离版二');
      assert.equal((await db.sourceEvidence.findUniqueOrThrow({where:{id:evidence.id}})).edition,'隔离版一');
    });
    await t.test('teacher and product use dedicated source kinds; sample evidence stays explicitly marked',async()=>{
      const teacher=await db.teacher.create({data:{name:'师资样例',title:'测试方向',bio:'师资传承',status:'DRAFT',isDemo:true}}),teacherRoot='/admin/teachers/'+teacher.id+'/editorial';
      const teacherEvidence=await post(teacherRoot+'/evidence',dto({kind:'LINEAGE'}),operator);assert.equal((await call('/admin/teachers/'+teacher.id+'/transition',admin,'POST',{action:'submit',expectedVersion:teacher.version,reason:'师资送审'})).status,400);
      await post(teacherRoot+'/evidence/'+teacherEvidence.id+'/review',{state:'APPROVED',expectedVersion:1,reason:'核对传承文献'},moderator);
      let row=await post('/admin/teachers/'+teacher.id+'/transition',{action:'submit',expectedVersion:teacher.version,reason:'师资送审'});await post('/admin/teachers/'+teacher.id+'/transition',{action:'publish',expectedVersion:row.version,reason:'师资发布'});
      const profile=(await call('/catalog/teachers/'+teacher.id)).body;assert.equal(profile.evidence[0].isDemo,true);assert.equal('proofAssetId' in profile.evidence[0],false);
      const product=await db.product.create({data:{title:'文化用品样例',subtitle:'隔离测试',description:'测试文化来源',category:'文创',type:'PHYSICAL',cover:'/static/art/books.svg',price:100,culturalOrigin:'测试',status:'PUBLISHED',isDemo:true}}),productRoot='/admin/products/'+product.id+'/editorial';
      const p=await post(productRoot+'/evidence',dto({kind:'QUALITY'}),operator);await post(productRoot+'/evidence/'+p.id+'/review',{state:'APPROVED',expectedVersion:1,reason:'质量文件核查'},moderator);assert.equal((await call('/catalog/products/'+product.id)).body.evidence[0].isDemo,true);
      assert.equal((await call(teacherRoot+'/evidence',operator,'POST',dto({kind:'QUALITY'}))).status,400);assert.equal((await call(productRoot+'/evidence/'+teacherEvidence.id+'/proof',operator,'POST',{})).status,404);
    });
    await t.test('file tickets recheck permissions, binding and session; withdrawal immediately removes public evidence',async()=>{
      const current=(await call(root,operator)).body.evidence.find(e=>e.edition==='隔离版二');await review(current,'REJECTED');assert.deepEqual((await call('/discovery/articles/'+article.id+'/context')).body.evidence,[]);
      const ticket=await post(root+'/evidence/'+evidence.id+'/proof',{},moderator),role=await db.accessRole.findUniqueOrThrow({where:{code:'MODERATOR'}});
      try{await db.accessRole.update({where:{id:role.id},data:{permissionCodes:role.permissionCodes.filter(p=>p!=='content.read')}});assert.equal((await fetch(base+ticket.path)).status,403);}finally{await db.accessRole.update({where:{id:role.id},data:{permissionCodes:role.permissionCodes}});}
      await db.authSession.updateMany({where:{userId:moderator.id},data:{revokedAt:new Date()}});assert.equal((await fetch(base+ticket.path)).status,401);
      assert.ok(await db.auditLog.count({where:{action:'evidence.file.view',resourceId:evidence.id}})>0);
    });
  }finally{await app.close();await db.$disconnect();}
});
