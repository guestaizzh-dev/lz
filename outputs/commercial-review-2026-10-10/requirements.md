# 商用标准逐项需求核查清单

2026-10-10。仅“能力闭环已验证”计1；其余均计0。已完成能力仍须通过全站正式发布门禁，不能直接代表现有App已可商用。原文P编号沿用逐段抽取，详见 [outputs/audit-2026-10-09/00-original-source.md](<C:/Users/l6658/Documents/ChatGPT/道学书院/outputs/audit-2026-10-09/00-original-source.md>)。旧清单的开发环境验收文案仅保留于JSON/CSV acceptance字段作追溯，不作为本次商用门槛。

## 基础账号

| ID | 需求与原文定位 | 阶段 | 判定 | 当前事实 / 未完成原因 |
| --- | --- | --- | --- | --- |
| ID01 | 微信一键登录及绑定（P014） | R2 | 未完成 · 工作流缺失 | 未发现微信授权、绑定与账号合并闭环。 **待补：**补客户端授权、服务端身份校验、绑定及合并冲突处理。 |
| ID02 | 手机号注册与登录基础链路（P014） | R1 | 未完成 · 部分实现 | 验证码消费、限流、刷新、私人接口隔离有实现和测试；线上短信关闭。 **待补：**实际生产注册登录成功后才计完成。 |
| ID03 | 正式短信发送与接收（P014） | R1 | 未完成 · 正式交付未验证 | 腾讯短信协议已写；生产显式关闭，已有线上检查返回503。 **待补：**配置正式签名模板并验证接收、失败及限流。 |
| ID04 | 自主选择和修改道学兴趣标签（P014） | R1 | 已完成 · 能力闭环已验证 | 兴趣标签可保存修改，推荐读取当前标签，游客无需填写。 |
| ID05 | 昵称头像资料管理（P015） | R1 | 已完成 · 能力闭环已验证 | 本人昵称、私有头像上传及资料修改有专用接口与App页面。 |
| ID06 | 个人订单和售后管理（P015） | R1 | 未完成 · 部分实现 | 课程订单、退课列表和商品预占订单可查看；完整商品及会员售后未闭环。 **待补：**完成真实各类订单、支付、退款及统一入口。 |
| ID07 | 个人当前会员与套餐查询（P015） | R1 | 已完成 · 能力闭环已验证 | 套餐和当前有效会员由服务端查询，生效到期按服务端时间判断。 |
| ID08 | 完整学习档案（P015） | R1 | 未完成 · 部分实现 | 学习档案已含在学、完成、作业点评、打卡和完成记录入口。 **待补：**library固定take100，无分页，超过100门课程会被截断；补分页及总量一致性验证。 |
| ID09 | 私人笔记存取及隔离（P015） | R1 | 已完成 · 能力闭环已验证 | 私人笔记支持新增编辑删除、原文版本及引用快照；按本人读取。 |
| ID10 | 私人每日修行日志（P015） | R1 | 已完成 · 能力闭环已验证 | 日志按北京时间日期记录，可编辑删除，版本冲突保护，默认私有。 |
| ID11 | 积分账户及明细（P015） | R1 | 已完成 · 能力闭环已验证 | 积分账户余额、冻结额及分页流水已实现，显示整数账本数据。 |
| ID12 | 站内消息中心（P015） | R1 | 未完成 · 部分实现 | 站内消息及已读已实现，覆盖课程收退款、点评、问答、论坛审核等事件。 **待补：**补商品、会员、预约、直播等全部事件及可靠提醒；推送未接。 |
| ID13 | 跨文章课程名师商品论坛综合搜索（P016） | R1 | 已完成 · 能力闭环已验证 | 搜索覆盖文章、课程、名师、商品、活动、直播预告和公开论坛，支持标签排序分页。 |
| ID14 | 基于兴趣标签的内容活动推荐（P016/P071） | R1 | 已完成 · 能力闭环已验证 | 兴趣标签加权推荐、游客回退、已读剔除及公开候选过滤已实现。 |
| ID15 | 浏览购买行为个性化推荐（P016/P071） | R2 | 未完成 · 部分实现 | 阅读、点赞、收藏可参与标签加权。 **待补：**购买行为未纳入，需验证归因与隐私说明。 |
| ID16 | 退出撤销与账号注销基础链路（D6.1） | R1 | 未完成 · 部分实现 | 退出撤销及注销清理存在；注销仍只处理旧Order，未处理TradeOrder付款/退款。 **待补：**接入课程交易及未履约订单处置，验证注销与迟到回调竞争。 |
| ID17 | 安全持久登录与账号恢复（D6.1） | R1 | 未完成 · 工作流缺失 | 访问/刷新凭证仅保存在内存，重启无法恢复登录。 **待补：**接入经验证的Keychain/Keystore存储、恢复及复用保护。 |
| ID18 | 完整设置与权限说明（D6.1） | R1 | 未完成 · 部分实现 | 设置、隐私、注销、客服已有入口。 **待补：**正式SDK清单、系统权限管理、版本检查及缓存管理尚不完整。 |

证据入口：[services/api/src/identity.ts](<C:/Users/l6658/Documents/ChatGPT/道学书院/services/api/src/identity.ts>)、[services/api/src/personal.ts](<C:/Users/l6658/Documents/ChatGPT/道学书院/services/api/src/personal.ts>)、[services/api/src/discovery.ts](<C:/Users/l6658/Documents/ChatGPT/道学书院/services/api/src/discovery.ts>)、[services/api/src/progression.ts](<C:/Users/l6658/Documents/ChatGPT/道学书院/services/api/src/progression.ts>)、[services/api/src/teaching.ts](<C:/Users/l6658/Documents/ChatGPT/道学书院/services/api/src/teaching.ts>)、[apps/mobile/lib/session.ts](<C:/Users/l6658/Documents/ChatGPT/道学书院/apps/mobile/lib/session.ts>)、[apps/mobile/pages/profile/edit.uvue](<C:/Users/l6658/Documents/ChatGPT/道学书院/apps/mobile/pages/profile/edit.uvue>)、[apps/mobile/pages/profile/settings.uvue](<C:/Users/l6658/Documents/ChatGPT/道学书院/apps/mobile/pages/profile/settings.uvue>)、[services/api/test/content.test.mjs](<C:/Users/l6658/Documents/ChatGPT/道学书院/services/api/test/content.test.mjs>)。

