import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../dist/main.js';
import { Database } from '../dist/database.js';
import { AuthService } from '../dist/auth.js';

test('administrator operating flows: categories, public images and direct publication', async t => {
  const app = await createApp(false);app.useLogger(['warn','error']); await app.listen(0, '127.0.0.1');
  const db = app.get(Database), auth = app.get(AuthService), base = await app.getUrl(), origin = 'http://127.0.0.1:5173';
  const actor = await db.user.create({ data: { nickname: '运营整改隔离验证', roles: ['ADMIN'] } }), credentials = auth.credentials(), csrf = randomUUID();
  await db.authSession.create({ data: { userId: actor.id, kind: 'ADMIN', accessHash: credentials.accessHash, refreshHash: credentials.refreshHash, accessExpiresAt: credentials.accessExpiresAt, expiresAt: new Date(Date.now() + 86400000), csrfToken: csrf } });
  const headers = { Origin: origin, Cookie: 'daoxue_access=' + credentials.access, 'X-CSRF-Token': csrf };
  const call = async (path, method = 'GET', body, anonymous = false) => {
    const response = await fetch(base + '/api/v1' + path, { method, headers: { ...(!anonymous ? headers : {}), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
  let category, teacher, course, image;
  try {
    await t.test('categories require admin authentication and can be maintained without touching internal codes', async () => {
      assert.equal((await call('/admin/categories?scope=COURSE', 'GET', undefined, true)).status, 401);
      const created = await call('/admin/categories', 'POST', { scope: 'COURSE', label: '运营课程' + randomUUID().slice(0, 8), position: 1, enabled: true });
      assert.equal(created.status, 201); category = created.body;
      assert.ok((await call('/catalog/categories?scope=COURSE', 'GET', undefined, true)).body.some(row => row.code === category.code));
      const duplicate = await call('/admin/categories', 'POST', { scope: 'COURSE', label: category.label, position: 2, enabled: true }); assert.equal(duplicate.status, 409);
    });
    await t.test('local image upload normalizes a real PNG and exposes only public images', async () => {
      const form = new FormData(); form.append('file', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAAAkCAIAAAC2bqvFAAAAVElEQVR4nO3PsQkAIBDAwN9/PhsrV3EIi0MIZIDLrLO/brigAS1oQAsa0IIGtKABLWhACxrQgga0oAEtaEALGtCCBrSgAS1oQAsa0IIGtKABLXjsAsEE7Us6pf+MAAAAAElFTkSuQmCC', 'base64')], { type: 'image/png' }), '验证封面.png');
      const response = await fetch(base + '/api/v1/admin/images', { method: 'POST', headers, body: form }); image = await response.json();
      assert.equal(response.status, 201, JSON.stringify(image));
      const shown = await fetch(base + '/api/v1/assets/images/' + image.id); assert.equal(shown.status, 200); assert.equal(shown.headers.get('content-type'), 'image/jpeg'); assert.ok((await shown.arrayBuffer()).byteLength > 0);
      const bad = new FormData(); bad.append('file', new Blob(['<svg onload="alert(1)"></svg>'], { type: 'image/png' }), 'fake.png');
      assert.equal((await fetch(base + '/api/v1/admin/images', { method: 'POST', headers, body: bad })).status, 400);
      assert.equal((await fetch(base + '/api/v1/assets/images/' + randomUUID())).status, 404);
      assert.ok((await call('/admin/images?q=' + encodeURIComponent('验证封面'))).body.items.some(row => row.id === image.id));
    });
    await t.test('teacher and mixed-content course publish directly with audit and frozen delivery intact', async () => {
      teacher = (await call('/admin/teachers', 'POST', { name: '运营验证讲师', title: '经典研习讲师', bio: '仅在隔离数据库验证发布流程', expertise: [], portrait: image.url })).body;
      const ready = await call('/admin/teachers/' + teacher.id + '/transition', 'POST', { action: 'publish', expectedVersion: teacher.version }); assert.equal(ready.status, 201, JSON.stringify(ready.body));
      const draft = await call('/admin/courses', 'POST', { title: '管理员直接发布课程', subtitle: '无需切换审核账号', description: '实际编辑、上传和发布的隔离验证课程', category: category.code, format: 'VIDEO', cover: image.url, price: 1000, teacherId: teacher.id, refundPolicy: '按实际交付与售前约定处理', tags: [], featured: false, chapters: [{ title: '经典图文', format: 'TEXT', body: '上善若水，水善利万物而不争。', durationSeconds: 0, trial: true, required: true }] });
      assert.equal(draft.status, 201, JSON.stringify(draft.body)); course = draft.body;
      const published = await call('/admin/courses/' + course.id + '/transition', 'POST', { action: 'publish', expectedVersion: course.version }); assert.equal(published.status, 201, JSON.stringify(published.body));
      const stored = await db.course.findUniqueOrThrow({ where: { id: course.id } }); assert.equal(stored.status, 'PUBLISHED'); assert.ok(stored.publishedReleaseId);
      const before = await db.courseRelease.findUniqueOrThrow({ where: { id: stored.publishedReleaseId } });
      const renamed = await call('/admin/categories/' + category.id, 'PATCH', { scope: 'COURSE', label: '更新后的运营分类', position: 2, enabled: true, expectedVersion: category.version }); assert.equal(renamed.status, 200); category = renamed.body;
      assert.equal(category.code, before.memberPolicySnapshot.category);
      const shown = await call('/catalog/courses/' + course.id, 'GET', undefined, true); assert.equal(shown.status, 200); assert.equal(shown.body.categoryLabel, '更新后的运营分类');assert.equal(shown.body.category,'更新后的运营分类');assert.equal(shown.body.categoryCode,category.code);
      assert.deepEqual(await db.courseRelease.findUniqueOrThrow({ where: { id: stored.publishedReleaseId } }), before);
      assert.equal((await call('/admin/categories/' + category.id, 'DELETE')).status, 409);
      assert.equal((await call('/admin/categories/' + category.id, 'PATCH', { scope: 'COURSE', label: category.label, enabled: false, position: 2, expectedVersion: 1 })).status, 409);
      const disabled = await call('/admin/categories/' + category.id, 'PATCH', { scope: 'COURSE', label: category.label, enabled: false, position: 2, expectedVersion: category.version }); assert.equal(disabled.status, 200);
      assert.ok(!(await call('/catalog/categories?scope=COURSE', 'GET', undefined, true)).body.some(row => row.code === category.code));const current=(await call('/catalog/categories?scope=COURSE&current='+category.code,'GET',undefined,true)).body.find(row=>row.code===category.code);assert.equal(current.label,category.label);assert.equal(current.enabled,false);
      assert.equal((await call('/admin/courses', 'POST', { ...draft.body, category: category.code })).status, 400);
    });
    await t.test('an empty category can be deleted', async () => {
      const created = await call('/admin/categories', 'POST', { scope: 'PRODUCT', label: '空分类' + randomUUID().slice(0, 8), position: 20, enabled: true }); assert.equal(created.status, 201);
      assert.equal((await call('/admin/categories/' + created.body.id, 'DELETE')).status, 200);
    });
    await t.test('batch classification preserves published delivery and rolls back the entire selection on stale rows',async()=>{
      const next=await call('/admin/categories','POST',{scope:'COURSE',label:'批量归类'+randomUUID().slice(0,8),position:50,enabled:true});assert.equal(next.status,201);
      const before=await db.course.findUniqueOrThrow({where:{id:course.id}}),release=await db.courseRelease.findUniqueOrThrow({where:{id:before.publishedReleaseId}});
      const changed=await call('/admin/categories/assign','POST',{scope:'COURSE',category:next.body.code,items:[{id:before.id,version:before.version}]});assert.equal(changed.status,201);assert.equal(changed.body.count,1);
      const after=await db.course.findUniqueOrThrow({where:{id:course.id}});assert.equal(after.category,next.body.code);assert.equal(after.status,'PUBLISHED');assert.deepEqual(await db.courseRelease.findUniqueOrThrow({where:{id:before.publishedReleaseId}}),release);
      const bad=await call('/admin/categories/assign','POST',{scope:'COURSE',category:next.body.code,items:[{id:after.id,version:after.version},{id:randomUUID(),version:1}]});assert.equal(bad.status,409);assert.deepEqual(await db.course.findUniqueOrThrow({where:{id:after.id}}),after);
    });
    await t.test('administrator publishes an event with one ready-to-book session and canonical ticket inventory',async()=>{
      const startsAt=new Date(Date.now()+7*86400000).toISOString(),endsAt=new Date(Date.now()+7*86400000+3600000).toISOString();
      const created=await call('/admin/events','POST',{title:'周末经典共读',description:'管理员一次填写并开放报名的隔离验证',category:'线下活动',cover:image.url,location:'书院研习室',startsAt,endsAt,capacity:20,price:0});assert.equal(created.status,201,JSON.stringify(created.body));
      const published=await call('/admin/events/'+created.body.id+'/transition','POST',{action:'publish',expectedVersion:created.body.version});assert.equal(published.status,201,JSON.stringify(published.body));
      const sessions=await db.eventSession.findMany({where:{eventId:created.body.id}});assert.equal(sessions.length,1);assert.equal(sessions[0].capacity,20);assert.equal(sessions[0].state,'OPEN');
      const tickets=await db.eventTicketType.findMany({where:{sessionId:sessions[0].id}});assert.equal(tickets.length,1);assert.equal(tickets[0].perUserLimit,1);const offer=await db.saleOffer.findFirstOrThrow({where:{eventTicketId:tickets[0].id}});assert.equal(offer.price,0n);
      assert.equal((await call('/admin/events/'+created.body.id+'/transition','POST',{action:'publish',expectedVersion:created.body.version})).status,409);assert.equal(await db.eventSession.count({where:{eventId:created.body.id}}),1);
    });
    await t.test('admin media preview rechecks session, version and attachment separation on Range requests',async()=>{
      const bytes=Buffer.from('isolated-preview-transport-bytes'),id=randomUUID(),key=id+'.mp4';await writeFile(join(process.env.MEDIA_DIR,key),bytes);
      await db.mediaAsset.create({data:{id,storageKey:key,name:'preview.mp4',mime:'video/mp4',bytes:bytes.length,uploaderId:actor.id,status:'READY',visibility:'PRIVATE'}});
      const ticket=await call('/admin/media/assets/'+id+'/preview','POST',{});assert.equal(ticket.status,201,JSON.stringify(ticket.body));
      const range=await fetch(base+'/api/v1'+ticket.body.path,{headers:{...headers,Range:'bytes=1-4'}});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,4);
      assert.equal((await call('/admin/media/assets/'+image.id+'/preview','POST',{})).status,404);
      await db.mediaAsset.update({where:{id},data:{version:{increment:1}}});assert.equal((await fetch(base+'/api/v1'+ticket.body.path,{headers})).status,404);
      const renewed=await call('/admin/media/assets/'+id+'/preview','POST',{});await db.authSession.updateMany({where:{userId:actor.id},data:{revokedAt:new Date()}});
      assert.equal((await fetch(base+'/api/v1'+renewed.body.path,{headers})).status,401);
    });
  } finally { await app.close(); }
});
