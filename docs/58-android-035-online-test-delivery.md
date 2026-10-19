# Android 0.3.5 与线上测试交付

### 2026-10-19 预览验证码登录恢复

- 用户反馈发送验证码只显示“服务暂时繁忙”。实际线上`SMS_ENABLED=false`且无真实短信配置；指定预览登录原有效期`2026-10-18T10:30:21.738772Z`已过期，接口503被App的通用服务错误提示隐藏。这是配置有效期问题，并非手机网络或短信发送成功。
- 原手机号`19900001002`绑定的普通测试账号仍ACTIVE、仅USER角色，用户总数15，原约定验证码保持。备份`/opt/daoxue-academy/production.env`及当前发行`infra/.env`后，只续期`PREVIEW_LOGIN_EXPIRES_AT`至`2026-10-25T10:06:52Z`（本次6天）。重建本项目API容器，锁定原`daoxue-api:20261016-content-m06-01`镜像、无依赖重启、无构建/迁移；实际容器环境只这一项变化，健康恢复。未更新其余共用服务，真实短信和收款开关保持关闭。
- 公网9项验证通过：健康、其他手机号仍503、指定手机号挑战201/PREVIEW且不返回验证码、本人登录、本人会话、后台权限拒绝、刷新、退出和退出后鉴权拒绝。不创建新用户。现有0.3.9 APK无需重装，先点击获取验证码后使用原约定测试码；发送仍遵守60秒/每日次数限制。
- 同步修正本地App源码：仅允许短信接口503的三条明确业务文案显示给用户，其余5xx继续隐藏内部错误；PREVIEW挑战显示“不发送真实短信”说明。7项源码行为测试通过；这些提示改动未重新打包，不包含在先前生成的0.3.9中，不能宣称已到手机。
- 恢复及公网证据：`outputs/android-preview-039/preview-login-recovery.json`、`preview-login-https.log`、`login-message-tests.log`；私有回退文件路径在恢复JSON内。若需回退，仅恢复两份对应`.before-preview-renew-20261019T100652Z`配置并以同一镜像重建API。到期后需按测试安排续期；正式短信接入仍未完成。本次不改变A07或商用38/131进度。

## 最新补记：2026-10-19 Android 0.3.9 线上连接预览包

- 用户要求生成Android包供自行预览，明确同意“不含系统推送SDK”的独立预览例外。正式项目推送实现保持；站内消息及其入口保留，预览设置页明确说明限制。准备脚本：`scripts/prepare-android-preview.mjs`，副本在`.runtime/android-preview-039`。
- App仍连接`https://academy.43-160-229-173.sslip.io/api/v1`；实际HTTPS健康及首页接口200，生产环境/HTTPS策略检查通过。本次没有部署后端或后台；线上仍为65记录的发行，后续仅本地实现的业务不能因本包而视为线上可用。
- 0.3.9/code14，包名`cn.daoxue.academy`，Android API23起、arm64-v8a，74页面蒸汽字节码编译通过。安装包：`outputs/android/daoxue-academy-0.3.9.apk`，49,840,877字节，SHA256：`805daa4cca1f40b74de718939bb8d5cbb570d10dfea2b20dd9edabfb9655626f`。
- 首次完整项目仍被uni-push2未开通拦截；用户确认后从独立副本提交。首个预览云任务`598b1410-cb9b-11f1-972d-8d7b73e3bc25`失败，原因是RTC的自定义Maven仓库错放在顶层。按[DCloud官方配置](https://doc.dcloud.net.cn/uni-app-x/plugin/uts-plugin.html#config-json)改为`project.repositories`，同时修复正式源码和副本，并在准备脚本加入断言；ZEGO实际POM请求200。没有以删除RTC功能绕过。
- 重试任务`c5f9a710-cb9f-11f1-832f-619dc51c5cd7`最终OK，下载成功。ZIP完整性、包名/版本、线上地址、无推送API/个推资源、实际设置页字节码文案、RTC/安全存储/离线原生类存在及JAR签名验证通过。签名证书SHA256与0.3.7一致：`81d6c07aa2d22b2e022bcc6f00148f984c8bc5aac427f60207e1233c1e8df248`，可作为原包的覆盖更新。
- 证据：`outputs/android-preview-039/`；结构化APK信息在`outputs/android/daoxue-academy-0.3.9.json`。完整推送版仍待开通uni-push2；未安装手机、未进行双端实际验收。A07草稿仍未验证，商用38/131（29.0%）保持。

本批按用户要求，把第56、57批直播和课件改动发布到线上，并生成手机手动测试用的独立签名安装包。云录制继续暂缓，保留原有规范测试数据及指定管理员。

## 线上交付

- 地址：https://academy.43-160-229-173.sslip.io 。API沿用同域名的 `/api/v1`。
- 发布目录：`/opt/daoxue-academy/releases/20261014-media-live-035`；前版为 `20261014-live-r1-01`。
- 已执行备份并核对备份SHA256；第43项字幕/研习资料增量迁移已应用，没有清库或重新导入数据。
- 19类核心业务数据数量和行摘要前后一致。新增字段不计入旧数据摘要比较。
- API及官方Ant Design Pro后台已更新，API/数据库健康；其他共用服务器应用和外层网关配置未修改。
- 16项HTTPS检查通过，包括管理员登录、会话、课程及直播管理、直播播放器HTML/JS/CSS/ZEGO SDK、未登录访问隔离。
- 回退记录：`/opt/daoxue-academy/rollback-20261014-media-live-035.txt`。回退代码时保留增量数据库结构，不用旧备份覆盖新业务事实。

## Android 安装包

- 版本0.3.5，versionCode 10，包名 `cn.daoxue.academy`。
- 58页面 Android uni-app x 蒸汽字节码编译通过，使用已有DCloud云签名。
- 云打包任务：`ce846c30-c7a4-11f1-b030-d3635eaf95c6`，最终状态OK。
- 安装包：`outputs/android/daoxue-academy-0.3.5.apk`，39,490,389字节。
- SHA256：`65fa4b5220201ef5927dd9427be3a01becf8830e0cf34be7129b4fee4ed64cf5`。
- ZIP完整性、包名、版本、线上HTTPS接口与原签名一致性检查通过。
- 手机：JDY-AN00，已授权ADB；安装状态：安装返回Success，手机读取版本0.3.5/code10，已发送启动事件且应用进程存在（PID24950）；覆盖安装保留原数据。
- 完成后已删除手机上的临时下载文件、停止本机临时HTTP服务，并将ADB切回USB模式、断开临时无线连接。

## 过程与验收边界

首次本机编译内存不足，重启构建器后成功；HBuilderX登录恢复后沿原云签名打包。首个服务端发布包漏带 `services/api/scripts/prepare-live.mjs`，构建失败，补齐脚本与直播静态资源后重新构建成功；失败期间没有切换线上服务。USB传输两次出现关闭/EOF，重建ADB并改用同一局域网的HBuilderX ADB35无线通道；一次提示被用户关掉，安装返回INSTALL_FAILED_ABORTED。随后重新发起安装成功。直接HTTP下载也因网速慢超时，临时HTTP服务已停止，不作为成功安装证据。

证据目录：`outputs/phone-preview-035/`，含服务端构建、备份迁移发布日志、数据保留核对、HTTPS检查；APK元数据在安装包同目录JSON。

本批是构建、发布与安装交付，不代表手机全功能验收或iOS验收。正式支付、云媒体资源、真实公网ZEGO回调、双端长播/系统中断等原边界仍保留，商用完整需求维持38/131（29.0%）。
