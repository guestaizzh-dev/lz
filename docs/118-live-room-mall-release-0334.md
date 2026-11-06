# 118 · 直播间与商城发布 0.3.34

## 已发布

API/后台 `20261102-live-room-mall-0334`，85 迁移不变，21 类业务表计数保持。直播间全高布局、底部互动与设置面板、后台 OBS 设置弹窗、商城生活馆商品/课件视频/图书分栏已发布。生活馆铜银金钻折扣 95/90/85/80%，图书 99/98/97/96%；报价按商品 membershipPriceCategory，课件沿用课程购买权益。

录制 PREPARING 无媒体空闲正常退出恢复 WAITING，不消耗失败重试；真实异常仍累计失败。47 关联测试、17 浏览器组及静态门禁通过；RTC 页面替身不计真实媒体验收。

Android 0.3.34/code39，50,152,820 字节，SHA256 `b7a0eb67dbd7e7fcac8d7476bf10f311642b22960183a6f80c8ce3ddc0ebea8c`，云任务 `ca7cb4d0-d731-11f1-863f-9912326ac04e`；原证书 v1/v2 验签通过。下载页已更新，release revision15；证据 outputs/android-preview-0334、outputs/deploy-0334。

## 运维

主机 ubuntu@43.160.229.173，目录 /opt/daoxue-academy。备份 academy-20261103T031344Z-oQgmOK.dump 与媒体包校验通过；回退 rollback-20261102-live-room-mall-0334.txt。发布后磁盘约 11GB 可用，旧备份与业务媒体保留。

## 发布后实际反馈（未关闭）

用户手机黑屏、原生按钮/输入文字对齐、直播评论不应前置审核、连麦与后台保活，进入 [119](119-live-media-and-lifecycle-fixes.md)。不得以编译和替身页面通过覆盖真机缺陷。

实际 OBS 流只读诊断：ZEGO Web SDK 返回 1003081，extendedData 为 B-frame is detected in the bitstream，视频解码 0 帧、尺寸 0；公网流已接通但不可解码。当前 client.js 已热修解码异常提示（无重启），SHA256 fb9d4ba296126f87f3f81a6151a4a6264d2a474e3cd4c810d9cbba1a252e7513；运行容器与发布源码覆盖，镜像本体未包含，后续发布须纳入。备份 /opt/daoxue-academy/live-player-before-bframes-0334.js。

合成 WHIP 传输 40 样本中位延迟 187ms，p95 1700ms，仅代表合成 WebRTC 传输，不代表 OBS/手机延迟。证据 outputs/obs-mode-diagnosis。无手机/iOS正式验收，商用 38/131 不变。
