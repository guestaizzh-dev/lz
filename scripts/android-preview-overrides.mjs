import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../services/api/package.json', import.meta.url));
const ts = require('typescript');

export function previewNotifications(source) {
  assert(source.includes('uni.getPushClientId'));
  const marker = /\blet\s+listening\s*=\s*false\s*,\s*syncing\s*=\s*false\s*;/.exec(source);
  assert(marker, 'Push implementation marker missing');
  return (
    source.slice(0, marker.index) +
    `
// This preview has no system-push SDK; in-app messages still use the original API.
export async function refreshPush():Promise<void>{return;}
export function notificationPermission():string{return '预览包未包含系统推送，请在书院消息中查看通知';}
export function openNotificationPermission():void{uni.showToast({title:'请在书院消息中查看通知',icon:'none'});}
`
  );
}

export function previewSettings(source) {
  const start = /<view\s+v-if="currentUser"\s+class="section notification-section"\s*>/.exec(
    source,
  )?.index;
  assert(start !== undefined, 'Notification section missing');
  const heading = source.indexOf('本机显示', start);
  const sections = [...source.slice(start, heading).matchAll(/<view\s+class="section"\s*>/g)];
  const end = start + (sections.at(-1)?.index ?? -1);
  assert(heading > start && end > start, 'Display settings section missing');
  let result =
    source.slice(0, start) +
    `<view v-if="currentUser" class="section notification-section"><text class="section-heading">消息与通知</text><text class="intro">本预览包未包含系统推送，订单、课程和互动通知请在书院消息中查看。</text><button class="setting-action" @click="uni.navigateTo({url:'/pages/profile/messages'})">查看书院消息 ›</button></view>\n` +
    source.slice(end);
  const script = /<script\b[^>]*>([\s\S]*?)<\/script>/.exec(result);
  assert(script, 'Settings script missing');
  const offset = script.index + script[0].indexOf('>') + 1;
  const ast = ts.createSourceFile('settings.ts', script[1], ts.ScriptTarget.Latest, true);
  const statement = ast.statements.find(
    (node) =>
      ts.isExpressionStatement(node) &&
      ts.isCallExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'onShow' &&
      node.getText(ast).includes('loadPreferences'),
  );
  assert(statement, 'Push onShow hook missing');
  result =
    result.slice(0, offset + statement.getStart(ast)) +
    'onShow(()=>{permission.value=notificationPermission();});' +
    result.slice(offset + statement.end);
  return result;
}
