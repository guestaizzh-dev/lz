# 2026-10-25 发布：评审优化与 Android 0.3.18

本轮把 91—98 的课程/直播/会员/订单/阅读与响应式修复发布到线上，并交付 Android 预览包。未新增数据库迁移，未改支付、短信、推送、RTC、录制的开关。

## 发布信息

| 项 | 值 |
| --- | --- |
| 发行 | `20261025-review-polish-01` |
| 源码 | `2f4f4f7`（`fix: polish course, live, membership, order and reading interactions`） |
| 上一版 | `20261022-prelaunch-review-01` |
| API 镜像 | `daoxue-api:20261025-review-polish-01`，image id `sha256:7c9e7ea19cf15fa2b79ac5fdebbe72af865bf6ec1b5afd56a840e2f9eddfc438`（运行中 `daoxue-api-1` 同一 id） |
| 迁移/表 | 81 迁移、198 张 public 表，`migrate` 无待应用迁移 |
| 备份 | `academy-20261025T102130Z-Gs2nSD.dump`（切换脚本选用，含媒体包与 sha256） |
| 回滚 | `/opt/daoxue-academy/rollback-20261025-review-polish-01.txt`；环境备份 `production.env.before-20261025-review-polish-01` |
| 后台 | 静态资源未重建（本轮无后台代码改动），首页哈希与本地一致 |

## 发布内容

课程：报价哈希去掉易变直播状态、超时/待确认支付提示、购买刷新轮换幂等键、学习页刷新不遮挡、视频高度自适应。
直播：管理员场次入口统一单场约束与录制任务、取消场次不再产生无法发布回放、心跳记账不踢人、房间回放/录制批量查询、按规则复用准入、列表主推去重与过期场次文案、观看页未登录提示。
会员：刷新不清空会员/权益、分页用量错误局部化、并行取数、超时订单文案、订单去重副标题与生效期。
订单/列表：`ready` 门控首帧空状态、追加加载局部错误与页码回退、预约/训练营/核验卡统一纸面样式。
阅读：返回页面保留点赞/标注、字号显示当前值、评论首帧与追加回复错误处理。
Web：内容列 720 居中、页头/底栏对齐、键盘焦点样式、`viewWidth` Web 上限。

## 验证

- 发布前隔离数据库全量 **837/837** 通过（559 秒），日志 `outputs/review-2026-10-25/api-full-tests-before-deploy.log`。
- 18 类业务表计数前后一致；`migrate` 输出无待应用迁移；API healthy。
- 21 项公网/后台检查通过：健康、首页、后台登录、直播管理、指南、分类、课程、商品、活动 200；播放器 JS/CSS 与后台首页 sha256 一致；录制 ready（1 场预告）；通用课程数据入口 403；未登录诊断 401；数字订单/对账/事故/发布配置 200；临时管理员会话已退出、无新业务记录。证据 `outputs/deploy-2026-10-25-review/public-checks.json`。
- 只读冒烟：`/live/rooms/:id` 200（1 场，`rtcReady=true`，历史录制 `replayStatus=FAILED` 未处理）；课程报价 200（示例课不可收款、付费视频课报价正常返回）。证据 `smoke.json`、`quote-smoke.json`。
- `academy-watch.timer`、`academy-backup.timer` 均为 active；清理旧镜像 `20261019-sim-06`、`20261021-internal-closure-03` 与退出容器后磁盘可用约 9.7GB（83%）。
- 发布过程：构建日志 `build.log`、切换日志 `switch.log`、数据库计数 `db-counts.json`（18 类一致、81 迁移/198 表）。

## Android 0.3.18

| 项 | 值 |
| --- | --- |
| 版本 | 0.3.18 / code 23 |
| 文件 | `outputs/android/daoxue-academy-0.3.18.apk`，50,017,681 字节 |
| SHA256 | `471d7f3f9bea03c3e9377c823109333a977aa23f6fbe03deb5aa41963399f4c5` |
| 包名/架构 | `cn.daoxue.academy`，arm64-v8a，minSdk 23 |
| 签名 | 云端证书，SHA256 `81d6c07a…`，与 0.3.17 相同，可覆盖升级 |
| 内容 | 生产 HTTPS、无系统推送（预览变体）、站内消息保留、安全存储/RTC/离线模块编译、客户端诊断 |
| 打包 | HBuilderX 5.26 云端证书，ticket `bbb74ca0-d05b-11f1-a4dd-b772ee468eb5`，76 页面编译通过 |

证据：`outputs/android-preview-0318/`（`pack-submit.log`、`pack-status.json`、`build-summary.json`、`profile.json`）与 APK 同目录 JSON 校验结果。**未安装手机、未做真机/iOS 验收，未上架商店。**

## 边界与未完成

- 本次是代码/后台发布，不等于真实收款、短信、推送、RTC 长时录制或原生体验验收；商用完成度仍为 38/131。
- 数据库会话的 `statement_timeout`/`lock_timeout` 显示 0（API 连接级设置，未改）；保持既有约定。
- `/api/v1/configuration/release` 仍为空，App 更新提示未配置；0.3.18 以文件交付。
- 报价对个别课程返回 `paymentEnabled=true`（服务端渠道开关现状，未改）；App 无支付 AppID，购买页仍不会发起真实收款。
- 历史录制失败 `replayStatus=FAILED` 与直播长时容量仍按 85/26 跟踪。
- 购课/播放/直播数据态真机与登录态视觉仍未验收。
