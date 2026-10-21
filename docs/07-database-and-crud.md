2026-10-21补充：当前线上80次迁移、198张表（含迁移表）。第75—80迁移分别补首次资料领取事实、CommercePartnerRule/CommerceFeeEvidence/CommercePartnerShare/CommercePartnerRevenue、账单修订唯一约束、咨询抵扣定义、OperationsIncident/OperationsIncidentEvent与新数字消费触发器。规则/合约/订单/账务不允许通用CRUD改写；新表完整字段见prisma/schema.prisma与对应手写migration.sql，业务约束和入口见[89](89-internal-business-closure.md)。原业务数据未重新seed或覆盖。

2026-10-18结构增量：第70迁移新增ServiceDelivery，完整字段与约束以[迁移SQL](../services/api/prisma/migrations/20261018120000_paid_service_delivery/migration.sql)及Prisma模型为准；业务流程与验证见[79](79-paid-service-delivery-and-recognition.md)。原183张业务表原字段摘要保持，新增表仅由订单履约流程维护，不开放通用编辑。

2026-10-15 M06第46迁移：新增NotificationPreference（userId文本主键并外键User、version正整数默认1、updatedAt timestamptz、pushEnabled默认false、transactions/learning/community布尔默认true）；DeviceToken新增sessionId可空外键AuthSession与索引、boundAt timestamptz默认now；NotificationDelivery新增deviceVersion整数默认1。Notification插入触发器同事务写原OutboxJob、eventKey唯一去重，不新建平行消息队列。所有偏好/设备/投递由鉴权专用流程处理。已应用本地迁移，15类原业务数量保持；正式库未变更，见[65](65-m06-sharing-and-teacher-profiles.md)与[迁移](../services/api/prisma/migrations/20261015140000_notification_delivery/migration.sql)。

2026-10-14第43迁移（57）：CourseChapter/Lesson新增subtitleText（text，默认空，200000字符），LiveReplay新增subtitleText及notes（50000字符），Lesson字幕触发器禁止修改。均由课程/回放专用审核流程生成，不开放通用CRUD；既有161业务模型/162表保持。迁移本地已应用，12类原业务数量与摘要一致，未上线。完整字段及验证见[57](57-media-and-live-delivery-hardening.md)与[迁移](../services/api/prisma/migrations/20261014100000_media_subtitle_delivery/migration.sql)。

2026-10-14当前直播交付续办（55）：用户明确暂缓云录制；采用ZEGO RTC实际开播观看与人工上传审核回放。直播课程固定版本场次、老师本人开播台、观看时长、实际回放时长与取消停止交付补偿已实现。79关联回归、12实际页面流程及4条真实RTC链路通过，API/官方Pro/App Web构建通过；第42本地迁移已应用，原数据摘要保持。backend/admin已部署20261014-live-r1-01，11公网检查通过，19类原核心业务数据计数及摘要一致；原生、公网服务商回调及正式交易未验收，商用38/131保持。详见[55](55-live-course-r1-delivery.md)。

2026-10-13历史直播记录（54）：按用户决定改用ZEGO RTC；五类场次/短期准入、预约改期提醒、评论引用治理、人工审核回放及关联交易卡已实现。本地38项关联回归、9条实际页面流程及API/Pro/App Web构建通过，第41迁移已应用、161业务模型/162表且原规范数据摘要保持。实际RTC推流解码成功，但跨房间与观众推流仍未拒绝，权限门禁保持关闭；云录制/VOD、直播课程绑定、原生及完整L06未验收。下一L04与实际服务商权限/回调联调，未部署/更新APK，商用38/131不变，见[54](54-zego-rtc-live.md)。

2026-10-13历史记录续办（53）：付费营期整体延期/取消、已开营延长结营期限及本人同意协商退款已实现并本地验证；原安排/教学日期/学习成果保留，取消补退余额且一次释放。180关联回归、9实际页面及API/Pro/App Web通过；第40本地迁移已应用，161表/160模型和规范数据保持。下一A05付费实际履约、预收收入/结算积分，再iOS营期及A01/M07差异票价优惠和A07/A08联动验收。完整M04/CO05及商用38/131保持未验收，未部署/更新APK，见[53](53-cohort-schedule-and-compensation.md)。

2026-10-13历史记录续办（52）：独立付费营期报价/占位、可信收款报名、异常款补偿及开营前全额退出已实现并本地验证；退款暂停本期正文媒体/教学讨论，拒绝恢复、成功一次释放。126关联、3生产门禁专项及8实际页面通过，API/Pro/App Web构建通过；第39本地迁移已应用，161表/160模型和规范数据保持。下一A03付费整期延期取消与已开营退出/补偿，再A05实际交付结算；完整M04/CO05及商用38/131未验收，未部署/更新APK，见[52](52-paid-cohort-orders.md)。

2026-10-13历史记录续办（51）：个人预约拒绝与服务争议协商退款已实现并本地验证；负责老师单次拒约全额补偿，财务提出金额/依据、本人确认后退款，拒绝恢复原参加状态，整场取消补齐余额且一次释放。104关联及54末次同意约束专项（重叠）、15实际页面和API/Pro/App Web通过；第38本地迁移已应用，161表/160模型与规范数据保持。完整A04/A06仍进行中，下一A03付费营期/已开营退出延期补偿，再A05付费实际履约结算；商用38/131保持，未部署/更新APK，见[51](51-booking-disputes-and-refusals.md)。

2026-10-13历史记录当前续办：A02/A04/A06原价付费预约与活动订单子流程已本地验证；统一库存/15分钟占位、可信收款确认、超时查单/晚付补偿、截止前整单退款与预收账本、App售后及Pro工作台接通。95关联、22末次专项（重叠）、8实际页面与三端构建通过，37迁移本地应用、161表/160模型，规范数据保持。下一付费延期取消/拒绝与争议补偿，再付费营期和履约结算；商用38/131保持，未部署/更新APK，见[49](49-paid-booking-orders.md)。

2026-10-13历史记录当前续办：A01/A02会员优先报名子流程已本地验证，冻结会员版本/活动范围、退款暂停/独立补偿、同库存及登录回跳/刷新接通；65关联、7真实页面与API/Pro/App Web通过。第36迁移本地应用，161表/160模型，规范数据保持。下一A04付费预约活动订单与A02超时晚付补偿，完整M07/A阶段及商用38/131仍未验收；未部署或更新APK，见[48](48-event-priority-booking.md)。

2026-10-12历史记录当前续办：A05免费活动实际履约与更正已完成本地验证，独立于签到保存完整/部分/未交付/未到场结果；内部依据不泄露，旧事实保留，免费不生成消费奖励。43关联/9实际页面及API/Pro/App Web通过，第35迁移本地应用，161表含元数据/160模型，规范数据保持。下一A01/A02会员优先开放与M07前置；付费结算/现场/原生及完整A05仍未完成，商用38/131保持，未部署/更新APK，见[47](47-event-fulfilment-records.md)。

2026-10-12历史记录当前续办：A05工作人员按场次委派、15分钟临时二维码、逐人幂等核销和误签到撤销已完成本地验证；88关联/7末次专项（重叠）及6真实页面通过，API/Pro/App Web通过。第34迁移本地应用，160表含元数据/159模型，原规范数据保持。下一活动结束后的实际履约记录；完整A05/付费结算及商用38/131仍未完成，未部署/更新APK，见[46](46-event-checkin-operations.md)。

2026-10-12历史记录最新营期续办：未开营免费营期整体延期、学员确认/退出、整期取消及结营通知已实现并本地验证；发布教学要求和原报名保留，教学日期按开营锚点顺延。146关联、18末次迁移边界专项（重叠）/7真实页面、API/Pro/App Web通过。本地33迁移、160表含元数据/159模型，规范数据保持；下一A05委派核销，付费及已开营补偿未齐，商用38/131不变，未上线/更新APK，见[45](45-cohort-schedule-changes.md)。

2026-10-12历史记录最新教学续办：营期专属老师/助教、固定版本作业、每日打卡、私人图片和点评、原营期消息回跳及结营只读已本地验证；124/124关联回归、8/8实际页面、API/Pro/App Web构建通过。第32迁移已在本地应用，159表含元数据/158模型，原规范数据保持。下一延期确认与取消通知，再A05；完整A03/CO05未商用验收，38/131不变，未上线或更新APK，见[44](44-cohort-teaching.md)。

2026-10-12最新章节排程：新增CohortLessonSchedule（id/cohortId/courseId/releaseId/lessonId/opensOnDay）和CourseCohort.scheduleFrozenAt；复合外键、唯一约束、开放时间边界、初始化和冻结保护见[第31迁移](../services/api/prisma/migrations/20261012140000_cohort_lesson_schedule/migration.sql)。本地159表含元数据、158模型、31迁移，原规范数据/普通授权摘要保持；排程不进入通用CRUD。字段与真实验证见[43](43-cohort-chapter-schedule.md)，线上未应用本批。

2026-10-12当前营期增量：新增CohortRegistration/CohortStudyProgress/CohortCertificate，StudyEvent记录营期归属，Enrollment保留普通授权唯一约束并禁止新营期写入。复合外键和身份保护见[第30迁移](../services/api/prisma/migrations/20261012120000_cohort_learning_context/migration.sql)，字段说明见[42](42-cohort-registration-and-learning-context.md)。本机已应用第29/30迁移、实测158表含元数据及157业务模型；规范数据和普通授权摘要保持。下方155表/29迁移/仅隔离应用是前一阶段历史。线上仍未应用本批迁移。

2026-10-12取消延期增量：155表不变，29迁移；AppointmentSlot/EventSession新增scheduleVersion与changeReason，Appointment/EventRegistration新增acceptedScheduleVersion与终态scheduleSnapshot，新增两个流程/通知索引。原快照与历史保留，不提供通用事实编辑。迁移仅在隔离测试库验证，未应用手测或线上数据库，详见[39](39-booking-schedule-changes.md)。

# 数据库结构与 CRUD 实施契约

2026-10-12当前入口：预约、活动、营期及六类内容联动复用既有表；取消延期新增一项字段与索引迁移，仓库共29迁移、155表，已在本轮隔离空库完整应用，未应用手测或线上数据库。144实体当前33类完整通用CRUD、111类受控流程；服务、时段、活动场次/票种、营期采用专用工作流，不允许通用数据维护直接改席位和权限事实。营期讨论区禁止经通用CRUD创建归属、改范围或删除，普通公共讨论区保留原CRUD。当前增量见[39](39-booking-schedule-changes.md)，此前38阶段的28迁移和下方结构统计是历史证据。

2026-10-11会员退款/商城优惠增量：28迁移、155表，无新增业务表；Refund新增assessmentSnapshot（JSON核查依据）与acceptedAt（学员确认时间），Product新增memberDiscountEligible（Boolean，默认false）。PlanBenefit/BenefitScope冻结商品折扣与免邮规则，BenefitUsage记录对应期间、预占/消费/释放/退回及原优惠金额；原TradeOrder/Item保存实付分摊。两项手写迁移分别为20261011110000_membership_partial_refunds与20261011113000_member_shop_pricing；专用流程维护，不开放事实通用改写。部署及验证见36/37。

2026-10-11商城增量：26迁移/155表；Refund新增returnAddressCipher，商品收入/异常退款负债科目、库存/包裹索引及实物购买快照/地址防改写触发器。库存、交易、发货、退换货继续走专用流程，不允许通用CRUD修改收退款或库存事实。未重建/迁移规范示例数据，详见34。

2026-10-11最新会员续办：member-sales-02已部署，219项后端全量、42HTTPS及6项实际浏览器检查通过，API/Pro/App Web构建通过。Android会员购买/续期/排队、未来整段退款及退款期间内容/配额暂停、订单/注销/看板联动和表格宽度修复已实现；原规范数据和会员日期/版本保留。iOS、部分消费退款/奖励及退款取消后的交付恢复仍未完成，商用保持38/131（29.0%），50%未达到。见[31会员交易续办报告](31-membership-purchase-and-refund.md)。

2026-10-10 Apple与会员基础续办：长期课程Apple映射、持久归属、已验证恢复/全额撤销和会员九组合管理已实现并部署20261011-membership-01；196项后端、后台/App Web构建及29项实际HTTPS通过。九个配置中8个启用，保留旧停用套餐及会员历史；真实Apple/原生及会员购买仍未验收。C07退款撤回续办中，商用仍38/131（29.0%）。见[29续办报告](29-apple-and-membership-foundation.md)。

2026-10-10录播增量：线上152表（含元数据），新增CourseVersionChoice及CourseRelease交付状态，支付宝应收科目；CourseVersionChoice由专用流程创建，不开放通用CRUD。原购课快照/历史保留，选择绑定当前grantKey，不跨授权继承；结构/约束/迁移与实际数量证据见[28](28-course-commerce-hardening.md)。下方表清单保留原基础阶段统计，新事实定义以schema.prisma及两个增量迁移为准。

日期：2026-10-09。来源：本机 PostgreSQL 实际结构与服务端权限白名单。

2026-10-09后台升级：app_user、event、sale_offer进一步收归账号/活动/课程专用流程；通用编辑不得绕过账号冻结、发布审核和报价。角色策略初始化及既有角色授权基线通过20261009190000/20261009200000两项手写迁移完成，无新增业务表。见[20后台升级报告](20-admin-upgrade.md)。

## 1. 本次实施范围

原144目标实体继续提供查询；当前物理库150表（新增CourseCertificate、CourseReview各通过专用流程维护）。当前41类完整通用CRUD、0类用户受限编辑、103类受控流程；不得用建表或CRUD数量代表全部业务完成。

保留的 4 张兼容表为 Order、OrderItem（旧的开发预占订单）、DeliveryZone（旧配送配置）、Favorite（旧文章收藏）。它们由现有专用接口维护，不属于新增的数据工作台。Favorite 与 Reaction 双向同步；CartItem 绑定 SKU 的规范 SaleOffer。旧开发预占订单仍不代表已支付订单。

历史数据库阶段按用户授权重建测试库；续办阶段通过增量迁移新增完成记录与课程评价，保留现有数据。SQL为当前结构快照，只适用于独立空库；不是直接覆盖生产库的脚本。

完整结构 SQL：[database-schema.sql](../outputs/course-sales-2026-10-09/database-schema.sql)。实际列、约束和索引：[database-inventory.json](../outputs/course-sales-2026-10-09/database-inventory.json)。

## 2. 操作与安全契约

- 后台入口 `/data`，沿用官方 Ant Design Pro 的 PageContainer、ProTable、Drawer、Form。角色菜单与接口权限同时校验。
- GET `/api/v1/admin/data/schema` 返回当前账号可用实体与读写字段。GET `/admin/data/:entity` 支持 page/size/q/filters/sort/direction，最大50条。filters 是 JSON 等值筛选对象，最多8个字段。
- GET `/admin/data/:entity/:id` 获取详情；POST 创建；PATCH 修改；DELETE 删除。写入体为 `{data, reason, expectedRevision}`，创建无需 expectedRevision，删除无需 data。
- reason 必须2—500字；修改/删除使用详情返回的 `_revision`。行锁、写操作和审计在一个事务内；失效版本返回409。
- 所有表与列来自内部白名单，值参数化；枚举、整数、BigInt、JSON、数组、时区和外键校验。引用仍被使用时不能删除；时段重叠由排斥约束拦截。
- 哈希、令牌、密文、推流密钥和原始渠道载荷不出现在查询结果。Cipher 字段仅输入，AES-256-GCM 保存；留空不覆写。生产必须配置 DOMAIN_ENCRYPTION_KEY。
- 私人笔记、日志、地址、个人互动、问答、作业与教师点评按当前账号归属过滤，不因 ADMIN 而开放他人的私人正文。老师的真实学员访问需要专门课程归属流程。
- 角色使用 POST `/admin/data/roles/grant` 与 POST `/admin/data/roles/:id/revoke`；不允许自改管理角色，撤销保留历史，权限和审计同步。
- 支付交易、退款核验、钱包/积分/财务账本等只能由对应流程写入。当前通用工作台不会伪造支付成功或改余额；未实现的渠道和流程见实施报告。
- 已发布课程/文章/商品/名师的审核状态继续通过原有审核接口变更；通用编辑不能绕过发布流程。会员套餐内容变更自动形成新版本，历史版本保持原内容。

## 3. 构建与维护

既有生成器仅用于原基础域，禁止重新生成以覆盖后续专用模块。新增结构使用审查后的手写迁移 → Prisma generate → API build → 针对性测试 → 前后台构建。SQL 中的 FK/CHECK/排斥约束和触发器是约束来源；新增模型的 Prisma 标量字段不完整表达这些 SQL 约束。禁止直接用 db push 或未经核查的自动 diff 重写数据库；新结构变更须检查生成 SQL 与实际约束。

## 4. 逐实体覆盖

以下读写权限以 ADMIN 为上限；普通角色还受模块限制。只读表示禁止通用写入，不表示对应业务流程已经开发完成。

|实体|模块|物理表|创建|查询|修改|删除|数据边界|
|---|---|---|---|---|---|---|---|
|app_user|身份|User|流程维护|已完成|已完成|流程维护|业务配置/资料|
|auth_identity|身份|AuthIdentity|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|auth_session|身份|AuthSession|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|consumed_refresh|身份|ConsumedRefresh|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|otp_challenge|身份|OtpChallenge|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|rate_limit|身份|RateLimit|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|access_role|身份|AccessRole|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|user_role|身份|UserRole|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|tag|身份内容|Tag|已完成|已完成|已完成|已完成|业务配置/资料|
|user_tag|身份内容|UserTag|已完成|已完成|已完成|已完成|本人记录|
|consent_record|身份|ConsentRecord|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|media_asset|内容|MediaAsset|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|resource|内容|Resource|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|resource_tag|内容|ResourceTag|已完成|已完成|已完成|已完成|业务配置/资料|
|source_evidence|内容治理|SourceEvidence|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|resource_evidence|内容治理|ResourceEvidence|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|content_relation|内容|ContentRelation|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|article|文章|Article|已完成|已完成|已完成|已完成|业务配置/资料|
|article_release|文章|ArticleRelease|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|article_block|文章|ArticleBlock|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|reaction|内容互动|Reaction|流程维护|已完成|流程维护|流程维护|本人记录|
|reading_event|内容互动|ReadingEvent|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|private_note|文章|Note|流程维护|已完成|流程维护|流程维护|本人记录|
|note_export|文章|NoteExport|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|practice_log|实践|PracticeLog|已完成|已完成|已完成|已完成|本人记录|
|teacher|名师|Teacher|已完成|已完成|已完成|已完成|业务配置/资料|
|teacher_staff|名师|TeacherStaff|已完成|已完成|已完成|已完成|业务配置/资料|
|teacher_question|名师|TeacherQuestion|流程维护|已完成|流程维护|流程维护|本人记录|
|teacher_answer|名师|TeacherAnswer|流程维护|已完成|流程维护|流程维护|本人记录|
|service_offering|名师|ServiceOffering|已完成|已完成|已完成|已完成|业务配置/资料|
|appointment_slot|名师|AppointmentSlot|已完成|已完成|已完成|已完成|业务配置/资料|
|appointment|名师|Appointment|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|course|课程|Course|已完成|已完成|已完成|已完成|业务配置/资料|
|course_chapter|课程|CourseChapter|已完成|已完成|已完成|已完成|业务配置/资料|
|course_release|课程|CourseRelease|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|lesson|课程|Lesson|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|course_cohort|课程|CourseCohort|已完成|已完成|已完成|已完成|业务配置/资料|
|course_staff|课程|CourseStaff|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|enrollment|课程|Enrollment|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|study_progress|课程|StudyProgress|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|study_event|课程|StudyEvent|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|assignment|课程实践|Assignment|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|submission|课程实践|Submission|流程维护|已完成|流程维护|流程维护|本人记录|
|teacher_review|课程实践|TeacherReview|流程维护|已完成|流程维护|流程维护|本人记录|
|practice_task|课程实践|PracticeTask|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|practice_checkin|课程实践|PracticeCheckin|流程维护|已完成|流程维护|流程维护|本人记录|
|offline_license|课程|OfflineLicense|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|forum_section|社群|ForumSection|已完成|已完成|已完成|已完成|业务配置/资料|
|forum_thread|社群|ForumThread|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|comment|社群内容|Comment|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|user_block|治理|UserBlock|流程维护|已完成|流程维护|流程维护|本人记录|
|report|治理|Report|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|moderation_action|治理|ModerationAction|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|user_restriction|治理|UserRestriction|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|content_authorization|治理|ContentAuthorization|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|writing_campaign|社群|WritingCampaign|已完成|已完成|已完成|已完成|业务配置/资料|
|campaign_entry|社群|CampaignEntry|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|live_room|直播|LiveRoom|已完成|已完成|已完成|已完成|业务配置/资料|
|live_session|直播|LiveSession|已完成|已完成|已完成|已完成|业务配置/资料|
|live_reservation|直播|LiveReservation|已完成|已完成|已完成|已完成|本人记录|
|live_replay|直播|LiveReplay|已完成|已完成|已完成|已完成|业务配置/资料|
|live_mic_request|直播|LiveMicRequest|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|live_poll|直播|LivePoll|已完成|已完成|已完成|已完成|业务配置/资料|
|poll_option|直播|PollOption|已完成|已完成|已完成|已完成|业务配置/资料|
|poll_vote|直播|PollVote|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|virtual_gift|直播|VirtualGift|已完成|已完成|已完成|已完成|业务配置/资料|
|gift_wallet|直播|GiftWallet|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|gift_ledger|直播|GiftLedger|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|product|商城|Product|已完成|已完成|已完成|已完成|业务配置/资料|
|product_sku|商城|ProductSku|已完成|已完成|已完成|已完成|业务配置/资料|
|digital_release|商城|DigitalRelease|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|digital_release_asset|商城|DigitalReleaseAsset|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|sale_offer|交易|SaleOffer|已完成|已完成|已完成|已完成|业务配置/资料|
|channel_product_mapping|交易|ChannelProductMapping|已完成|已完成|已完成|已完成|业务配置/资料|
|cart_item|商城|CartItem|已完成|已完成|已完成|已完成|本人记录|
|address|商城|Address|流程维护|已完成|流程维护|流程维护|本人记录|
|delivery_template|商城|DeliveryTemplate|已完成|已完成|已完成|已完成|业务配置/资料|
|delivery_zone|商城|ShippingZone|已完成|已完成|已完成|已完成|业务配置/资料|
|trade_order|交易|TradeOrder|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|order_item|交易|TradeOrderItem|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|inventory_reservation|交易|InventoryReservation|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|inventory_ledger|交易|InventoryLedger|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|payment_attempt|交易|PaymentAttempt|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|payment_transaction|交易|PaymentTransaction|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|provider_callback|交易运维|ProviderCallback|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|refund|交易|Refund|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|refund_item|交易|RefundItem|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|shipment|商城|Shipment|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|shipment_item|商城|ShipmentItem|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|digital_delivery|商城|DigitalDelivery|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|membership_plan|会员|MembershipPlan|已完成|已完成|已完成|已完成|业务配置/资料|
|membership_plan_version|会员|MembershipPlanVersion|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|benefit_definition|会员|BenefitDefinition|已完成|已完成|已完成|已完成|业务配置/资料|
|plan_benefit|会员|PlanBenefit|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|membership_period|会员|Membership|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|benefit_usage|会员|BenefitUsage|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|growth_ledger|成长|GrowthLedger|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|points_account|积分|PointsAccount|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|points_ledger|积分|PointsLedger|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|points_reservation|积分|PointsReservation|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|points_reward|积分|PointsReward|已完成|已完成|已完成|已完成|业务配置/资料|
|points_redemption|积分|PointsRedemption|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|event|活动|Event|已完成|已完成|已完成|已完成|业务配置/资料|
|event_session|活动|EventSession|已完成|已完成|已完成|已完成|业务配置/资料|
|event_ticket_type|活动|EventTicketType|已完成|已完成|已完成|已完成|业务配置/资料|
|event_registration|活动|EventRegistration|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|event_checkin|活动|EventCheckin|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|event_staff|活动|EventStaff|已完成|已完成|已完成|已完成|业务配置/资料|
|event_waitlist|活动|EventWaitlist|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|coupon_template|营销|CouponTemplate|已完成|已完成|已完成|已完成|业务配置/资料|
|user_coupon|营销|UserCoupon|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|promotion|营销|Promotion|已完成|已完成|已完成|已完成|业务配置/资料|
|promotion_offer|营销|PromotionOffer|已完成|已完成|已完成|已完成|业务配置/资料|
|group_buy|营销|GroupBuy|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|group_buy_member|营销|GroupBuyMember|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|referral|营销|Referral|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|commission_ledger|营销财务|CommissionLedger|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|withdrawal_request|营销财务|WithdrawalRequest|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|partner|合作财务|Partner|已完成|已完成|已完成|已完成|业务配置/资料|
|partner_contract|合作财务|PartnerContract|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|settlement|合作财务|Settlement|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|settlement_item|合作财务|SettlementItem|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|finance_journal|财务|FinanceJournal|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|finance_entry|财务|FinanceEntry|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|reconciliation|财务|Reconciliation|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|operating_service|运营|OperatingService|已完成|已完成|已完成|已完成|业务配置/资料|
|ad_placement|运营|AdPlacement|已完成|已完成|已完成|已完成|业务配置/资料|
|ad_campaign|运营|AdCampaign|已完成|已完成|已完成|已完成|业务配置/资料|
|notification|消息|Notification|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|device_token|消息|DeviceToken|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|notification_delivery|消息|NotificationDelivery|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|feedback|客服|Feedback|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|feedback_reply|客服|FeedbackReply|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|audit_log|运维治理|AuditLog|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|outbox_job|运维|OutboxJob|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|idempotency_record|运维|IdempotencyRecord|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|feature_config|运维运营|FeatureConfig|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|attachment_binding|媒体|AttachmentBinding|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|benefit_scope|会员|BenefitScope|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|refund_transaction|交易|RefundTransaction|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|withdrawal_allocation|营销财务|WithdrawalAllocation|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|finance_account|财务|FinanceAccount|已完成|已完成|已完成|已完成|业务配置/资料|
|benefit_grant|会员成长|BenefitGrant|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|
|gift_credit_allocation|直播财务|GiftCreditAllocation|流程维护|已完成|流程维护|流程维护|事实/版本/敏感记录|

## 5. 完整物理表结构

共 150 表、1775 列、409 外键、277 CHECK；列名、类型和默认值以真实数据库为准。

### AccessRole / access_role

角色与权限码，权限码目录由代码版本维护

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|code|text|是|—|通用可写|
|name|text|是|—|通用可写|
|permissionCodes|text[]|是|'{}'::text[]||
|active|boolean|是|true|通用可写|

约束：
- `AccessRole_code_key`：`UNIQUE (code)`
- `AccessRole_pkey`：`PRIMARY KEY (id)`
- `AccessRole_version_check`：`CHECK (version > 0)`
- `domain_role_code`：`CHECK (code = ANY (ARRAY['USER'::text, 'TEACHER'::text, 'OPERATOR'::text, 'MODERATOR'::text, 'SUPPORT'::text, 'FINANCE'::text, 'ADMIN'::text]))`

索引：

### AdCampaign / ad_campaign

广告排期与实际曝光点击汇总、合同交付

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|placementId|text|是|—|ad_placement.id；通用可写|
|operatingServiceId|text|否|—|operating_service.id；通用可写|
|targetResourceId|text|是|—|resource.id；通用可写|
|creativeAssetId|text|否|—|media_asset.id；通用可写|
|startsAt|timestamp with time zone|是|—|通用可写|
|endsAt|timestamp with time zone|是|—|通用可写|
|state|text|是|—|通用可写|
|metrics|jsonb|是|'{}'::jsonb|通用可写|

约束：
- `AdCampaign_pkey`：`PRIMARY KEY (id)`
- `AdCampaign_version_check`：`CHECK (version > 0)`
- `domain_AdCampaign_0`：`CHECK ("endsAt" > "startsAt")`
- `domain_AdCampaign_creativeAssetId_fk`：`FOREIGN KEY ("creativeAssetId") REFERENCES "MediaAsset"(id)`
- `domain_AdCampaign_operatingServiceId_fk`：`FOREIGN KEY ("operatingServiceId") REFERENCES "OperatingService"(id)`
- `domain_AdCampaign_placementId_fk`：`FOREIGN KEY ("placementId") REFERENCES "AdPlacement"(id)`
- `domain_AdCampaign_targetResourceId_fk`：`FOREIGN KEY ("targetResourceId") REFERENCES "Resource"(id)`

索引：
- `CREATE INDEX "domain_AdCampaign_idx_0" ON public."AdCampaign" USING btree ("placementId", state, "startsAt", "endsAt")`

### AdPlacement / ad_placement

有标识广告推荐位，不伪装权威内容

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|code|text|是|—|通用可写|
|surface|text|是|—|通用可写|
|format|text|是|—|通用可写|
|label|text|是|'推广'::text|通用可写|
|active|boolean|是|false|通用可写|

约束：
- `AdPlacement_code_key`：`UNIQUE (code)`
- `AdPlacement_pkey`：`PRIMARY KEY (id)`
- `AdPlacement_version_check`：`CHECK (version > 0)`

索引：

### Address / address

私人地址加密，订单另留不可变快照

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|—||
|userId|text|是|—|app_user.id；通用可写|
|recipient|text|是|—|查询隐藏|
|phone|text|是|—|查询隐藏|
|province|text|是|—|通用可写|
|city|text|是|—|通用可写|
|district|text|是|—|通用可写|
|detail|text|是|—|查询隐藏|
|isDefault|boolean|是|false|通用可写|
|createdAt|timestamp(3) without time zone|是|CURRENT_TIMESTAMP||
|updatedAt|timestamp(3) without time zone|是|—||
|version|integer|是|1||
|recipientCipher|text|是|''::text|查询隐藏；通用可写|
|phoneCipher|text|是|''::text|查询隐藏|
|provinceCode|text|是|''::text|通用可写|
|cityCode|text|是|''::text|通用可写|
|districtCode|text|是|''::text|通用可写|
|detailCipher|text|是|''::text|查询隐藏；通用可写|

