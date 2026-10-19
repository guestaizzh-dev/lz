import test from 'node:test';
import assert from 'node:assert/strict';
import {studyOverview} from '../../../apps/mobile/lib/study-overview.ts';

test('learning overview respects required lessons, accessible next lesson and recent progress',()=>{
  const lesson=(id,required,progress=null,accessible=true)=>({id,title:id,required,progress,accessible});
  const item={lessons:[lesson('one',true,{completedAt:'2026-10-09',positionSeconds:0,watchedSeconds:0}),lesson('optional',false),lesson('two',true,{completedAt:null,positionSeconds:5,watchedSeconds:5,updatedAt:'2026-10-09'})]};
  assert.equal(studyOverview(item).percent,50);
  assert.equal(studyOverview(item).next.id,'two');
  item.lessons[2].progress.completedAt='2026-10-09';
  assert.equal(studyOverview(item).finished,true);
  assert.equal(studyOverview({lessons:[]}).finished,false);
  assert.equal(studyOverview({lessons:[lesson('locked',true,null,false)]}).next,undefined);
  assert.equal(studyOverview({lessons:[lesson('free',false)]}).total,1);
});
