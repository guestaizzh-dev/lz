# A01/A02：活动会员优先报名窗口

2026-10-13登记，验证于2026-10-12开始。此子流程已实现并本地验证；完整A01/A02及会员任务M07仍未商用验收。

## 业务规则与界面

运营可配置早于公众开放时间的会员窗口。会员与公众共用同一场次、票种和容量；公众开放后剩余席位直接开放，不另建会员库存。报名事务内重新验证当前会员、冻结版本、有效期、退款暂停、撤权及活动范围；游客登录返回原场次，App刷新可跨公众开放边界继续报名。

官方Pro套餐权益页可发布新的活动优先权益版本，并选择适用活动。旧已售版本不追加权益，内容/商城权益调整也保留活动范围与说明。独立补偿授权沿自身范围与有效期生效，会员退款不误撤独立来源。报名冻结实际优先来源，会员之后到期或撤销不取消已确认报名。优先不是免票或配额消费，不写benefitUsageId，也不阻止免费取消/延期。

付费活动仍关闭；活动优先不等于活动优惠、免票、名师问答或研学专属全部完成。延期沿原规则移动举行安排，已公布的报名开放时间保留。

## 数据与接口

第36迁移`20261012230000_event_priority_windows`已在本地应用。新增EVENT_PRIORITY权益定义，EventSession会员开放时间约束与EventRegistration.prioritySnapshot确认后不可变保护；无新表。161表含元数据、160业务模型、36迁移。原用户15、课程8、交易0、提交3、打卡2与普通学习授权/作业/人员摘要前后一致。

- `POST /admin/membership-benefits/plans/:id/events`：管理员按expectedVersion发布新版本，eventPriority、适用eventIds、reason；不改已售版本。
- 公开场次返回priorityEligible、priorityWindow、serverTime；资格采用可选登录身份，不信任客户端会员标识。
- 免费报名事务保存prioritySnapshot；公众阶段不新增优先消费记录。

## 验证证据

65/65关联HTTP/PostgreSQL回归通过，覆盖旧版、未来、到期、撤权、范围、并发容量、一次取消释放、确认后续权、退款暂停、独立补偿及内容/商城版本变更保留。7/7真实页面流程通过，errors=[]：Pro权益发布/时间配置、游客登录回跳、会员报名/来源冻结、旧会员阻断、公众开放刷新、撤权后已确认报名保留。

API、Pro类型检查/生产构建、App Web导出通过。Web是HBuilderX 5.26 VDOM，不能代替双端蒸汽原生验收；未上线、云包、更新APK或手机验收。最后线上发布仍20261012-member-shop-01/28迁移。

证据：[关联测试](../outputs/event-priority-2026-10-12/targeted-tests-final-2.log)、[页面结果](../outputs/event-priority-2026-10-12/browser-checks.json)、[API构建](../outputs/event-priority-2026-10-12/api-build-final-2.log)、[Pro类型](../outputs/event-priority-2026-10-12/admin-typecheck.log)、[Pro构建](../outputs/event-priority-2026-10-12/admin-build.log)、[App Web](../outputs/event-priority-2026-10-12/app-web-build-final-2.log)、[本地迁移](../outputs/event-priority-2026-10-12/local-migration.log)、[迁移前](../outputs/event-priority-2026-10-12/local-before.json)、[迁移后](../outputs/event-priority-2026-10-12/local-after.json)。批次不累加。

## 下一步与验收边界

A04付费预约/活动订单、A02占位超时/晚付补偿、A03付费营期及A05结算积分继续开发。X03真实收退款、X05直播回放、X07实际活动内容与现场、X08双端原生仍缺；补齐对应真实资源和端到端证据后恢复商用验收。商用38/131＝29.0%，110任务统计保持，不用已实现的子流程替代整项需求验收。