## 文章经典

| ID | 需求与原文定位 | 阶段 | 判定 | 当前事实 / 未完成原因 |
| --- | --- | --- | --- | --- |
| AR01 | 四类文章分类浏览（P020） | R1 | 已完成 · 能力闭环已验证 | 经典原文、名师解读、实践心得、道学常识目录筛选已有实现。 |
| AR02 | 权威注释版本和授权证据（P020/P093） | R1 | 未完成 · 正式交付未验证 | 授权来源可录入审核，按有效期展示，隐藏私人证据文件。 **待补：**样例授权不能证明真实权利；完成权威版本和版权材料核验。 |
| AR03 | 图文正文发布与阅读（P021） | R1 | 已完成 · 能力闭环已验证 | 图文结构块发布阅读、版本快照、公开及会员正文边界已实现。 |
| AR04 | 文章音频视频发布与阅读（P021） | R1 | 未完成 · 工作流缺失 | 文章编辑块只接受paragraph/quote/image。 **待补：**增加音视频发布、审核、受控播放及失败回退。 |
| AR05 | 古籍水墨书法排版工具（P021） | R2 | 未完成 · 部分实现 | 已有宋体、留白及阅读主题；未形成后台古籍排版工具。 **待补：**补模板选择、预览及跨端可读性验证。 |
| AR06 | 文章草稿审核发布下架（D6.2） | R1 | 已完成 · 能力闭环已验证 | 草稿、提交审核、拒绝修订、发布和下架有专用状态转换。 |
| AR07 | 会员文章服务端鉴权（D6.2） | R1 | 已完成 · 能力闭环已验证 | 会员正文服务端鉴权，未授权不会获得全文。 |
| AR08 | 文章点赞（P022） | R1 | 已完成 · 能力闭环已验证 | 文章点赞及取消、状态回显、唯一约束实现。 |
| AR09 | 文章收藏及个人收藏列表（P022） | R1 | 已完成 · 能力闭环已验证 | 收藏及取消、分页收藏列表和下架提示已实现。 |
| AR10 | 文章评论与引用评论（P022） | R1 | 已完成 · 能力闭环已验证 | 评论、引用、回复、审核与本人待审状态可用。 |
| AR11 | 可打开的内容分享链接（P022） | R1 | 未完成 · 部分实现 | 服务端分享链接可打开摘要，下架后失效；线上没有App Web全文落地页。 **待补：**补可继续阅读的真实分享落地及App唤起/下载回退。 |
| AR12 | 微信好友朋友圈社群分享（P022） | R2 | 未完成 · 工作流缺失 | 未发现正式微信好友/朋友圈SDK闭环。 **待补：**接入平台分享、取消失败与回跳验证。 |
| AR13 | 按段落记私人笔记（P022） | R1 | 已完成 · 能力闭环已验证 | 笔记绑定稳定段落和原引用快照，可从阅读页记录及私人列表维护。 |
| AR14 | 文本范围标注（P022） | R2 | 未完成 · 正式交付未验证 | 跨段选文、复制、高亮及弹窗代码与Web专项通过。 **待补：**未验证原生WebView菜单、手势冲突和长文边界，暂不计商用完成。 |
| AR15 | 笔记整理导出（P022） | R2 | 未完成 · 正式交付未验证 | 后端Markdown整理与Web下载通过；App文件写入及系统分享有代码。 **待补：**Android/iOS实际导出保存分享未验证，不能只以浏览器下载算完成。 |
| AR16 | 文章导向对应名师课程直播（P023/P065） | R1 | 未完成 · 部分实现 | 文章可配置有效课程/直播预告关联并跳转。 **待补：**名师关联展示及正式直播间后续流程未完整覆盖。 |
| AR17 | 阅读历史去重及举报（D6.2） | R1 | 已完成 · 能力闭环已验证 | 阅读记录按用户/北京时间业务日去重，历史分页，举报校验。 |

证据入口：[services/api/src/admin.ts](<C:/Users/l6658/Documents/ChatGPT/道学书院/services/api/src/admin.ts>)、[services/api/src/catalog.ts](<C:/Users/l6658/Documents/ChatGPT/道学书院/services/api/src/catalog.ts>)、[services/api/src/content.ts](<C:/Users/l6658/Documents/ChatGPT/道学书院/services/api/src/content.ts>)、[services/api/src/editorial.ts](<C:/Users/l6658/Documents/ChatGPT/道学书院/services/api/src/editorial.ts>)、[services/api/src/personal.ts](<C:/Users/l6658/Documents/ChatGPT/道学书院/services/api/src/personal.ts>)、[services/api/src/discovery.ts](<C:/Users/l6658/Documents/ChatGPT/道学书院/services/api/src/discovery.ts>)、[services/api/src/share.ts](<C:/Users/l6658/Documents/ChatGPT/道学书院/services/api/src/share.ts>)、[apps/mobile/pages/article/detail.uvue](<C:/Users/l6658/Documents/ChatGPT/道学书院/apps/mobile/pages/article/detail.uvue>)、[apps/mobile/lib/note-export.ts](<C:/Users/l6658/Documents/ChatGPT/道学书院/apps/mobile/lib/note-export.ts>)、[services/api/test/content.test.mjs](<C:/Users/l6658/Documents/ChatGPT/道学书院/services/api/test/content.test.mjs>)。

## 名师服务