约束：
- `Address_pkey`：`PRIMARY KEY (id)`
- `Address_version_check`：`CHECK (version > 0)`
- `Address_userId_fkey`：`FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE CASCADE`
- `domain_Address_userId_fk`：`FOREIGN KEY ("userId") REFERENCES "User"(id)`

索引：
- `CREATE UNIQUE INDEX "Address_one_default_per_user" ON public."Address" USING btree ("userId") WHERE ("isDefault" = true)`
- `CREATE INDEX "Address_userId_isDefault_idx" ON public."Address" USING btree ("userId", "isDefault")`
- `CREATE INDEX "domain_Address_idx_0" ON public."Address" USING btree ("userId", "isDefault")`
- `CREATE UNIQUE INDEX "domain_Address_idx_1" ON public."Address" USING btree ("userId") WHERE ("isDefault" = true)`

### Appointment / appointment

付款/免费权益确认预约及交付，隐私联系信息加密

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|userId|text|是|—|app_user.id；通用可写|
|slotId|text|是|—|appointment_slot.id；通用可写|
|orderItemId|text|否|—|order_item.id；通用可写|
|requestKey|text|是|—|通用可写|
|state|text|是|—|通用可写|
|contactCipher|text|是|—|查询隐藏；通用可写|
|serviceSnapshot|jsonb|是|—|通用可写|
|benefitUsageId|text|否|—|benefit_usage.id；通用可写|
|confirmedAt|timestamp with time zone|否|—|通用可写|
|completedAt|timestamp with time zone|否|—|通用可写|
|cancelReason|text|否|—|通用可写|
|acceptedScheduleVersion|integer|是|1且大于0|学员确认专用流程维护|
|scheduleSnapshot|jsonb|否|—|终态实际安排，不覆盖原快照|

约束：
- `Appointment_orderItemId_key`：`UNIQUE ("orderItemId")`
- `Appointment_pkey`：`PRIMARY KEY (id)`
- `Appointment_version_check`：`CHECK (version > 0)`
- `domain_Appointment_0`：`UNIQUE ("userId", "requestKey")`
- `domain_Appointment_1`：`CHECK (state = ANY (ARRAY['PENDING'::text, 'CONFIRMED'::text, 'CANCEL_PENDING'::text, 'CANCELLED'::text, 'COMPLETED'::text, 'NO_SHOW'::text]))`
- `domain_Appointment_benefitUsageId_fk`：`FOREIGN KEY ("benefitUsageId") REFERENCES "BenefitUsage"(id)`
- `domain_Appointment_orderItemId_fk`：`FOREIGN KEY ("orderItemId") REFERENCES "TradeOrderItem"(id)`
- `domain_Appointment_slotId_fk`：`FOREIGN KEY ("slotId") REFERENCES "AppointmentSlot"(id)`
- `domain_Appointment_userId_fk`：`FOREIGN KEY ("userId") REFERENCES "User"(id)`

索引：
- `CREATE INDEX "domain_Appointment_idx_0" ON public."Appointment" USING btree ("slotId", state)`
- `CREATE INDEX "domain_Appointment_idx_1" ON public."Appointment" USING btree ("userId", "createdAt")`

### AppointmentSlot / appointment_slot

唯一服务时段库存，不能在商品另维护库存

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|offeringId|text|是|—|service_offering.id；通用可写|
|startsAt|timestamp with time zone|是|—|通用可写|
|endsAt|timestamp with time zone|是|—|通用可写|
|capacity|integer|是|1|通用可写|
|reserved|integer|是|0||
|confirmed|integer|是|0||
|state|text|是|'OPEN'::text|通用可写|
|teacherId|text|是|—|teacher.id；通用可写|
|scheduleVersion|integer|是|1且大于0|安排专用流程维护|
|changeReason|text|否|—|最新延期/运营取消原因|

约束：
- `AppointmentSlot_pkey`：`PRIMARY KEY (id)`
- `AppointmentSlot_version_check`：`CHECK (version > 0)`
- `domain_AppointmentSlot_0`：`UNIQUE ("offeringId", "startsAt")`
- `domain_AppointmentSlot_1`：`CHECK ("endsAt" > "startsAt")`
- `domain_AppointmentSlot_2`：`CHECK (capacity > 0 AND reserved >= 0 AND confirmed >= 0 AND (reserved + confirmed) <= capacity)`
- `domain_AppointmentSlot_3`：`CHECK (state = ANY (ARRAY['OPEN'::text, 'CLOSED'::text, 'CANCELLED'::text]))`
- `domain_AppointmentSlot_5`：`CHECK (capacity = 1)`
- `domain_slot_no_overlap`：`EXCLUDE USING gist ("teacherId" WITH =, tstzrange("startsAt", "endsAt", '[)'::text) WITH &&) WHERE (state <> 'CANCELLED'::text)`
- `domain_AppointmentSlot_4`：`FOREIGN KEY ("offeringId", "teacherId") REFERENCES "ServiceOffering"(id, "teacherId")`
- `domain_AppointmentSlot_offeringId_fk`：`FOREIGN KEY ("offeringId") REFERENCES "ServiceOffering"(id)`
- `domain_AppointmentSlot_teacherId_fk`：`FOREIGN KEY ("teacherId") REFERENCES "Teacher"(id)`

索引：
- `CREATE INDEX "domain_AppointmentSlot_idx_0" ON public."AppointmentSlot" USING btree ("offeringId", state, "startsAt")`

### Article / article

文章资源子类型，当前发布版指针与编辑版本

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|—||
|title|text|是|—|通用可写|
|summary|text|是|—|通用可写|
|category|text|是|—|通用可写|
|author|text|是|—|通用可写|
|source|text|是|—|通用可写|
|cover|text|是|—|通用可写|
|blocks|jsonb|是|—|通用可写|
|tags|text[]|否|—|通用可写|
|visibility|"Visibility"|是|'PUBLIC'::"Visibility"|通用可写|
|status|"PublishStatus"|是|'DRAFT'::"PublishStatus"|通用可写|
|isDemo|boolean|是|false|通用可写|
|featured|boolean|是|false|通用可写|
|publishedAt|timestamp(3) without time zone|否|—||
|createdAt|timestamp(3) without time zone|是|CURRENT_TIMESTAMP||
|updatedAt|timestamp(3) without time zone|是|—||
|version|integer|是|1||
|membershipTier|integer|是|1|通用可写|
|resourceKind|text|是|'ARTICLE'::text||
|authorDisplay|text|是|''::text|通用可写|
|authorUserId|text|否|—|app_user.id；通用可写|
|currentReleaseId|text|否|—|article_release.id|
|draftSourceSnapshot|jsonb|是|'{}'::jsonb|通用可写|
|draftTemplateCode|text|否|—|通用可写|

约束：
- `Article_pkey`：`PRIMARY KEY (id)`
- `Article_resourceKind_check`：`CHECK ("resourceKind" = 'ARTICLE'::text)`
- `domain_Article_0`：`FOREIGN KEY (id, "resourceKind") REFERENCES "Resource"(id, kind)`
- `domain_Article_1`：`FOREIGN KEY ("currentReleaseId", id) REFERENCES "ArticleRelease"(id, "articleId")`
- `domain_Article_authorUserId_fk`：`FOREIGN KEY ("authorUserId") REFERENCES "User"(id)`
- `domain_Article_currentReleaseId_fk`：`FOREIGN KEY ("currentReleaseId") REFERENCES "ArticleRelease"(id)`

索引：
- `CREATE INDEX "Article_status_publishedAt_idx" ON public."Article" USING btree (status, "publishedAt")`

### ArticleBlock / article_block

稳定段落键+发布版本正文；图文音视频引用块

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|releaseId|text|是|—|article_release.id；通用可写|
|stableKey|text|是|—|通用可写|
|position|integer|是|—|通用可写|
|kind|text|是|—|通用可写|
|body|jsonb|是|—|通用可写|
|mediaId|text|否|—|media_asset.id；通用可写|
|citationEvidenceId|text|否|—|source_evidence.id；通用可写|

约束：
- `ArticleBlock_pkey`：`PRIMARY KEY (id)`
- `domain_ArticleBlock_0`：`UNIQUE ("releaseId", "stableKey")`
- `domain_ArticleBlock_1`：`UNIQUE ("releaseId", "position")`
- `domain_ArticleBlock_2`：`CHECK ("position" >= 0)`
- `domain_ArticleBlock_3`：`CHECK (kind = ANY (ARRAY['PARAGRAPH'::text, 'QUOTE'::text, 'IMAGE'::text, 'AUDIO'::text, 'VIDEO'::text]))`
- `domain_ArticleBlock_citationEvidenceId_fk`：`FOREIGN KEY ("citationEvidenceId") REFERENCES "SourceEvidence"(id)`
- `domain_ArticleBlock_mediaId_fk`：`FOREIGN KEY ("mediaId") REFERENCES "MediaAsset"(id)`
- `domain_ArticleBlock_releaseId_fk`：`FOREIGN KEY ("releaseId") REFERENCES "ArticleRelease"(id)`

索引：

### ArticleRelease / article_release

不变文章正文版本，保留授权与来源快照

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|articleId|text|是|—|article.id；通用可写|
|releaseNo|integer|是|—|通用可写|
|sourceSnapshot|jsonb|是|—|通用可写|
|authorSnapshot|jsonb|是|—|通用可写|
|reviewerId|text|是|—|app_user.id|
|publishedAt|timestamp with time zone|是|—||

约束：
- `ArticleRelease_pkey`：`PRIMARY KEY (id)`
- `domain_ArticleRelease_0`：`UNIQUE ("articleId", "releaseNo")`
- `domain_ArticleRelease_1`：`UNIQUE (id, "articleId")`
- `domain_ArticleRelease_articleId_fk`：`FOREIGN KEY ("articleId") REFERENCES "Article"(id)`
- `domain_ArticleRelease_reviewerId_fk`：`FOREIGN KEY ("reviewerId") REFERENCES "User"(id)`

索引：

### Assignment / assignment

必修作业和期限，营期可选

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|courseId|text|是|—|course.id；通用可写|
|lessonId|text|否|—|lesson.id；通用可写|
|cohortId|text|否|—|course_cohort.id；通用可写|
|title|text|是|—|通用可写|
|instructions|jsonb|是|—|通用可写|
|dueAt|timestamp with time zone|否|—|通用可写|
|required|boolean|是|—|通用可写|
|allowedKinds|text[]|是|—|通用可写|
|state|text|是|—|通用可写|

约束：
- `Assignment_pkey`：`PRIMARY KEY (id)`
- `Assignment_version_check`：`CHECK (version > 0)`
- `domain_Assignment_cohortId_fk`：`FOREIGN KEY ("cohortId") REFERENCES "CourseCohort"(id)`
- `domain_Assignment_courseId_fk`：`FOREIGN KEY ("courseId") REFERENCES "Course"(id)`
- `domain_Assignment_lessonId_fk`：`FOREIGN KEY ("lessonId") REFERENCES "Lesson"(id)`

索引：
- `CREATE INDEX "domain_Assignment_idx_0" ON public."Assignment" USING btree ("courseId", "cohortId", "dueAt")`

### AttachmentBinding / attachment_binding

统一附件关系，数组只是响应投影；关系表是外键权威

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|assetId|text|是|—|media_asset.id；通用可写|
|noteId|text|否|—|private_note.id；通用可写|
|logId|text|否|—|practice_log.id；通用可写|
|submissionId|text|否|—|submission.id；通用可写|
|checkinId|text|否|—|practice_checkin.id；通用可写|
|threadId|text|否|—|forum_thread.id；通用可写|
|reportId|text|否|—|report.id；通用可写|
|feedbackId|text|否|—|feedback.id；通用可写|
|refundId|text|否|—|refund.id；通用可写|
|operatingServiceId|text|否|—|operating_service.id；通用可写|
|position|integer|是|0|通用可写|
|caption|text|否|—|通用可写|
|resourceId|text|否|—|resource.id；通用可写|
|purpose|text|是|'ATTACHMENT'::text|通用可写|
|feedbackReplyId|text|否|—|feedback_reply.id；通用可写|

约束：
- `AttachmentBinding_pkey`：`PRIMARY KEY (id)`
- `AttachmentBinding_version_check`：`CHECK (version > 0)`
- `domain_AttachmentBinding_0`：`CHECK (num_nonnulls("resourceId", "noteId", "logId", "submissionId", "checkinId", "threadId", "reportId", "feedbackId", "feedbackReplyId", "refundId", "operatingServiceId") = 1)`
- `domain_AttachmentBinding_1`：`CHECK ("position" >= 0)`
- `domain_AttachmentBinding_assetId_fk`：`FOREIGN KEY ("assetId") REFERENCES "MediaAsset"(id)`
- `domain_AttachmentBinding_checkinId_fk`：`FOREIGN KEY ("checkinId") REFERENCES "PracticeCheckin"(id)`
- `domain_AttachmentBinding_feedbackId_fk`：`FOREIGN KEY ("feedbackId") REFERENCES "Feedback"(id)`
- `domain_AttachmentBinding_feedbackReplyId_fk`：`FOREIGN KEY ("feedbackReplyId") REFERENCES "FeedbackReply"(id)`
- `domain_AttachmentBinding_logId_fk`：`FOREIGN KEY ("logId") REFERENCES "PracticeLog"(id)`
- `domain_AttachmentBinding_noteId_fk`：`FOREIGN KEY ("noteId") REFERENCES "Note"(id)`
- `domain_AttachmentBinding_operatingServiceId_fk`：`FOREIGN KEY ("operatingServiceId") REFERENCES "OperatingService"(id)`
- `domain_AttachmentBinding_refundId_fk`：`FOREIGN KEY ("refundId") REFERENCES "Refund"(id)`
- `domain_AttachmentBinding_reportId_fk`：`FOREIGN KEY ("reportId") REFERENCES "Report"(id)`
- `domain_AttachmentBinding_resourceId_fk`：`FOREIGN KEY ("resourceId") REFERENCES "Resource"(id)`
- `domain_AttachmentBinding_submissionId_fk`：`FOREIGN KEY ("submissionId") REFERENCES "Submission"(id)`
- `domain_AttachmentBinding_threadId_fk`：`FOREIGN KEY ("threadId") REFERENCES "ForumThread"(id)`

索引：
- `CREATE INDEX "domain_AttachmentBinding_idx_0" ON public."AttachmentBinding" USING btree ("assetId")`

### AuditLog / audit_log

重要后台变更不可变审计，敏感内容脱敏

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|—||
|actorId|text|是|—|app_user.id|
|action|text|是|—|通用可写|
|resource|text|是|—|通用可写|
|resourceId|text|否|—|通用可写|
|changes|jsonb|是|—|查询隐藏|
|createdAt|timestamp(3) without time zone|是|CURRENT_TIMESTAMP||
|resourceType|text|是|''::text|通用可写|
|resourceKey|text|是|''::text|通用可写|
|requestId|text|是|''::text|通用可写|
|reason|text|否|—|通用可写|
|beforeSnapshot|jsonb|是|'{}'::jsonb|查询隐藏|
|afterSnapshot|jsonb|是|'{}'::jsonb|查询隐藏|
|ipHash|text|否|—|查询隐藏|

约束：
- `AuditLog_pkey`：`PRIMARY KEY (id)`
- `domain_AuditLog_actorId_fk`：`FOREIGN KEY ("actorId") REFERENCES "User"(id)`

索引：
- `CREATE INDEX "AuditLog_resource_resourceId_createdAt_idx" ON public."AuditLog" USING btree (resource, "resourceId", "createdAt")`
- `CREATE INDEX "domain_AuditLog_idx_0" ON public."AuditLog" USING btree ("resourceType", "resourceKey", "createdAt")`
- `CREATE INDEX "domain_AuditLog_idx_1" ON public."AuditLog" USING btree ("actorId", "createdAt")`

### AuthIdentity / auth_identity

微信/Apple身份绑定，手机号继续由app_user管理

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|userId|text|是|—|app_user.id；通用可写|
|provider|text|是|—|通用可写|
|appScope|text|是|—|通用可写|
|subjectHash|text|是|—|查询隐藏|
|unionSubjectHash|text|否|—|查询隐藏|
|verifiedAt|timestamp with time zone|是|—|通用可写|

约束：
- `AuthIdentity_pkey`：`PRIMARY KEY (id)`
- `AuthIdentity_version_check`：`CHECK (version > 0)`
- `domain_AuthIdentity_0`：`UNIQUE (provider, "appScope", "subjectHash")`
- `domain_AuthIdentity_userId_fk`：`FOREIGN KEY ("userId") REFERENCES "User"(id)`

索引：
- `CREATE INDEX "domain_AuthIdentity_idx_0" ON public."AuthIdentity" USING btree ("userId", provider)`

### AuthSession / auth_session

APP/ADMIN短期access及可撤销refresh会话

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|—||
|userId|text|是|—|app_user.id；通用可写|
|accessHash|text|是|—|查询隐藏|
|accessExpiresAt|timestamp(3) without time zone|是|—|通用可写|
|refreshHash|text|是|—|查询隐藏|
|csrfToken|text|是|—|查询隐藏|
|expiresAt|timestamp(3) without time zone|是|—|通用可写|
|revokedAt|timestamp(3) without time zone|否|—|通用可写|
|createdAt|timestamp(3) without time zone|是|CURRENT_TIMESTAMP||
|kind|text|是|'ADMIN'::text|通用可写|
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|csrfHash|text|否|—|查询隐藏|
|deviceId|text|否|—|通用可写|

约束：
- `AuthSession_pkey`：`PRIMARY KEY (id)`
- `AuthSession_version_check`：`CHECK (version > 0)`
- `domain_AuthSession_0`：`CHECK (kind = ANY (ARRAY['APP'::text, 'ADMIN'::text]))`
- `domain_AuthSession_1`：`CHECK ("expiresAt" > "accessExpiresAt")`
- `AuthSession_userId_fkey`：`FOREIGN KEY ("userId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE RESTRICT`
- `domain_AuthSession_userId_fk`：`FOREIGN KEY ("userId") REFERENCES "User"(id)`

索引：
- `CREATE UNIQUE INDEX "AuthSession_accessHash_key" ON public."AuthSession" USING btree ("accessHash")`
- `CREATE UNIQUE INDEX "AuthSession_refreshHash_key" ON public."AuthSession" USING btree ("refreshHash")`
- `CREATE INDEX "AuthSession_userId_revokedAt_idx" ON public."AuthSession" USING btree ("userId", "revokedAt")`
- `CREATE INDEX "domain_AuthSession_idx_0" ON public."AuthSession" USING btree ("userId", "revokedAt")`

### BenefitDefinition / benefit_definition

文章课程准入/折扣运费问答活动签名品权益码

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|code|text|是|—|通用可写|
|name|text|是|—|通用可写|
|kind|text|是|—|通用可写|
|parameterSchema|jsonb|是|—|通用可写|
|active|boolean|是|false|通用可写|

约束：
- `BenefitDefinition_code_key`：`UNIQUE (code)`
- `BenefitDefinition_pkey`：`PRIMARY KEY (id)`
- `BenefitDefinition_version_check`：`CHECK (version > 0)`

索引：

### BenefitGrant / benefit_grant

成长/积分或人工赠权益的独立来源，不伪装付费会员

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|userId|text|是|—|app_user.id；通用可写|
|definitionId|text|是|—|benefit_definition.id；通用可写|
|growthLedgerId|text|否|—|growth_ledger.id；通用可写|
|redemptionId|text|否|—|points_redemption.id；通用可写|
|resourceId|text|否|—|resource.id；通用可写|
|offerId|text|否|—|sale_offer.id；通用可写|
|source|text|是|—|通用可写|
|quota|integer|是|—|通用可写|
|parametersSnapshot|jsonb|是|—|通用可写|
|startsAt|timestamp with time zone|是|—|通用可写|
|endsAt|timestamp with time zone|是|—|通用可写|
|revokedAt|timestamp with time zone|否|—|通用可写|
|grantKey|text|是|—|通用可写|
|actorId|text|否|—|app_user.id|
|reason|text|是|—|通用可写|

约束：
- `BenefitGrant_grantKey_key`：`UNIQUE ("grantKey")`
- `BenefitGrant_pkey`：`PRIMARY KEY (id)`
- `BenefitGrant_version_check`：`CHECK (version > 0)`
- `domain_BenefitGrant_0`：`CHECK (quota > 0 AND "endsAt" > "startsAt")`
- `domain_BenefitGrant_1`：`CHECK (num_nonnulls("growthLedgerId", "redemptionId") <= 1)`
- `domain_BenefitGrant_actorId_fk`：`FOREIGN KEY ("actorId") REFERENCES "User"(id)`
- `domain_BenefitGrant_definitionId_fk`：`FOREIGN KEY ("definitionId") REFERENCES "BenefitDefinition"(id)`
- `domain_BenefitGrant_growthLedgerId_fk`：`FOREIGN KEY ("growthLedgerId") REFERENCES "GrowthLedger"(id)`
- `domain_BenefitGrant_offerId_fk`：`FOREIGN KEY ("offerId") REFERENCES "SaleOffer"(id)`
- `domain_BenefitGrant_redemptionId_fk`：`FOREIGN KEY ("redemptionId") REFERENCES "PointsRedemption"(id)`
- `domain_BenefitGrant_resourceId_fk`：`FOREIGN KEY ("resourceId") REFERENCES "Resource"(id)`
- `domain_BenefitGrant_userId_fk`：`FOREIGN KEY ("userId") REFERENCES "User"(id)`

索引：
- `CREATE INDEX "domain_BenefitGrant_idx_0" ON public."BenefitGrant" USING btree ("userId", "endsAt")`

### BenefitScope / benefit_scope

权益强FK范围，指定资源/可售单元/分类恰好一种

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|planBenefitId|text|是|—|plan_benefit.id；通用可写|
|resourceId|text|否|—|resource.id；通用可写|
|offerId|text|否|—|sale_offer.id；通用可写|
|categoryCode|text|否|—|通用可写|

约束：
- `BenefitScope_pkey`：`PRIMARY KEY (id)`
- `domain_BenefitScope_0`：`CHECK (num_nonnulls("resourceId", "offerId", "categoryCode") = 1)`
- `domain_BenefitScope_offerId_fk`：`FOREIGN KEY ("offerId") REFERENCES "SaleOffer"(id)`
- `domain_BenefitScope_planBenefitId_fk`：`FOREIGN KEY ("planBenefitId") REFERENCES "PlanBenefit"(id)`
- `domain_BenefitScope_resourceId_fk`：`FOREIGN KEY ("resourceId") REFERENCES "Resource"(id)`

索引：
- `CREATE UNIQUE INDEX "domain_BenefitScope_idx_0" ON public."BenefitScope" USING btree ("planBenefitId", "resourceId") WHERE ("resourceId" IS NOT NULL)`
- `CREATE UNIQUE INDEX "domain_BenefitScope_idx_1" ON public."BenefitScope" USING btree ("planBenefitId", "offerId") WHERE ("offerId" IS NOT NULL)`
- `CREATE UNIQUE INDEX "domain_BenefitScope_idx_2" ON public."BenefitScope" USING btree ("planBenefitId", "categoryCode") WHERE ("categoryCode" IS NOT NULL)`

### BenefitUsage / benefit_usage

权益额度预占消费退还，取消可重试

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|userId|text|是|—|app_user.id；通用可写|
|periodId|text|否|—|membership_period.id；通用可写|
|definitionId|text|是|—|benefit_definition.id；通用可写|
|windowStart|date|是|—|通用可写|
|windowEnd|date|是|—|通用可写|
|quantity|integer|是|—|通用可写|
|businessKey|text|是|—|通用可写|
|state|text|是|—|通用可写|
|parametersSnapshot|jsonb|是|—|通用可写|
|reversalOfId|text|否|—|benefit_usage.id；通用可写|
|grantId|text|否|—|benefit_grant.id；通用可写|

约束：
- `BenefitUsage_pkey`：`PRIMARY KEY (id)`
- `BenefitUsage_reversalOfId_key`：`UNIQUE ("reversalOfId")`
- `BenefitUsage_version_check`：`CHECK (version > 0)`
- `domain_BenefitUsage_0`：`UNIQUE ("userId", "businessKey")`
- `domain_BenefitUsage_1`：`CHECK (quantity > 0 AND "windowEnd" >= "windowStart")`
- `domain_BenefitUsage_2`：`CHECK (state = ANY (ARRAY['HELD'::text, 'CONSUMED'::text, 'RELEASED'::text, 'REVERSED'::text]))`
- `domain_BenefitUsage_3`：`CHECK (num_nonnulls("periodId", "grantId") = 1)`
- `domain_BenefitUsage_definitionId_fk`：`FOREIGN KEY ("definitionId") REFERENCES "BenefitDefinition"(id)`
- `domain_BenefitUsage_grantId_fk`：`FOREIGN KEY ("grantId") REFERENCES "BenefitGrant"(id)`
- `domain_BenefitUsage_periodId_fk`：`FOREIGN KEY ("periodId") REFERENCES "Membership"(id)`
- `domain_BenefitUsage_reversalOfId_fk`：`FOREIGN KEY ("reversalOfId") REFERENCES "BenefitUsage"(id)`
- `domain_BenefitUsage_userId_fk`：`FOREIGN KEY ("userId") REFERENCES "User"(id)`

索引：
- `CREATE INDEX "domain_BenefitUsage_idx_0" ON public."BenefitUsage" USING btree ("periodId", "definitionId", "windowStart", state)`

### CampaignEntry / campaign_entry

投稿评选和授权

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|campaignId|text|是|—|writing_campaign.id；通用可写|
|threadId|text|是|—|forum_thread.id；通用可写|
|userId|text|是|—|app_user.id；通用可写|
|authorizationId|text|否|—|content_authorization.id；通用可写|
|state|text|是|—|通用可写|
|rank|integer|否|—|通用可写|
|judgeId|text|否|—|app_user.id；通用可写|
|judgeNote|text|否|—|通用可写|
|rewardKey|text|否|—|通用可写|

约束：
- `CampaignEntry_pkey`：`PRIMARY KEY (id)`
- `CampaignEntry_rewardKey_key`：`UNIQUE ("rewardKey")`
- `CampaignEntry_version_check`：`CHECK (version > 0)`
- `domain_CampaignEntry_0`：`UNIQUE ("campaignId", "threadId")`
- `domain_CampaignEntry_authorizationId_fk`：`FOREIGN KEY ("authorizationId") REFERENCES "ContentAuthorization"(id)`
- `domain_CampaignEntry_campaignId_fk`：`FOREIGN KEY ("campaignId") REFERENCES "WritingCampaign"(id)`
- `domain_CampaignEntry_judgeId_fk`：`FOREIGN KEY ("judgeId") REFERENCES "User"(id)`
- `domain_CampaignEntry_threadId_fk`：`FOREIGN KEY ("threadId") REFERENCES "ForumThread"(id)`
- `domain_CampaignEntry_userId_fk`：`FOREIGN KEY ("userId") REFERENCES "User"(id)`

索引：

### CartItem / cart_item

实物购物车引用可售单元

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|—||
|userId|text|是|—|app_user.id；通用可写|
|skuId|text|是|—|product_sku.id；通用可写|
|quantity|integer|是|—|通用可写|
|createdAt|timestamp(3) without time zone|是|CURRENT_TIMESTAMP||
|updatedAt|timestamp(3) without time zone|是|—||
|version|integer|是|1||
|offerId|text|是|''::text|sale_offer.id；通用可写|

约束：
- `CartItem_pkey`：`PRIMARY KEY (id)`
- `CartItem_quantity_check`：`CHECK (quantity >= 1 AND quantity <= 99)`
- `CartItem_version_check`：`CHECK (version > 0)`
- `domain_CartItem_0`：`UNIQUE ("userId", "offerId")`
- `domain_CartItem_1`：`CHECK (quantity >= 1 AND quantity <= 99)`
- `CartItem_skuId_fkey`：`FOREIGN KEY ("skuId") REFERENCES "ProductSku"(id) ON DELETE CASCADE`
- `CartItem_userId_fkey`：`FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE CASCADE`
- `domain_CartItem_offerId_fk`：`FOREIGN KEY ("offerId") REFERENCES "SaleOffer"(id)`
- `domain_CartItem_userId_fk`：`FOREIGN KEY ("userId") REFERENCES "User"(id)`

索引：
- `CREATE UNIQUE INDEX "CartItem_userId_skuId_key" ON public."CartItem" USING btree ("userId", "skuId")`
- `CREATE INDEX "domain_CartItem_idx_0" ON public."CartItem" USING btree ("userId", "updatedAt")`

### ChannelProductMapping / channel_product_mapping

渠道商品ID、平台价格币种和校验；商店价格与CNY报价分开

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|offerId|text|是|—|sale_offer.id；通用可写|
|channel|text|是|—|通用可写|
|appScope|text|是|—|通用可写|
|externalProductId|text|是|—|通用可写|
|productType|text|是|—|通用可写|
|currency|character(3)|是|—|通用可写|
|priceMinor|bigint|否|—|通用可写|
|minorExponent|integer|是|2|通用可写|
|active|boolean|是|false|通用可写|

约束：
- `ChannelProductMapping_pkey`：`PRIMARY KEY (id)`
- `ChannelProductMapping_version_check`：`CHECK (version > 0)`
- `domain_ChannelProductMapping_0`：`UNIQUE (channel, "appScope", "externalProductId")`
- `domain_ChannelProductMapping_1`：`CHECK ("priceMinor" IS NULL OR "priceMinor" >= 0)`
- `domain_ChannelProductMapping_2`：`CHECK ("minorExponent" >= 0 AND "minorExponent" <= 3)`
- `domain_ChannelProductMapping_offerId_fk`：`FOREIGN KEY ("offerId") REFERENCES "SaleOffer"(id)`

索引：
- `CREATE INDEX "domain_ChannelProductMapping_idx_0" ON public."ChannelProductMapping" USING btree ("offerId", channel, active)`

### Comment / comment

