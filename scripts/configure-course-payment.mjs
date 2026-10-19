import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';

const manifestFile=new URL('../apps/mobile/manifest.json',import.meta.url),clientFile=new URL('../apps/mobile/lib/payment-config.ts',import.meta.url);
const manifest=JSON.parse(await readFile(manifestFile,'utf8')),source=await readFile(clientFile,'utf8'),match=source.match(/export const courseWechatAppId = '([^']*)';/);
assert.ok(match,'Cannot find courseWechatAppId');
const configured=manifest['app-android']?.distribute?.modules?.['uni-payment']?.wxpay?.appid??'';
if(process.argv[2]==='--check'){
  assert.equal(configured,match[1],'Android SDK and client payment AppIDs differ');
  assert.match(configured,/^wx[a-f0-9]{16}$/,'A real WeChat AppID is required before a payment-enabled build');
  console.log('Android payment module and client AppID match. Package/signature binding still needs merchant verification.');
}else{
  const appid=process.argv[2];assert.match(appid??'',/^wx[a-f0-9]{16}$/,'Usage: node scripts/configure-course-payment.mjs wx<16 hex digits> | --check');
  manifest['app-android'].distribute.modules['uni-payment']={...manifest['app-android'].distribute.modules['uni-payment'],wxpay:{appid}};
  await writeFile(clientFile,source.replace(match[0],"export const courseWechatAppId = '"+appid+"';"));
  await writeFile(manifestFile,JSON.stringify(manifest,null,2)+'\n');
  console.log('Android WeChat payment configured. Rebuild; match the server WECHAT_PAY_APP_ID and registered package/signature.');
}