| ID | 需求与原文定位 | 阶段 | 判定 | 当前事实 / 未完成原因 |
| --- | --- | --- | --- | --- |
| TE01 | 名师基本档案及课程列表（P026） | R1 | 已完成 · 能力闭环已验证 | 名师简介、研究标签、关联已发布课程及分页列表可用。 |
| TE02 | 传承背景脉络与成就核验（P026） | R1 | 未完成 · 正式交付未验证 | 传承简介和证据实体存在，当前主要是测试老师档案。 **待补：**真实资质、成就及审核材料须逐人核验。 |
| TE03 | 独立授课方向及代表课编排（P026） | R1 | 未完成 · 部分实现 | expertise标签及关联课程已展示。 **待补：**独立授课方向和代表课程编排未形成完整运营流程。 |
| TE04 | 名师直播活动日程（P026） | R1 | 未完成 · 部分实现 | 有直播预告和活动目录，但名师详情仅介绍/课程/问答。 **待补：**补名师统一直播、活动日程及变更通知。 |
| TE05 | 名师音视频信任内容（P026） | R1 | 未完成 · 工作流缺失 | 名师页面未发现音视频介绍发布观看流程。 **待补：**补可信媒体内容、审核及播放。 |
| TE06 | 一对一咨询预约（P027） | R1 | 未完成 · 工作流缺失 | App咨询预约按钮禁用，未发现可售时段支付与履约流程。 **待补：**统一服务、时段预占、支付、取消退款和联系信息授权。 |
| TE07 | App内实时一对一咨询（P027） | R2 | 未完成 · 工作流缺失 | 未发现实时咨询SDK及房间准入。 **待补：**接入双端实时咨询及结束、退款和异常处理。 |
| TE08 | 线下见面预约（P027） | R1 | 未完成 · 工作流缺失 | 活动目录不能代替线下见面预约交易。 **待补：**补时间库存、报名确认、核销及取消。 |
| TE09 | 向名师提问与精选答复（P027） | R1 | 已完成 · 能力闭环已验证 | 私问、公开答复审核、老师归属、通知和精选答复可用。 |
| TE10 | 名师会员独家解读权益（P028） | R1 | 未完成 · 部分实现 | 文章/课程会员准入已支持，名师专属内容权益未形成完整配置。 **待补：**建立老师内容集合与可兑现套餐映射。 |
| TE11 | 名师会员连麦优先（P028） | R2 | 未完成 · 工作流缺失 | 直播连麦及会员优先队列未实现。 **待补：**依赖真实直播和主持人审批。 |
| TE12 | 签名书籍文创权益（P028/P061） | R2 | 未完成 · 工作流缺失 | 未发现签名商品配额、领取和发货流程。 **待补：**配置实物权益库存、订单和履约证据。 |
| TE13 | 老师账号绑定及资源归属工作台（D4/D6.3） | R1 | 已完成 · 能力闭环已验证 | 老师账号绑定、课程工作人员授权、作业点评与问答归属保护实现。 |

证据入口：[services/api/src/catalog.ts](<C:/Users/l6658/Documents/ChatGPT/道学书院/services/api/src/catalog.ts>)、[services/api/src/questions.ts](<C:/Users/l6658/Documents/ChatGPT/道学书院/services/api/src/questions.ts>)、[services/api/src/teaching.ts](<C:/Users/l6658/Documents/ChatGPT/道学书院/services/api/src/teaching.ts>)、[apps/mobile/pages/teacher/detail.uvue](<C:/Users/l6658/Documents/ChatGPT/道学书院/apps/mobile/pages/teacher/detail.uvue>)。

## 课程实践

| ID | 需求与原文定位 | 阶段 | 判定 | 当前事实 / 未完成原因 |
| --- | --- | --- | --- | --- |
| CO01 | 四类课程目录（P032） | R1 | 已完成 · 能力闭环已验证 | 四类课程目录及图文/音频/视频混合章节类型展示筛选可用。 |
| CO02 | 视频课程正式交付（P032） | R1 | 未完成 · 部分实现 | 本地私有视频、短期票据、章节鉴权及Range播放可运行。 **待补：**正式内容、转码/CDN、并发交付及原生播放器链路缺证据。 |
| CO03 | 音频课程正式交付（P032） | R1 | 未完成 · 部分实现 | 私有音频、章节鉴权、续播倍速Web播放可运行。 **待补：**补正式媒体交付和双端音频后台/中断验证。 |
| CO04 | 直播课程交付（P032） | R1 | 未完成 · 工作流缺失 | 直播课程尚无实际播放与交付。 **待补：**绑定场次、准入、回放及取消补偿。 |
| CO05 | 训练营课程交付（P032） | R1 | 未完成 · 工作流缺失 | 批次等表已建，未发现训练营报名、营期及阶段交付流程。 **待补：**补批次容量、开营、助教、阶段提醒和结束。 |
| CO06 | 线下课程交付（P032） | R1 | 未完成 · 工作流缺失 | 线下课程没有报名支付席位核销闭环。 **待补：**复用活动库存、报名及核销。 |
| CO07 | 课程标价与试听配置（P033） | R1 | 已完成 · 能力闭环已验证 | 课程价格、试听章节、有效期及退课说明可配置并展示。 |
| CO08 | 付费购课与自动授权（P033） | R1 | 未完成 · 正式交付未验证 | 录播订单、签名验签、回调查单、授权和退款有深入实现与模拟回归。 **待补：**微信生产收款关闭；真实App收款/退款、支付宝及iOS内购未验收。 |
| CO09 | 课程优惠券（P033） | R2 | 未完成 · 工作流缺失 | 券表不能代替领券、核算、占用消费及退款返券。 **待补：**补规则、渠道映射与真实结账。 |
| CO10 | 课程拼团（P033） | R2 | 未完成 · 工作流缺失 | 未发现拼团成团授权、失败自动退款链路。 **待补：**补团状态、人数、到期任务及退款补偿。 |
| CO11 | 单层会员课程推广分销（P033/P067） | R2 | 未完成 · 工作流缺失 | 推广和账本实体存在，未发现有效归因及佣金结算工作流。 **待补：**补单层归因、反自购、退款冲回及付款凭证。 |
| CO12 | 离线缓存与到期校验（P034） | R2 | 未完成 · 工作流缺失 | 未实现受控离线下载和许可证到期校验。 **待补：**补下载、用户隔离、续验及退款撤权窗口。 |
| CO13 | 完整倍速续播跨设备体验（P034） | R1 | 未完成 · 正式交付未验证 | 播放器有倍速和服务端进度，Web音视频测试通过。 **待补：**跨设备、后台、来电和原生播放尚无完整验证。 |
| CO14 | 基础学习进度与事件幂等（P034） | R1 | 已完成 · 能力闭环已验证 | 进度写入服务端，事件ID及payloadHash幂等，按时间限制学习累加。 |
| CO15 | 弱网持久进度重试（P034） | R1 | 未完成 · 部分实现 | 失败可重试，但pending队列为页面内存变量。 **待补：**持久化按用户/章节隔离队列，断网退出重启后继续同步。 |
| CO16 | 作业文本图片提交（P034） | R1 | 已完成 · 能力闭环已验证 | 文本/图片作业、归属媒体、提交版本、截止和修订流程已实现。 |
| CO17 | 老师助教点评答疑（P034） | R1 | 已完成 · 能力闭环已验证 | 所属老师/助教点评、评分、退回补交、学员回看及通知闭环。 |
| CO18 | 课程实践打卡（P034） | R1 | 已完成 · 能力闭环已验证 | 课程实践任务、日期打卡、点评及北京时间连续记录实现。 |
| CO19 | 购课自动课程社群（P034/P066） | R1 | 未完成 · 部分实现 | 已有Enrollment/会员访问时可进入课程讨论区。 **待补：**真实支付自动授权与讨论准入尚未联调，不能算购课全闭环。 |
| CO20 | 免费课程加入与人工补偿授权（D6.4） | R1 | 已完成 · 能力闭环已验证 | 免费加入和人工补偿授权复用学习权限，操作留审计。 |
| CO21 | 已购版本与独立访问权隔离（D6.4） | R1 | 已完成 · 能力闭环已验证 | 已加入版本冻结；下架不自动取消独立权益，会员与购课准入分开。 |
| CO22 | 已购版本升级与补偿处理（D6.4） | R1 | 未完成 · 部分实现 | 独立已购版本保持，后台可补偿授权。 **待补：**缺已购版本升级确认、撤销内容补偿和用户通知完整流程。 |