文章论坛直播评论与引用；所有目标指向资源

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|resourceId|text|是|—|resource.id；通用可写|
|authorId|text|是|—|app_user.id；通用可写|
|parentId|text|否|—|comment.id；通用可写|
|quoteBlockId|text|否|—|article_block.id；通用可写|
|quoteSnapshot|text|否|—|通用可写|
|body|text|是|—|通用可写|
|reviewState|text|是|—|通用可写|
|deletedAt|timestamp with time zone|否|—||

约束：
- `Comment_pkey`：`PRIMARY KEY (id)`
- `Comment_version_check`：`CHECK (version > 0)`
- `domain_Comment_authorId_fk`：`FOREIGN KEY ("authorId") REFERENCES "User"(id)`
- `domain_Comment_parentId_fk`：`FOREIGN KEY ("parentId") REFERENCES "Comment"(id)`
- `domain_Comment_quoteBlockId_fk`：`FOREIGN KEY ("quoteBlockId") REFERENCES "ArticleBlock"(id)`
- `domain_Comment_resourceId_fk`：`FOREIGN KEY ("resourceId") REFERENCES "Resource"(id)`

索引：
- `CREATE INDEX "domain_Comment_idx_0" ON public."Comment" USING btree ("resourceId", "createdAt", id)`
- `CREATE INDEX "domain_Comment_idx_1" ON public."Comment" USING btree ("parentId")`

### CommissionLedger / commission_ledger

佣金净实收及退款回冲，原始费率固定

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|promoterId|text|是|—|app_user.id；通用可写|
|orderItemId|text|是|—|order_item.id；通用可写|
|referralId|text|是|—|referral.id；通用可写|
|eventKey|text|是|—|通用可写|
|delta|bigint|是|—|通用可写|
|currency|character(3)|是|—|通用可写|
|basisSnapshot|jsonb|是|—|通用可写|
|rateBasisPoints|integer|是|—|通用可写|
|availableAt|timestamp with time zone|是|—|通用可写|
|reversalOfId|text|否|—|commission_ledger.id；通用可写|

约束：
- `CommissionLedger_eventKey_key`：`UNIQUE ("eventKey")`
- `CommissionLedger_pkey`：`PRIMARY KEY (id)`
- `CommissionLedger_reversalOfId_key`：`UNIQUE ("reversalOfId")`
- `domain_CommissionLedger_0`：`CHECK (delta <> 0 AND "rateBasisPoints" >= 0 AND "rateBasisPoints" <= 10000)`
- `domain_CommissionLedger_orderItemId_fk`：`FOREIGN KEY ("orderItemId") REFERENCES "TradeOrderItem"(id)`
- `domain_CommissionLedger_promoterId_fk`：`FOREIGN KEY ("promoterId") REFERENCES "User"(id)`
- `domain_CommissionLedger_referralId_fk`：`FOREIGN KEY ("referralId") REFERENCES "Referral"(id)`
- `domain_CommissionLedger_reversalOfId_fk`：`FOREIGN KEY ("reversalOfId") REFERENCES "CommissionLedger"(id)`

索引：
- `CREATE INDEX "domain_CommissionLedger_idx_0" ON public."CommissionLedger" USING btree ("promoterId", "availableAt")`

### ConsentRecord / consent_record

政策版本和非必要数据处理同意/撤回

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|userId|text|是|—|app_user.id；通用可写|
|policyCode|text|是|—|通用可写|
|policyVersion|text|是|—|通用可写|
|purpose|text|是|—|通用可写|
|accepted|boolean|是|—|通用可写|
|actedAt|timestamp with time zone|是|—|通用可写|
|source|text|是|—|通用可写|

约束：
- `ConsentRecord_pkey`：`PRIMARY KEY (id)`
- `domain_ConsentRecord_userId_fk`：`FOREIGN KEY ("userId") REFERENCES "User"(id)`

索引：
- `CREATE INDEX "domain_ConsentRecord_idx_0" ON public."ConsentRecord" USING btree ("userId", purpose, "actedAt")`

### ConsumedRefresh / consumed_refresh

已消费刷新令牌，重放撤销原会话

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|hash|text|是|—|通用可写|
|sessionId|text|是|—|auth_session.id；通用可写|
|createdAt|timestamp(3) without time zone|是|CURRENT_TIMESTAMP||
|id|text|是|(gen_random_uuid())::text||
|expiresAt|timestamp with time zone|是|now()|通用可写|

约束：
- `ConsumedRefresh_id_key`：`UNIQUE (id)`
- `ConsumedRefresh_pkey`：`PRIMARY KEY (hash)`
- `ConsumedRefresh_sessionId_fkey`：`FOREIGN KEY ("sessionId") REFERENCES "AuthSession"(id) ON UPDATE CASCADE ON DELETE CASCADE`
- `domain_ConsumedRefresh_sessionId_fk`：`FOREIGN KEY ("sessionId") REFERENCES "AuthSession"(id)`

索引：
- `CREATE INDEX "domain_ConsumedRefresh_idx_0" ON public."ConsumedRefresh" USING btree ("expiresAt")`

### ContentAuthorization / content_authorization

自愿公开私人摘录/日志或使用用户内容作课程案例的授权

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|userId|text|是|—|app_user.id；通用可写|
|threadId|text|否|—|forum_thread.id；通用可写|
|noteId|text|否|—|private_note.id；通用可写|
|logId|text|否|—|practice_log.id；通用可写|
|sourceSnapshot|jsonb|是|—|通用可写|
|usageScope|text|是|—|通用可写|
|agreementVersion|text|是|—|通用可写|
|targetReleaseId|text|否|—|course_release.id；通用可写|
|grantedAt|timestamp with time zone|是|—|通用可写|
|revokedAt|timestamp with time zone|否|—|通用可写|

约束：
- `ContentAuthorization_pkey`：`PRIMARY KEY (id)`
- `ContentAuthorization_version_check`：`CHECK (version > 0)`
- `domain_ContentAuthorization_0`：`CHECK (num_nonnulls("threadId", "noteId", "logId") = 1)`
- `domain_ContentAuthorization_logId_fk`：`FOREIGN KEY ("logId") REFERENCES "PracticeLog"(id)`
- `domain_ContentAuthorization_noteId_fk`：`FOREIGN KEY ("noteId") REFERENCES "Note"(id)`
- `domain_ContentAuthorization_targetReleaseId_fk`：`FOREIGN KEY ("targetReleaseId") REFERENCES "CourseRelease"(id)`
- `domain_ContentAuthorization_threadId_fk`：`FOREIGN KEY ("threadId") REFERENCES "ForumThread"(id)`
- `domain_ContentAuthorization_userId_fk`：`FOREIGN KEY ("userId") REFERENCES "User"(id)`

索引：
- `CREATE INDEX "domain_ContentAuthorization_idx_0" ON public."ContentAuthorization" USING btree ("userId", "grantedAt")`

### ContentRelation / content_relation

文章名师课程直播商品活动的强FK联动

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|fromId|text|是|—|resource.id；通用可写|
|toId|text|是|—|resource.id；通用可写|
|relationType|text|是|—|通用可写|
|rank|integer|是|0|通用可写|
|startsAt|timestamp with time zone|否|—|通用可写|
|endsAt|timestamp with time zone|否|—|通用可写|
|approvedBy|text|否|—|app_user.id|

约束：
- `ContentRelation_pkey`：`PRIMARY KEY (id)`
- `ContentRelation_version_check`：`CHECK (version > 0)`
- `domain_ContentRelation_0`：`UNIQUE ("fromId", "toId", "relationType")`
- `domain_ContentRelation_1`：`CHECK ("fromId" <> "toId")`
- `domain_ContentRelation_2`：`CHECK ("endsAt" IS NULL OR "startsAt" IS NULL OR "endsAt" > "startsAt")`
- `domain_ContentRelation_approvedBy_fk`：`FOREIGN KEY ("approvedBy") REFERENCES "User"(id)`
- `domain_ContentRelation_fromId_fk`：`FOREIGN KEY ("fromId") REFERENCES "Resource"(id)`
- `domain_ContentRelation_toId_fk`：`FOREIGN KEY ("toId") REFERENCES "Resource"(id)`

索引：
- `CREATE INDEX "domain_ContentRelation_idx_0" ON public."ContentRelation" USING btree ("fromId", "relationType", rank)`

### CouponTemplate / coupon_template

积分券R1、营销券R2；一单一券择优策略

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|code|text|是|—|通用可写|
|title|text|是|—|通用可写|
|discountKind|text|是|—|通用可写|
|discountValue|bigint|是|—|通用可写|
|threshold|bigint|是|—|通用可写|
|maxDiscount|bigint|否|—|通用可写|
|startsAt|timestamp with time zone|是|—|通用可写|
|endsAt|timestamp with time zone|是|—|通用可写|
|validDays|integer|否|—|通用可写|
|totalLimit|integer|是|—|通用可写|
|issuedCount|integer|是|0||
|perUserLimit|integer|是|—|通用可写|
|allowedChannels|text[]|是|—|通用可写|
|scope|jsonb|是|—|通用可写|
|stackingPolicy|text|是|—|通用可写|
|active|boolean|是|false|通用可写|

约束：
- `CouponTemplate_code_key`：`UNIQUE (code)`
- `CouponTemplate_pkey`：`PRIMARY KEY (id)`
- `CouponTemplate_version_check`：`CHECK (version > 0)`
- `domain_CouponTemplate_0`：`CHECK ("discountValue" > 0 AND threshold >= 0 AND "totalLimit" >= "issuedCount" AND "issuedCount" >= 0 AND "perUserLimit" > 0)`
- `domain_CouponTemplate_1`：`CHECK ("endsAt" > "startsAt")`

索引：

### Course / course

四类五形式课程定义，独立已购版本不得覆盖

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|—||
|title|text|是|—|通用可写|
|subtitle|text|是|—|通用可写|
|description|text|是|—|通用可写|
|category|text|是|—|通用可写|
|format|"CourseFormat"|是|'VIDEO'::"CourseFormat"|通用可写|
|cover|text|是|—|通用可写|
|price|integer|是|—|通用可写|
|chaptersCount|integer|是|0||
|durationMinutes|integer|是|0|通用可写|
|tags|text[]|否|—|通用可写|
|teacherId|text|是|—|teacher.id；通用可写|
|status|"PublishStatus"|是|'DRAFT'::"PublishStatus"|通用可写|
|featured|boolean|是|false|通用可写|
|isDemo|boolean|是|false|通用可写|
|createdAt|timestamp(3) without time zone|是|CURRENT_TIMESTAMP||
|updatedAt|timestamp(3) without time zone|是|—||
|accessDays|integer|否|—|通用可写|
|membershipTier|integer|否|—|通用可写|
|publishedReleaseId|text|否|—|course_release.id|
|refundPolicy|text|是|'未开始学习可申请退款，具体以订单售前规则为准'::text|通用可写|
|version|integer|是|1||
|resourceKind|text|是|'COURSE'::text||
|completionPolicy|jsonb|是|'{}'::jsonb|通用可写|

约束：
- `Course_pkey`：`PRIMARY KEY (id)`
- `Course_resourceKind_check`：`CHECK ("resourceKind" = 'COURSE'::text)`
- `domain_Course_0`：`CHECK (format = ANY (ARRAY['VIDEO'::"CourseFormat", 'AUDIO'::"CourseFormat", 'LIVE'::"CourseFormat", 'COHORT'::"CourseFormat", 'OFFLINE'::"CourseFormat"]))`
- `domain_Course_1`：`CHECK ("accessDays" IS NULL OR "accessDays" > 0)`
- `Course_teacherId_fkey`：`FOREIGN KEY ("teacherId") REFERENCES "Teacher"(id) ON UPDATE CASCADE ON DELETE RESTRICT`
- `domain_Course_2`：`FOREIGN KEY (id, "resourceKind") REFERENCES "Resource"(id, kind)`
- `domain_Course_3`：`FOREIGN KEY ("publishedReleaseId", id) REFERENCES "CourseRelease"(id, "courseId")`
- `domain_Course_publishedReleaseId_fk`：`FOREIGN KEY ("publishedReleaseId") REFERENCES "CourseRelease"(id)`
- `domain_Course_teacherId_fk`：`FOREIGN KEY ("teacherId") REFERENCES "Teacher"(id)`

索引：
- `CREATE INDEX "Course_status_category_idx" ON public."Course" USING btree (status, category)`

### CourseCertificate

本人研习完成记录；按发布版本生成一次，禁止通用CRUD

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|userId|text|是|—||
|courseId|text|是|—||
|releaseId|text|是|—||
|courseTitle|text|是|—||
|lessonCount|integer|是|—||
|completedAt|timestamp with time zone|是|—||
|createdAt|timestamp with time zone|是|now()||

约束：
- `CourseCertificate_lessonCount_check`：`CHECK ("lessonCount" > 0)`
- `CourseCertificate_pkey`：`PRIMARY KEY (id)`
- `CourseCertificate_userId_releaseId_key`：`UNIQUE ("userId", "releaseId")`
- `CourseCertificate_courseId_fkey`：`FOREIGN KEY ("courseId") REFERENCES "Course"(id)`
- `CourseCertificate_releaseId_fkey`：`FOREIGN KEY ("releaseId") REFERENCES "CourseRelease"(id)`
- `CourseCertificate_userId_fkey`：`FOREIGN KEY ("userId") REFERENCES "User"(id)`

索引：

### CourseChapter / course_chapter

草稿章节稳定ID；编辑不得全部重建键

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|—||
|courseId|text|是|—|course.id；通用可写|
|title|text|是|—|通用可写|
|position|integer|是|—|通用可写|
|format|"LessonFormat"|是|—|通用可写|
|body|text|是|''::text|通用可写|
|mediaId|text|否|—|media_asset.id；通用可写|
|durationSeconds|integer|是|0|通用可写|
|trial|boolean|是|false|通用可写|
|required|boolean|是|true|通用可写|
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|stableKey|text|是|(gen_random_uuid())::text|通用可写|
|archivedAt|timestamp with time zone|否|—|通用可写|

约束：
- `CourseChapter_pkey`：`PRIMARY KEY (id)`
- `CourseChapter_version_check`：`CHECK (version > 0)`
- `domain_CourseChapter_0`：`UNIQUE ("courseId", "stableKey")`
- `domain_CourseChapter_1`：`CHECK ("position" >= 0 AND "durationSeconds" >= 0)`
- `CourseChapter_courseId_fkey`：`FOREIGN KEY ("courseId") REFERENCES "Course"(id) ON UPDATE CASCADE ON DELETE CASCADE`
- `domain_CourseChapter_courseId_fk`：`FOREIGN KEY ("courseId") REFERENCES "Course"(id)`
- `domain_CourseChapter_mediaId_fk`：`FOREIGN KEY ("mediaId") REFERENCES "MediaAsset"(id)`

索引：
- `CREATE UNIQUE INDEX "CourseChapter_courseId_position_key" ON public."CourseChapter" USING btree ("courseId", "position")`
- `CREATE UNIQUE INDEX "domain_CourseChapter_idx_0" ON public."CourseChapter" USING btree ("courseId", "position") WHERE ("archivedAt" IS NULL)`

### CourseCohort / course_cohort

开营批次容量时间、固定发布版与助教

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|courseId|text|是|—|course.id；通用可写|
|releaseId|text|是|—|course_release.id；通用可写|
|title|text|是|—|通用可写|
|startsAt|timestamp with time zone|是|—|通用可写|
|endsAt|timestamp with time zone|是|—|通用可写|
|enrollDeadline|timestamp with time zone|是|—|通用可写|
|capacity|integer|是|—|通用可写|
|reserved|integer|是|0||
|confirmed|integer|是|0||
|state|text|是|—|通用可写|

约束：
- `CourseCohort_pkey`：`PRIMARY KEY (id)`
- `CourseCohort_version_check`：`CHECK (version > 0)`
- `domain_CourseCohort_0`：`CHECK ("endsAt" > "startsAt")`
- `domain_CourseCohort_1`：`CHECK (capacity >= 0 AND reserved >= 0 AND confirmed >= 0 AND (reserved + confirmed) <= capacity)`
- `domain_CourseCohort_2`：`UNIQUE (id, "courseId")`
- `domain_CourseCohort_3`：`FOREIGN KEY ("releaseId", "courseId") REFERENCES "CourseRelease"(id, "courseId")`
- `domain_CourseCohort_courseId_fk`：`FOREIGN KEY ("courseId") REFERENCES "Course"(id)`
- `domain_CourseCohort_releaseId_fk`：`FOREIGN KEY ("releaseId") REFERENCES "CourseRelease"(id)`

索引：
- `CREATE INDEX "domain_CourseCohort_idx_0" ON public."CourseCohort" USING btree ("courseId", "startsAt")`

### CourseRelease / course_release

不可变交付快照，作者授权、时效退课规则固定

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|—||
|courseId|text|是|—|course.id；通用可写|
|version|integer|是|—||
|title|text|是|—|通用可写|
|createdAt|timestamp(3) without time zone|是|CURRENT_TIMESTAMP||
|descriptionSnapshot|text|是|''::text|通用可写|
|teacherSnapshot|jsonb|是|'{}'::jsonb|通用可写|
|accessDays|integer|否|—|通用可写|
|refundPolicySnapshot|jsonb|是|'{}'::jsonb|通用可写|
|completionPolicySnapshot|jsonb|是|'{}'::jsonb|通用可写|

约束：
- `CourseRelease_pkey`：`PRIMARY KEY (id)`
- `domain_CourseRelease_0`：`UNIQUE ("courseId", version)`
- `domain_CourseRelease_1`：`UNIQUE (id, "courseId")`
- `CourseRelease_courseId_fkey`：`FOREIGN KEY ("courseId") REFERENCES "Course"(id) ON UPDATE CASCADE ON DELETE CASCADE`
- `domain_CourseRelease_courseId_fk`：`FOREIGN KEY ("courseId") REFERENCES "Course"(id)`

索引：
- `CREATE UNIQUE INDEX "CourseRelease_courseId_version_key" ON public."CourseRelease" USING btree ("courseId", version)`

### CourseReview

真实学员课程评价；先审后发，版本校验，禁止通用CRUD

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|userId|text|是|—||
|courseId|text|是|—||
|releaseId|text|是|—||
|rating|integer|是|—||
|body|text|是|—||
|reviewState|text|是|'PENDING'::text||
|version|integer|是|1||
|reviewerId|text|否|—||
|reviewedAt|timestamp with time zone|否|—||
|deletedAt|timestamp with time zone|否|—||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||

约束：
- `CourseReview_body_check`：`CHECK (char_length(body) >= 1 AND char_length(body) <= 5000)`
- `CourseReview_pkey`：`PRIMARY KEY (id)`
- `CourseReview_rating_check`：`CHECK (rating >= 1 AND rating <= 5)`
- `CourseReview_reviewState_check`：`CHECK ("reviewState" = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text, 'REMOVED'::text]))`
- `CourseReview_userId_courseId_key`：`UNIQUE ("userId", "courseId")`
- `CourseReview_version_check`：`CHECK (version > 0)`
- `CourseReview_courseId_fkey`：`FOREIGN KEY ("courseId") REFERENCES "Course"(id)`
- `CourseReview_releaseId_fkey`：`FOREIGN KEY ("releaseId") REFERENCES "CourseRelease"(id)`
- `CourseReview_reviewerId_fkey`：`FOREIGN KEY ("reviewerId") REFERENCES "User"(id)`
- `CourseReview_userId_fkey`：`FOREIGN KEY ("userId") REFERENCES "User"(id)`

索引：
- `CREATE INDEX "CourseReview_courseId_reviewState_createdAt_idx" ON public."CourseReview" USING btree ("courseId", "reviewState", "createdAt")`

### CourseStaff / course_staff

老师和助教按课程及可选营期授权

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|courseId|text|是|—|course.id；通用可写|
|cohortId|text|否|—|course_cohort.id；通用可写|
|userId|text|是|—|app_user.id；通用可写|
|role|text|是|—|通用可写|
|revokedAt|timestamp with time zone|否|—|通用可写|

约束：
- `CourseStaff_pkey`：`PRIMARY KEY (id)`
- `CourseStaff_version_check`：`CHECK (version > 0)`
- `domain_CourseStaff_0`：`CHECK (role = ANY (ARRAY['TEACHER'::text, 'ASSISTANT'::text]))`
- `domain_CourseStaff_1`：`FOREIGN KEY ("cohortId", "courseId") REFERENCES "CourseCohort"(id, "courseId")`
- `domain_CourseStaff_cohortId_fk`：`FOREIGN KEY ("cohortId") REFERENCES "CourseCohort"(id)`
- `domain_CourseStaff_courseId_fk`：`FOREIGN KEY ("courseId") REFERENCES "Course"(id)`
- `domain_CourseStaff_userId_fk`：`FOREIGN KEY ("userId") REFERENCES "User"(id)`

索引：
- `CREATE INDEX "domain_CourseStaff_idx_0" ON public."CourseStaff" USING btree ("courseId", "userId")`
- `CREATE INDEX "domain_CourseStaff_idx_1" ON public."CourseStaff" USING btree ("cohortId", "userId")`

### DeliveryTemplate / delivery_template

不同商品配送规则及售前说明

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|name|text|是|—|通用可写|
|chargeBasis|text|是|—|通用可写|
|prioritySupported|boolean|是|false|通用可写|
|description|text|是|—|通用可写|
|active|boolean|是|false|通用可写|

约束：
- `DeliveryTemplate_pkey`：`PRIMARY KEY (id)`
- `DeliveryTemplate_version_check`：`CHECK (version > 0)`
- `domain_DeliveryTemplate_0`：`CHECK ("chargeBasis" = ANY (ARRAY['ORDER'::text, 'QUANTITY'::text, 'WEIGHT'::text]))`

索引：

### DeliveryZone

既有专用业务兼容表

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|province|text|是|—||
|fee|integer|是|—||
|surcharge|integer|是|0||
|freeAbove|integer|否|—||
|enabled|boolean|是|false||
|version|integer|是|1||

约束：
- `DeliveryZone_fee_check`：`CHECK (fee >= 0)`
- `DeliveryZone_freeAbove_check`：`CHECK ("freeAbove" >= 0)`
- `DeliveryZone_pkey`：`PRIMARY KEY (province)`
- `DeliveryZone_surcharge_check`：`CHECK (surcharge >= 0)`

索引：

### DeviceToken / device_token

原生推送设备绑定与退出失效

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|userId|text|是|—|app_user.id；通用可写|
|platform|text|是|—|通用可写|
|provider|text|是|—|通用可写|
|tokenCipher|text|是|—|查询隐藏；通用可写|
|tokenHash|text|是|—|查询隐藏|
|deviceId|text|是|—|通用可写|
|enabled|boolean|是|false|通用可写|
|revokedAt|timestamp with time zone|否|—|通用可写|
|lastConfirmedAt|timestamp with time zone|否|—|通用可写|

约束：
- `DeviceToken_pkey`：`PRIMARY KEY (id)`
- `DeviceToken_tokenHash_key`：`UNIQUE ("tokenHash")`
- `DeviceToken_version_check`：`CHECK (version > 0)`
- `domain_DeviceToken_userId_fk`：`FOREIGN KEY ("userId") REFERENCES "User"(id)`

索引：
- `CREATE INDEX "domain_DeviceToken_idx_0" ON public."DeviceToken" USING btree ("userId", enabled, "revokedAt")`

### DigitalDelivery / digital_delivery

支付后领取权益，退款逐来源撤销

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|userId|text|是|—|app_user.id；通用可写|
|orderItemId|text|是|—|order_item.id；通用可写|
|releaseId|text|是|—|digital_release.id；通用可写|
|startsAt|timestamp with time zone|是|—|通用可写|
|expiresAt|timestamp with time zone|否|—|通用可写|
|revokedAt|timestamp with time zone|否|—|通用可写|
|grantKey|text|是|—|通用可写|

约束：
- `DigitalDelivery_grantKey_key`：`UNIQUE ("grantKey")`
- `DigitalDelivery_orderItemId_key`：`UNIQUE ("orderItemId")`
- `DigitalDelivery_pkey`：`PRIMARY KEY (id)`
- `DigitalDelivery_version_check`：`CHECK (version > 0)`
- `domain_DigitalDelivery_0`：`CHECK ("expiresAt" IS NULL OR "expiresAt" > "startsAt")`
- `domain_DigitalDelivery_orderItemId_fk`：`FOREIGN KEY ("orderItemId") REFERENCES "TradeOrderItem"(id)`
- `domain_DigitalDelivery_releaseId_fk`：`FOREIGN KEY ("releaseId") REFERENCES "DigitalRelease"(id)`
- `domain_DigitalDelivery_userId_fk`：`FOREIGN KEY ("userId") REFERENCES "User"(id)`

索引：
- `CREATE INDEX "domain_DigitalDelivery_idx_0" ON public."DigitalDelivery" USING btree ("userId", "expiresAt")`

### DigitalRelease / digital_release

数字资料不可变版本与使用期限

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|productId|text|是|—|product.id；通用可写|
|releaseNo|integer|是|—|通用可写|
|description|text|是|—|通用可写|
|accessDays|integer|否|—|通用可写|
|rightsSnapshot|jsonb|是|—|通用可写|

约束：
- `DigitalRelease_pkey`：`PRIMARY KEY (id)`
- `domain_DigitalRelease_0`：`UNIQUE ("productId", "releaseNo")`
- `domain_DigitalRelease_1`：`CHECK ("accessDays" IS NULL OR "accessDays" > 0)`
- `domain_DigitalRelease_productId_fk`：`FOREIGN KEY ("productId") REFERENCES "Product"(id)`

索引：

### DigitalReleaseAsset / digital_release_asset

数字资料包文件顺序

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|releaseId|text|是|—|digital_release.id；通用可写|
|assetId|text|是|—|media_asset.id；通用可写|
|position|integer|是|—|通用可写|

约束：
- `DigitalReleaseAsset_pkey`：`PRIMARY KEY (id)`
- `domain_DigitalReleaseAsset_0`：`UNIQUE ("releaseId", "assetId")`
- `domain_DigitalReleaseAsset_1`：`UNIQUE ("releaseId", "position")`
- `domain_DigitalReleaseAsset_assetId_fk`：`FOREIGN KEY ("assetId") REFERENCES "MediaAsset"(id)`
- `domain_DigitalReleaseAsset_releaseId_fk`：`FOREIGN KEY ("releaseId") REFERENCES "DigitalRelease"(id)`

索引：

### Enrollment / enrollment

每笔独立来源的课程授权，避免退款误撤其他购课权

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|—||
|userId|text|是|—|app_user.id；通用可写|
|courseId|text|是|—|course.id；通用可写|
|releaseId|text|是|—|通用可写|
|source|text|是|—|通用可写|
|expiresAt|timestamp(3) without time zone|否|—|通用可写|
|revokedAt|timestamp(3) without time zone|否|—|通用可写|
|createdAt|timestamp(3) without time zone|是|CURRENT_TIMESTAMP||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|cohortId|text|否|—|course_cohort.id；通用可写|
|orderItemId|text|否|—|order_item.id；通用可写|
|grantKey|text|是|(gen_random_uuid())::text|通用可写|
|startsAt|timestamp with time zone|是|now()|通用可写|
|grantActorId|text|否|—|app_user.id|
|grantReason|text|否|—|通用可写|
|startedAt|timestamp with time zone|否|—||

约束：
- `Enrollment_grantKey_key`：`UNIQUE ("grantKey")`
- `Enrollment_orderItemId_key`：`UNIQUE ("orderItemId")`
- `Enrollment_pkey`：`PRIMARY KEY (id)`
- `Enrollment_version_check`：`CHECK (version > 0)`
- `domain_Enrollment_1`：`CHECK ("expiresAt" IS NULL OR "expiresAt" > "startsAt")`
- `Enrollment_courseId_fkey`：`FOREIGN KEY ("courseId") REFERENCES "Course"(id) ON UPDATE CASCADE ON DELETE CASCADE`
- `Enrollment_releaseId_fkey`：`FOREIGN KEY ("releaseId") REFERENCES "CourseRelease"(id) ON UPDATE CASCADE ON DELETE RESTRICT`
- `Enrollment_userId_fkey`：`FOREIGN KEY ("userId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE CASCADE`
- `domain_Enrollment_0`：`FOREIGN KEY ("releaseId", "courseId") REFERENCES "CourseRelease"(id, "courseId")`
- `domain_Enrollment_2`：`FOREIGN KEY ("cohortId", "courseId") REFERENCES "CourseCohort"(id, "courseId")`
- `domain_Enrollment_cohortId_fk`：`FOREIGN KEY ("cohortId") REFERENCES "CourseCohort"(id)`
- `domain_Enrollment_courseId_fk`：`FOREIGN KEY ("courseId") REFERENCES "Course"(id)`
- `domain_Enrollment_grantActorId_fk`：`FOREIGN KEY ("grantActorId") REFERENCES "User"(id)`
- `domain_Enrollment_orderItemId_fk`：`FOREIGN KEY ("orderItemId") REFERENCES "TradeOrderItem"(id)`
- `domain_Enrollment_userId_fk`：`FOREIGN KEY ("userId") REFERENCES "User"(id)`

索引：
- `CREATE UNIQUE INDEX "Enrollment_userId_courseId_key" ON public."Enrollment" USING btree ("userId", "courseId")`
- `CREATE INDEX "domain_Enrollment_idx_0" ON public."Enrollment" USING btree ("userId", "courseId", "revokedAt", "expiresAt")`

### Event / event

讲座研学见面会线下课，时间席位下放场次

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|—||
|title|text|是|—|通用可写|
|description|text|是|—|通用可写|
|category|text|是|—|通用可写|
|cover|text|是|—|通用可写|
|location|text|是|—|通用可写|
|startsAt|timestamp(3) without time zone|是|—|通用可写|
|endsAt|timestamp(3) without time zone|是|—|通用可写|
|capacity|integer|是|—|通用可写|
|price|integer|是|—|通用可写|
|status|"PublishStatus"|是|'DRAFT'::"PublishStatus"|通用可写|
|isDemo|boolean|是|false|通用可写|
|createdAt|timestamp(3) without time zone|是|CURRENT_TIMESTAMP||
|updatedAt|timestamp(3) without time zone|是|—||
|version|integer|是|1||
|resourceKind|text|是|'EVENT'::text||
|organizerPartnerId|text|否|—|partner.id；通用可写|
|teacherId|text|否|—|teacher.id；通用可写|
|cancelPolicy|jsonb|是|'{}'::jsonb|通用可写|
|responsibleUserId|text|是|—|app_user.id；通用可写|

