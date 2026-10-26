# 固定扫码下载与版本发布

## 已上线入口

- 下载页面：**https://cuecanvas.top/download/**
- 域名首页：**https://cuecanvas.top/**，跳转到下载页。
- Android 安装包固定地址：https://cuecanvas.top/download/android.apk
- 二维码图片：https://cuecanvas.top/download/qr.png
- 版本信息：https://cuecanvas.top/download/release.json

二维码编码的是固定下载页，不是某一版 APK。后续升级不换二维码、不要求重新发安装包。当前为 Android **0.3.18 / code23 体验版**，50,017,681 字节，ARM64 / Android 6.0 及以上；原云端签名，SHA256 为 `471d7f3f9bea03c3e9377c823109333a977aa23f6fbe03deb5aa41963399f4c5`。没有重新打包，也未上架应用商店。

微信中提示在外部浏览器打开；iPhone/iPad 显示未开放并阻止误下载 APK。桌面可扫码或保存二维码。安装/来源权限仍由 Android 系统确认，网页不能静默安装。发布页不请求账户或设备权限，不载入第三方字体/脚本。

## 本次改动与部署

域名已经解析到 43.160.229.173，现有证书覆盖 cuecanvas.top，有效期至 2026-11-09（证书时间以服务器为准）；共享网关原先遗漏该域名，导致浏览器证书不匹配。只追加此域名的 HTTP→HTTPS 与下载路径代理，其他域名的既有路由保留。

- 页面源码：`apps/download/`，沿用书院墨青、纸色及宋体标题，原生 HTML/CSS/JS，无额外前端框架。
- 文件准备：`scripts/prepare-app-download.mjs`，核对 APK 与已验证 JSON 的版本/构建号/包名/大小/SHA256，生成页面与二维码，拒绝覆盖已有输出目录。
- 网关模板：`infra/cuecanvas-download.nginx.conf`。
- 静态目录挂载及路径：`infra/compose.shared-edge.yaml`、`infra/nginx.shared-edge.conf`。APK 响应附带下载文件名、正确 MIME、no-cache、Range；文件不存在返回404。
- 服务器数据：`/opt/daoxue-academy/download/releases/0.3.18-code23/`，`current` 软链选中当前版，不随 API 发行目录被替换。
- 网关备份：`/opt/daoxue-academy/download-20261025-0318-r2-backup/`，包含 edge 配置、compose覆盖及共享网关原配置。修改文件原位写入，兼容已有文件 bind mount。
- API 发行仍是 `20261025-aliyun-sms-01`；没有数据库迁移或API重启，仅重建静态edge并平滑重载共享网关。
- 通过原后台鉴权、CSRF、版本锁及审计接口更新系统配置 `release`，revision 0→1，App版本检查地址改为固定下载页；iOS配置保持。管理员临时会话已退出。
- 证书原有 certbot.timer 和 cuecanvas deploy hook 保留，hook 会复制新证书并校验/重载共享网关。
- `certbot renew --cert-name cuecanvas.top --dry-run --non-interactive --no-random-sleep-on-renew` 实际验证成功，HTTP域名验证及模拟续证链路通过；未替换生产证书。

本轮不解决阿里云余额不足，真实短信仍待充值，不因有下载页提高商用38/131。

## 后续如何更新

1. 先完成 Android 打包与原签名校验，保留 APK 及同名已验证 `.json`。
2. 在项目根目录运行（以下版本号只是示例，须替换为真实已验证版本）：

```powershell
node scripts/prepare-app-download.mjs outputs/android/daoxue-academy-0.3.19.apk 0.3.19 24 https://cuecanvas.top/download/ outputs/app-download-0319 "本次更新说明"
```

如需指定页面发布日期，可设置 `ACADEMY_DOWNLOAD_DATE=YYYY-MM-DD`；否则取北京时间。模板中的体验版标识应随实际发行性质调整，不得把未验收包写成正式版。

3. 将生成目录完整上传至服务器的独立 staging 目录，在服务器执行：

```bash
bash /opt/daoxue-academy/publish-app-download.sh /完整的上传暂存目录
```

此工具源码在 `infra/publish-app-download.sh`：核对SHA256、完整文件、递增构建号，保留旧目录，通过软链原子切换整套页面和APK，防止半个包被下载。相同/较低构建号拒绝发布；已存在版本不覆盖；不需要重启API或nginx。

4. 后台「系统配置 → 版本发布」同步 Android 版本号/构建号/更新说明，下载地址始终填 `https://cuecanvas.top/download/`。本次已经配置0.3.18/code23。
5. 检查页面、`release.json`、APK Range206和公网文件校验，核对新包原签名可覆盖，再对外通知。

## 回退

如果仅安装包需回退，明确选择已存在的旧版本，将 `download/current` 原子切回对应 `releases/`，再通过后台保存原版本配置的新修订；不要覆盖旧包或删除业务数据库。当前首次发布只有0.3.18，无更早下载页版本可切。

若回退本轮网关配置，使用上述备份原位恢复网关/edge/compose，先 nginx -t 再 reload/recreate edge；须同时把后台版本配置恢复为先前值的新修订。保留应用API、业务数据、证书和下载文件。

## 验证范围与证据

- 真实Edge浏览器6组：320、390、844横屏、1280，微信提示、iOS禁用下载；无横向溢出，0页面脚本异常。
- 准备工具专项1组：真实APK匹配、错误版本/非法HTTPS/未知目标拒绝、HTML转义、固定地址及不覆盖输出。
- 发布工具在服务器隔离临时目录验证：正向发布、软链切换、同构建号拒绝；临时目录清理。
- 真实公网Edge页面200，APK Range206；远端APK全文件SHA256与本地一致，字节数50,017,681；正确MIME、下载文件名、no-cache。缺失资源404，原后台健康200。
- 发布前临时运行edge做nginx配置检查时，固定IP导致地址冲突；已回退该次尝试，改用现有edge内执行nginx -t后重建，正式上线验证通过，未影响数据库/API。
- 证据：`outputs/download-page-review/checks.json`、`live-checks.json`、`release-config-before.json`、`release-config-after.json`、页面截图，以及 `outputs/app-download-0318/release.json`、`qr.png`。原始部署日志留在私有 `.runtime/download-*`。
- 未做手机安装/iOS原生测试，不把Web检查视为真机验收；真实短信、支付及上架门禁仍按原计划。