证据入口：[services/api/src/learning.ts](<C:/Users/l6658/Documents/ChatGPT/道学书院/services/api/src/learning.ts>)、[services/api/src/course-sales.ts](<C:/Users/l6658/Documents/ChatGPT/道学书院/services/api/src/course-sales.ts>)、[services/api/src/wechat-pay.ts](<C:/Users/l6658/Documents/ChatGPT/道学书院/services/api/src/wechat-pay.ts>)、[services/api/src/curriculum-admin.ts](<C:/Users/l6658/Documents/ChatGPT/道学书院/services/api/src/curriculum-admin.ts>)、[services/api/src/teaching.ts](<C:/Users/l6658/Documents/ChatGPT/道学书院/services/api/src/teaching.ts>)、[services/api/src/practices.ts](<C:/Users/l6658/Documents/ChatGPT/道学书院/services/api/src/practices.ts>)、[services/api/src/media.ts](<C:/Users/l6658/Documents/ChatGPT/道学书院/services/api/src/media.ts>)、[apps/mobile/pages/course/player.uvue](<C:/Users/l6658/Documents/ChatGPT/道学书院/apps/mobile/pages/course/player.uvue>)、[apps/mobile/pages/course/library.uvue](<C:/Users/l6658/Documents/ChatGPT/道学书院/apps/mobile/pages/course/library.uvue>)、[services/api/test/course-sales.test.mjs](<C:/Users/l6658/Documents/ChatGPT/道学书院/services/api/test/course-sales.test.mjs>)。

## 直播

| ID | 需求与原文定位 | 阶段 | 判定 | 当前事实 / 未完成原因 |
| --- | --- | --- | --- | --- |
| LI01 | 五类直播预告场次（P038） | R1 | 未完成 · 部分实现 | 有直播房间、场次预告、发布与下架管理。 **待补：**五类业务规则、完整状态机和正式服务商场次未验证。 |
| LI02 | 直播预约和开播提醒（P038） | R1 | 未完成 · 工作流缺失 | 未发现用户预约、开播任务及推送闭环。 **待补：**补预约去重、取消、站内消息和设备推送。 |
| LI03 | 真实直播推流观看及稳定性（P038/P094） | R1 | 未完成 · 工作流缺失 | live接口明确playbackAvailable:false。 **待补：**接推流、限时观看准入、重连及供应商回调。 |
| LI04 | 审核回放与原权益复用（D6.5） | R1 | 未完成 · 工作流缺失 | 回放表存在，未发现审核后授权播放交付。 **待补：**补录制入库、审核、与原权益一致的凭证。 |
| LI05 | 直播弹幕评论和经典引用（P039） | R1 | 未完成 · 工作流缺失 | 未发现实时房间评论WebSocket及禁言即时生效。 **待补：**补评论、举报、引用与主持治理。 |
| LI06 | 直播连麦与主持人控制（P039） | R2 | 未完成 · 工作流缺失 | 未实现连麦申请及主持控制。 **待补：**接双端SDK和服务器审批。 |
| LI07 | 古风礼物打赏（P039） | R2 | 未完成 · 工作流缺失 | 礼物实体无余额收款、消费和分成闭环。 **待补：**独立余额账本、支付验签及退款处理。 |
| LI08 | 直播投票问卷（P039） | R2 | 未完成 · 工作流缺失 | 未发现房间投票创建、投票去重和结果流。 **待补：**补投票生命周期和准入校验。 |
| LI09 | 直播课程商品活动卡和会员入口（P040） | R1 | 未完成 · 部分实现 | 文章直播预告可关联课程；正式直播房间商品活动购买入口不完整。 **待补：**在真实房间接商品/课程/活动/会员交易卡片。 |
| LI10 | 直播秒杀限时营销（P040） | R2 | 未完成 · 工作流缺失 | 未发现直播限时营销库存及结账规则。 **待补：**补独立预留、限购和服务端时间核算。 |
| LI11 | 老师App内开播（D6.5） | R2 | 未完成 · 工作流缺失 | 未发现老师App推流开播。 **待补：**接原生推流、授权密钥、状态回调及异常结束。 |

证据入口：[services/api/src/discovery.ts](<C:/Users/l6658/Documents/ChatGPT/道学书院/services/api/src/discovery.ts>)、[services/api/src/editorial.ts](<C:/Users/l6658/Documents/ChatGPT/道学书院/services/api/src/editorial.ts>)、[services/api/src/main.ts](<C:/Users/l6658/Documents/ChatGPT/道学书院/services/api/src/main.ts>)、[apps/mobile/pages/live/detail.uvue](<C:/Users/l6658/Documents/ChatGPT/道学书院/apps/mobile/pages/live/detail.uvue>)。

## 论坛治理

