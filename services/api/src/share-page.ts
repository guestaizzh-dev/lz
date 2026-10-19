type SharedItem = { resourceType: string; resourceId: string; title: string; description: string };
type PublicArticle = { author: string; source: string; access: string; isDemo: boolean; blocks: unknown };
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function publicShareUrl(value: string | undefined) {
  try { const url = new URL(value ?? ''); return ['https:', ...(process.env.NODE_ENV === 'production' ? [] : ['http:'])].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
export function renderSharePage(item: SharedItem, code: string, article: PublicArticle | null, related: { id: string; type: string; title: string }[]) {
  const e = escapeHtml, web = publicShareUrl(process.env.PUBLIC_APP_URL);
  const appUrl = 'daoxueacademy://share?code=' + encodeURIComponent(code);
  const link = (url: string, label: string, primary = false) => `<a class="${primary ? 'button' : 'link'}" href="${e(url)}">${e(label)}</a>`;
  const downloads = [[process.env.PUBLIC_ANDROID_DOWNLOAD_URL, '下载 Android App'], [process.env.PUBLIC_IOS_DOWNLOAD_URL, '下载 iOS App']].flatMap(([url, label]) => { const safe = publicShareUrl(url); return safe ? [link(safe, label!)] : []; }).join('');
  const webLink = web ? link(web.replace(/\/$/, '') + '/#/pages/shared/index?code=' + encodeURIComponent(code), '在浏览器继续') : '';
  const blocks = article?.access !== 'MEMBERSHIP_REQUIRED' && Array.isArray(article?.blocks) ? article.blocks.flatMap(block => {
    if (!block || typeof block !== 'object') return [];
    const b = block as Record<string, unknown>, text = typeof b.text === 'string' ? e(b.text) : '', caption = typeof b.caption === 'string' ? e(b.caption) : '';
    if (b.type === 'paragraph') return [`<p>${text}</p>`];
    if (b.type === 'quote') return [`<blockquote>${text}</blockquote>`];
    if (b.type === 'image') { const src = publicShareUrl(typeof b.url === 'string' ? b.url : undefined); return src ? [`<figure><img loading="lazy" src="${e(src)}" alt="${caption}">${caption ? `<figcaption>${caption}</figcaption>` : ''}</figure>`] : []; }
    if (['audio', 'video'].includes(String(b.type))) return [`<aside>${b.type === 'audio' ? '音频' : '视频'}课件${caption ? ' · ' + caption : ''}，请在 App 内播放。</aside>`];
    return [];
  }).join('') : '';
  const api = publicShareUrl(process.env.PUBLIC_API_URL ?? 'http://127.0.0.1:3000/api/v1');
  const cards = api ? related.map(target => link(`${api.replace(/\/$/, '')}/share/open/${encodeURIComponent(target.type + '_' + target.id)}`, target.title)).join('') : '';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noarchive"><title>${e(item.title)} · 老子道学书院</title><style>
*{box-sizing:border-box}body{margin:0;background:#f4f0e7;color:#233d3a;font-family:system-ui,"PingFang SC","Microsoft YaHei",sans-serif}main{max-width:720px;margin:auto;padding:40px 24px 32px}header{font-size:14px;letter-spacing:3px;border-bottom:1px solid #d9d5c9;padding-bottom:20px}h1{font-family:"Songti SC","Noto Serif CJK SC",serif;font-size:clamp(26px,6vw,36px);line-height:1.55;overflow-wrap:anywhere;margin:28px 0 12px}.summary{color:#64736c;line-height:1.9}.meta,figcaption{font-size:13px;color:#6c756d;line-height:1.8}article{font-size:18px;line-height:2;overflow-wrap:anywhere}article p{white-space:pre-wrap;margin:24px 0}blockquote{white-space:pre-wrap;margin:24px 0;padding:4px 20px;border-left:2px solid #8d9a88;color:#50654f}figure{margin:24px 0}img{max-width:100%;height:auto;border-radius:4px}aside{font-size:14px;padding:18px;background:#eae6db;border-radius:6px;line-height:1.9;margin:24px 0}nav{display:flex;flex-wrap:wrap;gap:12px;margin-top:24px}a{overflow-wrap:anywhere;color:#295f54;min-height:44px;display:inline-flex;align-items:center;padding:10px 0}.button{background:#295f54;color:#fff;border-radius:6px;text-decoration:none;padding:12px 20px}.link{margin-right:16px}footer{border-top:1px solid #d9d5c9;margin-top:32px;padding-top:20px;font-size:13px;line-height:1.9;color:#64736c}h2{font-size:18px;margin-top:32px}a:focus-visible{outline:3px solid #aa743f;outline-offset:4px}@media(max-width:360px){main{padding:28px 18px}}
</style></head><body><main><header>老子道学书院</header><h1>${e(item.title)}</h1>${article?.isDemo ? '<aside>规范演示内容，非正式出版或授权材料。</aside>' : ''}<p class="summary">${e(item.description)}</p>${article ? `<p class="meta">${e(article.author)}${article.source ? ' · ' + e(article.source) : ''}</p>` : ''}<article>${blocks}</article>${article?.access === 'MEMBERSHIP_REQUIRED' ? '<aside>本文为会员专属内容，此处仅展示公开简介。请在 App 内登录并查看所需权益。</aside>' : ''}${cards ? `<section aria-label="相关研习"><h2>延伸研习</h2>${cards}</section>` : ''}<nav aria-label="继续阅读">${link(appUrl, '在 App 中打开', true)}${webLink}</nav><footer>若未打开 App，请在系统浏览器中重试。${downloads ? `<nav aria-label="下载书院">${downloads}</nav>` : '尚未安装的读者可先阅读本页公开内容，安装渠道以书院正式发布为准。'}会员内容、购课与预约均在登录后按实际权限开放。</footer></main></body></html>`;
}
