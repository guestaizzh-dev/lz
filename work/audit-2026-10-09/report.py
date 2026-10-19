from pathlib import Path
import json
OUT=Path.cwd()/'outputs/audit-2026-10-09'
stats=json.loads((OUT/'completion-stats.json').read_text(encoding='utf-8'))
tables=json.loads((OUT/'target-schema-data.json').read_text(encoding='utf-8'))
write=lambda n,s:(OUT/n).write_text(s,encoding='utf-8')
append=lambda n,s:(OUT/n).write_text((OUT/n).read_text(encoding='utf-8')+s,encoding='utf-8')
append('01-database-design.md',r'''

## 状态与字段业务字典

列名已经表达类型、空值及关联；以下补充易混淆语义。实现时据此形成DTO枚举、迁移CHECK与状态转移校验，不能只建表不执行规则。

| 字段/领域 | 状态或含义 | 转移与边界 |
|---|---|---|
| publish_state | DRAFT / REVIEW / PUBLISHED / REJECTED / ARCHIVED | 草稿送审，审核通过发布/驳回；已发布下架；重发必须重新核验资产来源；is_demo生产不可售 |
| review_state | PENDING / APPROVED / REJECTED / HIDDEN | 审核可见性独立于用户个人编辑；私人作业不因未公共审核就暴露给论坛 |
| resource.visibility | PUBLIC / MEMBER / COURSE / PRIVATE | 资源类型与可见规则组合校验；课程讨论只有对应课权，PRIVATE仅本人/合法指定服务者 |
| kind / category_code | 类型与分类不同 | ARTICLE四类、COURSE四类、PRODUCT五类、论坛六区、LIVE五类；字典可由feature_config维护，不以分类字符串判断支付路由 |
| source | FREE / ORDER / COMPENSATION / GROWTH_REWARD等 | 独立授权来源不可相互覆盖；会员课权动态计算，不重复生成无限期独立Enrollment |
| sale_offer.kind | COURSE / PHYSICAL / DIGITAL / MEMBERSHIP / CONSULTATION / EVENT / GIFT / OPERATING_SERVICE | 仅一种履约；源FK和kind必须对应。服务SKU需绑定service_offering，数字SKU需固定数字发布版。经营服务R2仅后台创建 |
| trade_order.state | PENDING→PAID→FULFILLING→COMPLETED；PENDING→CLOSED | 已付不可直接CLOSED逃避退款；部分退款仍独立记账，不把“全退”当未曾收款 |
| order_item.state | PENDING / GRANTED / DELIVERING / DELIVERED / CANCELLED / REVOKED | 课程授权、会员生效、实物配送、预约确认分别驱动；整单完成从所有项推导 |
| inventory_reservation.state | HELD→CONVERTED / RELEASED | 销售转化与释放只能发生一次；退款回库是新库存流水，不把CONVERTED改回HELD |
| stock / reserved | stock=未销售总库存，reserved=其中锁定量 | 可售=stock-reserved；付款时stock、reserved同减；关单只减reserved；退货验收后才增stock |
| payment_transaction.disposition | ACCEPTED / DUPLICATE / LATE / AMOUNT_MISMATCH / REFUND_REQUIRED | 只有ACCEPTED驱动正常订单一次授权；异常收款都保留事实和退款/人工处理，不丢弃回调 |
| refund.state | REQUESTED→REVIEW→REJECTED / APPROVED；APPROVED→RETURNING / REFUNDING→SUCCEEDED / FAILED | FAILED可幂等重试；实际退款以refund_transaction为准，APPROVED不是退钱成功；EXCHANGE无现金退款时依换件履约完成 |
| shipment.state | CREATED / SHIPPED / DELIVERED / EXCEPTION / CANCELLED | kind分OUTBOUND / RETURN / EXCHANGE；退件签收要验货才回库存，不以快递签收自动判断合格 |
| appointment.state | PENDING / CONFIRMED / CANCEL_PENDING / CANCELLED / COMPLETED / NO_SHOW | 已确认需走取消退款政策，老师拒绝同样有退款通知，不静默删记录 |
| event_session.state | SCHEDULED / OPEN / FINISHED / CANCELLED / POSTPONED | 延期保留原记录与新场次关联；同意转期或退出有用户动作记录 |
| event_registration.state | PENDING / CONFIRMED / CANCEL_PENDING / CANCELLED / CHECKED_IN | 免费和权益报名同样占席；多名参加者按attendee_no核销，码只存hash |
| course_cohort.state | PLANNED / ENROLLING / RUNNING / COMPLETED / CANCELLED | 开营批次与章节发布版绑定；延期取消有通知补偿和学员退课规则 |
| live_session.state | SCHEDULED / PREPARING / LIVE / ENDED / REPLAY_READY / CANCELLED | 服务商回调为事实，后台有纠正审计；回放审核前不可公开 |
| assignment / practice_task | required标必修，due_at或业务日期规定截止 | 自读标记只代表读过，不自动证明实践质量、专业资格或现金奖励条件 |
| submission.state | DRAFT / SUBMITTED / REVIEWED / RETURNED / WITHDRAWN | 每次修订追加revision，不覆写老师点评所依赖的旧提交 |
| practice_checkin.state | SUBMITTED / VALID / REJECTED / WITHDRAWN | 有效打卡奖励幂等；撤回被奖励的事实要冲正；私人日记不默认计为课程任务完成 |
| benefit_usage.state | HELD / CONSUMED / RELEASED / REVERSED | 额度按会员period、definition、window累计；取消返还，避免同一权益因重复请求多扣 |
| user_coupon.state | AVAILABLE / LOCKED / USED / EXPIRED / REVOKED | 下单锁定、付款核销、超时释放；退款返券按成交时规则，不重新创造新有效期 |
| points_redemption.state | PENDING / DELIVERING / COMPLETED / FAILED / CANCELLED | 积分预占、券/实物/咨询发放；失败回退同一事件，不生成第二份奖励 |
| group_buy.state / member.state | OPEN / SUCCEEDED / FAILED / CANCELLED；PENDING / PAID / REFUNDING / REFUNDED | 团成功才发权；团失败逐笔渠道退款；成员同用户不能占两位 |
| withdrawal / settlement.state | REQUESTED / REVIEW / APPROVED / PAYING / PAID / FAILED / REJECTED | 有实际转账凭证及外部唯一ID才PAID；审批不等于打款，失败解除余额占用 |
| finance_journal / finance_entry | event_key幂等；debit/credit为正向借/贷 | 同journal同币种平衡；收入、渠道费用、合作应付、退款负债等按finance_account目录记账 |
| content_authorization | scope、agreement_version、source_snapshot、granted/revoked | 授权仅指这份内容和用途；私人笔记/日志不受运营精选开关自动公开 |
| outbox_job.state | READY / RUNNING / DONE / DEAD | worker用租约领取，可重试、死信；业务事务与outbox写入同提交 |
| callback / notification_delivery / export.state | RECEIVED/READY、PROCESSING/RUNNING、DONE、FAILED/DEAD | 失败次数和next_retry可见，后台可重放，脱敏错误码不含第三方密钥 |
| feedback / report.state | OPEN / ASSIGNED / PROCESSING / RESOLVED / CLOSED / REJECTED | 用户看得到处理状态；内部备注与私人信息不能由公共接口输出 |

## 必须由事务/触发器执行的跨表约束

数据库CHECK无法代替跨行预算、资源归属及状态机。参考DDL明确给出了可由单行/唯一/FK约束实现的部分；下列是实施时不可遗漏的事务契约。

1. **资源完整性**：resource的kind必须有且只有对应子类型；发布前在同事务核验子类型、来源授权和READY媒体。content_relation允许类型组合由规则表述：文章→名师/课程/直播、课程→商品/活动、直播→课程/商品/活动等。不能将PRIVATE源内容自动变PUBLIC。
2. **版本归属**：文章/课程当前版复合FK已保证版本属于自己；章节位置和stable_key版本内唯一。课程批次、教师委派、作业与打卡的course_id须一致。文章草稿JSON中的媒体须有attachment_binding，发布转换成article_block强FK；不接受任意URL。发布后正文不原地修改。
3. **时段和会员重叠**：参考DDL用btree_gist为同老师的未取消预约时段、同用户未撤销会员时段建立EXCLUDE范围约束。R1咨询slot容量固定1，多人见面会用event。更换服务时段先处理已有预约；升级会员R1排队生效，不重叠赠送/付费时段。使用[starts,ends)避免相邻区间冲突。
4. **原子下单**：锁用户幂等记录→按固定顺序锁SKU/席位/时段/营期→重算价格/权益/券→核对quote_hash→写订单/项快照及预占/账本/outbox。按offer.kind限制同单同履约；可多SKU实物，课程/会员/数字/预约独立。sale_offer的源类型、cohort归属和订单项固定的发布版必须匹配；修改报价返回新确认，不擅自提高扣款。
5. **库存和席位**：预占更新加条件stock-reserved≥qty；时段/营期类似。多票种总confirmed+reserved不可超过event_session.capacity，锁场次后核验票种总和；限购按用户已确认和当前预占计算。促销库存预占不能只改普通SKU；活动价库存需同事务同步promotion_offer，并给reservation业务快照存活动ID。
6. **支付和关单**：核验商户、App、产品、渠道交易、金额币种，payment_transaction唯一渠道事实；同订单仅一个ACCEPTED部分唯一索引。订单行锁决定一次收款接受、库存转销售和权益授予。超时任务先查渠道，再关单。重复/跨渠道成功都写入事实表与财务账，异常退款不产生第二份课权。迟到付款不能履约转退款/补偿；iOS渠道退款能力必须按商店规则，不能伪造自动商户退款。
7. **退款预算**：锁原交易、订单及各项，累计正在批准/退款中/成功金额不得超过可退金额；refund_item必须属于refund.order_id，累计quantity和amount不得超过对应项。退款渠道事实去重。只对ACCEPTED收款的退款冲减trade_order.refunded_total和撤销原项权益；退DUPLICATE等异常收款只处理异常交易账，不误撤正常权益。退货验收后库存回入。兑换/券/积分/佣金同事件幂等冲正。
8. **权益授权**：enrollment、membership_period、digital_delivery、appointment、registration分别以order_item或人工grant_key唯一来源。退一笔订单只能撤这一来源，多来源授权仍有效。会员准入在服务端动态算，资源的会员规则与套餐版本清楚显示；benefit_scope中的指定资源不能把单卖课意外变免费。退款后重算，不由App缓存会员状态绕过。
9. **额度和积分**：问答/活动等权益使用时锁period或独立benefit_grant+权益，按window统计HELD/CONSUMED，确认后扣，取消返。benefit_grant承接成长、积分兑换和人工赠送，固定期限/额度/范围；benefit_usage只能对应会员period或grant之一，两种来源各自校验本人和权益归属。积分账户行锁、唯一event_key、余额与流水同提交。消费按已履约净消费，退款按原规则冲正；首次完成章奖励与打卡/质量奖励各有不同事件键。每日上限按业务日期，并纳入撤回复核。不直接以客户端播放elapsed兑换钱或积分。
10. **论坛和媒体权限**：parent comment必须属于同resource；经典quote必须核验公开可引用版本，不把付费正文引用出去。禁言封禁所有写入口共用检查，block影响列表与互动。帖子、直播评论、媒体URL按所在section/session准入校验；本人作业只对本人及指定老师助教可读。媒体删除前检查资产绑定，留存所需版本不被清理任务误删。
11. **拼团和推广结算**：同团人数/成员支付状态在锁团事务中核验，团价及来源版本快照进order_item。首次有效推广7天、一级、自购不计；一订单只固定一个归因。commission_ledger不更新settlement归属，settlement_item/withdrawal_allocation记录结算和占用关系，锁推广者余额防重复提现。退款增加负流水，已付佣金负余额结转，不抹掉实际转账。
12. **总账平衡**：finance_entry.account_code强FK；可用延迟约束触发器在提交时核验每journal借贷平衡，不能以单行CHECK保证。不同币种不得直接相加；渠道折算、税费和结算币种另留证据。礼物消费按gift_credit_allocation关联充值来源，借/贷gift_ledger必须同钱包且一正一负，按原实付/费用分摊到服务场次与合同；总消费不超过充值可用额，退款冲正不能重复扣已经消费的来源。结算明细汇总必须等于单头，实付凭证才标PAID；过期协议不可给新单分成，旧单保留合同版本。
13. **核销**：registration属于场次，actor属于event_staff且有核销权限；同registration+attendee_no唯一，数量不越界。退款/已取消不可核销，现场网络失败保留幂等请求后同步，不生成两个核销事实。
14. **可靠任务**：业务提交与outbox同事务，任务event_key幂等；worker租约与重试不靠进程timer唯一承担。provider_callback保存验签结果和哈希，乱序回调只允许合法状态推进；失败可重放。通知失败不回滚已经核验的收款。队列Redis仅加速，DB事实可重建任务。

## 数据保留与迁移路线

### 现有29表到目标的映射

| 当前实体 | 目标迁移方向 |
|---|---|
| User / AuthSession / ConsumedRefresh / OtpChallenge / RateLimit | app_user等；保留字符串ID和会话哈希，新增加密检索字段与角色关系；旧手机号先加密/双写，不直接删 |
| Teacher / Article / Course / Product / Event | resource + 对应子表共用原id；核验isDemo、分类及发布状态，强关联不改变既有详情ID |
| Article.blocks / Note / Favorite / PracticeLog | draft_blocks + article_release/block、private_note、reaction、practice_log；迁移保留原blockId、版本、quote和日期；无法匹配原文的笔记保留快照，不伪造FK |
| CourseChapter / CourseRelease / Lesson / Enrollment / StudyProgress / StudyEvent | 对应表渐进扩展；不丢已购版与进度；现有单一Enrollment生成原人工/免费来源grant_key，多来源新购买才追加 |
| MembershipPlan / Membership | plan/version、period/benefit；根据历史可证明字段生成“历史补偿版本”，缺失原权益不得补造收费证据 |
| MediaAsset | media_asset补状态、hash、访问范围与转码信息；本地测试资产不当生产可用COS/VOD对象 |
| ProductSku / CartItem / Address / DeliveryZone | SKU、offer、购物车、加密地址、模板区域；保留一个默认地址条件唯一；查非法SKU、重复与库存差异后再加约束 |
| Order / OrderItem | 开发预占记录单独标记或归档，保持可追踪；不得回填PAID或收入。正式trade_order从真渠道沙箱起产生，并保留原预占释放证明 |
| AuditLog | audit_log保留原动作来源与actor引用；已不存在actor用匿名审计主体，不删历史 |

### 迁移分批

1. 先在隔离数据库顺序执行现有8迁移并核验schema/索引/CHECK；本次只提供参考DDL，当前实例未连接，不做任何真实迁移。
2. 建新增旁路表和回填任务，resource复用原ID；统计源/目标数量、孤儿引用、金额和库存，修复与留档。新旧读取用可回退配置逐模块切换。
3. 优先身份媒体、版本来源、order/payment/refund/inventory/outbox和权益，完成真实沙箱资金/权限/并发验收；其次作业实践、讨论治理、预约活动、直播及通知，形成R1完整业务。
4. R2营销/RTC/离线/投票礼物/分销/广告按各能力验证再建表启用。无需上线未验收表对应的入口；R2不得因为分期而被永久删除。
5. 每批先备份并演练恢复，在事务支持的迁移范围加锁控制；大量回填分批推进。恢复是数据库与对象资产元数据一起恢复，不能只导回业务行。
6. 双写期间校验差异，停旧写入后保留只读兼容期；确认所有读取切换、外键无孤儿、历史权益可用和报表对账后再去旧列。禁止把这份142表参考SQL直接执行到现有库。

交易、会话、私密笔记日志、论坛、渠道回执的保留期限由业务/隐私政策及渠道义务共同确定，写入feature_config并版本化，不在审计中凭空宣称已达到某个法定时限。用户注销应删除/匿名化私密数据、注销身份、撤会话与推送，已发生资金事实以匿名主体保留；私人资料不得借财务保留理由整体留存。

## 数据库设计验收清单

- 空库能部署正式迁移，142表FK/索引/检查与Prisma映射一致；参考DDL转迁移后实际解析，不仅字符串检查。
- 原29表数据迁移总量、ID、笔记引用、学习进度、会员时段、可售库存核对一致；旧预占不能成为营业额。
- 20个并发抢1个SKU/时段/席位，成功数量不超过容量；重复/乱序/迟到付款不多发权，不丢实际异常收款。
- 两人改同一课程/商品草稿，旧version提交返回冲突；已发布旧版仍可学，改名师资料不改成交快照。
- 部分退款、取消预约、活动延期、积分兑换失败、打卡撤回与分销回冲的账本、库存和权益可对账。
- 跨账号、跨老师、客服越权读私密内容、未审资源、会员到期、已购内容下架测试拒绝/允许符合规则。
- worker宕机、回调重放、推送失败、库存重算、数据恢复演练有证据，报告可追到业务事件键。

## 官方核验依据

2026-10-09只读核验：[PostgreSQL约束说明](https://www.postgresql.org/docs/current/ddl-constraints.html)。跨行规则不以普通CHECK实现，条件唯一用partial unique index，时段冲突采用排斥约束或受控事务。本文只引用原理，不声称目标DDL已运行。
''')

