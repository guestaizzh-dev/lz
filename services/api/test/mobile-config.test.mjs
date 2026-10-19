import test from 'node:test';
import assert from 'node:assert/strict';
import {endpoints,validateEndpoint,networkPolicy} from '../../../scripts/configure-mobile-api.mjs';

test('mobile release rejects local endpoints, credentials and malformed URLs',()=>{
  for(const environment of ['demo','production']){
    assert.equal(validateEndpoint(endpoints[environment]+'/',environment),endpoints[environment]);
    for(const url of ['http://academy.example.com/api/v1','https://127.2.3.4/api/v1','https://localhost/api/v1','https://dev.localhost/api/v1','https://10.0.0.4/api/v1','https://192.168.1.1/api/v1','https://172.31.0.1/api/v1','https://user:pass@academy.example.com/api/v1','https://academy.example.com/api/v1?token=secret','https://academy.example.com/api/v1#secret','https://academy.example.com/'])assert.throws(()=>validateEndpoint(url,environment));
    assert.ok(!networkPolicy(endpoints[environment],environment).includes('cleartextTrafficPermitted="true"'));
  }
  assert.throws(()=>validateEndpoint(endpoints.production,'unknown'));
});

test('development HTTP is restricted to the selected LAN or loopback hostname',()=>{
  const xml=networkPolicy('http://192.168.1.20:3000/api/v1','development');
  assert.ok(xml.includes('<base-config cleartextTrafficPermitted="false"/>'));
  assert.ok(xml.includes('<domain includeSubdomains="false">192.168.1.20</domain>'));
  assert.ok(!xml.includes('localhost'));
  assert.ok(!networkPolicy('https://api.example.com/api/v1','development').includes('cleartextTrafficPermitted="true"'));
});