约束：
- `Event_pkey`：`PRIMARY KEY (id)`
- `Event_resourceKind_check`：`CHECK ("resourceKind" = 'EVENT'::text)`
- `Event_version_check`：`CHECK (version > 0)`
- `domain_Event_0`：`FOREIGN KEY (id, "resourceKind") REFERENCES "Resource"(id, kind)`
- `domain_Event_organizerPartnerId_fk`：`FOREIGN KEY ("organizerPartnerId") REFERENCES "Partner"(id)`
- `domain_Event_responsibleUserId_fk`：`FOREIGN KEY ("responsibleUserId") REFERENCES "User"(id)`
- `domain_Event_teacherId_fk`：`FOREIGN KEY ("teacherId") REFERENCES "Teacher"(id)`

索引：
- `CREATE INDEX "Event_status_startsAt_idx" ON public."Event" USING btree (status, "startsAt")`

### EventCheckin / event_checkin

核销幂等，工作者须在场次授权范围

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|registrationId|text|是|—|event_registration.id；通用可写|
|attendeeNo|integer|是|—|通用可写|
|actorId|text|是|—|app_user.id|
|requestKey|text|是|—|通用可写|
|checkedAt|timestamp with time zone|是|—|通用可写|

约束：
- `EventCheckin_pkey`：`PRIMARY KEY (id)`
- `EventCheckin_requestKey_key`：`UNIQUE ("requestKey")`
- `domain_EventCheckin_0`：`UNIQUE ("registrationId", "attendeeNo")`
- `domain_EventCheckin_1`：`CHECK ("attendeeNo" > 0)`
- `domain_EventCheckin_actorId_fk`：`FOREIGN KEY ("actorId") REFERENCES "User"(id)`
- `domain_EventCheckin_registrationId_fk`：`FOREIGN KEY ("registrationId") REFERENCES "EventRegistration"(id)`

索引：

### EventRegistration / event_registration

免费也需报名，付费与会员额度共用席位

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|userId|text|是|—|app_user.id；通用可写|
|ticketTypeId|text|是|—|event_ticket_type.id；通用可写|
|orderItemId|text|否|—|order_item.id；通用可写|
|requestKey|text|是|—|通用可写|
|quantity|integer|是|—|通用可写|
|attendeeSnapshotCipher|text|是|—|查询隐藏；通用可写|
|state|text|是|—|通用可写|
|checkinHash|text|是|—|查询隐藏|
|benefitUsageId|text|否|—|benefit_usage.id；通用可写|
|confirmedAt|timestamp with time zone|否|—|通用可写|
|cancelledAt|timestamp with time zone|否|—|通用可写|
|acceptedScheduleVersion|integer|是|1且大于0|学员确认专用流程维护|
|scheduleSnapshot|jsonb|否|—|终态实际安排，不覆盖原快照|

约束：
- `EventRegistration_checkinHash_key`：`UNIQUE ("checkinHash")`
- `EventRegistration_orderItemId_key`：`UNIQUE ("orderItemId")`
- `EventRegistration_pkey`：`PRIMARY KEY (id)`
- `EventRegistration_version_check`：`CHECK (version > 0)`
- `domain_EventRegistration_0`：`UNIQUE ("userId", "requestKey")`
- `domain_EventRegistration_1`：`CHECK (quantity > 0)`
- `domain_EventRegistration_benefitUsageId_fk`：`FOREIGN KEY ("benefitUsageId") REFERENCES "BenefitUsage"(id)`
- `domain_EventRegistration_orderItemId_fk`：`FOREIGN KEY ("orderItemId") REFERENCES "TradeOrderItem"(id)`
- `domain_EventRegistration_ticketTypeId_fk`：`FOREIGN KEY ("ticketTypeId") REFERENCES "EventTicketType"(id)`
- `domain_EventRegistration_userId_fk`：`FOREIGN KEY ("userId") REFERENCES "User"(id)`

索引：
- `CREATE INDEX "domain_EventRegistration_idx_0" ON public."EventRegistration" USING btree ("userId", "createdAt")`
- `CREATE INDEX "domain_EventRegistration_idx_1" ON public."EventRegistration" USING btree ("ticketTypeId", state)`

### EventSession / event_session

单场时间地点、延期取消与核销范围

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|eventId|text|是|—|event.id；通用可写|
|startsAt|timestamp with time zone|是|—|通用可写|
|endsAt|timestamp with time zone|是|—|通用可写|
|location|text|是|—|通用可写|
|contactCipher|text|否|—|查询隐藏；通用可写|
|state|text|是|—|通用可写|
|capacity|integer|是|—|通用可写|
|cancelDeadline|timestamp with time zone|是|—|通用可写|
|publicOpenAt|timestamp with time zone|是|—|通用可写|
|memberOpenAt|timestamp with time zone|否|—|通用可写|
|rescheduledFromId|text|否|—|event_session.id；通用可写|
|scheduleVersion|integer|是|1且大于0|安排专用流程维护|
|changeReason|text|否|—|最新延期/运营取消原因|

约束：
- `EventSession_pkey`：`PRIMARY KEY (id)`
- `EventSession_version_check`：`CHECK (version > 0)`
- `domain_EventSession_0`：`CHECK ("endsAt" > "startsAt" AND capacity > 0)`
- `domain_EventSession_1`：`CHECK ("memberOpenAt" IS NULL OR "memberOpenAt" <= "publicOpenAt")`
- `domain_EventSession_eventId_fk`：`FOREIGN KEY ("eventId") REFERENCES "Event"(id)`
- `domain_EventSession_rescheduledFromId_fk`：`FOREIGN KEY ("rescheduledFromId") REFERENCES "EventSession"(id)`

索引：
- `CREATE INDEX "domain_EventSession_idx_0" ON public."EventSession" USING btree ("eventId", "startsAt")`

### EventStaff / event_staff

场次工作人员授权

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|sessionId|text|是|—|event_session.id；通用可写|
|userId|text|是|—|app_user.id；通用可写|
|scopeCodes|text[]|是|—|通用可写|
|revokedAt|timestamp with time zone|否|—|通用可写|

约束：
- `EventStaff_pkey`：`PRIMARY KEY (id)`
- `EventStaff_version_check`：`CHECK (version > 0)`
- `domain_EventStaff_sessionId_fk`：`FOREIGN KEY ("sessionId") REFERENCES "EventSession"(id)`
- `domain_EventStaff_userId_fk`：`FOREIGN KEY ("userId") REFERENCES "User"(id)`

索引：
- `CREATE UNIQUE INDEX "domain_EventStaff_idx_0" ON public."EventStaff" USING btree ("sessionId", "userId") WHERE ("revokedAt" IS NULL)`

### EventTicketType / event_ticket_type

票种容量及售价由offer配置，多票种R2

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|sessionId|text|是|—|event_session.id；通用可写|
|title|text|是|—|通用可写|
|capacity|integer|是|—|通用可写|
|reserved|integer|是|0||
|confirmed|integer|是|0||
|perUserLimit|integer|是|1|通用可写|
|active|boolean|是|false|通用可写|

约束：
- `EventTicketType_pkey`：`PRIMARY KEY (id)`
- `EventTicketType_version_check`：`CHECK (version > 0)`
- `domain_EventTicketType_0`：`CHECK (capacity >= 0 AND reserved >= 0 AND confirmed >= 0 AND (reserved + confirmed) <= capacity AND "perUserLimit" > 0)`
- `domain_EventTicketType_sessionId_fk`：`FOREIGN KEY ("sessionId") REFERENCES "EventSession"(id)`

索引：
- `CREATE INDEX "domain_EventTicketType_idx_0" ON public."EventTicketType" USING btree ("sessionId", active)`

### EventWaitlist / event_waitlist

候补记录和限时补位邀请

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|sessionId|text|是|—|event_session.id；通用可写|
|userId|text|是|—|app_user.id；通用可写|
|quantity|integer|是|—|通用可写|
|state|text|是|—|通用可写|
|invitedUntil|timestamp with time zone|否|—|通用可写|
|registrationId|text|否|—|event_registration.id；通用可写|

约束：
- `EventWaitlist_pkey`：`PRIMARY KEY (id)`
- `EventWaitlist_version_check`：`CHECK (version > 0)`
- `domain_EventWaitlist_0`：`UNIQUE ("sessionId", "userId")`
- `domain_EventWaitlist_1`：`CHECK (quantity > 0)`
- `domain_EventWaitlist_registrationId_fk`：`FOREIGN KEY ("registrationId") REFERENCES "EventRegistration"(id)`
- `domain_EventWaitlist_sessionId_fk`：`FOREIGN KEY ("sessionId") REFERENCES "EventSession"(id)`
- `domain_EventWaitlist_userId_fk`：`FOREIGN KEY ("userId") REFERENCES "User"(id)`

索引：
- `CREATE INDEX "domain_EventWaitlist_idx_0" ON public."EventWaitlist" USING btree ("sessionId", state, "createdAt")`

### Favorite

既有专用业务兼容表

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|—||
|userId|text|是|—||
|articleId|text|是|—||
|createdAt|timestamp(3) without time zone|是|CURRENT_TIMESTAMP||

约束：
- `Favorite_pkey`：`PRIMARY KEY (id)`
- `Favorite_userId_fkey`：`FOREIGN KEY ("userId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE RESTRICT`

索引：
- `CREATE UNIQUE INDEX "Favorite_userId_articleId_key" ON public."Favorite" USING btree ("userId", "articleId")`

### FeatureConfig / feature_config

带版本的业务规则与开关、实际客服联系方式、消息偏好默认

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|configKey|text|是|—|通用可写|
|revision|integer|是|—|通用可写|
|value|jsonb|是|—|通用可写|
|effectiveAt|timestamp with time zone|是|—|通用可写|
|approvedBy|text|是|—|app_user.id|
|reason|text|是|—|通用可写|

约束：
- `FeatureConfig_pkey`：`PRIMARY KEY (id)`
- `domain_FeatureConfig_0`：`UNIQUE ("configKey", revision)`
- `domain_FeatureConfig_1`：`CHECK (revision > 0)`
- `domain_FeatureConfig_approvedBy_fk`：`FOREIGN KEY ("approvedBy") REFERENCES "User"(id)`

索引：
- `CREATE INDEX "domain_FeatureConfig_idx_0" ON public."FeatureConfig" USING btree ("configKey", "effectiveAt")`

### Feedback / feedback

意见/售后咨询/电话回访工单

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|userId|text|是|—|app_user.id；通用可写|
|orderId|text|否|—|trade_order.id；通用可写|
|kind|text|是|—|通用可写|
|body|text|是|—|通用可写|
|contactCipher|text|否|—|查询隐藏；通用可写|
|state|text|是|—|通用可写|
|assigneeId|text|否|—|app_user.id；通用可写|
|closedAt|timestamp with time zone|否|—|通用可写|

约束：
- `Feedback_pkey`：`PRIMARY KEY (id)`
- `Feedback_version_check`：`CHECK (version > 0)`
- `domain_Feedback_assigneeId_fk`：`FOREIGN KEY ("assigneeId") REFERENCES "User"(id)`
- `domain_Feedback_orderId_fk`：`FOREIGN KEY ("orderId") REFERENCES "TradeOrder"(id)`
- `domain_Feedback_userId_fk`：`FOREIGN KEY ("userId") REFERENCES "User"(id)`

索引：
- `CREATE INDEX "domain_Feedback_idx_0" ON public."Feedback" USING btree (state, "createdAt")`
- `CREATE INDEX "domain_Feedback_idx_1" ON public."Feedback" USING btree ("userId", "createdAt")`

### FeedbackReply / feedback_reply

工单双向答复，内部备注不发用户

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|feedbackId|text|是|—|feedback.id；通用可写|
|authorId|text|是|—|app_user.id；通用可写|
|body|text|是|—|通用可写|
|internal|boolean|是|false|通用可写|

约束：
- `FeedbackReply_pkey`：`PRIMARY KEY (id)`
- `domain_FeedbackReply_authorId_fk`：`FOREIGN KEY ("authorId") REFERENCES "User"(id)`
- `domain_FeedbackReply_feedbackId_fk`：`FOREIGN KEY ("feedbackId") REFERENCES "Feedback"(id)`

索引：
- `CREATE INDEX "domain_FeedbackReply_idx_0" ON public."FeedbackReply" USING btree ("feedbackId", "createdAt")`

### FinanceAccount / finance_account

财务科目目录，平台收入、渠道费、合作应付、退款等

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|code|text|是|—|通用可写|
|title|text|是|—|通用可写|
|kind|text|是|—|通用可写|
|active|boolean|是|true|通用可写|

约束：
- `FinanceAccount_code_key`：`UNIQUE (code)`
- `FinanceAccount_pkey`：`PRIMARY KEY (id)`
- `FinanceAccount_version_check`：`CHECK (version > 0)`

索引：

### FinanceEntry / finance_entry

双式分录；每journal同币种借贷总和为0

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|journalId|text|是|—|finance_journal.id；通用可写|
|accountCode|text|是|—|通用可写|
|partnerId|text|否|—|partner.id；通用可写|
|userId|text|否|—|app_user.id；通用可写|
|debit|bigint|是|0|通用可写|
|credit|bigint|是|0|通用可写|

约束：
- `FinanceEntry_pkey`：`PRIMARY KEY (id)`
- `domain_FinanceEntry_0`：`CHECK (debit > 0 AND credit = 0 OR credit > 0 AND debit = 0)`
- `domain_FinanceEntry_1`：`FOREIGN KEY ("accountCode") REFERENCES "FinanceAccount"(code)`
- `domain_FinanceEntry_journalId_fk`：`FOREIGN KEY ("journalId") REFERENCES "FinanceJournal"(id)`
- `domain_FinanceEntry_partnerId_fk`：`FOREIGN KEY ("partnerId") REFERENCES "Partner"(id)`
- `domain_FinanceEntry_userId_fk`：`FOREIGN KEY ("userId") REFERENCES "User"(id)`

索引：
- `CREATE INDEX "domain_FinanceEntry_idx_0" ON public."FinanceEntry" USING btree ("journalId")`
- `CREATE INDEX "domain_FinanceEntry_idx_1" ON public."FinanceEntry" USING btree ("accountCode", "createdAt")`

### FinanceJournal / finance_journal

支付退款费用合作应付总账事件，保存异常事实

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|eventKey|text|是|—|通用可写|
|kind|text|是|—|通用可写|
|orderId|text|否|—|trade_order.id；通用可写|
|transactionId|text|否|—|payment_transaction.id；通用可写|
|refundId|text|否|—|refund.id；通用可写|
|currency|character(3)|是|—|通用可写|
|postedAt|timestamp with time zone|是|—|通用可写|
|reversalOfId|text|否|—|finance_journal.id；通用可写|
|description|text|是|—|通用可写|

约束：
- `FinanceJournal_eventKey_key`：`UNIQUE ("eventKey")`
- `FinanceJournal_pkey`：`PRIMARY KEY (id)`
- `FinanceJournal_reversalOfId_key`：`UNIQUE ("reversalOfId")`
- `domain_FinanceJournal_orderId_fk`：`FOREIGN KEY ("orderId") REFERENCES "TradeOrder"(id)`
- `domain_FinanceJournal_refundId_fk`：`FOREIGN KEY ("refundId") REFERENCES "Refund"(id)`
- `domain_FinanceJournal_reversalOfId_fk`：`FOREIGN KEY ("reversalOfId") REFERENCES "FinanceJournal"(id)`
- `domain_FinanceJournal_transactionId_fk`：`FOREIGN KEY ("transactionId") REFERENCES "PaymentTransaction"(id)`

索引：

### ForumSection / forum_section

六区及受限课程讨论；共用帖子能力

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|code|text|是|—|通用可写|
|title|text|是|—|通用可写|
|scope|text|是|—|通用可写|
|courseId|text|否|—|course.id；通用可写|
|cohortId|text|否|—|course_cohort.id；通用可写|
|description|text|是|—|通用可写|
|active|boolean|是|false|通用可写|

约束：
- `ForumSection_code_key`：`UNIQUE (code)`
- `ForumSection_pkey`：`PRIMARY KEY (id)`
- `ForumSection_version_check`：`CHECK (version > 0)`
- `domain_ForumSection_0`：`CHECK (scope = ANY (ARRAY['PUBLIC'::text, 'COURSE'::text]))`
- `domain_ForumSection_1`：`CHECK ((scope = 'COURSE'::text) = ("courseId" IS NOT NULL))`
- `domain_ForumSection_cohortId_fk`：`FOREIGN KEY ("cohortId") REFERENCES "CourseCohort"(id)`
- `domain_ForumSection_courseId_fk`：`FOREIGN KEY ("courseId") REFERENCES "Course"(id)`

索引：

### ForumThread / forum_thread

帖子资源子类型，图文音视频块和引用

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|resourceKind|text|是|'THREAD'::text||
|sectionId|text|是|—|forum_section.id；通用可写|
|authorId|text|是|—|app_user.id；通用可写|
|blocks|jsonb|是|—|通用可写|
|citationReleaseId|text|否|—|article_release.id；通用可写|
|essence|boolean|是|false|通用可写|
|pinnedUntil|timestamp with time zone|否|—|通用可写|
|pinScope|text|否|—|通用可写|
|benefitUsageId|text|否|—|benefit_usage.id；通用可写|
|deletedAt|timestamp with time zone|否|—||

约束：
- `ForumThread_pkey`：`PRIMARY KEY (id)`
- `ForumThread_resourceKind_check`：`CHECK ("resourceKind" = 'THREAD'::text)`
- `ForumThread_version_check`：`CHECK (version > 0)`
- `domain_ForumThread_0`：`FOREIGN KEY (id, "resourceKind") REFERENCES "Resource"(id, kind)`
- `domain_ForumThread_authorId_fk`：`FOREIGN KEY ("authorId") REFERENCES "User"(id)`
- `domain_ForumThread_benefitUsageId_fk`：`FOREIGN KEY ("benefitUsageId") REFERENCES "BenefitUsage"(id)`
- `domain_ForumThread_citationReleaseId_fk`：`FOREIGN KEY ("citationReleaseId") REFERENCES "ArticleRelease"(id)`
- `domain_ForumThread_sectionId_fk`：`FOREIGN KEY ("sectionId") REFERENCES "ForumSection"(id)`

索引：
- `CREATE INDEX "domain_ForumThread_idx_0" ON public."ForumThread" USING btree ("sectionId", "createdAt", id)`
- `CREATE INDEX forum_section_recent ON public."ForumThread" USING btree ("sectionId", "createdAt" DESC, id DESC) WHERE ("deletedAt" IS NULL)`

### GiftCreditAllocation / gift_credit_allocation

礼物消费按购买来源分摊，付费余额池消费与老师收入可对账

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|debitLedgerId|text|是|—|gift_ledger.id；通用可写|
|creditLedgerId|text|是|—|gift_ledger.id；通用可写|
|credits|bigint|是|—|通用可写|
|allocatedPaidMinor|bigint|是|—|通用可写|
|allocatedFeeMinor|bigint|是|—|通用可写|
|currency|character(3)|是|—|通用可写|
|contractId|text|否|—|partner_contract.id；通用可写|
|reversalOfId|text|否|—|gift_credit_allocation.id；通用可写|

约束：
- `GiftCreditAllocation_pkey`：`PRIMARY KEY (id)`
- `GiftCreditAllocation_reversalOfId_key`：`UNIQUE ("reversalOfId")`
- `domain_GiftCreditAllocation_0`：`UNIQUE ("debitLedgerId", "creditLedgerId")`
- `domain_GiftCreditAllocation_1`：`CHECK (credits > 0 AND "allocatedPaidMinor" >= 0 AND "allocatedFeeMinor" >= 0)`
- `domain_GiftCreditAllocation_contractId_fk`：`FOREIGN KEY ("contractId") REFERENCES "PartnerContract"(id)`
- `domain_GiftCreditAllocation_creditLedgerId_fk`：`FOREIGN KEY ("creditLedgerId") REFERENCES "GiftLedger"(id)`
- `domain_GiftCreditAllocation_debitLedgerId_fk`：`FOREIGN KEY ("debitLedgerId") REFERENCES "GiftLedger"(id)`
- `domain_GiftCreditAllocation_reversalOfId_fk`：`FOREIGN KEY ("reversalOfId") REFERENCES "GiftCreditAllocation"(id)`

索引：
- `CREATE INDEX "domain_GiftCreditAllocation_idx_0" ON public."GiftCreditAllocation" USING btree ("creditLedgerId")`

### GiftLedger / gift_ledger

礼物充值消费退款不可变流水

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|walletId|text|是|—|gift_wallet.id；通用可写|
|eventKey|text|是|—|通用可写|
|delta|bigint|是|—|通用可写|
|kind|text|是|—|通用可写|
|orderItemId|text|否|—|order_item.id；通用可写|
|sessionId|text|否|—|live_session.id；通用可写|
|giftId|text|否|—|virtual_gift.id；通用可写|
|quantity|integer|否|—|通用可写|
|reversalOfId|text|否|—|gift_ledger.id；通用可写|
|balanceAfter|bigint|是|—|通用可写|
|paymentTransactionId|text|否|—|payment_transaction.id；通用可写|
|refundTransactionId|text|否|—|refund_transaction.id；通用可写|

约束：
- `GiftLedger_eventKey_key`：`UNIQUE ("eventKey")`
- `GiftLedger_pkey`：`PRIMARY KEY (id)`
- `GiftLedger_reversalOfId_key`：`UNIQUE ("reversalOfId")`
- `domain_GiftLedger_0`：`CHECK (delta <> 0 AND "balanceAfter" >= 0)`
- `domain_GiftLedger_1`：`CHECK (quantity IS NULL OR quantity > 0)`
- `domain_GiftLedger_giftId_fk`：`FOREIGN KEY ("giftId") REFERENCES "VirtualGift"(id)`
- `domain_GiftLedger_orderItemId_fk`：`FOREIGN KEY ("orderItemId") REFERENCES "TradeOrderItem"(id)`
- `domain_GiftLedger_paymentTransactionId_fk`：`FOREIGN KEY ("paymentTransactionId") REFERENCES "PaymentTransaction"(id)`
- `domain_GiftLedger_refundTransactionId_fk`：`FOREIGN KEY ("refundTransactionId") REFERENCES "RefundTransaction"(id)`
- `domain_GiftLedger_reversalOfId_fk`：`FOREIGN KEY ("reversalOfId") REFERENCES "GiftLedger"(id)`
- `domain_GiftLedger_sessionId_fk`：`FOREIGN KEY ("sessionId") REFERENCES "LiveSession"(id)`
- `domain_GiftLedger_walletId_fk`：`FOREIGN KEY ("walletId") REFERENCES "GiftWallet"(id)`

索引：
- `CREATE INDEX "domain_GiftLedger_idx_0" ON public."GiftLedger" USING btree ("walletId", "createdAt")`

### GiftWallet / gift_wallet

购买余额独立于免费积分，不设自动过期

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|userId|text|是|—|app_user.id；通用可写|
|balance|bigint|是|0||

约束：
- `GiftWallet_pkey`：`PRIMARY KEY (id)`
- `GiftWallet_userId_key`：`UNIQUE ("userId")`
- `GiftWallet_version_check`：`CHECK (version > 0)`
- `domain_GiftWallet_0`：`CHECK (balance >= 0)`
- `domain_GiftWallet_userId_fk`：`FOREIGN KEY ("userId") REFERENCES "User"(id)`

索引：

### GroupBuy / group_buy

课程拼团规则/团价售卖映射，团成才发课权

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|offerId|text|是|—|sale_offer.id；通用可写|
|leaderId|text|是|—|app_user.id；通用可写|
|requiredMembers|integer|是|—|通用可写|
|expiresAt|timestamp with time zone|是|—|通用可写|
|state|text|是|—|通用可写|
|ruleSnapshot|jsonb|是|—|通用可写|
|completedAt|timestamp with time zone|否|—|通用可写|

约束：
- `GroupBuy_pkey`：`PRIMARY KEY (id)`
- `GroupBuy_version_check`：`CHECK (version > 0)`
- `domain_GroupBuy_0`：`CHECK ("requiredMembers" >= 2)`
- `domain_GroupBuy_leaderId_fk`：`FOREIGN KEY ("leaderId") REFERENCES "User"(id)`
- `domain_GroupBuy_offerId_fk`：`FOREIGN KEY ("offerId") REFERENCES "SaleOffer"(id)`

索引：
- `CREATE INDEX "domain_GroupBuy_idx_0" ON public."GroupBuy" USING btree (state, "expiresAt")`

### GroupBuyMember / group_buy_member

拼团支付成员去重；失败逐单退款

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|groupId|text|是|—|group_buy.id；通用可写|
|userId|text|是|—|app_user.id；通用可写|
|orderItemId|text|是|—|order_item.id；通用可写|
|state|text|是|—|通用可写|
|joinedAt|timestamp with time zone|是|—|通用可写|

约束：
- `GroupBuyMember_orderItemId_key`：`UNIQUE ("orderItemId")`
- `GroupBuyMember_pkey`：`PRIMARY KEY (id)`
- `GroupBuyMember_version_check`：`CHECK (version > 0)`
- `domain_GroupBuyMember_0`：`UNIQUE ("groupId", "userId")`
- `domain_GroupBuyMember_groupId_fk`：`FOREIGN KEY ("groupId") REFERENCES "GroupBuy"(id)`
- `domain_GroupBuyMember_orderItemId_fk`：`FOREIGN KEY ("orderItemId") REFERENCES "TradeOrderItem"(id)`
- `domain_GroupBuyMember_userId_fk`：`FOREIGN KEY ("userId") REFERENCES "User"(id)`

索引：

### GrowthLedger / growth_ledger

成长值不可变事实，不隐式升级付费会员

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|userId|text|是|—|app_user.id；通用可写|
|delta|integer|是|—|通用可写|
|businessDay|date|是|—|通用可写|
|eventKey|text|是|—|通用可写|
|reason|text|是|—|通用可写|
|sourceResourceId|text|否|—|resource.id；通用可写|
|ruleSnapshot|jsonb|是|—|通用可写|
|reversalOfId|text|否|—|growth_ledger.id；通用可写|

约束：
- `GrowthLedger_eventKey_key`：`UNIQUE ("eventKey")`
- `GrowthLedger_pkey`：`PRIMARY KEY (id)`
- `GrowthLedger_reversalOfId_key`：`UNIQUE ("reversalOfId")`
- `domain_GrowthLedger_0`：`CHECK (delta <> 0)`
- `domain_GrowthLedger_reversalOfId_fk`：`FOREIGN KEY ("reversalOfId") REFERENCES "GrowthLedger"(id)`
- `domain_GrowthLedger_sourceResourceId_fk`：`FOREIGN KEY ("sourceResourceId") REFERENCES "Resource"(id)`
- `domain_GrowthLedger_userId_fk`：`FOREIGN KEY ("userId") REFERENCES "User"(id)`

索引：
- `CREATE INDEX "domain_GrowthLedger_idx_0" ON public."GrowthLedger" USING btree ("userId", "businessDay")`

### IdempotencyRecord / idempotency_record

跨创建退款兑换报名操作幂等缓存，业务唯一约束仍兜底

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|userId|text|是|—|app_user.id；通用可写|
|operation|text|是|—|通用可写|
|requestKey|text|是|—|通用可写|
|payloadHash|text|是|—|查询隐藏|
|state|text|是|—|通用可写|
|responseCode|integer|否|—|通用可写|
|response|jsonb|否|—|查询隐藏|
|expiresAt|timestamp with time zone|是|—|通用可写|

约束：
- `IdempotencyRecord_pkey`：`PRIMARY KEY (id)`
- `IdempotencyRecord_version_check`：`CHECK (version > 0)`
- `domain_IdempotencyRecord_0`：`UNIQUE ("userId", operation, "requestKey")`
- `domain_IdempotencyRecord_userId_fk`：`FOREIGN KEY ("userId") REFERENCES "User"(id)`

索引：
- `CREATE INDEX "domain_IdempotencyRecord_idx_0" ON public."IdempotencyRecord" USING btree ("expiresAt")`

### InventoryLedger / inventory_ledger

实物库存入库预占释放销售退款回库可追溯

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|skuId|text|是|—|product_sku.id；通用可写|
|reservationId|text|否|—|inventory_reservation.id；通用可写|
|orderItemId|text|否|—|order_item.id；通用可写|
|stockDelta|bigint|是|—|通用可写|
|reservedDelta|bigint|是|—|通用可写|
|reason|text|是|—|通用可写|
|eventKey|text|是|—|通用可写|
|actorId|text|否|—|app_user.id|
|stockAfter|bigint|是|—|通用可写|
|reservedAfter|bigint|是|—|通用可写|

约束：
- `InventoryLedger_eventKey_key`：`UNIQUE ("eventKey")`
- `InventoryLedger_pkey`：`PRIMARY KEY (id)`
- `domain_InventoryLedger_0`：`CHECK ("stockAfter" >= "reservedAfter" AND "reservedAfter" >= 0)`
- `domain_InventoryLedger_actorId_fk`：`FOREIGN KEY ("actorId") REFERENCES "User"(id)`
- `domain_InventoryLedger_orderItemId_fk`：`FOREIGN KEY ("orderItemId") REFERENCES "TradeOrderItem"(id)`
- `domain_InventoryLedger_reservationId_fk`：`FOREIGN KEY ("reservationId") REFERENCES "InventoryReservation"(id)`
- `domain_InventoryLedger_skuId_fk`：`FOREIGN KEY ("skuId") REFERENCES "ProductSku"(id)`

索引：
- `CREATE INDEX "domain_InventoryLedger_idx_0" ON public."InventoryLedger" USING btree ("skuId", "createdAt")`

### InventoryReservation / inventory_reservation

