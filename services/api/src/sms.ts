import { createHash, createHmac } from 'node:crypto';
import { ServiceUnavailableException } from '@nestjs/common';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const hmac = (key: string | Buffer, value: string) => createHmac('sha256', key).update(value).digest();
// Tencent Cloud API v3, SMS 2021-01-11. No credentials or OTP are written to logs.
// Sources: cloud.tencent.com/document/api/382/55981 and /382/52072.
export function smsRequestHeaders(payload: string, config: { secretId: string; secretKey: string; region: string }, timestamp: number) {
  const host = 'sms.tencentcloudapi.com', contentType = 'application/json; charset=utf-8', action = 'SendSms';
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10), scope = date + '/sms/tc3_request';
  const signedHeaders = 'content-type;host;x-tc-action';
  const canonical = ['POST', '/', '', `content-type:${contentType}\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`, signedHeaders, sha(payload)].join('\n');
  const stringToSign = ['TC3-HMAC-SHA256', timestamp, scope, sha(canonical)].join('\n');
  const key = hmac(hmac(hmac('TC3' + config.secretKey, date), 'sms'), 'tc3_request');
  return { 'Content-Type': contentType, 'X-TC-Action': action, 'X-TC-Version': '2021-01-11', 'X-TC-Region': config.region, 'X-TC-Timestamp': String(timestamp), Authorization: `TC3-HMAC-SHA256 Credential=${config.secretId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${hmac(key, stringToSign).toString('hex')}` };
}
export async function sendSms(phone: string, code: string) {
  if (process.env.SMS_ENABLED === 'false') throw new ServiceUnavailableException('短信登录尚未开通，请联系书院');
  if (process.env.NODE_ENV !== 'production' && process.env.DEV_OTP_CODE) return 'DEVELOPMENT';
  const secretId = process.env.SMS_SECRET_ID, secretKey = process.env.SMS_SECRET_KEY, appId = process.env.SMS_SDK_APP_ID, templateId = process.env.SMS_TEMPLATE_ID, signName = process.env.SMS_SIGN_NAME;
  if (!secretId || !secretKey || !appId || !templateId || !signName) throw new ServiceUnavailableException('短信服务暂不可用，请稍后再试');
  const payload = JSON.stringify({ PhoneNumberSet: ['+86' + phone], SmsSdkAppId: appId, SignName: signName, TemplateId: templateId, TemplateParamSet: [code] });
  try {
    const res = await fetch('https://sms.tencentcloudapi.com/', { method: 'POST', headers: smsRequestHeaders(payload, { secretId, secretKey, region: process.env.SMS_REGION ?? 'ap-guangzhou' }, Math.floor(Date.now() / 1000)), body: payload, signal: AbortSignal.timeout(10_000) });
    const result = await res.json() as { Response?: { Error?: unknown; SendStatusSet?: { Code: string }[] } };
    if (!res.ok || result.Response?.Error || result.Response?.SendStatusSet?.[0]?.Code !== 'Ok') throw new Error('SMS failed');
    return 'SMS';
  } catch { throw new ServiceUnavailableException('短信服务暂不可用，请稍后再试'); }
}
