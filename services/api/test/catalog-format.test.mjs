import test from 'node:test';
import assert from 'node:assert/strict';
import {CatalogService} from '../dist/catalog.js';
import {formatChinaTime,formatChinaDate,chinaDay,readingDuration} from '../../../apps/mobile/lib/date-time.ts';
import {chinaPickerValue,chinaPickerIso} from '../../../apps/admin/src/utils/date-time.ts';

test('admin time editors keep Beijing wall-clock time across browser zones',()=>{
  const original=process.env.TZ;
  try{
    for(const zone of ['America/Los_Angeles','Asia/Shanghai','Asia/Tokyo']){
      process.env.TZ=zone;
      const value=chinaPickerValue('2030-10-11T01:30:00Z');
      assert.equal(value.format('YYYY-MM-DD HH:mm:ss'),'2030-10-11 09:30:00');
      assert.equal(chinaPickerIso(value),'2030-10-11T01:30:00.000Z');
      assert.equal(chinaPickerIso(value.hour(10).minute(15)),'2030-10-11T02:15:00.000Z');
    }
    assert.equal(chinaPickerIso(null),null);
  }finally{if(original===undefined)delete process.env.TZ;else process.env.TZ=original;}
});

test('display times use Beijing boundaries independently of the device zone',()=>{
  assert.equal(formatChinaTime('2026-10-09T16:01:00Z'),'2026-10-10 00:01');
  assert.equal(formatChinaDate('2026-12-31T16:00:00Z'),'2027-01-01');
  assert.equal(formatChinaTime('2026-10-10T00:01:00+08:00'),'2026-10-10 00:01');
  assert.equal(chinaDay('2026-10-10'),'2026-10-10');
  assert.equal(formatChinaTime(0),'1970-01-01 08:00');
  assert.equal(formatChinaTime('invalid'),'—');
  assert.equal(formatChinaTime(null),'—');
  assert.equal(readingDuration(15),'阅读不足1分钟');
  assert.equal(readingDuration(120),'累计阅读 2 分钟');
});

test('mixed course cards expose formats without exposing protected lesson bodies or media',async()=>{
  let where;
  const course={id:'course',publishedReleaseId:'published'};
  const lessons=[{releaseId:'published',format:'TEXT'},{releaseId:'published',format:'AUDIO'},{releaseId:'published',format:'VIDEO'}];
  const db={featureConfig:{findFirst:async()=>null},course:{findMany:async args=>{where=args.where;return[course];}},lesson:{findMany:async args=>{assert.equal(args.select.body,undefined);assert.equal(args.select.mediaId,undefined);return args.distinct?[{releaseId:'published'}]:lessons;}}};
  const service=new CatalogService(db,{});
  const result=await service.courses({size:20,contentFormat:'AUDIO'});
  assert.deepEqual(where.publishedReleaseId,{in:['published']});
  assert.deepEqual(result.items[0].contentFormats,['TEXT','AUDIO','VIDEO']);
  assert.equal(result.items[0].lessons,undefined);
});

test('enrolled course metadata uses its purchased frozen version',async()=>{
  const teacher={id:'teacher',name:'名师'};
  const course={id:'course',publishedReleaseId:'latest',teacher};
  const db={featureConfig:{findFirst:async()=>null},course:{findFirst:async()=>course},courseRelease:{findUniqueOrThrow:async args=>{assert.equal(args.where.id,'purchased');return{id:'purchased',title:'购课时版本',descriptionSnapshot:'原版介绍',teacherSnapshot:{name:'原版老师'},lessons:[{format:'TEXT'},{format:'AUDIO'}]};}}};
  const service=new CatalogService(db,{context:async()=>({course,enrollment:{releaseId:'purchased'}})});
  const result=await service.course('course','student');
  assert.equal(result.publishedReleaseId,'purchased');
  assert.equal(result.chaptersCount,2);
  assert.deepEqual(result.contentFormats,['TEXT','AUDIO']);
  assert.equal(result.title,'购课时版本');
  assert.equal(result.teacher.name,'原版老师');
});
