# M06 会员购课优惠与新课提前研习

日期：2026-10-17。内部业务实现与本地验证完成；M06仍进行中，iOS会员优惠产品机制、正式渠道及原生验收保留。商用38/131（29.0%）不变。

## 1. 本轮完成与业务约定

- [x] 会员课程折扣：只使用当前有效、未撤销且未处于退款暂停的已购权益版本；支持按课程、售卖项或分类范围匹配，公开后台编辑按课程范围。无适用范围表示所有已启用参与优惠的录播课程。
- [x] 课程逐版本选择是否参与优惠；默认关闭，旧课程、旧会员、旧订单不自动增加或改变权益。录播音视频可配置，直播、训练营与线下服务不混入此入口。
- [x] 金额按整数分向上取整，与优惠券及公益价取更低金额，不叠加；明确选择拼团时采用团价，不叠加会员折扣。
- [x] 报价与下单共用选择算法；冻结会员期、套餐权益版本、权益项、比例、节省金额、到期时间。15分钟订单占位不晚于会员优惠到期。
- [x] 同账号事务锁下幂等预占；下单HELD、可信收款CONSUMED、取消/异常收款RELEASED、成功原路退款REVERSED。退款按实付金额。预支付复验权益；通知晚到按实际付款时间核查，迟到/资格失效款原路补偿，不错误授权。
- [x] 新课提前窗口：仅包含会员内容的录播课程可同时设置提前与公开时间，采用北京时间输入、明确时区传输。课程审核发布时冻结时间；公开前不收取独立购课费用，不允许提前加入免费课程以绕过。
- [x] 完整提前研习须同时具备本课内容访问权及适用的提前学习权益；提前时间前全部只能试听，公开后按普通课程权益进入。撤销/过期/退款暂停即时重算；正文、媒体票据、进度、离线许可沿统一鉴权。课程版本升级同样复验时间。旧版无窗口，独立已购旧版不受新版本时间影响。
- [x] 学习档案按同一窗口计算可用数量与章节状态，锁定内容不显示为可直接研习；试听保留。
- [x] Pro会员权益配置、课程编辑窗口、App课程详情/购买说明/学习档案及权益文案接通。保留米白墨青与宋黑体层级，复用现有卡片和提示条。后台内置会员指南补充操作顺序与价格规则。
- [ ] iOS会员优惠：当前明确不套用Android折扣或伪造商店价格，仍使用已映射Apple价格且内购门禁保持。真实产品与获准优惠机制就绪后实现并验证专属映射/原生查询购买；不能因此将完整M06标完成。
- [ ] 正式渠道、原生双端、正式媒体与实际收退款验收，本轮没有部署、新APK或手机验收。

## 2. 数据与接口

第65条增量迁移`20261017100000_course_member_benefits`：Course增加memberDiscountEligible（默认false）、earlyAccessAt/publicOpenAt（可空，配对/顺序/类型/会员内容约束）；CourseRelease增加memberPolicySnapshot（默认{}，包括参与优惠、分类和窗口），触发器禁止改写已发布策略。新增COURSE_DISCOUNT和COURSE_EARLY_ACCESS两种权益定义。不创建另一套订单或账本。

`POST /admin/membership-benefits/plans/:id/courses`：ADMIN、members.write；expectedVersion、courseBasisPoints（1000—10000）、earlyAccess、courseIds（最多50个）、reason。发布新会员权益版本，复制其他权益和原范围，旧授权不自动升级。后台读取原权益失败时允许重试，不能清空原范围后直接保存。

课程编辑仍走现有`/admin/courses`草稿/审核发布流程。现有报价、下单、订单、学习目录返回优惠或开放说明；客户端不计算最终应付、不直接修改用量。

## 3. 源码位置与调整理由

