# A02/A04/A06：付费预约与活动订单

2026-10-13。原价订单、共用席位、收款确认与截止前整单退款子流程已实现。本地验证与页面证据见下文；完整A04、付费履约和商用验收仍未完成，正式收费开关保持关闭。

## 实际业务流程

老师预约和服务商品共用AppointmentSlot，活动票种共用EventSession总容量。下单前由服务端计算报价，冻结服务说明、安排、取消截止、单价、数量、会员优先来源和渠道；联系人单独加密，不进入公开订单快照。老师时段固定一人，活动按票种每人上限与场次总容量检查。免费入口保留原流程，不能绕过付费。

订单占位最多15分钟，并不晚于服务预约截止或活动开始；库存、待确认预约/报名、订单、审计和恢复任务在同一事务创建。重试同一请求只占一次；已有待支付订单可直接返回处理，不重复占位。商品发布允许与统一服务一致的付费报价，不另建SKU库存；示例师资、示例商品和示例活动不可真实收费。

微信/支付宝沿用已有验签适配和统一通知入口。仅渠道已验证事实确认预约：校验商户、应用、原渠道尝试、交易号、金额、币种与时间；并发通知只产生一次付款、一次确认、一次库存转换和一次通知。订单变为PAID/预约CONFIRMED，不冒充实际履约完成。正常收款记BOOKING_ADVANCE待履约预收负债；异常款记BOOKING_REFUND_PAYABLE，尚不确认实际服务收入、积分或合作分成。

取消或超时先核查渠道。支付正在发起、查询失败或渠道状态未知时保留占位；查到付款先确认，查到未付才关闭渠道并释放。取消期间锁定订单，避免查单后并发重新发起支付。迟到、取消后支付、金额不符、重复收款、停止交付或已开始无法履约的收款自动进入持久原路退款任务；不复活已释放名额、不挤占其他买家，重复款不撤原有效预约。

截止前且未签到/履约可申请整单原实付退款。申请立即将原预约/报名设为CANCEL_PENDING，暂停老师联系信息和活动签到；名额保留。财务审核拒绝恢复原安排，通过或重试仅开始渠道退款。渠道处理中或失败保留暂停及库存；渠道成功才产生不可变退款事实、冲回原预收/异常负债并释放一次库存。异常收款必须继续退回，不能拒绝为有效收入。部分参加、超过截止、已开营和已开始服务的争议处理仍待后续业务流程。

## App与官方Pro

App保留既有书院版式，新增预约活动订单详情与列表。付费场次进入售前说明，免费直接确认；原订单显示北京时间、服务端占位倒计时、单号复制、原规则、渠道核查、退款弹窗和办理进度。下单网络结果未知时锁定原提交与请求编号，允许重试原请求；确定性校验失败可修正重提。已确认报名有订单售后入口，消息返回对应订单；负责老师通知回工作台，不泄露学员订单。

Pro沿官方模板增加「预约与活动交易」：分页/状态/单号查询、冻结说明、已验证收款、退款审核拒绝/重试与恢复任务提示。后台复用orders.read与finance.refund，客服/运营不能退款，老师不能跨服务查看电话。经营看板纳入预约活动收退款与退款待办，并说明预收不等于实际服务收入或提现余额。付费服务禁止通过免费履约按钮伪造完成；注销先按真实查单规则处理未付款占位，未结交易和服务继续阻止注销。

Web、iOS未接通此业务原生支付，明确禁收费；Android仍须相同服务端开关和实际客户端支付模块。未完成数字训练营的Apple内购，不能用预约渠道规避。

## 数据与接口

第37迁移`20261013010000_booking_sales`已应用本地，新增预收/收入/异常负债三类记账科目、查询索引、每订单项一次预约库存预占约束及不可变购买快照保护；无新增业务表。仍为161表含元数据、160业务模型、37迁移。既有Appointment/EventRegistration、TradeOrder/Item、InventoryReservation、PaymentAttempt/Transaction、Refund/Item/Transaction、FinanceJournal/Entry、ProviderCallback、OutboxJob与Notification承担事实，不建第二套订单或库存。

