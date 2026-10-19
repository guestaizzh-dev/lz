import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const manifestFile=new URL('../apps/mobile/manifest.json',import.meta.url),clientFile=new URL('../apps/mobile/lib/payment-config.ts',import.meta.url);
const manifest=JSON.parse(await readFile(manifestFile,'utf8')),source=await readFile(clientFile,'utf8'),match=source.match(/export const courseAlipayAppId = '([^']*)';/);
assert.ok(match,'Cannot find courseAlipayAppId');
if(process.argv[2]==='--check'){
  assert.match(match[1],/^\d{16}$/,'A real Alipay AppID is required');
  assert.ok(manifest['app-android']?.distribute?.modules?.['uni-payment']?.alipay,'Android alipay module is missing');
  console.log('Alipay Android module configured. Verify server AppID, merchant approval and native return before opening sales.');
}else{
  const appid=process.argv[2];assert.match(appid??'',/^\d{16}$/,'Usage: node scripts/configure-alipay-payment.mjs <16 digit appId> | --check');
  manifest['app-android'].distribute.modules['uni-payment']={...manifest['app-android'].distribute.modules['uni-payment'],alipay:{}};
  await writeFile(clientFile,source.replace(match[0],"export const courseAlipayAppId = '"+appid+"';"));
  await writeFile(manifestFile,JSON.stringify(manifest,null,2)+'\n');
  console.log('Android Alipay configured. Rebuild with the authorized app identity; code presence alone does not enable production payments.');
}
