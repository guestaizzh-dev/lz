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
- 新域名12项公网检查：健康、首页、后台登录页、分析页、下载页/海报、版本配置、直播播放器CSP，真实管理员登录、课程/直播/系统配置接口均通过，接口测试会话已退出。请求记录在 `outputs/cue-domain-checks.json`。浏览器实测发现登录后访问根路径会被旧规则送到下载页；已将根路径改为跳转后台工作台，复测登录后到达 `/dashboard/analysis`，0 JS错误，下载二维码路径不变。
- API基础与预览登录隔离测试23/23通过；登录页号码切换3/3通过。实际短信渠道返回成功不等于运营商最终送达。
- 切换前备份 `/opt/daoxue-academy/backups/academy-20261027T021732Z-5G2Cm1.dump` 与媒体包，SHA256验证通过；前一环境及网关备份目录 `/opt/daoxue-academy/20261026-cue-domain-01-backup/`，恢复索引 `/opt/daoxue-academy/rollback-20261026-cue-domain-01.txt`。旧业务数据未还原、未清理；服务器磁盘切换前约4.3GB可用，需监测媒体容量。
- 原正式源码 Android 和 iOS 各76页蒸汽资源导出成功（不等于原生签名包）；Android 0.3.19/code24 预览 APK 云打包成功，50,017,760字节，SHA256 `606d72470b6e368e0302c326fc70c71b1069e14e23017db3a0552b48f0ad34df`。包内355个运行资源扫描无旧API域名，确认 `https://cuecanvas.top/api/v1`；原云端证书与0.3.18一致，JAR验签通过。502文件比较仅两项已授权无系统推送预览覆盖；未安装手机。
- 固定下载入口已原子切换到0.3.19，后台版本发布配置 revision 1→2；公网下载页200、APK Range206、二维码200，服务器完整APK SHA256与本地一致。旧二维码与分享海报继续使用，0.3.18下载目录保留；指针回退记录 `/opt/daoxue-academy/download-0319-rollback.txt`。本机APK `outputs/android/daoxue-academy-0.3.19.apk`，元数据及发布证据在 `outputs/android-preview-0319/`。下载页面6组浏览器检查通过。

## 未关闭的正式交付门禁

- 系统推送 uni-push 2.0 尚需DCloud开通与联调；本次遵照已授权预览例外，Android预览包不含系统推送SDK，站内消息保留。
- iOS 签名、IPA、Apple IAP/订阅产品与真机/App Store测试未完成；Android新包未做真机安装验收。
- 微信/支付宝真实支付、退款及商户资质、正式版权/运营主体与协议、长直播/录制容量、原生崩溃采集和长期异地备份等仍需按原计划验收。不得因换域名或云打包把这些标为商用完成。
- 为保证既有销售数据安全和旧版访问，未删除/重置已有业务数据、未更改管理员账号密码、未开放模拟收款给普通用户。
