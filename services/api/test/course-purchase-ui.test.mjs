import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

const source=await readFile(new URL('../../../apps/mobile/lib/course-sales.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const {coursePurchaseAction}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const clock=Date.now(),pending={state:'PENDING',canPay:true,expiresAt:new Date(clock+60000).toISOString(),refunds:[],refundedAmount:'0',access:false};

test('purchase actions require consent and preserve the existing pending checkout before creating another',()=>{
  assert.equal(coursePurchaseAction(null,{},true,false,clock).enabled,false);
  assert.equal(coursePurchaseAction(null,{},true,true,clock).kind,'BUY');
  assert.equal(coursePurchaseAction(null,{pendingOrderId:'existing'},false,false,clock).kind,'PENDING');
  assert.equal(coursePurchaseAction(null,{alreadyAccessible:true},false,false,clock).kind,'LEARN');
  assert.equal(coursePurchaseAction(null,{},false,true,clock).enabled,false);
});
test('unknown, expired and unsupported payments query before a second payment is possible',()=>{
  assert.equal(coursePurchaseAction({...pending,canPay:false},null,true,true,clock).kind,'QUERY');
  assert.equal(coursePurchaseAction({...pending,expiresAt:new Date(clock).toISOString()},null,true,true,clock).kind,'QUERY');
  assert.equal(coursePurchaseAction(pending,null,false,true,clock).kind,'QUERY');
  assert.equal(coursePurchaseAction(pending,null,true,true,clock).kind,'PAY');
});
test('refund recovery stays operable and never suggests paying or learning during approved course return',()=>{
  const action=coursePurchaseAction({...pending,state:'COMPLETED',access:true,refunds:[{automatic:false,state:'REFUNDING'}]},null,true,true,clock);
  assert.equal(action.kind,'QUERY');assert.equal(action.enabled,true);
  assert.equal(coursePurchaseAction({...pending,state:'COMPLETED',refundedAmount:'8800'},null,true,true,clock).kind,'DETAIL');
  assert.equal(coursePurchaseAction({...pending,state:'CLOSED'},null,true,true,clock).kind,'DETAIL');
  assert.equal(coursePurchaseAction({...pending,state:'COMPLETED',access:true},null,false,false,clock).kind,'LEARN');
  assert.equal(coursePurchaseAction({...pending,state:'COMPLETED',access:true,deliveryBlocked:true},null,false,false,clock).kind,'VERSION');
  assert.equal(coursePurchaseAction({...pending,state:'COMPLETED'},null,true,true,clock).kind,'LIBRARY');
});