商品/时段/席位/营期预占的明细，超时任务按事实释放

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|orderItemId|text|是|—|order_item.id；通用可写|
|skuId|text|否|—|product_sku.id；通用可写|
|slotId|text|否|—|appointment_slot.id；通用可写|
|eventTicketId|text|否|—|event_ticket_type.id；通用可写|
|cohortId|text|否|—|course_cohort.id；通用可写|
|quantity|integer|是|—|通用可写|
|state|text|是|'HELD'::text|通用可写|
|expiresAt|timestamp with time zone|是|—|通用可写|
|convertedAt|timestamp with time zone|否|—|通用可写|
|releasedAt|timestamp with time zone|否|—|通用可写|
|requestKey|text|是|—|通用可写|
|promotionOfferId|text|否|—|promotion_offer.id；通用可写|

约束：
- `InventoryReservation_pkey`：`PRIMARY KEY (id)`
- `InventoryReservation_requestKey_key`：`UNIQUE ("requestKey")`
- `InventoryReservation_version_check`：`CHECK (version > 0)`
- `domain_InventoryReservation_0`：`CHECK (num_nonnulls("skuId", "slotId", "eventTicketId", "cohortId") = 1)`
- `domain_InventoryReservation_1`：`CHECK (quantity > 0)`
- `domain_InventoryReservation_2`：`CHECK (state = ANY (ARRAY['HELD'::text, 'CONVERTED'::text, 'RELEASED'::text]))`
- `domain_InventoryReservation_cohortId_fk`：`FOREIGN KEY ("cohortId") REFERENCES "CourseCohort"(id)`
- `domain_InventoryReservation_eventTicketId_fk`：`FOREIGN KEY ("eventTicketId") REFERENCES "EventTicketType"(id)`
- `domain_InventoryReservation_orderItemId_fk`：`FOREIGN KEY ("orderItemId") REFERENCES "TradeOrderItem"(id)`
- `domain_InventoryReservation_promotionOfferId_fk`：`FOREIGN KEY ("promotionOfferId") REFERENCES "PromotionOffer"(id)`
- `domain_InventoryReservation_skuId_fk`：`FOREIGN KEY ("skuId") REFERENCES "ProductSku"(id)`
- `domain_InventoryReservation_slotId_fk`：`FOREIGN KEY ("slotId") REFERENCES "AppointmentSlot"(id)`

索引：
- `CREATE INDEX "domain_InventoryReservation_idx_0" ON public."InventoryReservation" USING btree (state, "expiresAt")`
- `CREATE INDEX "domain_InventoryReservation_idx_1" ON public."InventoryReservation" USING btree ("orderItemId")`

### Lesson / lesson

发布章节快照，支持音视频文字直播线下

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|—||
|releaseId|text|是|—|course_release.id；通用可写|
|sourceId|text|是|—|通用可写|
|title|text|是|—|通用可写|
|position|integer|是|—|通用可写|
|format|"LessonFormat"|是|—|通用可写|
|body|text|是|—|通用可写|
|mediaId|text|否|—|media_asset.id；通用可写|
|durationSeconds|integer|是|—|通用可写|
|trial|boolean|是|—|通用可写|
|required|boolean|是|—|通用可写|
|createdAt|timestamp with time zone|是|now()||
|liveSessionId|text|否|—|live_session.id；通用可写|
|eventSessionId|text|否|—|event_session.id；通用可写|

约束：
- `Lesson_pkey`：`PRIMARY KEY (id)`
- `domain_Lesson_0`：`UNIQUE ("releaseId", "position")`
- `domain_Lesson_1`：`UNIQUE ("releaseId", "sourceId")`
- `domain_Lesson_2`：`CHECK (format = ANY (ARRAY['TEXT'::"LessonFormat", 'AUDIO'::"LessonFormat", 'VIDEO'::"LessonFormat", 'LIVE'::"LessonFormat", 'OFFLINE'::"LessonFormat"]))`
- `domain_Lesson_3`：`CHECK ("durationSeconds" >= 0)`
- `Lesson_releaseId_fkey`：`FOREIGN KEY ("releaseId") REFERENCES "CourseRelease"(id) ON UPDATE CASCADE ON DELETE CASCADE`
- `domain_Lesson_eventSessionId_fk`：`FOREIGN KEY ("eventSessionId") REFERENCES "EventSession"(id)`
- `domain_Lesson_liveSessionId_fk`：`FOREIGN KEY ("liveSessionId") REFERENCES "LiveSession"(id)`
- `domain_Lesson_mediaId_fk`：`FOREIGN KEY ("mediaId") REFERENCES "MediaAsset"(id)`
- `domain_Lesson_releaseId_fk`：`FOREIGN KEY ("releaseId") REFERENCES "CourseRelease"(id)`

索引：
- `CREATE UNIQUE INDEX "Lesson_releaseId_position_key" ON public."Lesson" USING btree ("releaseId", "position")`

### LiveMicRequest / live_mic_request

连麦申请批准与结束，RTC凭证临时生成

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|sessionId|text|是|—|live_session.id；通用可写|
|userId|text|是|—|app_user.id；通用可写|
|priority|integer|是|0|通用可写|
|state|text|是|—|通用可写|
|approvedBy|text|否|—|app_user.id|
|rtcSessionId|text|否|—|通用可写|
|startedAt|timestamp with time zone|否|—|通用可写|
|endedAt|timestamp with time zone|否|—|通用可写|

约束：
- `LiveMicRequest_pkey`：`PRIMARY KEY (id)`
- `LiveMicRequest_version_check`：`CHECK (version > 0)`
- `domain_LiveMicRequest_0`：`CHECK (state = ANY (ARRAY['WAITING'::text, 'APPROVED'::text, 'REJECTED'::text, 'CONNECTED'::text, 'ENDED'::text, 'CANCELLED'::text]))`
- `domain_LiveMicRequest_approvedBy_fk`：`FOREIGN KEY ("approvedBy") REFERENCES "User"(id)`
- `domain_LiveMicRequest_sessionId_fk`：`FOREIGN KEY ("sessionId") REFERENCES "LiveSession"(id)`
- `domain_LiveMicRequest_userId_fk`：`FOREIGN KEY ("userId") REFERENCES "User"(id)`

索引：
- `CREATE INDEX "domain_LiveMicRequest_idx_0" ON public."LiveMicRequest" USING btree ("sessionId", state, priority, "createdAt")`

### LivePoll / live_poll

直播投票问卷

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|sessionId|text|是|—|live_session.id；通用可写|
|question|text|是|—|通用可写|
|allowMultiple|boolean|是|false|通用可写|
|closesAt|timestamp with time zone|是|—|通用可写|
|resultVisibility|text|是|—|通用可写|
|state|text|是|—|通用可写|

约束：
- `LivePoll_pkey`：`PRIMARY KEY (id)`
- `LivePoll_version_check`：`CHECK (version > 0)`
- `domain_LivePoll_sessionId_fk`：`FOREIGN KEY ("sessionId") REFERENCES "LiveSession"(id)`

索引：

### LiveReplay / live_replay

审核回放，固定准入规则和关联课

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|sessionId|text|是|—|live_session.id；通用可写|
|assetId|text|是|—|media_asset.id；通用可写|
|reviewState|text|是|—|通用可写|
|accessRuleSnapshot|jsonb|是|—|通用可写|
|publishedAt|timestamp with time zone|否|—||
|reviewerId|text|否|—|app_user.id|

约束：
- `LiveReplay_pkey`：`PRIMARY KEY (id)`
- `LiveReplay_sessionId_key`：`UNIQUE ("sessionId")`
- `LiveReplay_version_check`：`CHECK (version > 0)`
- `domain_LiveReplay_assetId_fk`：`FOREIGN KEY ("assetId") REFERENCES "MediaAsset"(id)`
- `domain_LiveReplay_reviewerId_fk`：`FOREIGN KEY ("reviewerId") REFERENCES "User"(id)`
- `domain_LiveReplay_sessionId_fk`：`FOREIGN KEY ("sessionId") REFERENCES "LiveSession"(id)`

索引：

### LiveReservation / live_reservation

预约开播提醒

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|sessionId|text|是|—|live_session.id；通用可写|
|userId|text|是|—|app_user.id；通用可写|
|cancelledAt|timestamp with time zone|否|—|通用可写|
|reminderSentAt|timestamp with time zone|否|—||

约束：
- `LiveReservation_pkey`：`PRIMARY KEY (id)`
- `LiveReservation_version_check`：`CHECK (version > 0)`
- `domain_LiveReservation_0`：`UNIQUE ("sessionId", "userId")`
- `domain_LiveReservation_sessionId_fk`：`FOREIGN KEY ("sessionId") REFERENCES "LiveSession"(id)`
- `domain_LiveReservation_userId_fk`：`FOREIGN KEY ("userId") REFERENCES "User"(id)`

索引：
- `CREATE INDEX "domain_LiveReservation_idx_0" ON public."LiveReservation" USING btree ("sessionId", "cancelledAt")`

### LiveRoom / live_room

长期房间定义，不存裸推流密钥

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|resourceKind|text|是|'LIVE'::text||
|teacherId|text|是|—|teacher.id；通用可写|
|provider|text|是|—|通用可写|
|providerRoomId|text|是|—|通用可写|
|categoryCode|text|是|—|通用可写|
|accessRule|jsonb|是|—|通用可写|
|courseId|text|否|—|course.id；通用可写|

约束：
- `LiveRoom_pkey`：`PRIMARY KEY (id)`
- `LiveRoom_resourceKind_check`：`CHECK ("resourceKind" = 'LIVE'::text)`
- `LiveRoom_version_check`：`CHECK (version > 0)`
- `domain_LiveRoom_0`：`UNIQUE (provider, "providerRoomId")`
- `domain_LiveRoom_1`：`FOREIGN KEY (id, "resourceKind") REFERENCES "Resource"(id, kind)`
- `domain_LiveRoom_courseId_fk`：`FOREIGN KEY ("courseId") REFERENCES "Course"(id)`
- `domain_LiveRoom_teacherId_fk`：`FOREIGN KEY ("teacherId") REFERENCES "Teacher"(id)`

索引：

### LiveSession / live_session

单场直播生命周期及媒体服务状态

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|roomId|text|是|—|live_room.id；通用可写|
|hostUserId|text|是|—|app_user.id；通用可写|
|title|text|是|—|通用可写|
|scheduledAt|timestamp with time zone|是|—|通用可写|
|startedAt|timestamp with time zone|否|—|通用可写|
|endedAt|timestamp with time zone|否|—|通用可写|
|state|text|是|'SCHEDULED'::text|通用可写|
|providerSessionId|text|否|—|通用可写|
|eventSessionId|text|否|—|event_session.id；通用可写|
|accessRuleSnapshot|jsonb|是|—|通用可写|
|pushSecretRef|text|否|—|查询隐藏|

约束：
- `LiveSession_pkey`：`PRIMARY KEY (id)`
- `LiveSession_version_check`：`CHECK (version > 0)`
- `domain_LiveSession_0`：`UNIQUE ("roomId", "scheduledAt")`
- `domain_LiveSession_1`：`CHECK (state = ANY (ARRAY['SCHEDULED'::text, 'PREPARING'::text, 'LIVE'::text, 'ENDED'::text, 'REPLAY_READY'::text, 'CANCELLED'::text]))`
- `domain_LiveSession_2`：`CHECK ("endedAt" IS NULL OR "startedAt" IS NULL OR "endedAt" >= "startedAt")`
- `domain_LiveSession_eventSessionId_fk`：`FOREIGN KEY ("eventSessionId") REFERENCES "EventSession"(id)`
- `domain_LiveSession_hostUserId_fk`：`FOREIGN KEY ("hostUserId") REFERENCES "User"(id)`
- `domain_LiveSession_roomId_fk`：`FOREIGN KEY ("roomId") REFERENCES "LiveRoom"(id)`

索引：
- `CREATE INDEX "domain_LiveSession_idx_0" ON public."LiveSession" USING btree (state, "scheduledAt")`

### MediaAsset / media_asset

对象存储元数据、转码和审核；长期URL不出现在用户响应

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|—||
|storageKey|text|是|—|查询隐藏|
|name|text|是|—|通用可写|
|mime|text|是|—|通用可写|
|bytes|integer|是|—|通用可写|
|uploaderId|text|是|—|app_user.id；通用可写|
|createdAt|timestamp(3) without time zone|是|CURRENT_TIMESTAMP||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|sha256|text|是|''::text|通用可写|
|status|text|是|''::text|通用可写|
|visibility|text|是|''::text|通用可写|
|durationSeconds|integer|否|—|通用可写|
|providerAssetId|text|否|—|查询隐藏|
|variants|jsonb|是|'{}'::jsonb|查询隐藏|
|failureCode|text|否|—|通用可写|

约束：
- `MediaAsset_pkey`：`PRIMARY KEY (id)`
- `MediaAsset_version_check`：`CHECK (version > 0)`
- `domain_MediaAsset_0`：`CHECK (bytes >= 0)`
- `domain_MediaAsset_1`：`CHECK ("durationSeconds" IS NULL OR "durationSeconds" >= 0)`
- `domain_MediaAsset_2`：`CHECK (status = ANY (ARRAY['UPLOADING'::text, 'PROCESSING'::text, 'REVIEW'::text, 'READY'::text, 'REJECTED'::text, 'DELETED'::text]))`
- `domain_MediaAsset_uploaderId_fk`：`FOREIGN KEY ("uploaderId") REFERENCES "User"(id)`

索引：
- `CREATE UNIQUE INDEX "MediaAsset_storageKey_key" ON public."MediaAsset" USING btree ("storageKey")`
- `CREATE INDEX "domain_MediaAsset_idx_0" ON public."MediaAsset" USING btree ("uploaderId", "createdAt")`
- `CREATE INDEX "domain_MediaAsset_idx_1" ON public."MediaAsset" USING btree (status, "createdAt")`

### Membership / membership_period

按购买/补偿来源排队的生效区间，时段不可重叠

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|—||
|userId|text|是|—|app_user.id；通用可写|
|planId|text|是|—|membership_plan.id；通用可写|
|tier|integer|是|—|通用可写|
|startsAt|timestamp(3) without time zone|是|—|通用可写|
|endsAt|timestamp(3) without time zone|是|—|通用可写|
|source|text|是|—|通用可写|
|revokedAt|timestamp(3) without time zone|否|—|通用可写|
|createdAt|timestamp(3) without time zone|是|CURRENT_TIMESTAMP||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|planVersionId|text|否|—|membership_plan_version.id；通用可写|
|orderItemId|text|否|—|order_item.id；通用可写|
|grantKey|text|是|(gen_random_uuid())::text|通用可写|
|actorId|text|否|—|app_user.id|
|reason|text|否|—|通用可写|

约束：
- `Membership_grantKey_key`：`UNIQUE ("grantKey")`
- `Membership_orderItemId_key`：`UNIQUE ("orderItemId")`
- `Membership_pkey`：`PRIMARY KEY (id)`
- `Membership_version_check`：`CHECK (version > 0)`
- `domain_Membership_0`：`CHECK (tier >= 1 AND tier <= 3 AND "endsAt" > "startsAt")`
- `domain_member_no_overlap`：`EXCLUDE USING gist ("userId" WITH =, tstzrange(("startsAt" AT TIME ZONE 'UTC'::text), ("endsAt" AT TIME ZONE 'UTC'::text), '[)'::text) WITH &&) WHERE ("revokedAt" IS NULL)`
- `Membership_planId_fkey`：`FOREIGN KEY ("planId") REFERENCES "MembershipPlan"(id) ON UPDATE CASCADE ON DELETE RESTRICT`
- `Membership_userId_fkey`：`FOREIGN KEY ("userId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE CASCADE`
- `domain_Membership_actorId_fk`：`FOREIGN KEY ("actorId") REFERENCES "User"(id)`
- `domain_Membership_orderItemId_fk`：`FOREIGN KEY ("orderItemId") REFERENCES "TradeOrderItem"(id)`
- `domain_Membership_planVersionId_fk`：`FOREIGN KEY ("planVersionId") REFERENCES "MembershipPlanVersion"(id)`
- `domain_Membership_userId_fk`：`FOREIGN KEY ("userId") REFERENCES "User"(id)`

索引：
- `CREATE INDEX "Membership_userId_startsAt_endsAt_idx" ON public."Membership" USING btree ("userId", "startsAt", "endsAt")`
- `CREATE INDEX "domain_Membership_idx_0" ON public."Membership" USING btree ("userId", "startsAt", "endsAt")`

### MembershipPlan / membership_plan

套餐身份；三级与有效天数，价格权益放不变版本

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|—||
|title|text|是|—|通用可写|
|tier|integer|是|—|通用可写|
|days|integer|是|—|通用可写|
|price|integer|是|—|通用可写|
|description|text|是|—|通用可写|
|active|boolean|是|false|通用可写|
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|code|text|是|(gen_random_uuid())::text|通用可写|
|currentVersionId|text|否|—|membership_plan_version.id|

约束：
- `MembershipPlan_code_key`：`UNIQUE (code)`
- `MembershipPlan_pkey`：`PRIMARY KEY (id)`
- `MembershipPlan_version_check`：`CHECK (version > 0)`
- `domain_MembershipPlan_0`：`UNIQUE (tier, days)`
- `domain_MembershipPlan_1`：`CHECK (tier >= 1 AND tier <= 3 AND (days = ANY (ARRAY[30, 90, 365])))`
- `domain_MembershipPlan_currentVersionId_fk`：`FOREIGN KEY ("currentVersionId") REFERENCES "MembershipPlanVersion"(id)`

索引：
- `CREATE UNIQUE INDEX "MembershipPlan_tier_days_key" ON public."MembershipPlan" USING btree (tier, days)`

### MembershipPlanVersion / membership_plan_version

不可变权益与条款版本，成交固定

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|planId|text|是|—|membership_plan.id；通用可写|
|releaseNo|integer|是|—|通用可写|
|tier|integer|是|—|通用可写|
|days|integer|是|—|通用可写|
|description|text|是|—|通用可写|
|termsSnapshot|jsonb|是|—|通用可写|
|publishedAt|timestamp with time zone|是|—||

约束：
- `MembershipPlanVersion_pkey`：`PRIMARY KEY (id)`
- `domain_MembershipPlanVersion_0`：`UNIQUE ("planId", "releaseNo")`
- `domain_MembershipPlanVersion_1`：`CHECK (tier >= 1 AND tier <= 3 AND days > 0)`
- `domain_MembershipPlanVersion_planId_fk`：`FOREIGN KEY ("planId") REFERENCES "MembershipPlan"(id)`

索引：

### ModerationAction / moderation_action

审核处置和申诉，保存前后状态可恢复

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|actorId|text|是|—|app_user.id|
|reportId|text|否|—|report.id；通用可写|
|resourceId|text|否|—|resource.id；通用可写|
|commentId|text|否|—|comment.id；通用可写|
|targetUserId|text|否|—|app_user.id；通用可写|
|action|text|是|—|通用可写|
|reason|text|是|—|通用可写|
|beforeSnapshot|jsonb|是|—|查询隐藏|
|afterSnapshot|jsonb|是|—|查询隐藏|
|appealOfId|text|否|—|moderation_action.id；通用可写|

约束：
- `ModerationAction_pkey`：`PRIMARY KEY (id)`
- `domain_ModerationAction_actorId_fk`：`FOREIGN KEY ("actorId") REFERENCES "User"(id)`
- `domain_ModerationAction_appealOfId_fk`：`FOREIGN KEY ("appealOfId") REFERENCES "ModerationAction"(id)`
- `domain_ModerationAction_commentId_fk`：`FOREIGN KEY ("commentId") REFERENCES "Comment"(id)`
- `domain_ModerationAction_reportId_fk`：`FOREIGN KEY ("reportId") REFERENCES "Report"(id)`
- `domain_ModerationAction_resourceId_fk`：`FOREIGN KEY ("resourceId") REFERENCES "Resource"(id)`
- `domain_ModerationAction_targetUserId_fk`：`FOREIGN KEY ("targetUserId") REFERENCES "User"(id)`

索引：
- `CREATE INDEX "domain_ModerationAction_idx_0" ON public."ModerationAction" USING btree ("resourceId", "createdAt")`
- `CREATE INDEX "domain_ModerationAction_idx_1" ON public."ModerationAction" USING btree ("targetUserId", "createdAt")`

### Note / private_note

私人摘录；删除资源后原文引用仍保留

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|—||
|userId|text|是|—|app_user.id；通用可写|
|articleId|text|是|—|article.id；通用可写|
|articleTitle|text|是|—|通用可写|
|blockId|text|是|—|通用可写|
|quote|text|是|—|通用可写|
|text|text|是|—|通用可写|
|createdAt|timestamp(3) without time zone|是|CURRENT_TIMESTAMP||
|updatedAt|timestamp(3) without time zone|是|—||
|articleVersion|integer|是|—|通用可写|
|version|integer|是|1||
|releaseId|text|否|—|article_release.id；通用可写|
|rangeStart|integer|否|—|通用可写|
|rangeEnd|integer|否|—|通用可写|
|deletedAt|timestamp with time zone|否|—||
|ranges|jsonb|否|—||

约束：
- `Note_pkey`：`PRIMARY KEY (id)`
- `Note_version_check`：`CHECK (version > 0)`
- `domain_Note_0`：`CHECK ("rangeStart" IS NULL AND "rangeEnd" IS NULL OR "rangeStart" >= 0 AND "rangeEnd" > "rangeStart")`
- `Note_userId_fkey`：`FOREIGN KEY ("userId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE RESTRICT`
- `domain_Note_articleId_fk`：`FOREIGN KEY ("articleId") REFERENCES "Article"(id)`
- `domain_Note_releaseId_fk`：`FOREIGN KEY ("releaseId") REFERENCES "ArticleRelease"(id)`
- `domain_Note_userId_fk`：`FOREIGN KEY ("userId") REFERENCES "User"(id)`

索引：
- `CREATE INDEX "Note_userId_updatedAt_idx" ON public."Note" USING btree ("userId", "updatedAt")`
- `CREATE INDEX "domain_Note_idx_0" ON public."Note" USING btree ("userId", "updatedAt", id)`

### NoteExport / note_export

本人笔记导出任务，按筛选及权限生成短期文件

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|userId|text|是|—|app_user.id；通用可写|
|requestKey|text|是|—|通用可写|
|filterSnapshot|jsonb|是|—|通用可写|
|format|text|是|—|通用可写|
|state|text|是|—|通用可写|
|assetId|text|否|—|media_asset.id；通用可写|
|expiresAt|timestamp with time zone|否|—|通用可写|
|errorCode|text|否|—|通用可写|

约束：
- `NoteExport_pkey`：`PRIMARY KEY (id)`
- `NoteExport_version_check`：`CHECK (version > 0)`
- `domain_NoteExport_0`：`UNIQUE ("userId", "requestKey")`
- `domain_NoteExport_assetId_fk`：`FOREIGN KEY ("assetId") REFERENCES "MediaAsset"(id)`
- `domain_NoteExport_userId_fk`：`FOREIGN KEY ("userId") REFERENCES "User"(id)`

索引：
- `CREATE INDEX "domain_NoteExport_idx_0" ON public."NoteExport" USING btree (state, "createdAt")`

### Notification / notification

站内消息，业务事实提交后投递

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|userId|text|是|—|app_user.id；通用可写|
|eventKey|text|是|—|通用可写|
|kind|text|是|—|通用可写|
|title|text|是|—|通用可写|
|body|text|是|—|通用可写|
|resourceId|text|否|—|resource.id；通用可写|
|orderId|text|否|—|trade_order.id；通用可写|
|appointmentId|text|否|—|appointment.id；通用可写|
|registrationId|text|否|—|event_registration.id；通用可写|
|readAt|timestamp with time zone|否|—|通用可写|
|expiresAt|timestamp with time zone|否|—|通用可写|

约束：
- `Notification_pkey`：`PRIMARY KEY (id)`
- `Notification_version_check`：`CHECK (version > 0)`
- `domain_Notification_0`：`UNIQUE ("userId", "eventKey")`
- `domain_Notification_appointmentId_fk`：`FOREIGN KEY ("appointmentId") REFERENCES "Appointment"(id)`
- `domain_Notification_orderId_fk`：`FOREIGN KEY ("orderId") REFERENCES "TradeOrder"(id)`
- `domain_Notification_registrationId_fk`：`FOREIGN KEY ("registrationId") REFERENCES "EventRegistration"(id)`
- `domain_Notification_resourceId_fk`：`FOREIGN KEY ("resourceId") REFERENCES "Resource"(id)`
- `domain_Notification_userId_fk`：`FOREIGN KEY ("userId") REFERENCES "User"(id)`

索引：
- `CREATE INDEX "domain_Notification_idx_0" ON public."Notification" USING btree ("userId", "createdAt", id)`

### NotificationDelivery / notification_delivery

推送重试不重复创建站内消息

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|notificationId|text|是|—|notification.id；通用可写|
|deviceTokenId|text|否|—|device_token.id；查询隐藏|
|channel|text|是|—|通用可写|
|deliveryKey|text|是|—|通用可写|
|state|text|是|—|通用可写|
|attempts|integer|是|0|通用可写|
|nextRetryAt|timestamp with time zone|否|—|通用可写|
|providerMessageId|text|否|—|通用可写|
|failureCode|text|否|—|通用可写|

约束：
- `NotificationDelivery_deliveryKey_key`：`UNIQUE ("deliveryKey")`
- `NotificationDelivery_pkey`：`PRIMARY KEY (id)`
- `NotificationDelivery_version_check`：`CHECK (version > 0)`
- `domain_NotificationDelivery_0`：`CHECK (attempts >= 0)`
- `domain_NotificationDelivery_deviceTokenId_fk`：`FOREIGN KEY ("deviceTokenId") REFERENCES "DeviceToken"(id)`
- `domain_NotificationDelivery_notificationId_fk`：`FOREIGN KEY ("notificationId") REFERENCES "Notification"(id)`

索引：
- `CREATE INDEX "domain_NotificationDelivery_idx_0" ON public."NotificationDelivery" USING btree (state, "nextRetryAt")`

### OfflineLicense / offline_license

离线文件设备授权，不存明文永久解密密钥

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|userId|text|是|—|app_user.id；通用可写|
|deviceId|text|是|—|通用可写|
|lessonId|text|是|—|lesson.id；通用可写|
|assetId|text|是|—|media_asset.id；通用可写|
|entitlementSnapshot|jsonb|是|—|通用可写|
|licenseHash|text|是|—|查询隐藏|
|expiresAt|timestamp with time zone|是|—|通用可写|
|revokedAt|timestamp with time zone|否|—|通用可写|

约束：
- `OfflineLicense_licenseHash_key`：`UNIQUE ("licenseHash")`
- `OfflineLicense_pkey`：`PRIMARY KEY (id)`
- `OfflineLicense_version_check`：`CHECK (version > 0)`
- `domain_OfflineLicense_assetId_fk`：`FOREIGN KEY ("assetId") REFERENCES "MediaAsset"(id)`
- `domain_OfflineLicense_lessonId_fk`：`FOREIGN KEY ("lessonId") REFERENCES "Lesson"(id)`
- `domain_OfflineLicense_userId_fk`：`FOREIGN KEY ("userId") REFERENCES "User"(id)`

索引：
- `CREATE INDEX "domain_OfflineLicense_idx_0" ON public."OfflineLicense" USING btree ("userId", "deviceId", "expiresAt")`

### OperatingService / operating_service

名师推广策划服务合同报价交付，后台创建订单

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|partnerId|text|是|—|partner.id；通用可写|
|contractId|text|是|—|partner_contract.id；通用可写|
|title|text|是|—|通用可写|
|deliverySpec|jsonb|是|—|通用可写|
|dueAt|timestamp with time zone|否|—|通用可写|
|state|text|是|—|通用可写|

约束：
- `OperatingService_pkey`：`PRIMARY KEY (id)`
- `OperatingService_version_check`：`CHECK (version > 0)`
- `domain_OperatingService_contractId_fk`：`FOREIGN KEY ("contractId") REFERENCES "PartnerContract"(id)`
- `domain_OperatingService_partnerId_fk`：`FOREIGN KEY ("partnerId") REFERENCES "Partner"(id)`

索引：
- `CREATE INDEX "domain_OperatingService_idx_0" ON public."OperatingService" USING btree ("partnerId", state)`

### Order

既有专用业务兼容表

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|—||
|userId|text|是|—||
|requestId|text|是|—||
|requestHash|text|是|—||
|status|"OrderStatus"|是|'PENDING'::"OrderStatus"||
|address|jsonb|是|—||
|subtotal|integer|是|—||
|shipping|integer|是|—||
|total|integer|是|—||
|quoteId|text|是|—||
|expiresAt|timestamp(3) without time zone|是|—||
|closedAt|timestamp(3) without time zone|否|—||
|closeReason|text|否|—||
|createdAt|timestamp(3) without time zone|是|CURRENT_TIMESTAMP||

约束：
- `Order_check`：`CHECK (total = (subtotal + shipping))`
- `Order_closed_state`：`CHECK ((status = 'CLOSED'::"OrderStatus") = ("closedAt" IS NOT NULL))`
- `Order_pkey`：`PRIMARY KEY (id)`
- `Order_shipping_check`：`CHECK (shipping >= 0)`
- `Order_subtotal_check`：`CHECK (subtotal >= 0)`
- `Order_userId_fkey`：`FOREIGN KEY ("userId") REFERENCES "User"(id)`

索引：
- `CREATE INDEX "Order_status_expiresAt_idx" ON public."Order" USING btree (status, "expiresAt")`
- `CREATE INDEX "Order_userId_createdAt_idx" ON public."Order" USING btree ("userId", "createdAt")`
- `CREATE UNIQUE INDEX "Order_userId_requestId_key" ON public."Order" USING btree ("userId", "requestId")`

### OrderItem

既有专用业务兼容表

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|—||
|orderId|text|是|—||
|skuId|text|是|—||
|productId|text|是|—||
|title|text|是|—||
|skuTitle|text|是|—||
|cover|text|是|—||
|unitPrice|integer|是|—||
|quantity|integer|是|—||
|subtotal|integer|是|—||

