# M07 会员活动免费与优惠票价

日期：北京时间2026-10-18。范围为会员M07活动票价子项；问答见75，优先报名见48。内部实现与本地验证不能替代真实服务、渠道及双端商用验收，商用基线38/131（29.0%）保持。

## 1. 业务规则与操作

会员管理「权益版本 → 调整新售活动票价」可设置折扣及指定活动；0%为免费，100%无价格减免。发布生成新售套餐版本，其他权益与范围复制保留，旧会员不自动追加。活动「场次与报名」设置独立票种价格及是否参与会员优惠。原订单价格和已经确认的报名不随配置变化重算。

- 报价选择本人有效冻结版本、活动/票种/分类范围内的最优折扣；整数分计算，不叠加多个会员来源。
- 付费优惠订单记录原价、优惠及实付，支付期限不晚于会员到期；可信收款按实际付款时间重新核查来源，异常款进入原路补偿。正常退款按实付金额处理，整单退完才逆转价格权益用量。
- 免费会员报名在本人填写联系方式并同意条款后直接确认，沿用真实场次库存、每人限额、预约时段和核销流程。不创建虚假现金订单、支付流水或财务凭证。
- 免费报名请求编号绑定原业务参数；结果未知可按原编号、原信息重试。权益/报价冲突自动刷新报价、撤销旧同意，不继续提交过期免费价格；按钮明确为「确认免费报名」。
- 免费报名确认后不因会员到期而取消，可以继续查看自己的报名与核销码。取消返还席位，价格权益用量标记逆转；已签到不允许本人自助取消。
- 开始前书院整场取消也释放已提前签到的免费报名，原签到事实保留。已签到的付费或配额报名仍遵守既有保护，不绕过退款、交付或额度流程。

这是限定范围的会员价格权益，**不是每月免费名额配额**；每次报名用量记录一次，实际人数保存在快照，容量与每人限制仍有效。咨询抵扣/免费咨询没有由此功能实现；现有M02通用预占/消费接口保留，实际咨询消费需单独接入和验收。

## 2. 实现位置

| 位置 | 内容 |
| --- | --- |
| services/api/src/booking-member-pricing.ts | 范围和最优价格来源、冻结用量、付款核查及逆转 |
| services/api/src/membership-benefits.ts | 新售EVENT_DISCOUNT版本发布、复制其他权益/范围 |
| services/api/src/bookings.ts | 独立票价、参与开关、免费报名取消及整场取消保护 |
| services/api/src/booking-sales.ts | 冻结报价与优惠订单、免费确认幂等、同库存、退款按实付 |
| apps/admin/src/pages/memberships/EventPricing.tsx、Benefits.tsx | 会员活动价格版本管理 |
| apps/admin/src/pages/events/TicketMemberPricing.tsx、Sessions.tsx | 票种价格、参与会员优惠及版本冲突反馈 |
| apps/admin/src/operations/workflows.ts | 后台配置、报名与取消指南 |
| apps/mobile/pages/booking/purchase.uvue、lib/booking-sales.ts、lib/learning.ts | 原价优惠展示、免费确认、未知结果重试和报价变化反馈 |

新增接口：POST /admin/membership-benefits/plans/:id/event-pricing；POST /admin/events/tickets/:id/member-pricing；POST /commerce/bookings/confirm-benefit。管理写操作验证角色、能力、原因与expectedVersion；普通报名只接受本人账号。

第67条迁移20261017120000_member_event_prices仅添加EVENT_DISCOUNT权益定义；未改写已售会员版本、票种及原订单。0—10000基点以服务端验证保存。

## 3. 验证与数据

- outputs/member-event-pricing/tests-final.log：83/83关联通过。包含会员范围和新旧版本、冻结原价与实付退款、关闭优惠保留原订单、免费与付费争抢同库存、幂等和参数冲突、会员到期后的报名/二维码、取消与签到历史、问答与原预约履约回归。
- 最终API/Pro构建通过：api-build-final.log、admin-build-final.log。App Web最终app-build-final.log通过；browser-final.log为6/6界面检查通过，JavaScript异常0、支付调用0、现金订单创建0，含原提交重试、过期报价关闭和320/390/768px。UI使用API夹具，不写实际会员/库存/财务；Web构建不代表原生签名包。
- 本地应用67迁移，local-migration.log及data-before.json/data-after.json记录183张原业务表的原字段完整摘要保持；新增权益定义为预期变化。私有逻辑归档.runtime/backups/member-event-pricing-before.json.gz已压缩回读校验，并非pg_dump或整套恢复演练。后续后台登录产生的正常会话变化不属于迁移数据改写。
- 未操作正式库、未部署、未生成新APK、未做手机验收。真实活动、人员、渠道及双端实际服务仍需正式验收；ME12/A01不由本地用例改成商用已完成。

## 4. 下一任务

按26继续会员M08有效消费积分成长、退款冻结/冲回及负债抵扣；先核对已有R2积分兑换和互动规则，复用原账户/流水/交易事实，再处理M09基础兑换。不得把已存在的R2入口误报为本轮新增或商用验收。