| 位置 | 修改与理由 |
| --- | --- |
| services/api/src/course-member-benefits.ts | 集中课程价格来源、用量状态与开放窗口，供交易和学习复用 |
| services/api/src/member-pricing.ts | 既有来源查询可按权益代码复用，排除停用定义及退款暂停会员 |
| services/api/src/course-sales.ts | 报价/下单同算法，冻结价格、预占/消费/释放/退回及付款时间复验 |
| services/api/src/membership-benefits.ts | 新售课程权益版本发布，保留其他权益、范围及说明 |
| services/api/src/curriculum-admin.ts | 窗口/类型校验、发布时间快照，避免草稿改动影响已交付版本 |
| services/api/src/learning.ts | 内容与窗口合并鉴权，学习档案统计/章节可用性一致 |
| services/api/src/course-versions.ts、apple-commerce.ts | 版本升级和Apple准备/可信交易同样执行时间限制；不把Android折扣传给Apple |
| apps/admin/src/pages/memberships/CourseBenefits.tsx、Benefits.tsx | 独立小表单编辑新售折扣/提前开关/范围，必填原因、冲突与加载错误处理 |
| apps/admin/src/pages/courses/index.tsx | 课程参与开关和北京时间日期输入，复用现有编辑抽屉 |
| apps/admin/src/operations/workflows.ts | 会员指南内补充两处配置顺序、权益条件与价格/售后规则 |
| apps/mobile/lib/course-sales.ts、learning.ts | 补齐DTO和用户可理解的权益名称 |
| apps/mobile/pages/course/detail.uvue、purchase.uvue、library.uvue | 开放时间/价格来源/禁售原因/锁定状态，避免把会员优惠误写为优惠券；保持现有布局 |

## 4. 验证及数据保持

- `outputs/course-member-benefits/tests-member-final.log`：11/11专项通过（包括父用例），覆盖取整、范围、版本冻结、iOS不使用Android折扣、优惠择优、失效报价、并发下单、取消、可信收款、平衡分录/原路退款、撤权异常款、迟到通知与晚付、提前/公开/正文/媒体/进度/学习档案、权限及新旧会员隔离。
- `tests.log`、`tests-final.log`：Apple课程、课程交易及会员商城既有51项均通过；早期新增测试的语法/夹具错误已在上述最终11项修复。两次相关运行有重叠，不重复累计。测试均由项目runner创建隔离数据库并清理，不操作日常测试数据或正式库。
- `browser-final.log`：5/5实际页面交互通过，API夹具验证原权益加载、必填/基点与范围提交、北京时间、优惠金额/禁售及320/390/768px；JavaScript异常0。截图`admin-course-benefits.png`、`app-early-window.png`、`app-member-quote.png`。未写财务或会员真实记录。
- API构建`api-build.log`、Pro构建`admin-build.log`通过；操作指南补记后的最终Pro构建见`admin-build-final.log`。App Web最终`app-build-final.log`成功（HBuilderX5.26配套编译器，Web为VDOM，并非原生发行包）。未进行手机或云打包。
- 本地65条迁移已应用：`local-migration.log`。183张原业务表按迁移前字段投影比较，原字段的数量和完整摘要保持：`data-before.json`、`data-after.json`及日志。新增列默认值和两条权益定义是本次预期变更，不声称迁移后整行JSON完全相同。
- 私有`.runtime/backups/course-member-before.json.gz`保留迁移前逻辑数据归档并核对压缩回读，非pg_dump/完整恢复演练。正式库未操作。原测试账号与数据保留。

## 5. 后续顺序

M06剩余正式iOS优惠与渠道资源记录为待恢复；下一可独立任务为M07会员问答配额/优先及活动优惠，再M08消费积分/退款冲回、M09基础兑换和实际履约结算。既有自动续费R15按70的资源/内部实现缺口继续，不把固定期续期当作自动续费。

2026-10-17后续关联复验：会员问答迭代的最终44项组合回归包含本章11项课程权益测试，均通过，见`outputs/member-questions/tests-final.log`；最新API/Pro/App Web构建亦通过，见75。