report=f'''# 项目全面体检与优化方案

日期：2026-10-09；对象：老子道学书院 Android/iOS App、Ant Design Pro后台、Nest API、Prisma模型/迁移、历史测试构建与真机记录。

## 结论

**产品定位仍指向“道学传承 + 实践落地 + 社群共生”，没有证据表明项目被改为其他业务；实际实现却停留在内容展示、基础学习与人工权益、商城基础，尚未形成原文承诺的文化生态闭环。** App替代小程序、后台采用官方Ant Design Pro属于用户明确授权；不能将这些调整算偏离。

最明显的方向风险是：文化来源和名师可信度缺结构化证据，课程实践和老师回应缺闭环，论坛/直播只是入口，交易没有真实收款履约，七板块无法互相导向。当前可用的私人笔记/日志值得保留，但不等于课程作业、实践点评或社群共生已经完成。继续集中做入口、装饰或商城展示，会扩大这一偏差。

逐项清单共 **{stats['total']}项，已完成{stats['done']}项、未完成{stats['undone']}项（{stats['rate']}%）**。仅原始策划中的软件要求，**{stats['originalSoftwareDone']}/{stats['originalSoftwareTotal']}项（{stats['originalSoftwareRate']}%）**。这是等权覆盖统计，不是工时完成率；不能据此预测“还剩83.5%工期”。部分实现统一记未完成，运营执行和工程增补有明确来源，R3不计入。

现状 **29表、8次迁移、25个App页面**；本次只读数据库连接被拒绝，未核实当前实例。目标全量R1/R2设计 **{len(tables)}表**，按领域和阶段提供全部字段及约束；表数是结构清晰度，不是用户需求数量，也不要求一次性建完。R1、R2及正式上线都未完成。

## 交付与阅读顺序

1. [完整数据库目标设计](01-database-design.md)，配套[当前29表字典](01a-database-current.md)、[现有迁移SQL](database-current-migrations.sql)和[目标参考DDL](database-target-reference.sql)。
2. [需求逐项完成度](02-requirements-completion.md)、[CSV筛选清单](02-requirements.csv)、[未完成独立汇总](02a-unfinished-requirements.md)。每项含来源、阶段、实际边界和验收。
3. 本报告给出方向判断、功能/信息架构/流程优化、顺序及验证门槛。[原Word98段索引](00-original-source.md)、源码哈希和数据库探测结果为审计依据。

## 证据与判定边界

原Word只读提取98个非空正文段落，未改原文件。检查docs/01、02、03、06，完整Prisma schema与8次迁移，API入口及业务模块、App关键路径、后台路由/业务页、官方模板来源、测试源码及历史日志。本轮只写审计报告/工具，不修改业务、清理数据、重新打包或安装手机。

2026-10-06历史`outputs/ui/orders-api-tests.log`记录33通过0失败，覆盖基础、学习、购物与开发预占；不能代表支付、论坛、直播已通过。Android0.2.2有安装及购物车变化记录。最新后台orders构建/重试日志失败，原生iOS未有成功验收证据。2026-10-09数据库元数据读取ECONNREFUSED，既不能据此认定数据库数据损坏，也不能声称当前生产可运行。当前后台HTTP可用性未重测，不把旧404直接当今日状态。

方案、枚举、角色名、空态入口、人工补偿授权和Web预览均不能单独证明相应业务完成。对“已完成”只确认清单中那一条基础能力；正式短信/媒体/付款/部署有独立未完成项，避免以开发环境证明商业正式交付。

## 原始目标是否偏离

| 原始目标 | 当前证据 | 方向判断 | 优化落点 |
|---|---|---|---|
| 经典可触达、权威解读 | 四类文章、正文与私人笔记已做；来源仅文字，音视频未闭环 | 方向保留，可信度和多媒体深度不足 | 经典版次、注释作者授权、版本及校审证据 |
| 名师传承与指导 | 基本档案及老师课程；问答/咨询/日程未实现 | 名师目前偏展示，指导价值未落地 | 绑定老师账号、问答、预约、作业点评工作台 |
| 系统研习→实践落地 | 章节版本、基础进度与文本学习；实践仅私人日志 | 核心实践断层 | 每章实践任务、私密打卡、反馈、复盘 |
| 同好社群共生 | 论坛六tab和课群方案；无帖子与治理模型 | 核心目标缺实现 | 先课程受限讨论，再公共六区、精选授权 |
| 文化文创转化 | SKU、购物车地址；下单支付履约未开放 | 基础投入较多，尚未转化成真实业务 | 配套商品关联、真实订单物流售后和溯源 |
| 七板块深度联动 | 各目录互相独立，搜索仅文章 | 孤立页面风险明显 | content_relation、统一资源入口、权益和服务库存 |
| 全球精神家园 | 简中大陆首期 | 授权内阶段收缩；全球愿景未取消但未做 | 文案准确，不提前承诺多语言全球支付 |
| 消费互动打卡升级会员 | 当前把付费/成长/积分分离 | 已有方案对原文获益语义有差异 | 成长赠试学/问答/公益活动权益，付费与赠权明示 |

原文“低门槛、沉浸、实用”要看真实任务是否顺畅，不能靠水墨图和书法标题证明。用户撤回的#bb2829要求不作为优化基线；继续沿用用户设计图的米白、黛青、水墨和少量朱砂。

## 按优先级排序的体检发现

### F01 · P0：R1交易闭环不可用

证据：`apps/mobile/pages/order/confirm.uvue:39`禁用下单；`shop/cart.uvue:12`禁用结算；`services/api/src/orders.ts:39`仅非生产且ORDER_RESERVATION_PREVIEW=true开放预占，返回paymentEnabled=false；当前OrderStatus仅PENDING/CLOSED。商城数字/服务商品发布明确被拒绝。

影响：课程、会员、商品、咨询、活动均不能完成正式支付交付；人工授权不能证明买课/续费。已有quote/预占/地址快照属于可保留基础。

措施：统一offer、订单项和渠道交易，首先做一笔正式沙箱课程购买及一次退款；再实物订单、会员、席位时段，复用支付和幂等事实。客户端成功只查单，收款验证后按项授予权益。人民币和商店本地币种分开，付费与履约状态分开；并发超卖、重复/迟到/跨渠道付款纳入强制验收。

### F02 · P0：核心“实践+指导+社群”没有业务闭环

证据：schema无作业/提交/点评/帖子/讨论实体；community是空态，teacher问答未开放；PracticeLog只有私人每日文本。现有课程发布拒绝LIVE/COHORT/OFFLINE，不能以CourseFormat枚举算五种课程实现。

影响：用户读完或听完后无法获得具体练习、反馈和同好交流，产品留存与名师差异化未达原文目的。

措施：R1加入课程任务→打卡/作业→老师助教点评→学习档案→受限课程讨论。免费试学课也跑同一实践路径；公共论坛先审后发，私人内容公开必须独立授权。五种交付按真实课件、直播场次、营期和线下库存分别落地。

### F03 · P0：双端和正式平台能力仍缺证据

证据：Android0.2.2开发APK历史安装；iOS签名/真机未完成。`apps/mobile/lib/api.ts:10`硬编码localhost，session只内存；真实媒体只见开发WAV和文字章。没有正式内购、推送和对象存储运行验证。

影响：换手机、离开电脑或重启后可能无法继续业务；不能拿Android本机开发预览宣称Android/iOS正式App交付。

措施：环境化HTTPS API、原生安全持久会话、正式Android/iOS构建；用真实MP4/HLS/音频、上传、微信/支付宝沙箱与StoreKit验证形成能力样例。能力不通先解决插件/签名，相关入口保持准确未开放，不制作假成功业务。

### F04 · P1：名师和经典信任缺数据证据

证据：Article.source仅文本；Teacher仅bio/title/expertise，没有传承证据、作者授权、老师账号关系及完整媒体。商品culturalOrigin文字不等于溯源质检完成。

影响：名师档案看起来有文化内容，却难以核查真实来源和服务责任人；推广与真实资质可能混淆。

措施：来源/授权/背景/质检统一证据档案，专业校审和发布审核分责；名师详情明示经核验资料、代表课、近期场次和可服务时段。示例内容is_demo独立，真实运营资料不能由代理编造。

### F05 · P1：会员与权益模型不够支撑成交承诺

证据：MembershipPlan直接upsert改原记录；Membership仅保存tier/时段/source，未存完整权益版本及购买来源；商品quote discountsEnabled=false。无问答额度、活动优惠、运费会员权益。

影响：套餐修改可能改变旧会员看到的说明；免费课、购课折扣、免邮与优先服务没有可核查用量。原文成长升级的利益未被承接。

措施：版本化套餐、benefit_definition/scope/usage、成交快照与按来源权益，过期/退款重算。保留三种身份分离以便计账，但成长达到门槛应可赠明确期限的试学/问答/公益活动权益，赠送不自动扣款、不冒充购买VIP。先落地当前已约定基础规则，不直接修改代理草案价格为正式收费。

### F06 · P1：搜索与跨板块关联未兑现

证据：首页存searchQuery转discover文章；catalog title contains，首页featured/time；tags未参与推荐；schema没有content_relation。名师→课的单一路径不足以覆盖文章直播配套好物。

影响：搜索占主要入口却只查文章，用户以为“搜索课程/名师”可用；文章引流、社群精选到课程、购课配工具全部断开。

措施：保留五个主导航，统一资源关系和分类搜索；R1先可解释规则推荐，人工精选+兴趣匹配+时窗+真实热度。R2再行为权重，不先训模型；避免开发热销示例冒充实际销量。

### F07 · P1：进度文档与实现不一致

证据：`docs/03-development-progress.md`仍将R10商城/SKU/购物车/地址写待开发，后台构建也沿用较早通过记录；实际已有新购物车/地址/开发订单代码与0.2.2截图。

影响：后续开发会重复实现或把旧成功当最新成功，用户无法判断哪些功能只是部分完成。

措施：以本次逐项CSV建立基线，新增“提交/版本、平台、环境、测试日志、上线状态”证据字段；进度从任务验收自动或固定流程更新，每次报告不能用功能数量代替上线状态。本次审计不擅自改原开发进度，下一开发回合先对齐事实。

### F08 · P1：后台最新构建失败且经营看板仍是示例

证据：`outputs/ui/admin-orders-build.log`及retry记录Go/esbuild内存崩溃、Exit3221226505；官方analysis页面明确使用示例数据。模板来源v6.0.3及MIT已核实，保留官方模板是正确实现。

影响：当前最新业务页无法据日志证明可部署；示例看板虽有标识，也不能成为真实经营验收。不能因模板完整就把业务后台算完整。

措施：保留Ant Pro壳与现有业务页，解决构建环境资源和依赖锁定，完整typecheck+build后smoke；新增岗位工作台、真实统计API、售后/财务/治理。构建输出使用临时目录并成功后原子切换，避免失败清空仍可用产物。

### F09 · P1：可靠任务和账本缺失

证据：预占靠30秒进程timer清扫，仅preview模式；package依赖未形成Redis/BullMQ运行链路；无provider_callback/outbox/资金和库存来源流水。

影响：服务重启可能漏关单/通知，真实支付后难以确认哪笔库存、积分、佣金被扣，后续补业务容易造成多次授权。

措施：优先DB outbox+幂等worker，可按既有技术决定接BullMQ调度；收款、退款、库存、积分、佣金保留不可变事件来源。队列失败不回滚已收款，迟到查单可补偿，后台提供积压/死信和重放工作台。

### F10 · P2：页面语义和交互存在容易误导的细节

证据：首页hero题字“上善若水/第八章”写死却跳首篇精选，改精选可能错配；学习库take100并逐课curriculum查询；“我的预约”转活动目录；shareContent只复制标题无URL。设计参考与Android截图已检查：古风基调已接近参考，但示例课程显示2讲·0分钟，资料和交付真实度不能由视觉弥补。

措施：hero由同一资源配置生成文案和目标；我的预约进入真实预约记录，活动广场是独立入口；分享带深链和网页回退；学习库游标分页+批量课程版/进度查询；所有入口用真实业务状态，示例时明确开发示例。视觉整改在功能数据流一致后按用户图逐页对齐。

## 端到端链路检查

| 链路 | 已有步骤 | 断点 | 目标验收 |
|---|---|---|---|
| 游客读经典→对应名师/课→购买→研习 | 阅读、名师/课目录、试听 | 关联、支付、自动课权 | 文章至确认≤3步，回调验证后可播并追溯来源 |
| 学完→实践→点评→讨论→精选案例 | 章节进度、私人日志 | 任务作业点评、课群和授权 | 提交当天任务并收到指定老师反馈，公开需本人同意 |
| 名师信任→提问→预约→服务完成 | 名师档案和课筛选 | 提问时段支付服务反馈 | 同时抢一个时段最多一单确认，取消退款通知双方 |
| 开播预约→观看→评论→相关购买→回放 | 静态列表入口 | 所有直播服务与联动 | 真媒体场次、鉴权、断线恢复和回放审核 |
| 好物→购物车→报价支付→发货→售后 | SKU、车、地址、服务端开发quote | App报价/下单、支付、发货退款 | 收货快照不变、部分退货库存资金权益一致 |
| 会员→购买续费→权益→成长积分 | 套餐读取、人工补偿、准入 | 真实购买、具体权益、奖励兑换 | 成交版本固定、过期按来源重算、兑换不透支 |

## 信息架构优化

保持用户提供设计的五入口。七板块完整保留，但按用户任务组织，而不是让用户理解内部表名。

| 一级入口 | 二级结构 | 主要操作与边界 |
|---|---|---|
| 首页 | 今日经典、继续研习、今日实践、精选名师、近期直播/活动、全局搜索 | 新用户先看真实经典和入门路径，已有学习用户突出继续研习与任务；各模块从配置资源读取 |
| 学堂 | 入门/经典/实践/生活/少儿、课程目录、我的研习、课程详情 | 课程内固定“介绍/目录/实践/讨论”，学习反馈留在同一课程上下文 |
| 发现 | 经典文章、名师、直播、道友交流、活动 | 论坛保持六区；名师页统一信任资料/代表课/公开问答/日程；直播明确预告直播中回放 |
| 好物 | 五类目录、新品/真实热销/配套工具、详情、购物车 | 文化来源与售后说明先于营销；数字和服务明确交付方式，付款独立按类型 |
| 我的 | 会员、学习档案、笔记/日志、订单售后、预约、积分成长、消息、客服设置 | 学习与私密内容靠前；真实预约列表不跳活动目录，积分余额不以示例值填充 |

全局搜索页分类显示全部/经典/课程/名师/好物/论坛/活动，用户输入保留，游标与标签切换独立；未审、下架与私密正文不检索。详情可显示资源存在但需权益，不能在搜索摘要泄露付费正文。

后台保持Ant Design Pro的ProLayout/ProTable/ProForm及官方账户/异常模式，具体路由按工作任务二开：

| 工作台 | 需要的业务能力 | 权限边界 |
|---|---|---|
| 内容/校审 | 文章经典、版本来源、媒体转码、待审/驳回/下架、跨内容关联 | 运营编辑，专业校审/审核发布，敏感操作审计 |
| 名师/教学 | 档案、服务时段、课程批次、待点评、待问答、课群 | 名师及助教仅自身/指定范围，不读无关财务与私密日志 |
| 社群/直播 | 帖子评论举报、禁言申诉、直播排期回放、房间卡片 | 即时治理权限与普通运营分离 |
| 商城/活动 | SKU库存、运费、发货退换、活动席位核销 | 仓配只见必要收货信息，工作人员只核销指定场次 |
| 客服/会员 | 工单、预约取消、会员补偿、订单问题 | 必要订单信息；不得普遍读取私人笔记和日志 |
| 财务 | 收款退款对账、异常交易、协议分成、结算提现 | 批准与实付分开，重要操作可双人复核，不以后台点击制造支付事实 |
| 系统 | 用户角色、规则版本、平台配置、任务告警、审计 | Secret只显示配置状态，不提供明文导出；真实看板按授权查询 |

## 具体业务流程优化

### A. 内容到研习实践：优先恢复原文核心价值

经典文章末尾展示经校审的“相关解读/研习课程/一项生活实践”；未登录先可读公开正文。点课程→看可试听与退课规则→确认购买→渠道支付。文章到确认页≤3次主要操作，登录成功返回原操作。课程详情不得将会员免费、会员折扣与单独售价混在一句“会员价”中。

付款验证后创建固定release的Enrollment和课群访问；进入课程时同时看到必修章节、今日任务和待反馈，不把所有任务藏到我的页面。每个实践任务明确目的、做法、频次、可提交文字/图片及可见范围。学员默认私密提交给老师/助教，老师在待点评工作台回复；学习档案记录完成和反馈，不用观看时长虚构实践成效。

实践后自愿生成公共分享草稿，用户勾选具体引用与公开范围，再送审。运营将优质心得用于课程案例时再征用途授权，记录版本和可撤回流程；老师点评与专业校审分开，不能因为老师写了就免审。推荐配套茶器/典籍时解释关联，不把练习入口变成强制买工具。

### B. 名师信任到服务

名师页展示真实研究方向/授课方向、核验后的传承背景、代表内容及近期日程；私问明确仅本人和老师可见，答复公开必须同意及审核。问答额度预占后扣，老师无法回答或超时按政策返还，不能无限占用会员额度。

预约统一选择service_offering+slot，名师入口和商城服务详情读取同一库存；展示价格、服务方式、时长、地点及取消截止，提交锁10分钟，支付确认后发双方消息。其他老师无权看联系人。免费/会员咨询同样占时段。取消、老师拒绝、延期各有明确退钱/返额度/改期路径，“我的预约”展示PENDING/CONFIRMED/COMPLETED等真实记录。

### C. 直播与活动

后台为已授权主播排场次并关联课程/活动，先用官方支持外部推流工具验证真实观看。用户预约后站内提醒为事实，推送是可选辅助，取消场次不再发开播提醒。进入会员/购课场次先服务端鉴权，再发短期播放凭证；断线保持房间上下文，回放经审核沿用原权益。

房间评论可引用公开经典；删除禁言举报统一治理，会员连麦优先是排队权益而非绕过主持审批。课程/商品卡打开详情后能返回直播，订单确认不会误丢正在播放状态。线下讲座/研学/见面会通过event_session/ticket报名，免费也占席位并发核销码，取消/延期通知全部有效报名者；多票种总容量统一控制。

### D. 商品交易、售后和财务

实物车多SKU→地址→服务端quote（价格、会员折扣或券择优、运费附加、可售）→明确确认→创建订单。报价过期/价变/库存不足显示原因并重新确认。支付失败或未知回到订单待确认，客户端不直接标成功。后台发真实包裹，用户可查单号和售后范围；退货、换货、退款是不同工作流。

数字资料、课程、会员、服务、活动独立订单按实际渠道路由，源权益和版本固定；实物和数字不混支付。部分退款按项和实收折扣分摊，退款成功才冲回收入/佣金与相应权益，实物验收退回才加库存。签名文创需要真实限量库存及实际物流，不能只挂会员权益标签。

每日核对订单应收、实际收款、渠道费用、退款和合作应付；同订单跨渠道两笔成功都留存事实，额外收款进入异常退款；已批准退款不算已退款，批准提现不算已转账。公益活动/课程分成按有版本协议降低，不在代码无依据自动给所有名师比例。

### E. 会员、成长、积分

会员卡片分别显示层级、权益版本、生效/到期、立即可用和额度。R1手动续费，同层续期，跨层售前显示排队生效；不自动补差或静默扣款。新课优先/连麦/问答/论坛置顶/活动优先/签名品各对应实际规则和资源，不用一张“尊享全部”卡覆盖未实现能力。

成长保留参与称号，并通过可配置奖励承接原文“参与后获得更多权益”：例为阶段性的指定课程试学、问答额度或公益活动资格，条件、期限与每日上限清楚显示。付费身份、参与称号、积分余额互相区分，但利益联动保留。积分消费与有效实践/审核事件幂等获取，R1先兑券，R2补文创和咨询；被驳回帖子或退款消费冲正，不把刷播放事件当现金奖励。

## UI和内容质量优化（沿用用户设计）

用户设计图`docs/design-reference/core-screens.png`与`page-system.png`作为唯一视觉基线，旧试制设计不作为验收通过依据。已读核心设计图和0.2.2Android首页截图，整体基调已有米白/黛青/水墨，但仍需全页面核对；未凭一张首页截图认定全部UI完成。

1. 建立少量统一token：主文字、次文字、背景、描边、主操作、强调，字体层级、行高、间距、安全区、点击尺寸。装饰书法只用于品牌/短标题，长正文可切系统清晰字体，支持系统放大；18—70岁用户优先可读。
2. 页面组件统一PageHead、ArticleRow、CourseRow、内容状态和底部操作。加载/空态/失败/下架/无权限明确不同，失败可重试，空态有真实下一步；未开放入口说明具体能力但不堆技术实现术语。
3. hero标题、章号、摘句、封面和目标来自同一审核资源；真实老师肖像和课程场景图各对应其内容，不给所有课程重复用书封来充实数量。不存在真实时长/场次不显示“0分钟”可售介绍。
4. 列表重内容结构，价格/权益/形式/时长只在与决策有关时显示，学习页突出章名和任务，商城页突出规格/溯源/交付。避免全屏重复卡片、假统计、无意义口号和会员强引导。
5. 逐页截图按375/390/430逻辑宽及原生Android/iOS对齐，测大字体、超长中文、无封面、输入键盘和弱网。设计参考用于布局气质，示例内容/价格/头像不照搬为真实经营资料。

## 技术和数据优化措施

保留uni-app x蒸汽模式、Nest/Prisma/PostgreSQL与官方Ant Pro，按现有锁文件版本推进，不因审计重写框架。App和React后台组件不混用；同一单体服务内部按内容、教学、交易、服务、社群、直播、治理分模块。

| 问题 | 具体改进 | 验证方法 |
|---|---|---|
| 原生会话和本机API | 环境配置HTTPS，Keychain/Keystore保护refresh，只持久非敏感设置；恢复请求串行刷新 | 重启、切网、冻结、退出、refresh重放 |
| 文章/章节编辑覆盖 | 稳定段落/章节ID+发布版，历史摘录和课权固定原版 | 改正文、删段落、课下架、会员到期后独立课权 |
| 学习库截断/N+1 | 游标分页，批量加载release/lesson/progress，返回最近学习投影 | 超100课、稳定排序无重漏、DB查询数有界 |
| 进度失败丢失 | 本地持久事件队列、eventId去重、退后台重试、响应后删除 | 断网退出进程→重启补报、不重复完成奖励 |
| 媒体直链风险 | 私有存储、转码审核READY、授权后签名、回放同准入 | 到期/退款/跨用户访问拒绝，合法播放不卡文本 |
| 金钱和库存无来源 | payment/refund/inventory/points/commission账本与唯一事件键 | 重复并发和回冲，账本总额/库存聚合对账 |
| timer单点和回调丢失 | DB outbox+callback inbox、worker租约、重试死信、查单补偿 | 服务强停、任务重复、乱序回调、重放恢复 |
| 只有角色没资源范围 | Teacher-user、course_staff、event_staff，统一resource访问策略 | 老师A读B作业/预约、客服私密内容、核销越权 |
| 状态与页面文案漂移 | API错误码、统一状态模型、证据化需求台账 | 入口状态、服务返回、用户文案同一版本 |
| 演示数据污染经营 | isDemo生产过滤，后台显式示例，指标只统计核验交易 | 示例不进入销量、会员、收入和推送名单 |

2026-10-09官方只读核验：DCloud requestPayment页面当前列出微信/支付宝provider，不能据此假设Apple IAP直接可用；按既有方案验证StoreKit桥接。Apple规则区分数字内容、真实实时一对一、实物/App外履约；初期大陆数字购买按IAP策略执行，不能将异步问答或多人线上训练营套一对一例外。以正式签名和沙箱真机证据为准。[DCloud支付API](https://doc.dcloud.net.cn/uni-app-x/api/request-payment.html)、[Apple支付审核条款](https://developer.apple.com/app-store/review/guidelines/#payments)。

## 优化实施顺序与退出条件

这些是可执行工作包，未实施。工期应根据平台能力和人员投入估算，原文1—3个月是期望，不以审计代替估期。先聚焦一条代表性链路，同时明确它不等于七板块R1全部完成。

| 顺序 | 工作包 | 交付 | 必须通过的门槛 |
|---|---|---|---|
| 0 | 事实基线与可复现构建 | 对齐docs进度、稳定Ant Pro新版本构建、确认当前DB迁移 | 最新构建日志、实际Schema差异与基础回归；不覆盖可用产物 |
| 1 | 双端平台能力 | Android/iOS正式测试包、HTTPS、安全会话、真实媒体/上传、支付/推送样例 | 真机沙箱、SDK签名与平台权限明确；无法验证功能不标完成 |
| 2 | 原文核心代表课 | 真实经典来源→真实名师→可买课程→学习→任务→点评→课群 | 游客到实践反馈全路径；权限及内容审核，不用种子示例替真实内容 |
| 3 | 统一交易权益 | 支付/退款/查单、会员版本权益、库存/outbox、订单售后 | 并发/重复/迟到/退款/异常收款、独立购课权与会员过期 |
| 4 | 商品咨询活动 | 实物发退换、数字领取、时段、活动票核销、合作结算 | 多入口共库存，交付通知，部分退款和对账 |
| 5 | 七板块R1补齐 | 五种课型基础、论坛治理、直播观看回放、全局搜索关联、消息客服 | 全部R1清单改为已完成，每条留API/DB/双端/后台证据 |
| 6 | 正式发布运营 | 授权内容真实供应、专业校审客服、备份恢复、上线资料与内测 | 非功能目标、正式包、真实服务维护、用户可达客服及平台审核 |
| 7 | R2增强 | 离线/精确标注/导出、RTC连麦投票礼物、营销分销、公益签名品/征文推广 | 每条R2有真实流程和对应风险测试，完成后才称原策划完整软件交付 |

第二包应先建立免费试学/人工补偿可练习路径，再接正式买课；第三包的平台支付已有能力验证后才接收费。表中2/3的数据依赖可穿插，但不能用免费试课宣称付费闭环完成。真实运营任务不由软件完成自动获得“已完成”。

## 验收与经营指标

指标均为建议定义/测试目标，不是当前经营数据或保证。基础正式版沿用现有契约：1万注册/500日活/100并发API测试目标，列表API p95<800ms、正常网络核心内容2秒内可操作；需固定环境实测。

| 目标 | 指标定义 | 数据来源及反例 |
|---|---|---|
| 文化可信 | 已发布内容来源/授权可核查率；校审通过和纠错时效 | source_evidence及审核动作；文字“权威”不计核查成功 |
| 系统研习 | 首次读经典→试听→付费→首次章完成转化 | reading、payment、study事件，排除Demo和退款测试 |
| 实践落地 | 加课7天内至少一次有效任务；有效提交后点评等待时长 | task/checkin/submission/review；私人日志数不代替老师指导 |
| 社群共生 | 有效学员课群发帖/回应率；授权精选到研习转化 | section/thread/comment/authorization；刷帖量不等于质量 |
| 真实服务 | 预约确认率、取消退款时效、活动核销率、售后解决时长 | appointment/registration/refund/shipment/feedback，未付款不计确认 |
| 交易可靠 | 差异订单、超卖、重复授权、退款失败、任务积压 | 核验交易/库存/账本/outbox；示例看板不当指标 |
| 留存价值 | D7/D30研习实践活跃和复购净实收 | 明确同一账号、有效业务事件和退款净额；不强迫公开隐私提高活跃 |

必须保护钱、权限、库存和交付的测试：多并发抢1份库存/时段/席位；重复/迟到/跨渠道付款；部分退款；会员到期且独立课权保留；跨用户/老师越权；作业与私人日志公开授权；论坛未审不可读；活动取消核销幂等；服务宕机任务恢复；双端断网、后台、重启、系统大字与媒体中断。

## 外部依赖与风险处理

| 依赖 | 需要的实际交付 | 缺失时如何推进 |
|---|---|---|
| App账号/签名/商店 | Android自有签名、iOS证书与profile、内购商品/沙箱账号 | 可做业务与契约，正式原生/IAP保持未完成，不拿开发包证明 |
| 商户与渠道 | 微信支付宝App产品、回调域名、沙箱/交易验证、退款能力 | 服务端幂等/账本在隔离测试实现，按钮不假收款 |
| 正式域名服务器 | HTTPS、持久DB、对象存储、worker、备份恢复和监控 | 继续本机开发，生产部署单列未完成 |
| 媒体短信推送 | 正式服务账号、配置与原生SDK/通道、内容审核 | 开发样例显式标注，正式接收播放推送验收分开 |
| 真实内容及服务人员 | 名师协议/背景核验、版权课件、助教/校审/客服、可预约时段 | 不编造身份经历和客服电话；准备工具与工作台待真实资料 |
| 商品活动履约 | 实际SKU库存、资质溯源、承运商、活动负责人/地点容量 | 目录标开发，无法履约不发布为可售 |

用户已授权普通业务技术判断，可继续按本方案确定细节；本次无需反复确认。只有外部资质/真实运营供给必须通过实际获得才能标完成，不能由开发代理“按理解”虚构。

## 本次验证记录

- Word98段与SHA256；29模型/8迁移/25App页面统计及代码哈希已保存。
- 逐项清单/未完成汇总从同一结构化数据生成，完成数一致；P/D/U来源明确，运营与R1/R2单列。
- 数据库当前列/枚举/索引/关系由源码提取，8次完整迁移另附；142目标表全部列、FK引用和查询索引提供参考DDL，跨行规则单列。目标SQL未在数据库执行，不宣称迁移或构建成功。
- 本次只读DB无法连接；历史33测试及Android0.2.2截图和最新后台失败日志检查，未重新跑会写fixture的测试。
- 外部官方文档搜索工具网关不可用；经只读直接HTTPS成功核验Apple/DCloud/PostgreSQL，未下载原始网页缓存作为交付。数据库/业务代码与原Word未改动。
'''
write('03-health-check-and-optimization.md',report)
write('official-verification.json',json.dumps({'date':'2026-10-09','method':'read-only HTTPS official pages; web search gateway unavailable','sources':[{'url':'https://developer.apple.com/app-store/review/guidelines/','httpStatus':200,'sections':['3.1.1','3.1.3(d)','3.1.3(e)'],'finding':'Digital unlocks use IAP under the selected initial distribution strategy; real-time person-to-person and physical/off-app services have distinct treatment. Purchased credits must not expire.'},{'url':'https://doc.dcloud.net.cn/uni-app-x/api/request-payment.html','httpStatus':200,'finding':'requestPayment provider section currently lists alipay and wxpay; Apple IAP compatibility must be independently verified.'},{'url':'https://www.postgresql.org/docs/current/ddl-constraints.html','httpStatus':200,'finding':'Cross-row constraints are not ordinary CHECK constraints; partial unique indexes and exclusion constraints address suitable invariants.'}]},ensure_ascii=False,indent=2))
write('README.md',f'''# 老子道学书院：原始需求对照体检

审计日期：2026-10-09。软件定位未变，但实践指导、社群共生及真实交易闭环未完成。当前29表/25App页面不等于七板块R1可上线。

1. [完整数据库结构设计](01-database-design.md)（142目标表，R1/R2分阶段）；[现状29表逐列字典](01a-database-current.md)；[目标参考DDL](database-target-reference.sql)；[现状8迁移SQL](database-current-migrations.sql)。
2. [逐项完成度](02-requirements-completion.md)；[可筛选CSV](02-requirements.csv)；[未完成独立汇总](02a-unfinished-requirements.md)。{stats['total']}项中{stats['done']}已完成、{stats['undone']}未完成（{stats['rate']}%）。仅原文软件要求{stats['originalSoftwareDone']}/{stats['originalSoftwareTotal']}（{stats['originalSoftwareRate']}%）。等权覆盖统计不代表工期或上线比例。
3. [全面体检与深入优化方案](03-health-check-and-optimization.md)（方向、优先级、功能、信息架构、业务流程、实施/验收与外部依赖）。

来源：[原Word98段索引](00-original-source.md)、`evidence-inventory.json`、`database-evidence.json`、`official-verification.json`。机器可读资料：`requirements-data.json`、`target-schema-data.json`、`completion-stats.json`。

本轮仅生成审计工具及报告，未修改业务代码、执行目标迁移或安装App。当前数据库只读连接ECONNREFUSED，数据库实际部署情况未核实；真实短信/媒体/支付/iOS/正式部署缺验收，不能宣称已上线。APK与基础测试引用2026-10-06历史证据，后台最新构建失败另列。
''')
for filename in ('01-database-design.md','03-health-check-and-optimization.md','README.md'):
    text=(OUT/filename).read_text(encoding='utf-8').replace('142表',str(len(tables))+'表').replace('142目标表',str(len(tables))+'目标表')
    (OUT/filename).write_text(text,encoding='utf-8')
print('Reports written.')
