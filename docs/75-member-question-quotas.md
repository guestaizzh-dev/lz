# M07 会员专属问答配额、优先与履约

日期：2026-10-17。范围是会员阶段任务M07的问答子项，活动免费/优惠票价尚未接入，不将完整M07标为已完成。正式运营服务与双端商用验收保留，商用38/131（29.0%）不变。

## 1. 业务决定与操作

普通研习提问保留。用户在名师提问弹窗主动选择「使用会员专属问答额度」，显示本老师适用的本周期剩余次数、计次和退额规则。不能在后台直接修改次数流水。

会员套餐「权益版本 → 调整新售问答权益」配置北京时间自然月次数（0—100）、是否优先以及指定名师；未指定表示适用已开放问答的名师。指定名师必须已发布并关联有效TEACHER答复账号。发布生成新售版本，其他权益/范围复制保留，旧会员不自动增加新额度。24小时仍最多提交10条问题。

- 提交：按原授权版本、名师范围、实际周期及剩余额度事务预占HELD；同提交编号重试不重复占用，更换内容、范围或会员选择不能复用原编号。
- 私人答复：仅所属老师或管理员答复，直接交付并CONSUMED。
- 公开答复：草稿仅工作人员可见，用户自己的列表也不提前显示未经审核的内容；审核通过后公开、通知并CONSUMED。审核拒绝回到待答，继续保留HELD，可由老师重新答复或本人取消。
- 答复前取消：仅本人，确认后CLOSED并RELEASED；重复取消不重复返额。老师无法答复：填写给学员的说明，REJECTED并RELEASED，说明、通知与审计均保留。
- 问题已接收后，即使会员到期/撤销仍继续履约；老师档案下架后，负责老师仍可在后台处理原问题。不能以到期自动取消或伪造答复。
- 优先：冻结提交时的套餐约定；后台先待答、再会员优先、再先到先答，并在分页查询时执行排序。会员到期不取消已接收问题的优先，不承诺即时答复。

App「我的 → 我的问答」独立查看原问题和老师答复；答复通知也到该页面。该入口不依赖老师档案仍在公开展示，避免收到通知却打不开原服务记录。原问答正文仍支持复制，保留现有宋黑体、米白墨青与简洁列表风格。

## 2. 实现位置

| 位置 | 作用 |
| --- | --- |
| services/api/src/questions.ts | 专属提问预占、本人取消、老师拒答、先审后交付计次、统一锁顺序、优先分页、私人历史/说明 |
| services/api/src/membership-benefits.ts | 共用额度范围匹配和只读剩余额度，问答新售版本发布，其他权益与范围保留 |
| services/api/src/message-target.ts | 老师答复通知改到本人问答，脱离公开名师档案依赖 |
| apps/admin/src/pages/memberships/QuestionBenefits.tsx、Benefits.tsx | 读取原额度、按月次数/优先/名师范围、原因和冲突处理 |
| apps/admin/src/pages/questions/index.tsx | 会员/优先标识、答复前无法履约说明、用量规则提示 |
| apps/admin/src/operations/workflows.ts | 会员指南内补充配置、队列和取消/计次流程 |
| apps/mobile/components/TeacherQuestions.uvue | 主动选额度、剩余读取/重试、取消确认、状态说明；切账号/名师隔离旧请求；问答显示所属名师 |
| apps/mobile/pages/teacher/questions.uvue、pages/profile/index.uvue、pages/auth/login.uvue、pages.json | 独立我的问答入口、通知落点、登录后的问答回跳及窄屏布局 |

第66条迁移`20261017110000_member_questions`仅增加TEACHER_QUESTION权益定义和非空benefitUsageId唯一索引，复用已有TeacherQuestion/TeacherAnswer/BenefitUsage/BenefitScope/审计通知，不另建用量账本，不重写历史提问。

新增接口：`POST /admin/membership-benefits/plans/:id/questions`（ADMIN及members.write）；`GET /teachers/:id/question-benefits`（本人）；`POST /me/questions/:id/cancel`（本人+expectedVersion）；`POST /admin/questions/:id/decline`（所属老师/ADMIN、questions.write、expectedVersion、reason）。既有提问增加可选useMemberQuota，默认普通提问，保持旧客户端兼容。

## 3. 验证与边界

- `outputs/member-questions/tests-final.log`：44/44关联通过，含8个问答子用例及父用例、原研习互动、基础会员用量、课程会员权益和消息目标回归。覆盖并发额度/重试、范围、本人取消/答复竞争、私人/公开审核计次、草稿不泄露、到期/名师下架后履约、拒答说明/通知、优先分页、不同老师隔离、新旧会员与权限。
- 发现新增测试曾改动隔离库的共用套餐，影响后续用例；已在两个新增套件结束时恢复原套餐指针和描述，最终44项组合回归通过。没有通过放宽业务断言掩盖问题。
- API最终构建`api-build-final.log`、Pro最终构建`admin-build-final.log`通过；App Web最终构建`app-build-final.log`通过。Web编译器5.26/VDOM，不是原生安装包。
- 本地第66条迁移应用：`local-migration.log`；183张原业务表的原字段完整摘要/数量保持，新增一条权益定义是预期变更：`data-before.json`、`data-after.json`及对应日志。私有逻辑归档`.runtime/backups/member-questions-before.json.gz`已核对压缩回读；非pg_dump/完整恢复演练。正式库未操作。
- 浏览器交互检查见下方最终结果；仅API夹具，不写实际会员、问题或财务记录。
- 活动票价减免、真实答复人员/服务约定、正式渠道与双端仍需后续交付和验收。本轮无部署、新APK或手机验收。

## 4. 下一项

继续M07公益活动免费/优惠及预约消费权益，随后按26执行M08结算积分/退款冲回、M09基础兑换和实际履约结算。真实iOS优惠、自动续费及其他外部资源仍按既有恢复条件处理，不以内部用例代替商用验收。

## 5. 实际界面收尾

- 6条浏览器交互通过：`outputs/member-questions/browser-check.log`；最终源码构建后的`browser-final.log`再次6/6通过。覆盖新售额度加载/原因与范围、后台优先标记/拒答、登录回跳/主动会员提问/剩余与计次说明、取消确认与列表刷新、名师档案下架后的本人答复、320/390/768px；JavaScript异常0。API夹具，无实际业务写入。
- 发现原登录回跳白名单不含问答页面，已补充严格限定的名师详情/本人问答路径；提问/我的问答登录后回到原入口，不再丢回个人中心。
- 截图：`admin-benefits.png`、`app-compose.png`、`app-own-questions.png`。会员/私人/优先标识与所属名师同时呈现，不展示无意义ID。

最终本地API健康检查200：`local-health.log`；本轮关键源码及测试哈希：`source-manifest.json`。后台预览与API已加载最新本地代码；线上和原生安装包未变。
