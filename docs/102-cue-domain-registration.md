# 注册、域名切换与 Android 交付

## 当前状态

- 后台：`https://cuecanvas.top/user/login`；公开下载二维码仍指向 `https://cuecanvas.top/download/`。
- App API：`https://cuecanvas.top/api/v1`；线上 API 环境的 `PUBLIC_API_URL` 已指向该地址。
- 原 `https://academy.43-160-229-173.sslip.io` 暂时保留，旧 APK 和已发出的链接可继续访问。已有内容中保存的少量旧域名图片地址仍会使用旧域名，数据库历史快照没有改写，不能声称存量链接已全部替换。
- `SMS_ENABLED=true`、`SMS_PROVIDER=aliyun`、`PREVIEW_LOGIN_ENABLED=false`。新的手机号使用短信验证码首次登录时自动创建普通用户；登录页显式显示「登录 / 注册」。真实接口通过新域名向指定号码发起短信并返回201，实际收码和真实登录未由本轮验证。
- 登录页发送验证码期间若手机号改变，旧手机号的响应不会写入新号码表单；3项针对性测试通过。
- 个人登录态按 API 地址隔离，0.3.19 从旧地址切换后会要求重新登录；既有账号和服务端订单、学习记录不变，旧地址的本机缓存及离线内容不会自动迁移。

## 已部署与验证

- API仍使用已发布镜像 `daoxue-api:20261025-aliyun-sms-01`，无数据库迁移或源码镜像变更。修改共享网关 cuecanvas 主机路由，转发后台、API、直播 WebSocket、媒体 Range 和分片上传；下载路径保持原样。网关 `nginx -t` 后 reload，API/edge按既有流程重建并健康。
- 旧后台域名仍加入CORS，旧地址和新地址的 WebSocket 分别完成真实 TLS Upgrade，未授权连接按预期4401关闭；不构成直播推流/观看的全链路验收。
- 新域名12项公网检查：健康、首页、后台登录页、分析页、下载页/海报、版本配置、直播播放器CSP，真实管理员登录、课程/直播/系统配置接口均通过，管理员会话已退出。请求记录在 `outputs/cue-domain-checks.json`。
- API基础与预览登录隔离测试23/23通过；登录页号码切换3/3通过。实际短信渠道返回成功不等于运营商最终送达。
- 切换前备份 `/opt/daoxue-academy/backups/academy-20261027T021732Z-5G2Cm1.dump` 与媒体包，SHA256验证通过；前一环境及网关备份目录 `/opt/daoxue-academy/20261026-cue-domain-01-backup/`，恢复索引 `/opt/daoxue-academy/rollback-20261026-cue-domain-01.txt`。旧业务数据未还原、未清理；服务器磁盘切换前约4.3GB可用，需监测媒体容量。
- Android 0.3.19/code24 已编译76页并使用原云端证书提交 DCloud 排队，实际APK/签名/下载入口状态以本文件后续记录为准。

## 未关闭的正式交付门禁

- 系统推送 uni-push 2.0 尚需DCloud开通与联调；本次遵照已授权预览例外，Android预览包不含系统推送SDK，站内消息保留。
- iOS 签名、IPA、Apple IAP/订阅产品与真机/App Store测试未完成；Android新包未做真机安装验收。
- 微信/支付宝真实支付、退款及商户资质、正式版权/运营主体与协议、长直播/录制容量、原生崩溃采集和长期异地备份等仍需按原计划验收。不得因换域名或云打包把这些标为商用完成。
- 为保证既有销售数据安全和旧版访问，未删除/重置已有业务数据、未更改管理员账号密码、未开放模拟收款给普通用户。