- `POST /commerce/bookings/quote`：登录身份、kind、resourceId、quantity、platform，可选服务skuId；金额从服务端取得。
- `POST /commerce/booking-orders`：报价hash、幂等requestKey、渠道和授权联系人。
- `GET /commerce/booking-orders`、`GET /commerce/booking-orders/:id`：本人订单与合法动作。
- `POST /commerce/booking-orders/:id/payment|refresh|cancel|refund`：发起、查单、安全取消、退款申请。
- `GET /admin/booking-orders`、`GET /admin/booking-orders/:id`、`POST /admin/booking-orders/:id/refresh`。
- `POST /admin/booking-orders/refunds/:id/review`：FINANCE及finance.refund双校验，expectedVersion、APPROVE/REJECT/RETRY、已核实意见。
- 持久任务BOOKING_PAYMENT_CHECK、BOOKING_REFUND：租约、有限退避、失败DEAD、旧租约不覆盖新领取；财务可核查/重试原退款。

## 本地验证

95/95关联HTTP/PostgreSQL回归通过；末次22/22预约订单与看板专项通过，两批重叠，不相加。覆盖渠道/平台/样例禁收费、联系人授权、SKU与老师共用库存、同请求重试/多人竞争、原报价冻结、支付未知/断网保留、超时查单、重复/晚付/错额补偿、会员优先撤权、角色与私密信息、退款暂停/拒绝恢复/确认后一次释放、统一通知路由及防免费履约旁路。支付适配器在隔离库使用受控替身验证事务与异常；不是正式收退款。

API构建、Pro类型检查/生产构建、App Web导出通过。App最后一次导出无新增warning；HBuilderX 5.26 VDOM不是双端蒸汽验收。8/8实际页面流程通过，errors=[]：登录回原订单、取消释放、报名进入售后、退票弹窗、Pro隐私详情、财务审核、退款确认一次释放及Web禁收费。页面验证结果以[页面结果](../outputs/booking-sales-2026-10-13/browser-checks.json)为准；页面业务请求转发到隔离真实API，App真实测试OTP/后台受控会话，付款和退款事实仍为隔离适配器，不冒充商用。

迁移前后用户15、课程8、交易0、营期0、提交3、打卡2保持；普通Enrollment、Assignment、PracticeTask、CourseStaff完整摘要一致。审查快照25哈希保持c24a94ff6fb6e1735cc85b57a0412a249858dd2d77d1cfd46edf771958222d04。

证据：[关联回归](../outputs/booking-sales-2026-10-13/targeted-tests-final-3.log)、[末次专项](../outputs/booking-sales-2026-10-13/booking-tests-final.log)、[API构建](../outputs/booking-sales-2026-10-13/api-build-final-6.log)、[Pro类型](../outputs/booking-sales-2026-10-13/admin-typecheck-final-2.log)、[Pro构建](../outputs/booking-sales-2026-10-13/admin-build-final-2.log)、[App Web](../outputs/booking-sales-2026-10-13/app-web-build-final-2.log)、[迁移](../outputs/booking-sales-2026-10-13/local-migration.log)、[迁移前](../outputs/booking-sales-2026-10-13/local-before.json)、[迁移后](../outputs/booking-sales-2026-10-13/local-after.json)。[最终页面日志](../outputs/booking-sales-2026-10-13/browser-checks-final-3.log)与截图同目录。早期页面脚本在后台导出未结束时读取目录产生500，改为等待构建完成；Ant文本框和uni按钮定位修正后8项全部通过，未放松服务端断言。

## 当前下一步与资源条件

1. A04付费安排延期/整场取消、学员确认退出、老师拒绝与争议退款补偿，继续扩展原工作流；不能走免费整场取消覆盖收款事实。
2. A03付费训练营订单/固定版本/分日教学、退出及已开营补偿；Android与Apple数字购买各走适用渠道。
3. A05付费实际履约、部分交付补偿、预收转收入、结算积分及退款冲回；原签到不等于交付。
4. A07仍依L04真实直播/回放，A08依完整付费与实际现场；X03须正式商户/原生身份/真实小额收退款，X05须真实直播/录制，X07须真实服务合同内容及现场记录，X08须双端蒸汽构建与原生支付验收。资源齐全后恢复相关商用验收，继续开发独立流程。

本批未连接线上、未部署、未云打包或更新APK。最后线上仍20261012-member-shop-01/28迁移。商用38/131＝29.0%保持，免费/隔离流程或新增页面不替代七板块R1/R2验收。
