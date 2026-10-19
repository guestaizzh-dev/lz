import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readerAction} from '../../../apps/mobile/lib/reader.ts';
const blocks=[{id:'one',type:'paragraph',text:'上善😀若水'},{id:'two',type:'quote',text:'知行相照'},{id:'photo',type:'image',text:'',url:'/static/art/books.svg'},{id:'audio',type:'audio',text:''}];
const selection={blockId:'one',rangeStart:0,rangeEnd:4,quote:'上善😀'};
test('reader bridge accepts exact cross-paragraph UTF-16 snapshots, including emoji',()=>{
  for(const action of ['copy','note','comment','highlight'])assert.deepEqual(readerAction({action,selections:[selection,{blockId:'two',rangeStart:0,rangeEnd:2,quote:'知行'}]},blocks)?.selections.map(s=>s.quote),['上善😀','知行']);
});
test('reader bridge rejects broken characters, forged snapshots, unordered blocks and malformed values',()=>{
  for(const item of [{...selection,rangeStart:3},{...selection,rangeEnd:3},{...selection,quote:'伪造引用'},{...selection,rangeEnd:NaN},{...selection,rangeEnd:Infinity},{...selection,rangeStart:.5},{...selection,blockId:'photo'},null])assert.equal(readerAction({action:'note',selections:[item]},blocks),null);
  assert.equal(readerAction({action:'comment',selections:[selection,selection]},blocks),null);
  for(const value of [null,{},'note',{action:'script',selections:[selection]},{action:'note',selections:[]}])assert.equal(readerAction(value,blocks),null);
});
test('reader bridge limits media and image actions to the displayed article',()=>{
  assert.deepEqual(readerAction({action:'media',blockId:'audio',requestId:1},blocks),{action:'media',blockId:'audio',requestId:1});
  for(const data of [{action:'media',blockId:'one',requestId:1},{action:'media',blockId:'audio',requestId:-1},{action:'media',blockId:'audio',requestId:1.1},{action:'image',url:'https://evil.test/image.jpg'}])assert.equal(readerAction(data,blocks),null);
  assert.deepEqual(readerAction({action:'image',url:blocks[2].url},blocks),{action:'image',url:blocks[2].url});
});