| ID | 需求与原文定位 | 阶段 | 判定 | 当前事实 / 未完成原因 |
| --- | --- | --- | --- | --- |
| FO01 | 论坛六分区可用内容流（P044） | R1 | 已完成 · 能力闭环已验证 | 六分区、分页公开内容流和课程范围筛选可用。 |
| FO02 | 图文发帖（P045） | R1 | 已完成 · 能力闭环已验证 | 图文投稿、专用图片上传、审核后公开、撤回和失败保留输入实现。 |
| FO03 | 音视频发帖（P045） | R2 | 未完成 · 工作流缺失 | 未发现论坛音视频投稿和审核交付。 **待补：**补上传转码审核及播放。 |
| FO04 | 回复与引用经典或文章（P045） | R1 | 已完成 · 能力闭环已验证 | 引用已发布文章版本、正文快照和回复流程已实现。 |
| FO05 | 论坛点赞收藏（P045） | R1 | 已完成 · 能力闭环已验证 | 帖子点赞收藏、取消及用户状态回显可用。 |
| FO06 | 话题标签及筛选（P045） | R1 | 已完成 · 能力闭环已验证 | 标签、话题及分区筛选通过接口和页面消费。 |
| FO07 | 精华和运营置顶（P045） | R1 | 已完成 · 能力闭环已验证 | 精华、置顶由授权运营操作，记录原因并校验版本。 |
| FO08 | 参与次数和质量成长评价（P045） | R2 | 未完成 · 部分实现 | 审核帖、打卡和学习可积累限额成长。 **待补：**质量评价维度和完整参与规则未实现。 |
| FO09 | 论坛内容审核（P046） | R1 | 已完成 · 能力闭环已验证 | 公共内容先审后发，待审详情不公开，专用审核有审计。 |
| FO10 | 举报与封禁禁言（P046） | R1 | 已完成 · 能力闭环已验证 | 举报处理、禁言封禁、原因记录及站内回执可用。 |
| FO11 | 屏蔽拉黑用户（P046） | R1 | 已完成 · 能力闭环已验证 | 用户拉黑、取消及内容流/直接互动过滤已实现。 |
| FO12 | 征文主题活动（P046） | R2 | 未完成 · 工作流缺失 | 未发现征文创建、投稿关联、截止与评选工作流。 **待补：**补运营活动及授权记录。 |
| FO13 | 受限课程讨论区（D6.6） | R1 | 已完成 · 能力闭环已验证 | 课程讨论依当前有效课程/会员权益鉴权，不靠群码授权。 |

证据入口：[services/api/src/forum.ts](<C:/Users/l6658/Documents/ChatGPT/道学书院/services/api/src/forum.ts>)、[services/api/src/media.ts](<C:/Users/l6658/Documents/ChatGPT/道学书院/services/api/src/media.ts>)、[apps/mobile/pages/community/index.uvue](<C:/Users/l6658/Documents/ChatGPT/道学书院/apps/mobile/pages/community/index.uvue>)、[apps/mobile/pages/community/editor.uvue](<C:/Users/l6658/Documents/ChatGPT/道学书院/apps/mobile/pages/community/editor.uvue>)、[apps/admin/src/pages/forum/index.tsx](<C:/Users/l6658/Documents/ChatGPT/道学书院/apps/admin/src/pages/forum/index.tsx>)、[services/api/test/forum.test.mjs](<C:/Users/l6658/Documents/ChatGPT/道学书院/services/api/test/forum.test.mjs>)。

## 商城交易

| ID | 需求与原文定位 | 阶段 | 判定 | 当前事实 / 未完成原因 |
| --- | --- | --- | --- | --- |
| SH01 | 商城五类目录与实物详情（P050） | R1 | 已完成 · 能力闭环已验证 | 五类商品目录、详情、文化文字和发布可见性可用。 |
| SH02 | 数字商品自动交付（P050） | R1 | 未完成 · 工作流缺失 | 未发现数字商品支付后领取、短期签名及退款撤销。 **待补：**补自动交付权益与实际文件访问。 |
| SH03 | 服务商品预约交付（P050） | R1 | 未完成 · 工作流缺失 | 服务商品无统一预约库存和履约。 **待补：**关联可售服务/时段及取消退款。 |
| SH04 | 商品SKU及购物车管理（P051） | R1 | 已完成 · 能力闭环已验证 | SKU启停、价格库存版本、购物车数量及失效规格提示已实现。 |
| SH05 | 收货地址管理（P051） | R1 | 已完成 · 能力闭环已验证 | 本人地址增改删、默认地址、数量限制和手机号校验实现。 |
| SH06 | App真实报价确认与下单（P051） | R1 | 未完成 · 部分实现 | 真实报价与地址快照、预占订单代码存在。 **待补：**生产create被门禁禁用，购物车/商品checkoutEnabled:false。 |
| SH07 | 真实支付验签回调及查单（P051） | R1 | 未完成 · 工作流缺失 | 商品订单未接真实支付；课程专用微信服务不能当商品支付证据。 **待补：**实现商品收款、金额验签、查单和异常补偿。 |
| SH08 | 订单历史详情与状态跟踪（P051） | R1 | 未完成 · 部分实现 | 本人历史及订单详情有接口；当前仅预占和取消阶段。 **待补：**补付款到发货签收售后的真实状态跟踪。 |
| SH09 | 发货物流单号签收（P051） | R1 | 未完成 · 工作流缺失 | 发货实体不等于可执行发货、单号、签收流程。 **待补：**补专用履约页面、用户查询和审计。 |
| SH10 | 物流轨迹查询接口（P051） | R2 | 未完成 · 工作流缺失 | 未接物流服务查询轨迹。 **待补：**接真实承运商、失败回退及隐私保护。 |
| SH11 | 退款退货换货与咨询（P051） | R1 | 未完成 · 工作流缺失 | 商品退货换货、分项退款和咨询协同未闭环。 **待补：**接申请、审核、退货收货、真实退款与库存调整。 |
| SH12 | 优先物流（P051） | R2 | 未完成 · 工作流缺失 | 未实现优先物流可售选项和覆盖约束。 **待补：**接服务覆盖、价格及实际履约。 |
| SH13 | 基础实物地区运费配置与报价计算（D6.7） | R1 | 已完成 · 能力闭环已验证 | 地区配送开关、基础费、附加费和免运门槛服务端报价。 |
| SH14 | 正式库存预占支付扣减与释放（D6.7） | R1 | 未完成 · 部分实现 | 原子预占、超时释放、取消有开发测试。 **待补：**生产支付扣减、迟到回调、真实库存和退款释放尚未闭环。 |
| SH15 | 正式交易快照及退款分摊（D6.7） | R1 | 未完成 · 部分实现 | 旧商品预占订单保存价格与地址快照。 **待补：**商品正式支付、部分退款分摊与履约账本未接。 |
| SH16 | 新品热销及课程配套推荐（P052） | R1 | 未完成 · 部分实现 | 首页可人工选取目录商品；暂无完整销量排名和课程配套运营。 **待补：**补真实热销统计、新品及课程关联配置。 |
| SH17 | 折扣满减营销（P052） | R2 | 未完成 · 工作流缺失 | 未发现满减、限时折扣与正式结账择优。 **待补：**补活动规则、报价及退款分摊。 |
| SH18 | 商品文化溯源及质量审核（P052） | R1 | 未完成 · 正式交付未验证 | 文化溯源文字、审核状态及来源实体存在。 **待补：**当前样例不能证明真实来源和质量；补实际证据审核。 |
| SH19 | 商品草稿审核发布下架和审计基础（D6.7） | R1 | 已完成 · 能力闭环已验证 | 草稿、规格检查、提交审核、发布、下架和审计闭环。 |

