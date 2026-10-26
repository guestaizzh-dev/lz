# 老子道学书院 · 文档入口

短信接入新增：[100 阿里云验证码](100-aliyun-sms.md)（API已发布，凭据已私有配置，真实调用因 RAM `NoPermission` 待授权与收码验证）。

产品形态：Android / iOS App ＋ Web 运营后台。原文中的“小程序”已按用户纠正改为 App，七个业务板块全部保留。

最新发布：**`20261025-review-polish-01`**（课程/直播/会员/订单/阅读与响应式修复），Android 0.3.18/code23；见[99 发布记录](99-review-polish-release-20261025.md)与[24 线上部署](24-online-deployment.md)。业务总览见[87](87-project-business-and-architecture-map.md)。

## 现在只看这几份

| 想知道什么 | 看哪里 |
| --- | --- |
| 本次发布与 APK | [99 评审优化发布（2026-10-25）](99-review-polish-release-20261025.md) |
| --- | --- |
| 上线前风险与本轮修复 | [90 上线前全量评审](90-prelaunch-review.md) |
| 课程售卖/观看与直播链路 Review | [91 代码与交互 Review（2026-10-25）](91-code-and-interaction-review-2026-10-25.md) |
| 桌面端响应式与视觉一致性 | [92 宽窗口版式与焦点/反馈统一](92-desktop-responsive-and-visual-polish.md) |
| 直播查询与支付状态反馈 | [93 直播房间批量查询、超时/待确认支付提示](93-live-room-performance-and-payment-feedback.md) |
| 会员中心与订单反馈 | [94 会员状态、套餐刷新、用量分页与超时订单](94-membership-state-feedback.md) |
| 列表首帧与订单卡片 | [95 列表空状态首帧、预约/训练营订单卡片统一](95-list-first-frame-and-order-cards.md) |
| 直播准入去重与订单分页错误 | [96 直播房间按规则复用准入、订单追加加载局部提示](96-live-room-access-grouping.md) |
| 会员并行取数与数据态截图 | [97 会员中心并行请求、真实套餐桌面/手机截图](97-membership-parallel-load-and-data-shots.md) |
| 阅读页状态与评论反馈 | [98 文章返回保留点赞/标注、字号显示、评论错误处理](98-reading-state-and-comment-feedback.md) |
| 现在做到哪了、还差什么 | [83 现状核对与剩余缺口](83-status-and-gaps-2026-10-19.md)（唯一状态入口） |
| 下一步做什么、怎么验收 | [26 剩余开发计划](26-remaining-development-plan.md) |
| 业务范围与验收口径 | [01 产品需求](01-product-requirements.md) |
| 技术选型与外部依赖 | [02 技术调研与决策](02-technical-research-and-decisions.md) |
| 商用审查基线（只读快照） | [25 商用完成度审查](25-commercial-readiness-review.md)（38/131） |
| 给客户看的材料 | [客户版功能说明](../outputs/client-review-2026-10-19/老子道学书院_功能与交付说明_客户版_20261019.docx) |

## 一页事实（2026-10-25 发布后）

| 项 | 值 |
| --- | --- |
| 线上版本 | `20261025-review-polish-01`，81次迁移，198张public表（含迁移表） |
| 线上地址 | https://academy.43-160-229-173.sslip.io（后台 `/user/login`） |
| 安装包 | [Android 0.3.18/code23](../outputs/android/daoxue-academy-0.3.18.apk)，50,017,681字节，生产HTTPS、与0.3.17同证书、无系统推送预览；未做手机/iOS验收 |
| 演示账号 | 学员 `19900001002` / 验证码 `123456`（预览入口 10-25 18:06 北京时间到期）；后台 admin 口令见 `.runtime/online-admin-access.json` |
| 商用完成度 | 38/131（29.0%），正式渠道、原生、版权运营及89列明的具体依赖仍未全部验收 |
| 本轮核查 | 837全量、21项公网/后台检查、2项只读冒烟；18类业务计数一致 |
| 本轮核查 | 820全量、38性能及15导出关联、10隔离页面、5线上页面、29公网检查 |

## 文档索引

**产品与需求**
- [01 产品需求与实施契约](01-product-requirements.md)
- [04 UI 设计规范](04-ui-design-spec.md)、[06 App 版式参考](06-app-reference-implementation.md)
- [11](11-v03-no-payment-no-live-planning.md)、[12 内容阅读规划](12-v03-content-reading-plan.md)（历史规划，已被 01 取代）

**技术**
- [87 项目业务链路与架构总览](87-project-business-and-architecture-map.md)
- [02 技术调研与决策](02-technical-research-and-decisions.md)
- [07 数据库与接口契约](07-database-and-crud.md)、[35 管理层技术说明](35-technical-overview-for-management.md)
- [17 发布与恢复](17-release-and-recovery.md)、[24 线上部署记录](24-online-deployment.md)

**计划与进度**
- [26 剩余开发计划](26-remaining-development-plan.md)（110 个执行任务）
- [33 进度汇总](33-development-status-summary.md)（保留历史流水）
- [83 现状核对](83-status-and-gaps-2026-10-19.md)（当前）

**交付记录（按时间，证据在 outputs/）**
- 基础与内容：27、28、29、30、31、32、34、36、37
- 预约 / 活动 / 营期：38—53（42 报名隔离、43 分日排程、44 专属教学、46/47 核销与履约、49/50 付费订单、51 拒约协商、52/53 付费营期与补偿）
- 直播与媒体：54/55（ZEGO RTC）、56、57、63（大课件）、58（0.3.5 真机）
- 后台：59（导航与指南）、60（财务与恢复）
- 体验：61（全页面走查）、71（细节）、81（一致性）、82（视觉 v2）、84（直播开播台）
- 会员与内容：64/65（内容联动、分享、名师）、66—70（M08/M09 增强）、73—80（退款核查、课程优惠、问答配额、活动票价、积分与消费奖励）
- App 构建：58、61、62、81、82 及 `outputs/android/`

**测试与数据**
- [22 测试账号与数据](22-manual-test-data.md)、[23 自动化测试](23-automated-test-report.md)
- [21 后台使用与数据清理](21-admin-usage-and-data-cleanup.md)

**历史**
- [archive/README-history-2026-10-19.md](archive/README-history-2026-10-19.md)：原 README 的日期流水，仅作证据保留。

## 几条硬规矩

1. 文档里的“已实现”不等于“已验收”。商用完成度只认真实收款、真机、真实内容与商店上架。
2. 部署成功、构建成功、页面能点，都不提高 38/131。
3. 方案与计划不能当已完成证据；遇阻塞如实记录原因与恢复条件。
4. 不覆盖原始 Word，不提交真实密钥、签名私钥和网页缓存。
5. AI 经典解读、虚拟名师、线上道场属于 R3 展望，不在本期范围。


- [85：管理员直播与ZEGO服务端本地录制](85-live-admin-simplification.md)：本轮代码、真实录制、UI证据及待发布边界。
