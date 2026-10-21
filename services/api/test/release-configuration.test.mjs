import test from 'node:test';
import assert from 'node:assert/strict';
import {validateConfig,configDefaults} from '../dist/system-config.js';
test('release configuration accepts only traceable HTTPS packages and valid build numbers',()=>{
 const empty={...configDefaults.release};assert.deepEqual(validateConfig('release',empty),empty);
 const ready={...empty,androidVersion:'0.3.15',androidCode:20,androidUrl:'https://academy.example/downloads/academy.apk',notes:'更新资料交付与咨询权益'};assert.deepEqual(validateConfig('release',ready),ready);
 for(const changes of [{androidCode:-1},{androidCode:1.1},{androidVersion:'latest'},{androidUrl:'http://academy.example/a.apk'},{androidUrl:'javascript:alert(1)'},{androidUrl:'https://admin:password@academy.example/a.apk'},{androidVersion:''}])assert.throws(()=>validateConfig('release',{...ready,...changes}));
 assert.throws(()=>validateConfig('release',{...ready,secret:'must-not-publish'}));
});