约束：
- `OrderItem_check`：`CHECK (subtotal = ("unitPrice" * quantity))`
- `OrderItem_pkey`：`PRIMARY KEY (id)`
- `OrderItem_quantity_check`：`CHECK (quantity >= 1 AND quantity <= 99)`
- `OrderItem_unitPrice_check`：`CHECK ("unitPrice" >= 0)`
- `OrderItem_orderId_fkey`：`FOREIGN KEY ("orderId") REFERENCES "Order"(id) ON DELETE CASCADE`
- `OrderItem_skuId_fkey`：`FOREIGN KEY ("skuId") REFERENCES "ProductSku"(id)`

索引：
- `CREATE UNIQUE INDEX "OrderItem_orderId_skuId_key" ON public."OrderItem" USING btree ("orderId", "skuId")`

### OtpChallenge / otp_challenge

短信挑战，不存明文验证码

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|—||
|phone|text|是|—|查询隐藏|
|codeHash|text|是|—|查询隐藏|
|attempts|integer|是|0|通用可写|
|consumedAt|timestamp(3) without time zone|否|—|通用可写|
|expiresAt|timestamp(3) without time zone|是|—|通用可写|
|createdAt|timestamp(3) without time zone|是|CURRENT_TIMESTAMP||
|phoneHash|text|是|''::text|查询隐藏|
|purpose|text|是|''::text|通用可写|
|providerRequestId|text|否|—|通用可写|
|deliveryState|text|是|''::text|通用可写|

约束：
- `OtpChallenge_pkey`：`PRIMARY KEY (id)`
- `domain_OtpChallenge_0`：`CHECK (attempts >= 0 AND attempts <= 5)`

索引：
- `CREATE INDEX "OtpChallenge_phone_createdAt_idx" ON public."OtpChallenge" USING btree (phone, "createdAt")`
- `CREATE INDEX "domain_OtpChallenge_idx_0" ON public."OtpChallenge" USING btree ("phoneHash", purpose, "createdAt")`

### OutboxJob / outbox_job

与业务事务一同提交的持久可靠任务，worker租约重试

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|eventKey|text|是|—|通用可写|
|kind|text|是|—|通用可写|
|aggregateType|text|是|—|通用可写|
|aggregateId|text|是|—|通用可写|
|payload|jsonb|是|—|查询隐藏|
|state|text|是|'READY'::text|通用可写|
|attempts|integer|是|0|通用可写|
|availableAt|timestamp with time zone|是|—|通用可写|
|lockedUntil|timestamp with time zone|否|—|通用可写|
|workerId|text|否|—|通用可写|
|lastErrorCode|text|否|—|通用可写|
|completedAt|timestamp with time zone|否|—|通用可写|

约束：
- `OutboxJob_eventKey_key`：`UNIQUE ("eventKey")`
- `OutboxJob_pkey`：`PRIMARY KEY (id)`
- `OutboxJob_version_check`：`CHECK (version > 0)`
- `domain_OutboxJob_0`：`CHECK (attempts >= 0)`
- `domain_OutboxJob_1`：`CHECK (state = ANY (ARRAY['READY'::text, 'RUNNING'::text, 'DONE'::text, 'DEAD'::text]))`

索引：
- `CREATE INDEX "domain_OutboxJob_idx_0" ON public."OutboxJob" USING btree (state, "availableAt")`

### Partner / partner

名师机构文创品牌合作方，不等于开放商家入驻

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|code|text|是|—|通用可写|
|name|text|是|—|通用可写|
|kind|text|是|—|通用可写|
|status|text|是|—|通用可写|
|contactCipher|text|否|—|查询隐藏；通用可写|
|payeeCipher|text|否|—|查询隐藏；通用可写|
|qualificationEvidenceId|text|否|—|source_evidence.id；通用可写|
|reviewerId|text|否|—|app_user.id|
|reviewedAt|timestamp with time zone|否|—||

约束：
- `Partner_code_key`：`UNIQUE (code)`
- `Partner_pkey`：`PRIMARY KEY (id)`
- `Partner_version_check`：`CHECK (version > 0)`
- `domain_Partner_qualificationEvidenceId_fk`：`FOREIGN KEY ("qualificationEvidenceId") REFERENCES "SourceEvidence"(id)`
- `domain_Partner_reviewerId_fk`：`FOREIGN KEY ("reviewerId") REFERENCES "User"(id)`

索引：

### PartnerContract / partner_contract

不变协议版本，公益特殊费率及收款分账

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|partnerId|text|是|—|partner.id；通用可写|
|contractNo|text|是|—|通用可写|
|revision|integer|是|—|通用可写|
|startsAt|timestamp with time zone|是|—|通用可写|
|endsAt|timestamp with time zone|否|—|通用可写|
|rateBasisPoints|integer|是|—|通用可写|
|feePolicy|jsonb|是|—|通用可写|
|settlementCycle|text|是|—|通用可写|
|proofAssetId|text|是|—|media_asset.id；通用可写|
|scopeSnapshot|jsonb|是|—|通用可写|
|approvedBy|text|是|—|app_user.id|

约束：
- `PartnerContract_pkey`：`PRIMARY KEY (id)`
- `domain_PartnerContract_0`：`UNIQUE ("contractNo", revision)`
- `domain_PartnerContract_1`：`CHECK ("rateBasisPoints" >= 0 AND "rateBasisPoints" <= 10000)`
- `domain_PartnerContract_2`：`CHECK ("endsAt" IS NULL OR "endsAt" > "startsAt")`
- `domain_PartnerContract_approvedBy_fk`：`FOREIGN KEY ("approvedBy") REFERENCES "User"(id)`
- `domain_PartnerContract_partnerId_fk`：`FOREIGN KEY ("partnerId") REFERENCES "Partner"(id)`
- `domain_PartnerContract_proofAssetId_fk`：`FOREIGN KEY ("proofAssetId") REFERENCES "MediaAsset"(id)`

索引：

### PaymentAttempt / payment_attempt

一次渠道付款尝试，不把客户端返回当成功

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|orderId|text|是|—|trade_order.id；通用可写|
|channel|text|是|—|通用可写|
|mappingId|text|否|—|channel_product_mapping.id；通用可写|
|requestKey|text|是|—|通用可写|
|externalRequestId|text|否|—|通用可写|
|state|text|是|—|通用可写|
|amount|bigint|是|—|通用可写|
|currency|character(3)|是|—|通用可写|
|expiresAt|timestamp with time zone|是|—|通用可写|
|failureCode|text|否|—|通用可写|
|lastQueriedAt|timestamp with time zone|否|—|通用可写|

约束：
- `PaymentAttempt_pkey`：`PRIMARY KEY (id)`
- `PaymentAttempt_requestKey_key`：`UNIQUE ("requestKey")`
- `PaymentAttempt_version_check`：`CHECK (version > 0)`
- `domain_PaymentAttempt_0`：`CHECK (amount >= 0)`
- `domain_PaymentAttempt_1`：`CHECK (state = ANY (ARRAY['CREATED'::text, 'PENDING'::text, 'SUCCEEDED'::text, 'FAILED'::text, 'CLOSED'::text]))`
- `domain_PaymentAttempt_mappingId_fk`：`FOREIGN KEY ("mappingId") REFERENCES "ChannelProductMapping"(id)`
- `domain_PaymentAttempt_orderId_fk`：`FOREIGN KEY ("orderId") REFERENCES "TradeOrder"(id)`

索引：
- `CREATE INDEX "domain_PaymentAttempt_idx_0" ON public."PaymentAttempt" USING btree ("orderId", "createdAt")`
- `CREATE INDEX "domain_PaymentAttempt_idx_1" ON public."PaymentAttempt" USING btree (state, "expiresAt")`

### PaymentTransaction / payment_transaction

保存每次实际渠道收款，包括重复付款异常，事实不得丢弃

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|attemptId|text|否|—|payment_attempt.id；通用可写|
|orderId|text|是|—|trade_order.id；通用可写|
|channel|text|是|—|通用可写|
|appScope|text|是|—|通用可写|
|externalTransactionId|text|是|—|通用可写|
|originalTransactionId|text|否|—|通用可写|
|amount|bigint|是|—|通用可写|
|currency|character(3)|是|—|通用可写|
|channelFee|bigint|是|0|通用可写|
|verifiedAt|timestamp with time zone|是|—|通用可写|
|paidAt|timestamp with time zone|是|—|通用可写|
|disposition|text|是|—|通用可写|
|receiptHash|text|是|—|查询隐藏|
|receiptStorageRef|text|否|—|查询隐藏|
|settlementAmount|bigint|否|—|通用可写|
|settlementCurrency|character(3)|否|—|通用可写|

约束：
- `PaymentTransaction_pkey`：`PRIMARY KEY (id)`
- `domain_PaymentTransaction_0`：`UNIQUE (channel, "appScope", "externalTransactionId")`
- `domain_PaymentTransaction_1`：`CHECK (amount >= 0 AND "channelFee" >= 0)`
- `domain_PaymentTransaction_2`：`CHECK (disposition = ANY (ARRAY['ACCEPTED'::text, 'DUPLICATE'::text, 'LATE'::text, 'AMOUNT_MISMATCH'::text, 'REFUND_REQUIRED'::text]))`
- `domain_PaymentTransaction_attemptId_fk`：`FOREIGN KEY ("attemptId") REFERENCES "PaymentAttempt"(id)`
- `domain_PaymentTransaction_orderId_fk`：`FOREIGN KEY ("orderId") REFERENCES "TradeOrder"(id)`

索引：
- `CREATE UNIQUE INDEX "domain_PaymentTransaction_idx_0" ON public."PaymentTransaction" USING btree ("orderId") WHERE (disposition = 'ACCEPTED'::text)`

### PlanBenefit / plan_benefit

每个套餐版本具体权益参数和适用资源

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|planVersionId|text|是|—|membership_plan_version.id；通用可写|
|definitionId|text|是|—|benefit_definition.id；通用可写|
|parameters|jsonb|是|—|通用可写|
|quota|integer|否|—|通用可写|
|periodKind|text|是|—|通用可写|

约束：
- `PlanBenefit_pkey`：`PRIMARY KEY (id)`
- `domain_PlanBenefit_0`：`UNIQUE ("planVersionId", "definitionId")`
- `domain_PlanBenefit_1`：`CHECK (quota IS NULL OR quota >= 0)`
- `domain_PlanBenefit_definitionId_fk`：`FOREIGN KEY ("definitionId") REFERENCES "BenefitDefinition"(id)`
- `domain_PlanBenefit_planVersionId_fk`：`FOREIGN KEY ("planVersionId") REFERENCES "MembershipPlanVersion"(id)`

索引：

### PointsAccount / points_account

积分余额聚合，锁账号防并发透支

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|userId|text|是|—|app_user.id；通用可写|
|balance|bigint|是|0||
|reserved|bigint|是|0||

约束：
- `PointsAccount_pkey`：`PRIMARY KEY (id)`
- `PointsAccount_userId_key`：`UNIQUE ("userId")`
- `PointsAccount_version_check`：`CHECK (version > 0)`
- `domain_PointsAccount_0`：`CHECK (balance >= reserved AND reserved >= 0)`
- `domain_PointsAccount_userId_fk`：`FOREIGN KEY ("userId") REFERENCES "User"(id)`

索引：

### PointsLedger / points_ledger

消费打卡审核奖励兑换及退款冲正

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|accountId|text|是|—|points_account.id；通用可写|
|eventKey|text|是|—|通用可写|
|delta|bigint|是|—|通用可写|
|reason|text|是|—|通用可写|
|orderItemId|text|否|—|order_item.id；通用可写|
|resourceId|text|否|—|resource.id；通用可写|
|ruleSnapshot|jsonb|是|—|通用可写|
|businessDay|date|是|—|通用可写|
|reversalOfId|text|否|—|points_ledger.id；通用可写|
|balanceAfter|bigint|是|—|通用可写|

约束：
- `PointsLedger_eventKey_key`：`UNIQUE ("eventKey")`
- `PointsLedger_pkey`：`PRIMARY KEY (id)`
- `PointsLedger_reversalOfId_key`：`UNIQUE ("reversalOfId")`
- `domain_PointsLedger_0`：`CHECK (delta <> 0 AND "balanceAfter" >= 0)`
- `domain_PointsLedger_accountId_fk`：`FOREIGN KEY ("accountId") REFERENCES "PointsAccount"(id)`
- `domain_PointsLedger_orderItemId_fk`：`FOREIGN KEY ("orderItemId") REFERENCES "TradeOrderItem"(id)`
- `domain_PointsLedger_resourceId_fk`：`FOREIGN KEY ("resourceId") REFERENCES "Resource"(id)`
- `domain_PointsLedger_reversalOfId_fk`：`FOREIGN KEY ("reversalOfId") REFERENCES "PointsLedger"(id)`

索引：
- `CREATE INDEX "domain_PointsLedger_idx_0" ON public."PointsLedger" USING btree ("accountId", "createdAt")`

### PointsRedemption / points_redemption

兑换订单关联实际奖励交付

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|userId|text|是|—|app_user.id；通用可写|
|rewardId|text|是|—|points_reward.id；通用可写|
|requestKey|text|是|—|通用可写|
|pointsCost|bigint|是|—|通用可写|
|rewardSnapshot|jsonb|是|—|通用可写|
|state|text|是|—|通用可写|
|orderId|text|否|—|trade_order.id；通用可写|
|userCouponId|text|否|—|user_coupon.id；通用可写|
|benefitUsageId|text|否|—|benefit_usage.id；通用可写|
|businessDay|date|是|—|通用可写|
|completedAt|timestamp with time zone|否|—|通用可写|

约束：
- `PointsRedemption_pkey`：`PRIMARY KEY (id)`
- `PointsRedemption_version_check`：`CHECK (version > 0)`
- `domain_PointsRedemption_0`：`UNIQUE ("userId", "requestKey")`
- `domain_PointsRedemption_1`：`CHECK ("pointsCost" > 0)`
- `domain_PointsRedemption_benefitUsageId_fk`：`FOREIGN KEY ("benefitUsageId") REFERENCES "BenefitUsage"(id)`
- `domain_PointsRedemption_orderId_fk`：`FOREIGN KEY ("orderId") REFERENCES "TradeOrder"(id)`
- `domain_PointsRedemption_rewardId_fk`：`FOREIGN KEY ("rewardId") REFERENCES "PointsReward"(id)`
- `domain_PointsRedemption_userCouponId_fk`：`FOREIGN KEY ("userCouponId") REFERENCES "UserCoupon"(id)`
- `domain_PointsRedemption_userId_fk`：`FOREIGN KEY ("userId") REFERENCES "User"(id)`

索引：
- `CREATE INDEX "domain_PointsRedemption_idx_0" ON public."PointsRedemption" USING btree ("userId", "businessDay")`
- `CREATE INDEX "domain_PointsRedemption_idx_1" ON public."PointsRedemption" USING btree (state, "createdAt")`

### PointsReservation / points_reservation

兑换预占，失败释放

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|accountId|text|是|—|points_account.id；通用可写|
|requestKey|text|是|—|通用可写|
|points|bigint|是|—|通用可写|
|state|text|是|—|通用可写|
|expiresAt|timestamp with time zone|是|—|通用可写|
|redemptionId|text|否|—|points_redemption.id；通用可写|

约束：
- `PointsReservation_pkey`：`PRIMARY KEY (id)`
- `PointsReservation_requestKey_key`：`UNIQUE ("requestKey")`
- `PointsReservation_version_check`：`CHECK (version > 0)`
- `domain_PointsReservation_0`：`CHECK (points > 0)`
- `domain_PointsReservation_1`：`CHECK (state = ANY (ARRAY['HELD'::text, 'CONSUMED'::text, 'RELEASED'::text]))`
- `domain_PointsReservation_accountId_fk`：`FOREIGN KEY ("accountId") REFERENCES "PointsAccount"(id)`
- `domain_PointsReservation_redemptionId_fk`：`FOREIGN KEY ("redemptionId") REFERENCES "PointsRedemption"(id)`

索引：
- `CREATE INDEX "domain_PointsReservation_idx_0" ON public."PointsReservation" USING btree (state, "expiresAt")`

### PointsReward / points_reward

积分兑换奖品券/实物/咨询，券R1其余R2

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|title|text|是|—|通用可写|
|kind|text|是|—|通用可写|
|pointsCost|bigint|是|—|通用可写|
|couponTemplateId|text|否|—|coupon_template.id；通用可写|
|offerId|text|否|—|sale_offer.id；通用可写|
|benefitDefinitionId|text|否|—|benefit_definition.id；通用可写|
|stock|integer|是|—|通用可写|
|reserved|integer|是|0||
|perUserDaily|integer|是|—|通用可写|
|active|boolean|是|false|通用可写|

约束：
- `PointsReward_pkey`：`PRIMARY KEY (id)`
- `PointsReward_version_check`：`CHECK (version > 0)`
- `domain_PointsReward_0`：`CHECK (num_nonnulls("couponTemplateId", "offerId", "benefitDefinitionId") = 1)`
- `domain_PointsReward_1`：`CHECK ("pointsCost" > 0 AND stock >= reserved AND reserved >= 0 AND "perUserDaily" > 0)`
- `domain_PointsReward_benefitDefinitionId_fk`：`FOREIGN KEY ("benefitDefinitionId") REFERENCES "BenefitDefinition"(id)`
- `domain_PointsReward_couponTemplateId_fk`：`FOREIGN KEY ("couponTemplateId") REFERENCES "CouponTemplate"(id)`
- `domain_PointsReward_offerId_fk`：`FOREIGN KEY ("offerId") REFERENCES "SaleOffer"(id)`

索引：

### PollOption / poll_option

投票选项

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|pollId|text|是|—|live_poll.id；通用可写|
|label|text|是|—|通用可写|
|position|integer|是|—|通用可写|

约束：
- `PollOption_pkey`：`PRIMARY KEY (id)`
- `domain_PollOption_0`：`UNIQUE ("pollId", "position")`
- `domain_PollOption_1`：`UNIQUE (id, "pollId")`
- `domain_PollOption_pollId_fk`：`FOREIGN KEY ("pollId") REFERENCES "LivePoll"(id)`

索引：

### PollVote / poll_vote

每次投票用户选项去重；单选限制服务事务检查

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|pollId|text|是|—|live_poll.id；通用可写|
|optionId|text|是|—|通用可写|
|userId|text|是|—|app_user.id；通用可写|

约束：
- `PollVote_pkey`：`PRIMARY KEY (id)`
- `domain_PollVote_1`：`UNIQUE ("pollId", "userId", "optionId")`
- `domain_PollVote_0`：`FOREIGN KEY ("optionId", "pollId") REFERENCES "PollOption"(id, "pollId")`
- `domain_PollVote_pollId_fk`：`FOREIGN KEY ("pollId") REFERENCES "LivePoll"(id)`
- `domain_PollVote_userId_fk`：`FOREIGN KEY ("userId") REFERENCES "User"(id)`

索引：

### PracticeCheckin / practice_checkin

任务打卡不同于私人日志；连续天数按日期事实推导

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|taskId|text|是|—|practice_task.id；通用可写|
|userId|text|是|—|app_user.id；通用可写|
|businessDay|date|是|—|通用可写|
|body|text|是|—|通用可写|
|privateLogId|text|否|—|practice_log.id；通用可写|
|state|text|是|—|通用可写|
|rewardEventKey|text|否|—||

约束：
- `PracticeCheckin_pkey`：`PRIMARY KEY (id)`
- `PracticeCheckin_rewardEventKey_key`：`UNIQUE ("rewardEventKey")`
- `PracticeCheckin_version_check`：`CHECK (version > 0)`
- `domain_PracticeCheckin_0`：`UNIQUE ("taskId", "userId", "businessDay")`
- `domain_PracticeCheckin_privateLogId_fk`：`FOREIGN KEY ("privateLogId") REFERENCES "PracticeLog"(id)`
- `domain_PracticeCheckin_taskId_fk`：`FOREIGN KEY ("taskId") REFERENCES "PracticeTask"(id)`
- `domain_PracticeCheckin_userId_fk`：`FOREIGN KEY ("userId") REFERENCES "User"(id)`

索引：
- `CREATE INDEX "domain_PracticeCheckin_idx_0" ON public."PracticeCheckin" USING btree ("userId", "businessDay")`

### PracticeLog / practice_log

私人日记，不直接公开；日期按上海业务时区

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|—||
|userId|text|是|—|app_user.id；通用可写|
|day|text|是|—|通用可写|
|text|text|是|—|通用可写|
|createdAt|timestamp(3) without time zone|是|CURRENT_TIMESTAMP||
|updatedAt|timestamp(3) without time zone|是|—||
|version|integer|是|1||
|deletedAt|timestamp with time zone|否|—||

约束：
- `PracticeLog_pkey`：`PRIMARY KEY (id)`
- `PracticeLog_version_check`：`CHECK (version > 0)`
- `domain_PracticeLog_0`：`UNIQUE ("userId", day)`
- `PracticeLog_userId_fkey`：`FOREIGN KEY ("userId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE RESTRICT`
- `domain_PracticeLog_userId_fk`：`FOREIGN KEY ("userId") REFERENCES "User"(id)`

索引：
- `CREATE UNIQUE INDEX "PracticeLog_userId_day_key" ON public."PracticeLog" USING btree ("userId", day)`
- `CREATE INDEX "domain_PracticeLog_idx_0" ON public."PracticeLog" USING btree ("userId", day)`

### PracticeTask / practice_task

课程每日/周期实践定义及打卡要求

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|courseId|text|是|—|course.id；通用可写|
|lessonId|text|否|—|lesson.id；通用可写|
|cohortId|text|否|—|course_cohort.id；通用可写|
|title|text|是|—|通用可写|
|instructions|jsonb|是|—|通用可写|
|frequency|text|是|—|通用可写|
|requiredDays|integer|是|—|通用可写|
|startsOn|date|否|—|通用可写|
|endsOn|date|否|—|通用可写|
|required|boolean|是|—|通用可写|

约束：
- `PracticeTask_pkey`：`PRIMARY KEY (id)`
- `PracticeTask_version_check`：`CHECK (version > 0)`
- `domain_PracticeTask_0`：`CHECK ("requiredDays" > 0)`
- `domain_PracticeTask_1`：`CHECK ("endsOn" IS NULL OR "startsOn" IS NULL OR "endsOn" >= "startsOn")`
- `domain_PracticeTask_cohortId_fk`：`FOREIGN KEY ("cohortId") REFERENCES "CourseCohort"(id)`
- `domain_PracticeTask_courseId_fk`：`FOREIGN KEY ("courseId") REFERENCES "Course"(id)`
- `domain_PracticeTask_lessonId_fk`：`FOREIGN KEY ("lessonId") REFERENCES "Lesson"(id)`

索引：

### Product / product

五类商品描述与溯源，履约类型单独定义

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|—||
|title|text|是|—|通用可写|
|subtitle|text|是|—|通用可写|
|description|text|是|—|通用可写|
|category|text|是|—|通用可写|
|type|"ProductType"|是|'PHYSICAL'::"ProductType"|通用可写|
|cover|text|是|—|通用可写|
|price|integer|是|—|通用可写|
|culturalOrigin|text|是|—|通用可写|
|status|"PublishStatus"|是|'DRAFT'::"PublishStatus"|通用可写|
|featured|boolean|是|false|通用可写|
|isDemo|boolean|是|false|通用可写|
|createdAt|timestamp(3) without time zone|是|CURRENT_TIMESTAMP||
|updatedAt|timestamp(3) without time zone|是|—||
|version|integer|是|1||
|resourceKind|text|是|'PRODUCT'::text||
|partnerId|text|否|—|partner.id；通用可写|
|deliveryTemplateId|text|否|—|delivery_template.id；通用可写|
|afterSalesPolicy|jsonb|是|'{}'::jsonb|通用可写|

约束：
- `Product_pkey`：`PRIMARY KEY (id)`
- `Product_resourceKind_check`：`CHECK ("resourceKind" = 'PRODUCT'::text)`
- `domain_Product_0`：`CHECK (type = ANY (ARRAY['PHYSICAL'::"ProductType", 'DIGITAL'::"ProductType", 'SERVICE'::"ProductType"]))`
- `domain_Product_1`：`FOREIGN KEY (id, "resourceKind") REFERENCES "Resource"(id, kind)`
- `domain_Product_deliveryTemplateId_fk`：`FOREIGN KEY ("deliveryTemplateId") REFERENCES "DeliveryTemplate"(id)`
- `domain_Product_partnerId_fk`：`FOREIGN KEY ("partnerId") REFERENCES "Partner"(id)`

索引：
- `CREATE INDEX "Product_status_category_idx" ON public."Product" USING btree (status, category)`

### ProductSku / product_sku

实物库存聚合，数字/服务不得冒用此库存

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|—||
|productId|text|是|—|product.id；通用可写|
|title|text|是|—|通用可写|
|price|integer|是|—|通用可写|
|stock|integer|是|0|通用可写|
|reserved|integer|是|0||
|active|boolean|是|false|通用可写|
|version|integer|是|1||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|code|text|是|(gen_random_uuid())::text|通用可写|
|specs|jsonb|是|'{}'::jsonb|通用可写|
|digitalReleaseId|text|否|—|digital_release.id；通用可写|
|serviceOfferingId|text|否|—|service_offering.id；通用可写|
|signedCopy|boolean|是|false|通用可写|

约束：
- `ProductSku_code_key`：`UNIQUE (code)`
- `ProductSku_inventory_check`：`CHECK (stock >= reserved AND reserved >= 0)`
- `ProductSku_pkey`：`PRIMARY KEY (id)`
- `ProductSku_price_check`：`CHECK (price >= 0)`
- `domain_ProductSku_0`：`CHECK (stock >= reserved AND reserved >= 0)`
- `domain_ProductSku_1`：`CHECK (num_nonnulls("digitalReleaseId", "serviceOfferingId") <= 1)`
- `ProductSku_productId_fkey`：`FOREIGN KEY ("productId") REFERENCES "Product"(id) ON DELETE CASCADE`
- `domain_ProductSku_digitalReleaseId_fk`：`FOREIGN KEY ("digitalReleaseId") REFERENCES "DigitalRelease"(id)`
- `domain_ProductSku_productId_fk`：`FOREIGN KEY ("productId") REFERENCES "Product"(id)`
- `domain_ProductSku_serviceOfferingId_fk`：`FOREIGN KEY ("serviceOfferingId") REFERENCES "ServiceOffering"(id)`

索引：
- `CREATE INDEX "ProductSku_productId_active_idx" ON public."ProductSku" USING btree ("productId", active)`
- `CREATE INDEX "domain_ProductSku_idx_0" ON public."ProductSku" USING btree ("productId", active)`

### Promotion / promotion

秒杀/满减活动服务端时间价格与独立库存

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|title|text|是|—|通用可写|
|kind|text|是|—|通用可写|
|startsAt|timestamp with time zone|是|—|通用可写|
|endsAt|timestamp with time zone|是|—|通用可写|
|rules|jsonb|是|—|通用可写|
|allowedChannels|text[]|是|—|通用可写|
|state|text|是|—|通用可写|

约束：
- `Promotion_pkey`：`PRIMARY KEY (id)`
- `Promotion_version_check`：`CHECK (version > 0)`
- `domain_Promotion_0`：`CHECK ("endsAt" > "startsAt")`

索引：

### PromotionOffer / promotion_offer

活动指定可售单元与限量

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|promotionId|text|是|—|promotion.id；通用可写|
|offerId|text|是|—|sale_offer.id；通用可写|
|price|bigint|否|—|通用可写|
|capacity|integer|否|—|通用可写|
|reserved|integer|是|0||
|sold|integer|是|0||
|perUserLimit|integer|是|—|通用可写|

约束：
- `PromotionOffer_pkey`：`PRIMARY KEY (id)`
- `PromotionOffer_version_check`：`CHECK (version > 0)`
- `domain_PromotionOffer_0`：`UNIQUE ("promotionId", "offerId")`
- `domain_PromotionOffer_1`：`CHECK (price IS NULL OR price >= 0)`
- `domain_PromotionOffer_2`：`CHECK (reserved >= 0 AND sold >= 0 AND (capacity IS NULL OR capacity >= (reserved + sold)))`
- `domain_PromotionOffer_3`：`CHECK ("perUserLimit" > 0)`
- `domain_PromotionOffer_offerId_fk`：`FOREIGN KEY ("offerId") REFERENCES "SaleOffer"(id)`
- `domain_PromotionOffer_promotionId_fk`：`FOREIGN KEY ("promotionId") REFERENCES "Promotion"(id)`

索引：

### ProviderCallback / provider_callback

支付退款直播转码审核统一回调收件箱

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|provider|text|是|—|通用可写|
|appScope|text|是|—|通用可写|
|externalEventId|text|是|—|通用可写|
|kind|text|是|—|通用可写|
|payloadHash|text|是|—|查询隐藏|
|payloadStorageRef|text|是|—|查询隐藏|
|signatureVerified|boolean|是|—|通用可写|
|state|text|是|—|通用可写|
|attempts|integer|是|0|通用可写|
|nextRetryAt|timestamp with time zone|否|—|通用可写|
|lastErrorCode|text|否|—|通用可写|
|handledAt|timestamp with time zone|否|—|通用可写|

约束：
- `ProviderCallback_pkey`：`PRIMARY KEY (id)`
- `ProviderCallback_version_check`：`CHECK (version > 0)`
- `domain_ProviderCallback_0`：`UNIQUE (provider, "appScope", "externalEventId")`
- `domain_ProviderCallback_1`：`CHECK (attempts >= 0)`

索引：
- `CREATE INDEX "domain_ProviderCallback_idx_0" ON public."ProviderCallback" USING btree (state, "nextRetryAt")`

### RateLimit / rate_limit

基础数据库限流，必要时缓存加速

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|key|text|是|—|通用可写|
|count|integer|是|—|通用可写|
|expiresAt|timestamp(3) without time zone|是|—|通用可写|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||