证据入口：[services/api/src/shopping.ts](<C:/Users/l6658/Documents/ChatGPT/道学书院/services/api/src/shopping.ts>)、[services/api/src/orders.ts](<C:/Users/l6658/Documents/ChatGPT/道学书院/services/api/src/orders.ts>)、[services/api/src/catalog.ts](<C:/Users/l6658/Documents/ChatGPT/道学书院/services/api/src/catalog.ts>)、[apps/mobile/pages/product/detail.uvue](<C:/Users/l6658/Documents/ChatGPT/道学书院/apps/mobile/pages/product/detail.uvue>)、[apps/mobile/pages/order/confirm.uvue](<C:/Users/l6658/Documents/ChatGPT/道学书院/apps/mobile/pages/order/confirm.uvue>)、[apps/admin/src/pages/products/index.tsx](<C:/Users/l6658/Documents/ChatGPT/道学书院/apps/admin/src/pages/products/index.tsx>)、[services/api/test/orders.test.mjs](<C:/Users/l6658/Documents/ChatGPT/道学书院/services/api/test/orders.test.mjs>)。

## 会员积分

| ID | 需求与原文定位 | 阶段 | 判定 | 当前事实 / 未完成原因 |
| --- | --- | --- | --- | --- |
| ME01 | 三级月季年套餐基础配置（P056） | R1 | 未完成 · 部分实现 | 套餐CRUD支持tier/days；线上仅入门月卡、进阶季卡、至尊年卡3个测试套餐。 **待补：**三级各自的月/季/年产品组合、正式价格和权益矩阵未完整落地；配置入口不能算完整套餐交付。 |
| ME02 | 会员购买续费开通（P056/P076） | R1 | 未完成 · 工作流缺失 | 会员购买入口不具备真实支付续费。 **待补：**补订单、产品映射、延期/跨级排队、通知与退款。 |
| ME03 | 人工会员补偿及生效排队撤销（D6.8） | R1 | 已完成 · 能力闭环已验证 | 人工授权按现有到期日排队，生效到期和撤销写审计。 |
| ME04 | 消费互动打卡成长升级规则（P056） | R1 | 未完成 · 部分实现 | 学习、有效打卡和审核内容有成长值和每日上限。 **待补：**消费来源及更完整成长升级规则未闭环。 |
| ME05 | 按层级访问指定文章课程基础（P058） | R1 | 已完成 · 能力闭环已验证 | 按有效会员层级控制指定文章与课程，不撤销独立课程权。 |
| ME06 | 新课优先学习（P058） | R1 | 未完成 · 工作流缺失 | 未发现会员新课提前开放窗口配置。 **待补：**补时间窗、会员层级和新课公开规则。 |
| ME07 | 会员商品折扣（P059） | R1 | 未完成 · 工作流缺失 | 商品报价尚未使用可兑现会员折扣权益。 **待补：**补权益快照、折扣核算及实付退款。 |
| ME08 | 会员购课立减（P059） | R1 | 未完成 · 工作流缺失 | 课程报价无会员折扣产品闭环。 **待补：**补数字渠道产品映射和会员立减报价。 |
| ME09 | 会员免邮权益（P059） | R1 | 未完成 · 工作流缺失 | 基础运费门槛不等于会员免邮额度。 **待补：**补权益核算、使用记录及范围。 |
| ME10 | 会员论坛置顶申请（P060） | R2 | 未完成 · 工作流缺失 | 运营置顶存在，会员申请和审核配额未实现。 **待补：**补申请、审核及到期清理，不能绕过治理。 |
| ME11 | 会员专属问答（P060） | R1 | 未完成 · 部分实现 | 普通私问/公开答复已实现。 **待补：**会员专属配额、优先级和权益用量未接。 |
| ME12 | 公益活动免费或优惠（P061） | R1 | 未完成 · 工作流缺失 | 活动报名付款本身未实现，会员优惠无交付。 **待补：**补活动报价、会员权益及报名。 |
| ME13 | 研学优先参与（P061） | R2 | 未完成 · 工作流缺失 | 未实现会员专享开放时段和研学报名容量。 **待补：**补优先窗口、余量释放和取消。 |
| ME14 | 消费互动打卡积分获取（P062） | R1 | 未完成 · 部分实现 | 审核公开帖及有效打卡积分有幂等账本。 **待补：**消费奖励、退款冲回、余额不足待抵扣等未实现。 |
| ME15 | 积分兑换优惠券（P062） | R1 | 未完成 · 工作流缺失 | 积分接口明确redemptionAvailable:false。 **待补：**补券库存、原子扣分、兑换幂等及回退。 |
| ME16 | 积分兑换文创和咨询（P062） | R2 | 未完成 · 工作流缺失 | 实物/咨询积分兑换未实现。 **待补：**复用真实商品库存及预约履约。 |
| ME17 | 套餐版本权益快照与用量（D6.8） | R1 | 未完成 · 部分实现 | 实体已建，但现有Membership查询仍关联可编辑plan资料。 **待补：**冻结已购权益版本，接BenefitUsage配额及套餐改版保护。 |

