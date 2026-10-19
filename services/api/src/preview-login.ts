export const previewPhone = '19900001002';
export const previewSessionDevice = 'preview-login';

export function previewLoginConfig(env: NodeJS.ProcessEnv = process.env) {
  if (env.PREVIEW_LOGIN_ENABLED !== undefined && !['true', 'false'].includes(env.PREVIEW_LOGIN_ENABLED)) throw new Error('Invalid PREVIEW_LOGIN_ENABLED');
  if (env.PREVIEW_LOGIN_ENABLED !== 'true') return null;
  const userId = env.PREVIEW_LOGIN_USER_ID, code = env.PREVIEW_LOGIN_CODE;
  const expiresAt = new Date(env.PREVIEW_LOGIN_EXPIRES_AT ?? '');
  if (!userId || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(userId) || !code || !/^\d{6}$/.test(code)) throw new Error('Preview login requires a pinned user ID and six-digit code');
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() > Date.now() + 7 * 86400_000) throw new Error('Preview login requires an expiry within seven days');
  if (env.SMS_ENABLED !== 'false' || ['PRODUCT_SALES_ENABLED', 'COURSE_WECHAT_ENABLED', 'COURSE_ALIPAY_ENABLED', 'MEMBERSHIP_SALES_ENABLED', 'APPLE_IAP_ENABLED', 'APPLE_MEMBERSHIP_SALES_ENABLED'].some(name => env[name] === 'true')) throw new Error('Preview login requires SMS and real payments to remain disabled');
  return expiresAt > new Date() ? { userId, code, expiresAt } : null;
}

export function isPreviewUser(user: { id: string; status: string; roles: string[] }) {
  const config = previewLoginConfig();
  return !!config && user.id === config.userId && user.status === 'ACTIVE' && user.roles.length === 1 && user.roles[0] === 'USER';
}