约束：
- `RateLimit_id_key`：`UNIQUE (id)`
- `RateLimit_pkey`：`PRIMARY KEY (key)`
- `RateLimit_version_check`：`CHECK (version > 0)`
- `domain_RateLimit_0`：`CHECK (count >= 0)`

索引：
- `CREATE INDEX "domain_RateLimit_idx_0" ON public."RateLimit" USING btree ("expiresAt")`

### Reaction / reaction

资源统一点赞/收藏，计数由事实重算

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|userId|text|是|—|app_user.id；通用可写|
|resourceId|text|是|—|resource.id；通用可写|
|kind|text|是|—|通用可写|

约束：
- `Reaction_pkey`：`PRIMARY KEY (id)`
- `domain_Reaction_0`：`UNIQUE ("userId", "resourceId", kind)`
- `domain_Reaction_1`：`CHECK (kind = ANY (ARRAY['LIKE'::text, 'FAVORITE'::text]))`
- `domain_Reaction_resourceId_fk`：`FOREIGN KEY ("resourceId") REFERENCES "Resource"(id)`
- `domain_Reaction_userId_fk`：`FOREIGN KEY ("userId") REFERENCES "User"(id)`

索引：
- `CREATE INDEX "domain_Reaction_idx_0" ON public."Reaction" USING btree ("resourceId", kind)`

### ReadingEvent / reading_event

阅读历史、去重和行为推荐事实；有限期保留

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|userId|text|否|—|app_user.id；通用可写|
|anonymousHash|text|否|—|查询隐藏|
|resourceId|text|是|—|resource.id；通用可写|
|eventKey|text|是|—|通用可写|
|businessDay|date|是|—|通用可写|
|dwellSeconds|integer|是|0|通用可写|
|consentRecordId|text|否|—|consent_record.id；通用可写|

约束：
- `ReadingEvent_eventKey_key`：`UNIQUE ("eventKey")`
- `ReadingEvent_pkey`：`PRIMARY KEY (id)`
- `domain_ReadingEvent_0`：`CHECK ("dwellSeconds" >= 0)`
- `domain_ReadingEvent_consentRecordId_fk`：`FOREIGN KEY ("consentRecordId") REFERENCES "ConsentRecord"(id)`
- `domain_ReadingEvent_resourceId_fk`：`FOREIGN KEY ("resourceId") REFERENCES "Resource"(id)`
- `domain_ReadingEvent_userId_fk`：`FOREIGN KEY ("userId") REFERENCES "User"(id)`

索引：
- `CREATE INDEX "domain_ReadingEvent_idx_0" ON public."ReadingEvent" USING btree ("userId", "createdAt")`
- `CREATE INDEX "domain_ReadingEvent_idx_1" ON public."ReadingEvent" USING btree ("resourceId", "businessDay")`

### Reconciliation / reconciliation

渠道每日对账任务与差异列表，不用示例营业额

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|channel|text|是|—|通用可写|
|appScope|text|是|—|通用可写|
|businessDay|date|是|—|通用可写|
|state|text|是|—|通用可写|
|billStorageRef|text|否|—|查询隐藏|
|billHash|text|否|—|查询隐藏|
|summary|jsonb|是|—|通用可写|
|differences|jsonb|是|—|通用可写|
|reviewerId|text|否|—|app_user.id|
|resolvedAt|timestamp with time zone|否|—|通用可写|

约束：
- `Reconciliation_pkey`：`PRIMARY KEY (id)`
- `Reconciliation_version_check`：`CHECK (version > 0)`
- `domain_Reconciliation_0`：`UNIQUE (channel, "appScope", "businessDay")`
- `domain_Reconciliation_reviewerId_fk`：`FOREIGN KEY ("reviewerId") REFERENCES "User"(id)`

索引：

### Referral / referral

一级推广批准与7天首次有效归因

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|promoterId|text|是|—|app_user.id；通用可写|
|buyerId|text|是|—|app_user.id；通用可写|
|code|text|是|—|通用可写|
|firstValidAt|timestamp with time zone|是|—|通用可写|
|expiresAt|timestamp with time zone|是|—|通用可写|
|approvalSnapshot|jsonb|是|—|通用可写|

约束：
- `Referral_pkey`：`PRIMARY KEY (id)`
- `Referral_version_check`：`CHECK (version > 0)`
- `domain_Referral_0`：`CHECK ("promoterId" <> "buyerId" AND "expiresAt" > "firstValidAt")`
- `domain_Referral_buyerId_fk`：`FOREIGN KEY ("buyerId") REFERENCES "User"(id)`
- `domain_Referral_promoterId_fk`：`FOREIGN KEY ("promoterId") REFERENCES "User"(id)`

索引：
- `CREATE INDEX "domain_Referral_idx_0" ON public."Referral" USING btree ("buyerId", "firstValidAt")`

### Refund / refund

售后申请与退款请求；换货不伪装现金退款

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|orderId|text|是|—|trade_order.id；通用可写|
|userId|text|是|—|app_user.id；通用可写|
|requestKey|text|是|—|通用可写|
|kind|text|是|—|通用可写|
|state|text|是|—|通用可写|
|requestedAmount|bigint|是|—|通用可写|
|approvedAmount|bigint|否|—|通用可写|
|reasonCode|text|是|—|通用可写|
|description|text|是|—|通用可写|
|reviewerId|text|否|—|app_user.id|
|reviewNote|text|否|—|通用可写|
|paymentTransactionId|text|否|—|payment_transaction.id；通用可写|
|succeededAt|timestamp with time zone|否|—|通用可写|
|failureCode|text|否|—|通用可写|
|channelRequestKey|text|否|—|通用可写|

约束：
- `Refund_channelRequestKey_key`：`UNIQUE ("channelRequestKey")`
- `Refund_pkey`：`PRIMARY KEY (id)`
- `Refund_version_check`：`CHECK (version > 0)`
- `domain_Refund_0`：`UNIQUE ("userId", "requestKey")`
- `domain_Refund_1`：`CHECK (kind = ANY (ARRAY['REFUND_ONLY'::text, 'RETURN_REFUND'::text, 'EXCHANGE'::text]))`
- `domain_Refund_2`：`CHECK (state = ANY (ARRAY['REQUESTED'::text, 'REVIEW'::text, 'REJECTED'::text, 'APPROVED'::text, 'RETURNING'::text, 'REFUNDING'::text, 'SUCCEEDED'::text, 'FAILED'::text, 'CANCELLED'::text]))`
- `domain_Refund_3`：`CHECK ("requestedAmount" >= 0 AND ("approvedAmount" IS NULL OR "approvedAmount" >= 0 AND "approvedAmount" <= "requestedAmount"))`
- `domain_Refund_orderId_fk`：`FOREIGN KEY ("orderId") REFERENCES "TradeOrder"(id)`
- `domain_Refund_paymentTransactionId_fk`：`FOREIGN KEY ("paymentTransactionId") REFERENCES "PaymentTransaction"(id)`
- `domain_Refund_reviewerId_fk`：`FOREIGN KEY ("reviewerId") REFERENCES "User"(id)`
- `domain_Refund_userId_fk`：`FOREIGN KEY ("userId") REFERENCES "User"(id)`

索引：
- `CREATE INDEX course_sales_refund_order_state ON public."Refund" USING btree ("orderId", state)`
- `CREATE INDEX "domain_Refund_idx_0" ON public."Refund" USING btree ("orderId", "createdAt")`
- `CREATE INDEX "domain_Refund_idx_1" ON public."Refund" USING btree (state, "updatedAt")`

### RefundItem / refund_item

按订单项部分退款和退货范围，避免整单撤权

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|refundId|text|是|—|refund.id；通用可写|
|orderItemId|text|是|—|order_item.id；通用可写|
|quantity|integer|是|—|通用可写|
|amount|bigint|是|—|通用可写|
|revokeQuantity|integer|是|—|通用可写|
|returnStockQuantity|integer|是|0|通用可写|

约束：
- `RefundItem_pkey`：`PRIMARY KEY (id)`
- `RefundItem_version_check`：`CHECK (version > 0)`
- `domain_RefundItem_0`：`UNIQUE ("refundId", "orderItemId")`
- `domain_RefundItem_1`：`CHECK (quantity > 0 AND amount >= 0 AND "revokeQuantity" >= 0 AND "revokeQuantity" <= quantity AND "returnStockQuantity" >= 0 AND "returnStockQuantity" <= quantity)`
- `domain_RefundItem_orderItemId_fk`：`FOREIGN KEY ("orderItemId") REFERENCES "TradeOrderItem"(id)`
- `domain_RefundItem_refundId_fk`：`FOREIGN KEY ("refundId") REFERENCES "Refund"(id)`

索引：

### RefundTransaction / refund_transaction

每笔已核验渠道退款事实，退重复异常收款不错误冲减正常订单

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|refundId|text|是|—|refund.id；通用可写|
|paymentTransactionId|text|是|—|payment_transaction.id；通用可写|
|channel|text|是|—|通用可写|
|appScope|text|是|—|通用可写|
|externalRefundId|text|是|—|通用可写|
|amount|bigint|是|—|通用可写|
|currency|character(3)|是|—|通用可写|
|verifiedAt|timestamp with time zone|是|—|通用可写|
|succeededAt|timestamp with time zone|是|—|通用可写|
|receiptHash|text|是|—|查询隐藏|
|receiptStorageRef|text|否|—|查询隐藏|

约束：
- `RefundTransaction_pkey`：`PRIMARY KEY (id)`
- `domain_RefundTransaction_0`：`UNIQUE (channel, "appScope", "externalRefundId")`
- `domain_RefundTransaction_1`：`CHECK (amount > 0)`
- `domain_RefundTransaction_paymentTransactionId_fk`：`FOREIGN KEY ("paymentTransactionId") REFERENCES "PaymentTransaction"(id)`
- `domain_RefundTransaction_refundId_fk`：`FOREIGN KEY ("refundId") REFERENCES "Refund"(id)`

索引：
- `CREATE INDEX "domain_RefundTransaction_idx_0" ON public."RefundTransaction" USING btree ("paymentTransactionId")`
- `CREATE INDEX "domain_RefundTransaction_idx_1" ON public."RefundTransaction" USING btree ("refundId")`

### Report / report

举报资源或评论，恰好一个目标

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|reporterId|text|是|—|app_user.id；通用可写|
|resourceId|text|否|—|resource.id；通用可写|
|commentId|text|否|—|comment.id；通用可写|
|reasonCode|text|是|—|通用可写|
|description|text|是|—|通用可写|
|state|text|是|—|通用可写|
|assigneeId|text|否|—|app_user.id；通用可写|
|resolvedAt|timestamp with time zone|否|—|通用可写|
|resolution|text|否|—|通用可写|

约束：
- `Report_pkey`：`PRIMARY KEY (id)`
- `Report_version_check`：`CHECK (version > 0)`
- `domain_Report_0`：`CHECK (num_nonnulls("resourceId", "commentId") = 1)`
- `domain_Report_assigneeId_fk`：`FOREIGN KEY ("assigneeId") REFERENCES "User"(id)`
- `domain_Report_commentId_fk`：`FOREIGN KEY ("commentId") REFERENCES "Comment"(id)`
- `domain_Report_reporterId_fk`：`FOREIGN KEY ("reporterId") REFERENCES "User"(id)`
- `domain_Report_resourceId_fk`：`FOREIGN KEY ("resourceId") REFERENCES "Resource"(id)`

索引：
- `CREATE INDEX "domain_Report_idx_0" ON public."Report" USING btree (state, "createdAt")`

### Resource / resource

强FK的公共内容身份；此表是发布状态唯一权威

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|kind|text|是|—|通用可写|
|title|text|是|—|通用可写|
|summary|text|是|''::text|通用可写|
|coverAssetId|text|否|—|media_asset.id；通用可写|
|ownerId|text|否|—|app_user.id；通用可写|
|publishState|text|是|'DRAFT'::text|通用可写|
|visibility|text|是|'PUBLIC'::text|通用可写|
|membershipTier|integer|否|—|通用可写|
|categoryCode|text|是|—|通用可写|
|isDemo|boolean|是|false|通用可写|
|featuredRank|integer|否|—|通用可写|
|publishedAt|timestamp with time zone|否|—||

约束：
- `Resource_pkey`：`PRIMARY KEY (id)`
- `Resource_version_check`：`CHECK (version > 0)`
- `domain_Resource_0`：`UNIQUE (id, kind)`
- `domain_Resource_1`：`CHECK (kind = ANY (ARRAY['ARTICLE'::text, 'TEACHER'::text, 'COURSE'::text, 'PRODUCT'::text, 'EVENT'::text, 'LIVE'::text, 'THREAD'::text]))`
- `domain_Resource_2`：`CHECK ("publishState" = ANY (ARRAY['DRAFT'::text, 'REVIEW'::text, 'PUBLISHED'::text, 'REJECTED'::text, 'ARCHIVED'::text]))`
- `domain_Resource_3`：`CHECK (visibility = ANY (ARRAY['PUBLIC'::text, 'MEMBER'::text, 'COURSE'::text, 'PRIVATE'::text]))`
- `domain_Resource_4`：`CHECK ("membershipTier" IS NULL OR "membershipTier" >= 1 AND "membershipTier" <= 3)`
- `domain_Resource_coverAssetId_fk`：`FOREIGN KEY ("coverAssetId") REFERENCES "MediaAsset"(id)`
- `domain_Resource_ownerId_fk`：`FOREIGN KEY ("ownerId") REFERENCES "User"(id)`

索引：
- `CREATE INDEX "domain_Resource_idx_0" ON public."Resource" USING btree (kind, "publishState", "publishedAt", id)`
- `CREATE INDEX "domain_Resource_idx_1" ON public."Resource" USING btree (kind, "categoryCode", "publishState")`

### ResourceEvidence / resource_evidence

资源与核验证据关联

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|resourceId|text|是|—|resource.id；通用可写|
|evidenceId|text|是|—|source_evidence.id；通用可写|
|purpose|text|是|—|通用可写|

约束：
- `ResourceEvidence_pkey`：`PRIMARY KEY (id)`
- `domain_ResourceEvidence_0`：`UNIQUE ("resourceId", "evidenceId", purpose)`
- `domain_ResourceEvidence_evidenceId_fk`：`FOREIGN KEY ("evidenceId") REFERENCES "SourceEvidence"(id)`
- `domain_ResourceEvidence_resourceId_fk`：`FOREIGN KEY ("resourceId") REFERENCES "Resource"(id)`

索引：

### ResourceTag / resource_tag

资源标签关系

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|resourceId|text|是|—|resource.id；通用可写|
|tagId|text|是|—|tag.id；通用可写|

约束：
- `ResourceTag_pkey`：`PRIMARY KEY (id)`
- `domain_ResourceTag_0`：`UNIQUE ("resourceId", "tagId")`
- `domain_ResourceTag_resourceId_fk`：`FOREIGN KEY ("resourceId") REFERENCES "Resource"(id)`
- `domain_ResourceTag_tagId_fk`：`FOREIGN KEY ("tagId") REFERENCES "Tag"(id)`

索引：

### SaleOffer / sale_offer

唯一计价和渠道映射对象，恰好一种交付源

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|kind|text|是|—|通用可写|
|courseReleaseId|text|否|—|course_release.id；通用可写|
|cohortId|text|否|—|course_cohort.id；通用可写|
|skuId|text|否|—|product_sku.id；通用可写|
|membershipVersionId|text|否|—|membership_plan_version.id；通用可写|
|serviceOfferingId|text|否|—|service_offering.id；通用可写|
|eventTicketId|text|否|—|event_ticket_type.id；通用可写|
|giftId|text|否|—|virtual_gift.id；通用可写|
|operatingServiceId|text|否|—|operating_service.id；通用可写|
|currency|character(3)|是|'CNY'::bpchar|通用可写|
|price|bigint|是|—|通用可写|
|active|boolean|是|false|通用可写|
|validFrom|timestamp with time zone|否|—|通用可写|
|validUntil|timestamp with time zone|否|—|通用可写|
|quantityLimit|integer|是|99|通用可写|
|policySnapshot|jsonb|是|—|通用可写|

约束：
- `SaleOffer_pkey`：`PRIMARY KEY (id)`
- `SaleOffer_version_check`：`CHECK (version > 0)`
- `domain_SaleOffer_0`：`CHECK (kind = ANY (ARRAY['COURSE'::text, 'PHYSICAL'::text, 'DIGITAL'::text, 'MEMBERSHIP'::text, 'CONSULTATION'::text, 'EVENT'::text, 'GIFT'::text, 'OPERATING_SERVICE'::text]))`
- `domain_SaleOffer_1`：`CHECK (num_nonnulls("courseReleaseId", "skuId", "membershipVersionId", "serviceOfferingId", "eventTicketId", "giftId", "operatingServiceId") = 1)`
- `domain_SaleOffer_2`：`CHECK (price >= 0 AND "quantityLimit" > 0)`
- `domain_SaleOffer_3`：`CHECK ("validUntil" IS NULL OR "validFrom" IS NULL OR "validUntil" > "validFrom")`
- `domain_SaleOffer_cohortId_fk`：`FOREIGN KEY ("cohortId") REFERENCES "CourseCohort"(id)`
- `domain_SaleOffer_courseReleaseId_fk`：`FOREIGN KEY ("courseReleaseId") REFERENCES "CourseRelease"(id)`
- `domain_SaleOffer_eventTicketId_fk`：`FOREIGN KEY ("eventTicketId") REFERENCES "EventTicketType"(id)`
- `domain_SaleOffer_giftId_fk`：`FOREIGN KEY ("giftId") REFERENCES "VirtualGift"(id)`
- `domain_SaleOffer_membershipVersionId_fk`：`FOREIGN KEY ("membershipVersionId") REFERENCES "MembershipPlanVersion"(id)`
- `domain_SaleOffer_operatingServiceId_fk`：`FOREIGN KEY ("operatingServiceId") REFERENCES "OperatingService"(id)`
- `domain_SaleOffer_serviceOfferingId_fk`：`FOREIGN KEY ("serviceOfferingId") REFERENCES "ServiceOffering"(id)`
- `domain_SaleOffer_skuId_fk`：`FOREIGN KEY ("skuId") REFERENCES "ProductSku"(id)`

索引：
- `CREATE INDEX "domain_SaleOffer_idx_0" ON public."SaleOffer" USING btree (kind, active)`

### ServiceOffering / service_offering

一对一与见面服务定义，同商城服务共用

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|teacherId|text|是|—|teacher.id；通用可写|
|title|text|是|—|通用可写|
|mode|text|是|—|通用可写|
|durationMinutes|integer|是|—|通用可写|
|leadMinutes|integer|是|—|通用可写|
|cancelBeforeMinutes|integer|是|—|通用可写|
|locationPolicy|text|是|—|通用可写|
|deliveryPolicy|text|是|—|通用可写|
|active|boolean|是|false|通用可写|

约束：
- `ServiceOffering_pkey`：`PRIMARY KEY (id)`
- `ServiceOffering_version_check`：`CHECK (version > 0)`
- `domain_ServiceOffering_0`：`CHECK (mode = ANY (ARRAY['PHONE'::text, 'EXTERNAL_MEETING'::text, 'ONSITE'::text, 'IN_APP_RTC'::text]))`
- `domain_ServiceOffering_1`：`CHECK ("durationMinutes" > 0 AND "leadMinutes" >= 0 AND "cancelBeforeMinutes" >= 0)`
- `domain_ServiceOffering_2`：`UNIQUE (id, "teacherId")`
- `domain_ServiceOffering_teacherId_fk`：`FOREIGN KEY ("teacherId") REFERENCES "Teacher"(id)`

索引：

### Settlement / settlement

合作方月度或推广提现结算单，人工复核和实际打款

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|partnerId|text|否|—|partner.id；通用可写|
|promoterId|text|否|—|app_user.id；通用可写|
|periodStart|date|是|—|通用可写|
|periodEnd|date|是|—|通用可写|
|currency|character(3)|是|—|通用可写|
|grossAmount|bigint|是|—|通用可写|
|feeAmount|bigint|是|—|通用可写|
|refundAmount|bigint|是|—|通用可写|
|netAmount|bigint|是|—|通用可写|
|state|text|是|—|通用可写|
|reviewerId|text|否|—|app_user.id|
|paidAt|timestamp with time zone|否|—|通用可写|
|transferId|text|否|—|通用可写|
|proofAssetId|text|否|—|media_asset.id；通用可写|

约束：
- `Settlement_pkey`：`PRIMARY KEY (id)`
- `Settlement_transferId_key`：`UNIQUE ("transferId")`
- `Settlement_version_check`：`CHECK (version > 0)`
- `domain_Settlement_0`：`CHECK (num_nonnulls("partnerId", "promoterId") = 1)`
- `domain_Settlement_1`：`CHECK ("periodEnd" >= "periodStart")`
- `domain_Settlement_2`：`CHECK ("grossAmount" >= 0 AND "feeAmount" >= 0 AND "refundAmount" >= 0)`
- `domain_Settlement_3`：`CHECK ("netAmount" = ("grossAmount" - "feeAmount" - "refundAmount"))`
- `domain_Settlement_partnerId_fk`：`FOREIGN KEY ("partnerId") REFERENCES "Partner"(id)`
- `domain_Settlement_promoterId_fk`：`FOREIGN KEY ("promoterId") REFERENCES "User"(id)`
- `domain_Settlement_proofAssetId_fk`：`FOREIGN KEY ("proofAssetId") REFERENCES "MediaAsset"(id)`
- `domain_Settlement_reviewerId_fk`：`FOREIGN KEY ("reviewerId") REFERENCES "User"(id)`

索引：
- `CREATE INDEX "domain_Settlement_idx_0" ON public."Settlement" USING btree ("partnerId", "periodStart")`
- `CREATE INDEX "domain_Settlement_idx_1" ON public."Settlement" USING btree ("promoterId", "periodStart")`

### SettlementItem / settlement_item

每个收款/退款来源结算一次，差额结算用新事件

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|settlementId|text|是|—|settlement.id；通用可写|
|orderItemId|text|是|—|order_item.id；通用可写|
|eventKey|text|是|—|通用可写|
|contractId|text|否|—|partner_contract.id；通用可写|
|delta|bigint|是|—|通用可写|
|basisSnapshot|jsonb|是|—|通用可写|
|currency|character(3)|是|—|通用可写|
|commissionId|text|否|—|commission_ledger.id；通用可写|
|giftAllocationId|text|否|—|gift_credit_allocation.id；通用可写|

约束：
- `SettlementItem_commissionId_key`：`UNIQUE ("commissionId")`
- `SettlementItem_eventKey_key`：`UNIQUE ("eventKey")`
- `SettlementItem_giftAllocationId_key`：`UNIQUE ("giftAllocationId")`
- `SettlementItem_pkey`：`PRIMARY KEY (id)`
- `domain_SettlementItem_commissionId_fk`：`FOREIGN KEY ("commissionId") REFERENCES "CommissionLedger"(id)`
- `domain_SettlementItem_contractId_fk`：`FOREIGN KEY ("contractId") REFERENCES "PartnerContract"(id)`
- `domain_SettlementItem_giftAllocationId_fk`：`FOREIGN KEY ("giftAllocationId") REFERENCES "GiftCreditAllocation"(id)`
- `domain_SettlementItem_orderItemId_fk`：`FOREIGN KEY ("orderItemId") REFERENCES "TradeOrderItem"(id)`
- `domain_SettlementItem_settlementId_fk`：`FOREIGN KEY ("settlementId") REFERENCES "Settlement"(id)`

索引：
- `CREATE INDEX "domain_SettlementItem_idx_0" ON public."SettlementItem" USING btree ("settlementId")`

### Shipment / shipment

真实包裹、承运商单号签收及交换履约

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|orderId|text|是|—|trade_order.id；通用可写|
|refundId|text|否|—|refund.id；通用可写|
|kind|text|是|—|通用可写|
|carrierCode|text|是|—|通用可写|
|trackingNo|text|是|—|通用可写|
|state|text|是|—|通用可写|
|addressSnapshotCipher|text|是|—|查询隐藏；通用可写|
|shippedAt|timestamp with time zone|否|—|通用可写|
|deliveredAt|timestamp with time zone|否|—|通用可写|
|trackingSnapshot|jsonb|否|—|查询隐藏|
|actorId|text|是|—|app_user.id|

约束：
- `Shipment_pkey`：`PRIMARY KEY (id)`
- `Shipment_version_check`：`CHECK (version > 0)`
- `domain_Shipment_0`：`CHECK (kind = ANY (ARRAY['OUTBOUND'::text, 'RETURN'::text, 'EXCHANGE'::text]))`
- `domain_Shipment_1`：`UNIQUE ("carrierCode", "trackingNo")`
- `domain_Shipment_actorId_fk`：`FOREIGN KEY ("actorId") REFERENCES "User"(id)`
- `domain_Shipment_orderId_fk`：`FOREIGN KEY ("orderId") REFERENCES "TradeOrder"(id)`
- `domain_Shipment_refundId_fk`：`FOREIGN KEY ("refundId") REFERENCES "Refund"(id)`

索引：
- `CREATE INDEX "domain_Shipment_idx_0" ON public."Shipment" USING btree ("orderId", state)`

### ShipmentItem / shipment_item

一单多包裹/退换件逐项数量

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|shipmentId|text|是|—|shipment.id；通用可写|
|orderItemId|text|是|—|order_item.id；通用可写|
|quantity|integer|是|—|通用可写|

约束：
- `ShipmentItem_pkey`：`PRIMARY KEY (id)`
- `domain_ShipmentItem_0`：`UNIQUE ("shipmentId", "orderItemId")`
- `domain_ShipmentItem_1`：`CHECK (quantity > 0)`
- `domain_ShipmentItem_orderItemId_fk`：`FOREIGN KEY ("orderItemId") REFERENCES "TradeOrderItem"(id)`
- `domain_ShipmentItem_shipmentId_fk`：`FOREIGN KEY ("shipmentId") REFERENCES "Shipment"(id)`

索引：

### ShippingZone / delivery_zone

区域覆盖与基础/附加/续件费及优先配送

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|templateId|text|是|—|delivery_template.id；通用可写|
|regionCode|text|是|—|通用可写|
|baseFee|bigint|是|—|通用可写|
|surcharge|bigint|是|0|通用可写|
|incrementFee|bigint|是|0|通用可写|
|freeAbove|bigint|否|—|通用可写|
|priorityFee|bigint|否|—|通用可写|
|enabled|boolean|是|false|通用可写|

约束：
- `ShippingZone_pkey`：`PRIMARY KEY (id)`
- `ShippingZone_version_check`：`CHECK (version > 0)`
- `domain_ShippingZone_0`：`UNIQUE ("templateId", "regionCode")`
- `domain_ShippingZone_1`：`CHECK ("baseFee" >= 0 AND surcharge >= 0 AND "incrementFee" >= 0)`
- `domain_ShippingZone_2`：`CHECK ("freeAbove" IS NULL OR "freeAbove" >= 0)`
- `domain_ShippingZone_3`：`CHECK ("priorityFee" IS NULL OR "priorityFee" >= 0)`
- `domain_ShippingZone_templateId_fk`：`FOREIGN KEY ("templateId") REFERENCES "DeliveryTemplate"(id)`

索引：

### SourceEvidence / source_evidence

经典版本、译注版权、名师背景、文化溯源及资质证据

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|kind|text|是|—|通用可写|
|title|text|是|—|通用可写|
|author|text|否|—|通用可写|
|edition|text|否|—|通用可写|
|sourceUrl|text|否|—|通用可写|
|proofAssetId|text|否|—|media_asset.id；通用可写|
|rightsHolder|text|否|—|通用可写|
|licenseScope|text|否|—|通用可写|
|validFrom|timestamp with time zone|否|—|通用可写|
|validUntil|timestamp with time zone|否|—|通用可写|
|reviewState|text|是|—|通用可写|
|reviewerId|text|否|—|app_user.id|
|reviewNote|text|否|—|通用可写|

约束：
- `SourceEvidence_pkey`：`PRIMARY KEY (id)`
- `SourceEvidence_version_check`：`CHECK (version > 0)`
- `domain_SourceEvidence_0`：`CHECK ("validUntil" IS NULL OR "validFrom" IS NULL OR "validUntil" > "validFrom")`
- `domain_SourceEvidence_proofAssetId_fk`：`FOREIGN KEY ("proofAssetId") REFERENCES "MediaAsset"(id)`
- `domain_SourceEvidence_reviewerId_fk`：`FOREIGN KEY ("reviewerId") REFERENCES "User"(id)`

索引：

### StudyEvent / study_event

客户端持久队列的幂等学习事实

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|—||
|userId|text|是|—|app_user.id；通用可写|
|lessonId|text|是|—|lesson.id；通用可写|
|payloadHash|text|是|—|查询隐藏|
|result|jsonb|是|—|通用可写|
|createdAt|timestamp(3) without time zone|是|CURRENT_TIMESTAMP||
|receivedAt|timestamp with time zone|是|now()|通用可写|

约束：
- `StudyEvent_pkey`：`PRIMARY KEY (id)`
- `domain_StudyEvent_0`：`UNIQUE ("userId", id)`
- `StudyEvent_lessonId_fkey`：`FOREIGN KEY ("lessonId") REFERENCES "Lesson"(id) ON UPDATE CASCADE ON DELETE CASCADE`
- `StudyEvent_userId_fkey`：`FOREIGN KEY ("userId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE CASCADE`
- `domain_StudyEvent_lessonId_fk`：`FOREIGN KEY ("lessonId") REFERENCES "Lesson"(id)`
- `domain_StudyEvent_userId_fk`：`FOREIGN KEY ("userId") REFERENCES "User"(id)`

索引：
- `CREATE INDEX "domain_StudyEvent_idx_0" ON public."StudyEvent" USING btree ("lessonId", "receivedAt")`

### StudyProgress / study_progress

一用户一发布版章节的续播及完成

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|—||
|userId|text|是|—|app_user.id；通用可写|
|lessonId|text|是|—|lesson.id；通用可写|
|positionSeconds|integer|是|0|通用可写|
|watchedSeconds|integer|是|0|通用可写|
|completedAt|timestamp(3) without time zone|否|—|通用可写|
|updatedAt|timestamp(3) without time zone|是|—||
|createdAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|lastEventAt|timestamp with time zone|否|—|通用可写|
|deviceId|text|否|—|通用可写|