证据入口：[services/api/src/learning.ts](<C:/Users/l6658/Documents/ChatGPT/道学书院/services/api/src/learning.ts>)、[services/api/src/curriculum-admin.ts](<C:/Users/l6658/Documents/ChatGPT/道学书院/services/api/src/curriculum-admin.ts>)、[services/api/src/progression.ts](<C:/Users/l6658/Documents/ChatGPT/道学书院/services/api/src/progression.ts>)、[services/api/src/forum.ts](<C:/Users/l6658/Documents/ChatGPT/道学书院/services/api/src/forum.ts>)、[services/api/src/practices.ts](<C:/Users/l6658/Documents/ChatGPT/道学书院/services/api/src/practices.ts>)、[apps/mobile/pages/membership/index.uvue](<C:/Users/l6658/Documents/ChatGPT/道学书院/apps/mobile/pages/membership/index.uvue>)、[apps/admin/src/pages/memberships/index.tsx](<C:/Users/l6658/Documents/ChatGPT/道学书院/apps/admin/src/pages/memberships/index.tsx>)、[outputs/commercial-review-2026-10-10/production-plan-snapshot.json](<C:/Users/l6658/Documents/ChatGPT/道学书院/outputs/commercial-review-2026-10-10/production-plan-snapshot.json>)。

## 联动活动

| ID | 需求与原文定位 | 阶段 | 判定 | 当前事实 / 未完成原因 |
| --- | --- | --- | --- | --- |
| LK01 | 文章直播名师课程双向关联（P065） | R1 | 未完成 · 部分实现 | 文章关联课程/直播预告、名师关联课程已有入口。 **待补：**缺七板块双向关系编辑和实时可见性完整消费。 |
| LK02 | 优质心得老师点评成为课程案例（P065） | R2 | 未完成 · 工作流缺失 | 未发现公开心得转课程案例的授权申请和点评流程。 **待补：**补用户授权、审核、引用及撤回处理。 |
| LK03 | 购课会员自动社群权限（P066） | R1 | 未完成 · 部分实现 | 已有访问权可进入课程讨论。 **待补：**真实购课和会员购买自动准入尚未闭环。 |
| LK04 | 学习配套工具推荐（P066） | R1 | 未完成 · 工作流缺失 | 未发现课程配套商品/工具完整关联与推荐入口。 **待补：**补运营关联、有效性过滤及购买回流。 |
| LK05 | 私人笔记日志自主分享为论坛帖（P067） | R1 | 未完成 · 工作流缺失 | 私人笔记日志只有编辑复制导出，无明确分享转帖流程。 **待补：**经用户主动确认转换，保留私有原件与公开审核。 |
| LK06 | 精选内容运营推广（P067） | R2 | 未完成 · 部分实现 | 首页精选、精华置顶可运行。 **待补：**跨内容推广排期、成效及审核未完整实现。 |
| LK07 | 文章购课不超过三步（P070） | R1 | 未完成 · 部分实现 | 文章关联到课程及购买页路径存在。 **待补：**真实成交和登录/支付回跳未验证，不能只数页面步骤。 |
| LK08 | 简化直播预约商品下单（P070） | R1 | 未完成 · 部分实现 | 商品报价有入口，直播预约未实现，生产下单禁用。 **待补：**补真实预约及结账后验证简化流程。 |
| LK09 | 一键收藏与快速私人记录基础（P070） | R1 | 已完成 · 能力闭环已验证 | 文章一键收藏、选文记录和私人日志弹窗减少填写步骤。 |
| LK10 | 统一活动报名支付席位核销（D6.3/D6.7/P078） | R1 | 未完成 · 工作流缺失 | 活动仅目录与发布管理，没有报名支付席位核销。 **待补：**实现免费/付费报名、占位、取消、核销角色及幂等。 |
| LK11 | 高质量古风视觉和可读性验收（P069） | R1 | 未完成 · 正式交付未验证 | 既有宋体标题、米白墨青、淡山水及留白，Web巡检无溢出破图。 **待补：**截图和编译不足以完成高质量验收；字体实际加载、大字、长文和无障碍须验证。 |
| LK12 | 在线反馈表单及处理回执（P072） | R1 | 已完成 · 能力闭环已验证 | 反馈表单、版本处理、客服回复、本人回执及失败保留输入闭环。 |
| LK13 | 真实在线电话客服渠道（P072） | R1 | 未完成 · 正式交付未验证 | 客服配置和反馈入口可展示，当前为测试联系方式。 **待补：**提供并验证实际值班电话/客服，不能把样例当真实渠道。 |
| LK14 | 定期用户意见收集和版本迭代（P072） | 运营 | 未完成 · 正式交付未验证 | 尚无真实运营意见收集、迭代周期及用户反馈结果。 **待补：**建立持续收集处理复盘证据。 |

证据入口：[services/api/src/discovery.ts](<C:/Users/l6658/Documents/ChatGPT/道学书院/services/api/src/discovery.ts>)、[services/api/src/forum.ts](<C:/Users/l6658/Documents/ChatGPT/道学书院/services/api/src/forum.ts>)、[services/api/src/feedback.ts](<C:/Users/l6658/Documents/ChatGPT/道学书院/services/api/src/feedback.ts>)、[services/api/src/events-admin.ts](<C:/Users/l6658/Documents/ChatGPT/道学书院/services/api/src/events-admin.ts>)、[apps/mobile/pages/profile/library.uvue](<C:/Users/l6658/Documents/ChatGPT/道学书院/apps/mobile/pages/profile/library.uvue>)、[apps/mobile/pages/event/detail.uvue](<C:/Users/l6658/Documents/ChatGPT/道学书院/apps/mobile/pages/event/detail.uvue>)、[outputs/automated-test-2026-10-10/browser-summary.json](<C:/Users/l6658/Documents/ChatGPT/道学书院/outputs/automated-test-2026-10-10/browser-summary.json>)。

## 后台经营与上线