约束：
- `StudyProgress_pkey`：`PRIMARY KEY (id)`
- `StudyProgress_version_check`：`CHECK (version > 0)`
- `domain_StudyProgress_0`：`UNIQUE ("userId", "lessonId")`
- `domain_StudyProgress_1`：`CHECK ("positionSeconds" >= 0 AND "watchedSeconds" >= 0)`
- `StudyProgress_lessonId_fkey`：`FOREIGN KEY ("lessonId") REFERENCES "Lesson"(id) ON UPDATE CASCADE ON DELETE CASCADE`
- `StudyProgress_userId_fkey`：`FOREIGN KEY ("userId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE CASCADE`
- `domain_StudyProgress_lessonId_fk`：`FOREIGN KEY ("lessonId") REFERENCES "Lesson"(id)`
- `domain_StudyProgress_userId_fk`：`FOREIGN KEY ("userId") REFERENCES "User"(id)`

索引：
- `CREATE UNIQUE INDEX "StudyProgress_userId_lessonId_key" ON public."StudyProgress" USING btree ("userId", "lessonId")`
- `CREATE INDEX "domain_StudyProgress_idx_0" ON public."StudyProgress" USING btree ("userId", "updatedAt")`

### Submission / submission

学员作业修订版本，附件绑定媒体

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|assignmentId|text|是|—|assignment.id；通用可写|
|userId|text|是|—|app_user.id；通用可写|
|revision|integer|是|—|通用可写|
|body|text|是|—|通用可写|
|state|text|是|—|通用可写|
|submittedAt|timestamp with time zone|是|—||

约束：
- `Submission_pkey`：`PRIMARY KEY (id)`
- `Submission_version_check`：`CHECK (version > 0)`
- `domain_Submission_0`：`UNIQUE ("assignmentId", "userId", revision)`
- `domain_Submission_1`：`CHECK (revision > 0)`
- `domain_Submission_assignmentId_fk`：`FOREIGN KEY ("assignmentId") REFERENCES "Assignment"(id)`
- `domain_Submission_userId_fk`：`FOREIGN KEY ("userId") REFERENCES "User"(id)`

索引：
- `CREATE INDEX "domain_Submission_idx_0" ON public."Submission" USING btree ("assignmentId", state, "submittedAt")`

### Tag / tag

兴趣和资源标签字典

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|code|text|是|—|通用可写|
|name|text|是|—|通用可写|
|parentId|text|否|—|tag.id；通用可写|
|active|boolean|是|true|通用可写|

约束：
- `Tag_code_key`：`UNIQUE (code)`
- `Tag_pkey`：`PRIMARY KEY (id)`
- `Tag_version_check`：`CHECK (version > 0)`
- `domain_Tag_parentId_fk`：`FOREIGN KEY ("parentId") REFERENCES "Tag"(id)`

索引：

### Teacher / teacher

名师审核档案，账号绑定与后台角色分开

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|—||
|name|text|是|—|通用可写|
|title|text|是|—|通用可写|
|bio|text|是|—|通用可写|
|portrait|text|否|—|通用可写|
|expertise|text[]|否|—|通用可写|
|status|"PublishStatus"|是|'DRAFT'::"PublishStatus"|通用可写|
|isDemo|boolean|是|false|通用可写|
|createdAt|timestamp(3) without time zone|是|CURRENT_TIMESTAMP||
|updatedAt|timestamp(3) without time zone|是|—||
|version|integer|是|1||
|resourceKind|text|是|'TEACHER'::text||
|userId|text|否|—|app_user.id；通用可写|
|lineageSummary|text|否|—|通用可写|
|achievementSummary|text|否|—|通用可写|
|teachingDirection|text|是|''::text|通用可写|
|servicePolicy|text|否|—|通用可写|
|portraitAssetId|text|否|—|media_asset.id；通用可写|

约束：
- `Teacher_pkey`：`PRIMARY KEY (id)`
- `Teacher_resourceKind_check`：`CHECK ("resourceKind" = 'TEACHER'::text)`
- `Teacher_userId_key`：`UNIQUE ("userId")`
- `domain_Teacher_0`：`FOREIGN KEY (id, "resourceKind") REFERENCES "Resource"(id, kind)`
- `domain_Teacher_portraitAssetId_fk`：`FOREIGN KEY ("portraitAssetId") REFERENCES "MediaAsset"(id)`
- `domain_Teacher_userId_fk`：`FOREIGN KEY ("userId") REFERENCES "User"(id)`

索引：

### TeacherAnswer / teacher_answer

答复版本及审核，精选标记

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|questionId|text|是|—|teacher_question.id；通用可写|
|authorId|text|是|—|app_user.id；通用可写|
|body|text|是|—|通用可写|
|assetId|text|否|—|media_asset.id；通用可写|
|reviewState|text|是|—|通用可写|
|featured|boolean|是|false|通用可写|
|reviewerId|text|否|—|app_user.id|

约束：
- `TeacherAnswer_pkey`：`PRIMARY KEY (id)`
- `TeacherAnswer_version_check`：`CHECK (version > 0)`
- `domain_TeacherAnswer_assetId_fk`：`FOREIGN KEY ("assetId") REFERENCES "MediaAsset"(id)`
- `domain_TeacherAnswer_authorId_fk`：`FOREIGN KEY ("authorId") REFERENCES "User"(id)`
- `domain_TeacherAnswer_questionId_fk`：`FOREIGN KEY ("questionId") REFERENCES "TeacherQuestion"(id)`
- `domain_TeacherAnswer_reviewerId_fk`：`FOREIGN KEY ("reviewerId") REFERENCES "User"(id)`

索引：
- `CREATE INDEX "domain_TeacherAnswer_idx_0" ON public."TeacherAnswer" USING btree ("questionId", "createdAt")`

### TeacherQuestion / teacher_question

私问或申请公开，会员问答额度关联

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|teacherId|text|是|—|teacher.id；通用可写|
|userId|text|是|—|app_user.id；通用可写|
|body|text|是|—|通用可写|
|visibility|text|是|—|通用可写|
|state|text|是|—|通用可写|
|benefitUsageId|text|否|—|benefit_usage.id；通用可写|
|answeredAt|timestamp with time zone|否|—||

约束：
- `TeacherQuestion_pkey`：`PRIMARY KEY (id)`
- `TeacherQuestion_version_check`：`CHECK (version > 0)`
- `domain_TeacherQuestion_0`：`CHECK (visibility = ANY (ARRAY['PRIVATE'::text, 'PUBLIC'::text]))`
- `domain_TeacherQuestion_1`：`CHECK (state = ANY (ARRAY['OPEN'::text, 'ANSWERED'::text, 'CLOSED'::text, 'REJECTED'::text]))`
- `domain_TeacherQuestion_benefitUsageId_fk`：`FOREIGN KEY ("benefitUsageId") REFERENCES "BenefitUsage"(id)`
- `domain_TeacherQuestion_teacherId_fk`：`FOREIGN KEY ("teacherId") REFERENCES "Teacher"(id)`
- `domain_TeacherQuestion_userId_fk`：`FOREIGN KEY ("userId") REFERENCES "User"(id)`

索引：
- `CREATE INDEX "domain_TeacherQuestion_idx_0" ON public."TeacherQuestion" USING btree ("teacherId", state, "createdAt")`
- `CREATE INDEX "domain_TeacherQuestion_idx_1" ON public."TeacherQuestion" USING btree ("userId", "createdAt")`

### TeacherReview / teacher_review

作业或实践点评，恰好一个来源

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|submissionId|text|否|—|submission.id；通用可写|
|checkinId|text|否|—|practice_checkin.id；通用可写|
|reviewerId|text|是|—|app_user.id|
|body|text|是|—|通用可写|
|score|integer|否|—|通用可写|
|state|text|是|—|通用可写|
|reviewedAt|timestamp with time zone|是|—||

约束：
- `TeacherReview_pkey`：`PRIMARY KEY (id)`
- `TeacherReview_version_check`：`CHECK (version > 0)`
- `domain_TeacherReview_0`：`CHECK (num_nonnulls("submissionId", "checkinId") = 1)`
- `domain_TeacherReview_1`：`CHECK (score IS NULL OR score >= 0 AND score <= 100)`
- `domain_TeacherReview_checkinId_fk`：`FOREIGN KEY ("checkinId") REFERENCES "PracticeCheckin"(id)`
- `domain_TeacherReview_reviewerId_fk`：`FOREIGN KEY ("reviewerId") REFERENCES "User"(id)`
- `domain_TeacherReview_submissionId_fk`：`FOREIGN KEY ("submissionId") REFERENCES "Submission"(id)`

索引：
- `CREATE INDEX "domain_TeacherReview_idx_0" ON public."TeacherReview" USING btree ("submissionId")`
- `CREATE INDEX "domain_TeacherReview_idx_1" ON public."TeacherReview" USING btree ("checkinId")`

### TeacherStaff / teacher_staff

名师助理资源范围委派

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|teacherId|text|是|—|teacher.id；通用可写|
|userId|text|是|—|app_user.id；通用可写|
|scopeCodes|text[]|是|—|通用可写|
|revokedAt|timestamp with time zone|否|—|通用可写|

约束：
- `TeacherStaff_pkey`：`PRIMARY KEY (id)`
- `TeacherStaff_version_check`：`CHECK (version > 0)`
- `domain_TeacherStaff_teacherId_fk`：`FOREIGN KEY ("teacherId") REFERENCES "Teacher"(id)`
- `domain_TeacherStaff_userId_fk`：`FOREIGN KEY ("userId") REFERENCES "User"(id)`

索引：
- `CREATE UNIQUE INDEX "domain_TeacherStaff_idx_0" ON public."TeacherStaff" USING btree ("teacherId", "userId") WHERE ("revokedAt" IS NULL)`

### TradeOrder / trade_order

订单商务状态与支付/退款分离；不同履约种类不混单

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|orderNo|text|是|—|通用可写|
|userId|text|是|—|app_user.id；通用可写|
|kind|text|是|—|通用可写|
|requestKey|text|是|—|通用可写|
|requestHash|text|是|—|查询隐藏|
|state|text|是|'PENDING'::text|通用可写|
|currency|character(3)|是|—|通用可写|
|minorExponent|integer|是|2|通用可写|
|subtotal|bigint|是|—|通用可写|
|discountTotal|bigint|是|0|通用可写|
|shippingTotal|bigint|是|0|通用可写|
|payableTotal|bigint|是|—|通用可写|
|paidTotal|bigint|是|0|通用可写|
|refundedTotal|bigint|是|0|通用可写|
|addressSnapshotCipher|text|否|—|查询隐藏；通用可写|
|pricingSnapshot|jsonb|是|—|查询隐藏|
|quoteHash|text|是|—|查询隐藏|
|expiresAt|timestamp with time zone|是|—|通用可写|
|paidAt|timestamp with time zone|否|—|通用可写|
|closedAt|timestamp with time zone|否|—|通用可写|
|completedAt|timestamp with time zone|否|—|通用可写|
|closeReason|text|否|—|通用可写|

约束：
- `TradeOrder_orderNo_key`：`UNIQUE ("orderNo")`
- `TradeOrder_pkey`：`PRIMARY KEY (id)`
- `TradeOrder_version_check`：`CHECK (version > 0)`
- `domain_TradeOrder_0`：`UNIQUE ("userId", "requestKey")`
- `domain_TradeOrder_1`：`CHECK (state = ANY (ARRAY['PENDING'::text, 'PAID'::text, 'FULFILLING'::text, 'COMPLETED'::text, 'CLOSED'::text]))`
- `domain_TradeOrder_2`：`CHECK (subtotal >= 0 AND "discountTotal" >= 0 AND "shippingTotal" >= 0 AND "payableTotal" = (subtotal - "discountTotal" + "shippingTotal") AND "payableTotal" >= 0)`
- `domain_TradeOrder_3`：`CHECK ("paidTotal" >= 0 AND "refundedTotal" >= 0 AND "refundedTotal" <= "paidTotal")`
- `domain_TradeOrder_4`：`CHECK (kind = ANY (ARRAY['COURSE'::text, 'PHYSICAL'::text, 'DIGITAL'::text, 'MEMBERSHIP'::text, 'CONSULTATION'::text, 'EVENT'::text, 'GIFT'::text, 'OPERATING_SERVICE'::text]))`
- `domain_TradeOrder_userId_fk`：`FOREIGN KEY ("userId") REFERENCES "User"(id)`

索引：
- `CREATE INDEX "domain_TradeOrder_idx_0" ON public."TradeOrder" USING btree ("userId", "createdAt", id)`
- `CREATE INDEX "domain_TradeOrder_idx_1" ON public."TradeOrder" USING btree (state, "expiresAt")`

### TradeOrderItem / order_item

逐项价格、权益、合作方、履约及折扣运费快照

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|orderId|text|是|—|trade_order.id；通用可写|
|lineNo|integer|是|—|通用可写|
|offerId|text|是|—|sale_offer.id；通用可写|
|quantity|integer|是|—|通用可写|
|unitPrice|bigint|是|—|通用可写|
|subtotal|bigint|是|—|通用可写|
|discountAllocated|bigint|是|0|通用可写|
|shippingAllocated|bigint|是|0|通用可写|
|payable|bigint|是|—|通用可写|
|refundedAmount|bigint|是|0|通用可写|
|itemSnapshot|jsonb|是|—|查询隐藏|
|benefitSnapshot|jsonb|是|—|通用可写|
|contractVersionId|text|否|—|partner_contract.id；通用可写|
|referralSnapshot|jsonb|否|—|通用可写|
|slotId|text|否|—|appointment_slot.id；通用可写|
|state|text|是|—|通用可写|
|digitalReleaseId|text|否|—|digital_release.id；通用可写|
|courseReleaseId|text|否|—|course_release.id；通用可写|
|membershipVersionId|text|否|—|membership_plan_version.id；通用可写|

约束：
- `TradeOrderItem_pkey`：`PRIMARY KEY (id)`
- `TradeOrderItem_version_check`：`CHECK (version > 0)`
- `domain_TradeOrderItem_0`：`UNIQUE ("orderId", "lineNo")`
- `domain_TradeOrderItem_1`：`CHECK (quantity >= 1 AND quantity <= 99)`
- `domain_TradeOrderItem_2`：`CHECK ("unitPrice" >= 0 AND subtotal = ("unitPrice" * quantity))`
- `domain_TradeOrderItem_3`：`CHECK ("discountAllocated" >= 0 AND "shippingAllocated" >= 0 AND payable = (subtotal - "discountAllocated" + "shippingAllocated") AND payable >= 0)`
- `domain_TradeOrderItem_4`：`CHECK ("refundedAmount" >= 0 AND "refundedAmount" <= payable)`
- `domain_TradeOrderItem_contractVersionId_fk`：`FOREIGN KEY ("contractVersionId") REFERENCES "PartnerContract"(id)`
- `domain_TradeOrderItem_courseReleaseId_fk`：`FOREIGN KEY ("courseReleaseId") REFERENCES "CourseRelease"(id)`
- `domain_TradeOrderItem_digitalReleaseId_fk`：`FOREIGN KEY ("digitalReleaseId") REFERENCES "DigitalRelease"(id)`
- `domain_TradeOrderItem_membershipVersionId_fk`：`FOREIGN KEY ("membershipVersionId") REFERENCES "MembershipPlanVersion"(id)`
- `domain_TradeOrderItem_offerId_fk`：`FOREIGN KEY ("offerId") REFERENCES "SaleOffer"(id)`
- `domain_TradeOrderItem_orderId_fk`：`FOREIGN KEY ("orderId") REFERENCES "TradeOrder"(id)`
- `domain_TradeOrderItem_slotId_fk`：`FOREIGN KEY ("slotId") REFERENCES "AppointmentSlot"(id)`

索引：
- `CREATE INDEX course_sales_order_release ON public."TradeOrderItem" USING btree ("courseReleaseId", "orderId")`
- `CREATE INDEX "domain_TradeOrderItem_idx_0" ON public."TradeOrderItem" USING btree ("offerId")`
- `CREATE INDEX "domain_TradeOrderItem_idx_1" ON public."TradeOrderItem" USING btree ("orderId", state)`

### User / app_user

游客之外的统一账号，注销保留匿名交易主体

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|—||
|phone|text|否|—|查询隐藏|
|username|text|否|—||
|passwordHash|text|否|—|查询隐藏|
|nickname|text|是|—|通用可写|
|avatar|text|否|—|通用可写|
|tags|text[]|否|—|通用可写|
|roles|"Role"[]|否|ARRAY['USER'::"Role"]||
|status|"AccountStatus"|是|'ACTIVE'::"AccountStatus"|通用可写|
|createdAt|timestamp(3) without time zone|是|CURRENT_TIMESTAMP||
|updatedAt|timestamp(3) without time zone|是|—||
|version|integer|是|1||
|phoneCipher|text|否|—|查询隐藏|
|phoneHash|text|否|—|查询隐藏|
|avatarAssetId|text|否|—|media_asset.id；通用可写|
|deletedAt|timestamp with time zone|否|—||
|lastSeenAt|timestamp with time zone|否|—||

约束：
- `User_phoneHash_key`：`UNIQUE ("phoneHash")`
- `User_pkey`：`PRIMARY KEY (id)`
- `User_version_check`：`CHECK (version > 0)`
- `domain_User_0`：`CHECK (status = ANY (ARRAY['ACTIVE'::"AccountStatus", 'FROZEN'::"AccountStatus", 'DELETED'::"AccountStatus"]))`
- `domain_User_1`：`CHECK ((status = 'DELETED'::"AccountStatus") = ("deletedAt" IS NOT NULL))`
- `domain_User_avatarAssetId_fk`：`FOREIGN KEY ("avatarAssetId") REFERENCES "MediaAsset"(id)`

索引：
- `CREATE UNIQUE INDEX "User_phone_key" ON public."User" USING btree (phone)`
- `CREATE UNIQUE INDEX "User_username_key" ON public."User" USING btree (username)`

### UserBlock / user_block

本人拉黑关系

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|userId|text|是|—|app_user.id；通用可写|
|blockedId|text|是|—|app_user.id；通用可写|

约束：
- `UserBlock_pkey`：`PRIMARY KEY (id)`
- `domain_UserBlock_0`：`UNIQUE ("userId", "blockedId")`
- `domain_UserBlock_1`：`CHECK ("userId" <> "blockedId")`
- `domain_UserBlock_blockedId_fk`：`FOREIGN KEY ("blockedId") REFERENCES "User"(id)`
- `domain_UserBlock_userId_fk`：`FOREIGN KEY ("userId") REFERENCES "User"(id)`

索引：

### UserCoupon / user_coupon

券领取锁定核销退回

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|templateId|text|是|—|coupon_template.id；通用可写|
|userId|text|是|—|app_user.id；通用可写|
|claimKey|text|是|—|通用可写|
|state|text|是|—|通用可写|
|expiresAt|timestamp with time zone|是|—|通用可写|
|lockedOrderId|text|否|—|trade_order.id；通用可写|
|usedOrderId|text|否|—|trade_order.id；通用可写|
|termsSnapshot|jsonb|是|—|通用可写|
|redeemKey|text|否|—|通用可写|

约束：
- `UserCoupon_claimKey_key`：`UNIQUE ("claimKey")`
- `UserCoupon_pkey`：`PRIMARY KEY (id)`
- `UserCoupon_redeemKey_key`：`UNIQUE ("redeemKey")`
- `UserCoupon_version_check`：`CHECK (version > 0)`
- `domain_UserCoupon_0`：`CHECK (state = ANY (ARRAY['AVAILABLE'::text, 'LOCKED'::text, 'USED'::text, 'EXPIRED'::text, 'REVOKED'::text]))`
- `domain_UserCoupon_lockedOrderId_fk`：`FOREIGN KEY ("lockedOrderId") REFERENCES "TradeOrder"(id)`
- `domain_UserCoupon_templateId_fk`：`FOREIGN KEY ("templateId") REFERENCES "CouponTemplate"(id)`
- `domain_UserCoupon_usedOrderId_fk`：`FOREIGN KEY ("usedOrderId") REFERENCES "TradeOrder"(id)`
- `domain_UserCoupon_userId_fk`：`FOREIGN KEY ("userId") REFERENCES "User"(id)`

索引：
- `CREATE INDEX "domain_UserCoupon_idx_0" ON public."UserCoupon" USING btree ("userId", state, "expiresAt")`
- `CREATE UNIQUE INDEX "domain_UserCoupon_idx_1" ON public."UserCoupon" USING btree ("usedOrderId") WHERE ("usedOrderId" IS NOT NULL)`

### UserRestriction / user_restriction

禁言封禁跨入口统一执行

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|userId|text|是|—|app_user.id；通用可写|
|resourceId|text|否|—|resource.id；通用可写|
|scope|text|是|—|通用可写|
|startsAt|timestamp with time zone|是|—|通用可写|
|endsAt|timestamp with time zone|否|—|通用可写|
|actionId|text|是|—|moderation_action.id；通用可写|
|revokedAt|timestamp with time zone|否|—|通用可写|

约束：
- `UserRestriction_pkey`：`PRIMARY KEY (id)`
- `UserRestriction_version_check`：`CHECK (version > 0)`
- `domain_UserRestriction_0`：`CHECK ("endsAt" IS NULL OR "endsAt" > "startsAt")`
- `domain_UserRestriction_actionId_fk`：`FOREIGN KEY ("actionId") REFERENCES "ModerationAction"(id)`
- `domain_UserRestriction_resourceId_fk`：`FOREIGN KEY ("resourceId") REFERENCES "Resource"(id)`
- `domain_UserRestriction_userId_fk`：`FOREIGN KEY ("userId") REFERENCES "User"(id)`

索引：
- `CREATE INDEX "domain_UserRestriction_idx_0" ON public."UserRestriction" USING btree ("userId", scope, "endsAt")`

### UserRole / user_role

多角色授予；老师资源归属仍由teacher_staff/course_staff约束

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|userId|text|是|—|app_user.id；通用可写|
|roleId|text|是|—|access_role.id；通用可写|
|grantedBy|text|是|—|app_user.id|
|reason|text|是|—|通用可写|
|revokedAt|timestamp with time zone|否|—|通用可写|

约束：
- `UserRole_pkey`：`PRIMARY KEY (id)`
- `UserRole_version_check`：`CHECK (version > 0)`
- `domain_UserRole_grantedBy_fk`：`FOREIGN KEY ("grantedBy") REFERENCES "User"(id)`
- `domain_UserRole_roleId_fk`：`FOREIGN KEY ("roleId") REFERENCES "AccessRole"(id)`
- `domain_UserRole_userId_fk`：`FOREIGN KEY ("userId") REFERENCES "User"(id)`

索引：
- `CREATE UNIQUE INDEX "domain_UserRole_idx_0" ON public."UserRole" USING btree ("userId", "roleId") WHERE ("revokedAt" IS NULL)`

### UserTag / user_tag

用户自主兴趣

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|userId|text|是|—|app_user.id；通用可写|
|tagId|text|是|—|tag.id；通用可写|

约束：
- `UserTag_pkey`：`PRIMARY KEY (id)`
- `domain_UserTag_0`：`UNIQUE ("userId", "tagId")`
- `domain_UserTag_tagId_fk`：`FOREIGN KEY ("tagId") REFERENCES "Tag"(id)`
- `domain_UserTag_userId_fk`：`FOREIGN KEY ("userId") REFERENCES "User"(id)`

索引：

### VirtualGift / virtual_gift

古风礼物商品和消费单位，价格由offer决定

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|code|text|是|—|通用可写|
|title|text|是|—|通用可写|
|iconAssetId|text|否|—|media_asset.id；通用可写|
|creditCost|bigint|是|—|通用可写|
|active|boolean|是|false|通用可写|

约束：
- `VirtualGift_code_key`：`UNIQUE (code)`
- `VirtualGift_pkey`：`PRIMARY KEY (id)`
- `VirtualGift_version_check`：`CHECK (version > 0)`
- `domain_VirtualGift_0`：`CHECK ("creditCost" > 0)`
- `domain_VirtualGift_iconAssetId_fk`：`FOREIGN KEY ("iconAssetId") REFERENCES "MediaAsset"(id)`

索引：

### WithdrawalAllocation / withdrawal_allocation

提现占用佣金明细，失败释放，防同一余额同时申请

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|withdrawalId|text|是|—|withdrawal_request.id；通用可写|
|commissionId|text|是|—|commission_ledger.id；通用可写|
|amount|bigint|是|—|通用可写|
|state|text|是|—|通用可写|

约束：
- `WithdrawalAllocation_pkey`：`PRIMARY KEY (id)`
- `WithdrawalAllocation_version_check`：`CHECK (version > 0)`
- `domain_WithdrawalAllocation_0`：`UNIQUE ("withdrawalId", "commissionId")`
- `domain_WithdrawalAllocation_1`：`CHECK (amount > 0)`
- `domain_WithdrawalAllocation_2`：`CHECK (state = ANY (ARRAY['HELD'::text, 'PAID'::text, 'RELEASED'::text]))`
- `domain_WithdrawalAllocation_commissionId_fk`：`FOREIGN KEY ("commissionId") REFERENCES "CommissionLedger"(id)`
- `domain_WithdrawalAllocation_withdrawalId_fk`：`FOREIGN KEY ("withdrawalId") REFERENCES "WithdrawalRequest"(id)`

索引：
- `CREATE INDEX "domain_WithdrawalAllocation_idx_0" ON public."WithdrawalAllocation" USING btree ("commissionId", state)`

### WithdrawalRequest / withdrawal_request

提现审批不等于付款；记录实际付款及防重复请求

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|userId|text|是|—|app_user.id；通用可写|
|requestKey|text|是|—|通用可写|
|amount|bigint|是|—|通用可写|
|currency|character(3)|是|—|通用可写|
|state|text|是|—|通用可写|
|recipientCipher|text|是|—|查询隐藏；通用可写|
|reviewerId|text|否|—|app_user.id|
|paidAt|timestamp with time zone|否|—|通用可写|
|externalTransferId|text|否|—|通用可写|
|proofAssetId|text|否|—|media_asset.id；通用可写|
|failureCode|text|否|—|通用可写|
|settlementId|text|否|—|settlement.id；通用可写|

约束：
- `WithdrawalRequest_externalTransferId_key`：`UNIQUE ("externalTransferId")`
- `WithdrawalRequest_pkey`：`PRIMARY KEY (id)`
- `WithdrawalRequest_version_check`：`CHECK (version > 0)`
- `domain_WithdrawalRequest_0`：`UNIQUE ("userId", "requestKey")`
- `domain_WithdrawalRequest_1`：`CHECK (amount > 0)`
- `domain_WithdrawalRequest_proofAssetId_fk`：`FOREIGN KEY ("proofAssetId") REFERENCES "MediaAsset"(id)`
- `domain_WithdrawalRequest_reviewerId_fk`：`FOREIGN KEY ("reviewerId") REFERENCES "User"(id)`
- `domain_WithdrawalRequest_settlementId_fk`：`FOREIGN KEY ("settlementId") REFERENCES "Settlement"(id)`
- `domain_WithdrawalRequest_userId_fk`：`FOREIGN KEY ("userId") REFERENCES "User"(id)`

索引：
- `CREATE INDEX "domain_WithdrawalRequest_idx_0" ON public."WithdrawalRequest" USING btree (state, "createdAt")`

### WritingCampaign / writing_campaign

主题征文活动及规则奖品

|字段|数据库类型|必填|数据库默认值|关联/权限|
|---|---|---|---|---|
|id|text|是|(gen_random_uuid())::text||
|createdAt|timestamp with time zone|是|now()||
|updatedAt|timestamp with time zone|是|now()||
|version|integer|是|1||
|title|text|是|—|通用可写|
|sectionId|text|是|—|forum_section.id；通用可写|
|startsAt|timestamp with time zone|是|—|通用可写|
|endsAt|timestamp with time zone|是|—|通用可写|
|rules|jsonb|是|—|通用可写|
|rewardPolicy|jsonb|是|—|通用可写|
|state|text|是|—|通用可写|

约束：
- `WritingCampaign_pkey`：`PRIMARY KEY (id)`
- `WritingCampaign_version_check`：`CHECK (version > 0)`
- `domain_WritingCampaign_0`：`CHECK ("endsAt" > "startsAt")`
- `domain_WritingCampaign_sectionId_fk`：`FOREIGN KEY ("sectionId") REFERENCES "ForumSection"(id)`

索引：

2026-10-11 Apple会员确认约束增补：20261011083000_apple_membership_consents复用TradeOrder/TradeOrderItem/PaymentAttempt/ChannelProductMapping；新增1索引及3个不可变约束触发器，保护Apple会员购买确认与已映射SaleOffer身份/价格。155表（含元数据）不变、25迁移；无生产数据插入或重建。专用流程与实际发布验证见32。


2026-10-13协商退款约束（51）：复用原预约/报名、Refund/RefundItem和预收账本；第38迁移扩展acceptedAt约束，添加BOOKING_DISPUTE同意状态检查与已确认方案不可变触发器、暂停预约索引。金额整数分，沿原用户/订单/资源锁序、幂等请求、持久任务/渠道确认及审计通知。无新表/模型，161表含元数据/160模型保持；38迁移本地应用、规范数据摘要一致。部分退款保留额不自动确认收入；付费履约依A05。


2026-10-13第39迁移（52）：复用TradeOrder/SaleOffer/InventoryReservation/PaymentTransaction/Refund和账本，新增COHORT类型及CohortRegistration.orderItemId唯一外键/suspendedAt；购买身份/原安排与订单项快照不可变，报名需匹配可信收款。新增营期预收及异常待退/收入科目、有效售卖项唯一和订单索引；无新模型/表。39迁移本地应用，161表/160模型，规范数据和普通课程/教学摘要不变。COHORT_SALES_ENABLED默认false，worker持久恢复；正式渠道/iOS/原生和实际履约仍待验收。