| ID | 需求与原文定位 | 阶段 | 判定 | 当前事实 / 未完成原因 |
| --- | --- | --- | --- | --- |
| OP01 | 使用官方Ant Design Pro模板二开（U后台） | R1 | 已完成 · 能力闭环已验证 | 直接在官方Ant Design Pro模板二开，来源和许可记录齐全。 |
| OP02 | 最新后台可部署构建（D后台） | R1 | 已完成 · 能力闭环已验证 | 后台类型检查和生产构建通过，HTTPS线上部署和浏览器登录验证通过。 |
| OP03 | 真实经营看板（D后台） | R1 | 已完成 · 能力闭环已验证 | 数据库驱动内容/活跃/待办看板及录播收款退款净额趋势，权限过滤。 |
| OP04 | 运营审核客服财务资源权限（D4/P080） | R1 | 已完成 · 能力闭环已验证 | 40项模块权限、角色菜单、账号冻结/会话撤销、资源归属及审计已有实现。 |
| OP05 | 课程商城礼物平台收入及合作分成（P075） | R1 | 未完成 · 工作流缺失 | 录播专用账本存在；商城、礼物及合作分成结算未交付。 **待补：**统一实际渠道、手续费、退款、合作比例快照与结算凭证。 |
| OP06 | 公益课程降低分成与公益会员（P075/P076） | R2 | 未完成 · 工作流缺失 | 未发现公益课程分成政策与公益会员交付。 **待补：**补公益规则、资格和结算。 |
| OP07 | 广告推荐位与名师推广收费（P077） | R2 | 未完成 · 工作流缺失 | 未发现广告排期及名师推广合同报价交付收费链路。 **待补：**补明确广告标识、排期审核、合同与服务收入。 |
| OP08 | 活动与运营服务收入记录（P078） | R1 | 未完成 · 工作流缺失 | 活动/运营服务有实体但无真实收入收款及履约记录链路。 **待补：**补订单、人工付款核验及服务交付。 |
| OP09 | 真实名师品牌机构合作和分成落地（P080/P081/P082） | 运营 | 未完成 · 正式交付未验证 | 当前合作对象与协议主要为测试记录。 **待补：**需真实机构名师准入及分成合同，不由代码代替。 |
| OP10 | Android/iOS正式构建与核心链路验收（P085） | R1 | 未完成 · 正式交付未验证 | Android有历史编译安装；Web业务测试通过，iOS正式包无验收证据。 **待补：**正式API双端包、登录支付媒体上传权限推送核心流程验收。 |
| OP11 | 生产部署HTTPS可靠任务和恢复（P085/P094） | R1 | 未完成 · 部分实现 | 后端和后台HTTPS部署、持久库媒体、重启、证书续期与每日本地备份已实证。 **待补：**生产支付任务未启用验证、异地备份和完整故障恢复/告警验收缺失。 |
| OP12 | 真实内容商品种子内测（P085/P086） | 运营 | 未完成 · 正式交付未验证 | 规范手动测试数据已完整导入线上，数量和媒体一致。 **待补：**当前是用户授权保留的测试场景，尚无真实版权商品与目标用户内测证据。 |
| OP13 | 上线推广及名师种子用户邀请（P087/P089） | 运营 | 未完成 · 正式交付未验证 | 未找到真实上线推广和种子用户邀请结果。 **待补：**由运营提供推广及用户验证记录。 |
| OP14 | 道学主题活动短视频社群引流（P090） | 运营 | 未完成 · 正式交付未验证 | 未找到真实活动短视频社群引流执行成果。 **待补：**完成运营策划及活动回收验证。 |
| OP15 | 道学垂直推荐与内容获客（P090） | 运营 | 未完成 · 正式交付未验证 | 标签推荐软件有实现，实际道学获客效果未证明。 **待补：**建立真实内容及转化数据。 |
| OP16 | 线下线上活动联动回顾（P091） | 运营 | 未完成 · 正式交付未验证 | 线下线上活动联动回顾尚无实际履约证据。 **待补：**完成活动执行、回顾与用户授权。 |
| OP17 | 专业道学内容审核团队与准确性（P093） | 运营 | 未完成 · 正式交付未验证 | 软件审核角色存在，真实专业内容团队尚无证明。 **待补：**明确审核人、资质、标准及实际审校记录。 |
| OP18 | 长期维护及直播视频稳定运维（P094） | 运营 | 未完成 · 正式交付未验证 | 运行备份基础有实现，视频/直播未交付，尚无长期SLA告警证明。 **待补：**建立监控值守、故障处理与媒体质量维护记录。 |
| OP19 | 合作方筛选及内容商品品质机制（P095） | 运营 | 未完成 · 正式交付未验证 | 商品状态审核可用，真实合作方品质筛选尚无实证。 **待补：**完成准入、抽检、追溯与持续复核。 |
| OP20 | 独家名师系统实践差异化成果（P096） | 运营 | 未完成 · 正式交付未验证 | 测试内容不能证明独家名师与系统实践商业成果。 **待补：**真实内容授权、学习交付和用户实践结果。 |

证据入口：[apps/admin/THIRD_PARTY.md](<C:/Users/l6658/Documents/ChatGPT/道学书院/apps/admin/THIRD_PARTY.md>)、[apps/admin/config/routes.ts](<C:/Users/l6658/Documents/ChatGPT/道学书院/apps/admin/config/routes.ts>)、[services/api/src/admin.ts](<C:/Users/l6658/Documents/ChatGPT/道学书院/services/api/src/admin.ts>)、[services/api/src/admin-management.ts](<C:/Users/l6658/Documents/ChatGPT/道学书院/services/api/src/admin-management.ts>)、[services/api/src/admin-permissions.ts](<C:/Users/l6658/Documents/ChatGPT/道学书院/services/api/src/admin-permissions.ts>)、[services/api/src/system-config.ts](<C:/Users/l6658/Documents/ChatGPT/道学书院/services/api/src/system-config.ts>)、[services/api/src/domain-policy.ts](<C:/Users/l6658/Documents/ChatGPT/道学书院/services/api/src/domain-policy.ts>)、[services/api/test/admin-management.test.mjs](<C:/Users/l6658/Documents/ChatGPT/道学书院/services/api/test/admin-management.test.mjs>)、[docs/24-online-deployment.md](<C:/Users/l6658/Documents/ChatGPT/道学书院/docs/24-online-deployment.md>)、[outputs/deployment-2026-10-10/api-checks.json](<C:/Users/l6658/Documents/ChatGPT/道学书院/outputs/deployment-2026-10-10/api-checks.json>)。
