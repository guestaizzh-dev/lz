# 内容阅读阶段：Claude 改动审查与补齐交付

日期：2026-10-09。范围：用户本次列出的 ID13、ID14、AR14、AR15、AR02、AR16，以及此前声明完成的 AR03、AR08、AR10、AR17、AR11。用户的“已完成7个”仅实际列出5项，本报告不补造另外两项。

## 1. 审查结论及处理

原改动不能按清单直接验收：后端无法编译，多处 App 调用未对应实际接口，部分测试绕过 HTTP 直接写数据库。保留了有效的文章、评论与分享入口，在现有服务、鉴权和数据库上修复并补齐。

| 优先级 | 审查前问题与证据 | 影响 | 已落实修复 |
| --- | --- | --- | --- |
| P1 | `schema.prisma` 重复 Report；`reading.ts` 使用不存在的 req.session/ReadingHistory；两套 share 实现引用缺失依赖/模块 | Prisma/TypeScript 构建失败，无法作为可运行交付 | 恢复已有148表基线，复用 ReadingEvent/Report；删除冲突实现和错误 apps/api 迁移目录。审查前差异留在本地忽略目录 |
| P1 | `content.ts` 单块编辑仅 AdminGuard，缺资源角色、版本和发布状态保护；kind=TEXT 与 App type=paragraph 不一致 | 可绕过审核修改内容，或发布后无法显示 | 单块接口撤除，统一现有文章草稿→提交→审核发布流程；图文块校验、唯一稳定键、并发版本和操作审计 |
| P1 | 点赞复合键与 Prisma 模型不符，PUT/POST不一致；私人点赞查询误用 articleId | 点赞不可用或重复 | 按现有 SQL 唯一约束参数化 INSERT ON CONFLICT；统一 POST/DELETE，会员及发布状态校验 |
| P1 | 引用稳定键直接写 Comment.quoteBlockId UUID外键；分页在截断后判断更多；待审父评论可回复；审核无并发版本保护 | 引用报错、翻页丢失、待审信息泄露、重复审核 | 发布生成 ArticleRelease/ArticleBlock，引用映射数据库块ID并存原文快照；先取size+1；只回复可见顶层评论；审核版本更新和审计同事务；回复预览每条最多3条并可继续翻页 |
| P1 | 阅读事件信任全局客户端eventKey；App历史使用Cookie而非Bearer；举报路由和原因枚举不匹配 | 用户事件混用、历史/举报不可用 | 用户+文章+上海业务日+访问键生成服务端哈希；同次访问累计时长取最大值，重试不重复增加；历史按当前用户和当前可发布文章查询；举报统一DTO |
| P1 | 分享硬编码未配置域名，信任客户端标题，无匹配resolver，未检查下架 | 链接打不开或暴露过期内容 | 分享为公开资源身份链接；生成、落地页和解析都检查当前发布状态；HTML转义；域名从PUBLIC_API_URL读取，不存个人分享正文或凭据 |
| P2 | 评论审核、来源证据和内容关联缺实际后台入口；原生CSS/图标存在缺项 | 前后台操作不闭环，原生页面缺失资源 | 直接在官方Ant Design Pro中新增审核页面、文章Drawer运营面板、直播展示管理；修复CSS并补齐Phosphor图标 |
| P2 | 原测试用后台Cookie访问App接口，且多项仅直接写DB再断言 | “完成”缺有效验收证据 | 改为真实Bearer登录、HTTP调用、PostgreSQL约束/归属/并发与清理回归，另做真实浏览器交互 |

## 2. 本次需求完成清单

下表“已完成”指本阶段功能实现及本机集成验收，不表示七板块R1/R2整体上线完成。Android/iOS的实际验证范围单列于第5节。

| ID | 需求 | 状态 | 实现与验收依据 |
| --- | --- | --- | --- |
| ID13 | 综合搜索 | 已完成 | 首页进入搜索；文章、课程、名师、商品、活动、直播统一查询；标题/摘要/标签关键词匹配、类型、标签、相关/最新/点赞排序、分页。只查已发布元数据，不搜索会员私有正文；课程同时检查名师发布状态 |
| ID14 | 标签推荐 | 已完成 | 用户兴趣权重5，最近100条阅读权重1、最近100条点赞权重3、最近100条收藏权重4，按资源聚合最高行为权重后累计标签匹配分。过滤已接触及下架资源，未登录/冷启动回退精选，首页可刷新。不使用训练模型 |
| AR14 | 文本范围标注（降级） | 已完成 | 长按段落或笔记按钮；默认整段，填写连续原文可选择精确范围，重复出现时选择第几处；以UTF-16偏移、原文版本、发布版本和摘录保存；阅读高亮；版本变化时不错误套用旧范围，原摘录留在私人笔记中。没有宣称实现系统原生拖拽选文 |
| AR15 | 笔记、标注、收藏 Markdown 整理导出 | 已完成 | 我的笔记/收藏导出全部私人记录；按文章归组，包含版本、段落、范围、原摘录、笔记和时间；当前下架收藏仅提示下架。服务端按Bearer归属查询并转义HTML/Markdown；Web实际文件下载通过；Android通过沙盒写文件和系统文件分享 |
| AR02 | 注释版本与授权证据 | 已完成 | 文章Drawer录入作者、版本、公开来源、权利人、授权范围和有效期，审核/撤回均留审计。App仅展示审核通过、有人审核且当前有效的证据，不返回私有资产标识/内部审核备注；未录入真实证据时不编造权威背书 |
| AR16 | 文章导向课程/直播 | 已完成 | 后台选择已发布内容，审核关联与排序，支持移除；App实际跳转课程通过。直播关联打开真实资料/排期页；资源、主讲或关联时效变化会重新过滤。直播播放服务仍不属于本阶段已完成能力 |
| AR03 | 图文正文发布与阅读 | 已完成（修复） | paragraph/quote/image统一编辑和渲染；图片HTTPS及说明；发布生成不可变版本和正文块；审核、版本和角色保护复用原流程 |
| AR08 | 文章点赞 | 已完成（修复） | POST点赞、DELETE取消、状态回读；并发幂等；与收藏语义独立 |
| AR10 | 评论与引用 | 已完成（修复） | 提交待审、引用快照、回复与分页、屏蔽用户过滤；后台审核实际闭环及并发测试通过 |
| AR17 | 阅读历史与举报 | 已完成（修复） | 登录用户访问事件归属隔离；同次阅读重试去重；上海日期；历史去掉下架文章；举报原因及说明校验，后台数据工作台可处理举报 |
| AR11 | 可打开分享链接 | 已完成（修复） | 公开元数据落地HTML和App解析；所有详情入口使用实际接口；下架后解析404；开发地址为本机，生产需配置真实可访问域名 |
| 集成测试 | 本机整体功能验收 | 已完成 | 全量API回归、后台正式构建、App Web和Android蒸汽构建；浏览器搜索→文章→标注→导出、评论提交→后台审核→App回显、后台关联→App课程跳转通过。设备证据见第5节 |

## 3. 数据与接口

本阶段没有新增表或执行重置/迁移，保留实际148表。完整字段、索引及SQL约束仍见[07数据库契约](07-database-and-crud.md)。使用以下已有结构：

- Resource / ResourceTag / Tag / UserTag：内容身份、标签和兴趣；Article/Course/Teacher/Product/Event/LiveRoom保留各自业务数据。
- ArticleRelease / ArticleBlock：每次审核发布形成新的releaseNo，正文稳定键映射UUID，用于引用；历史发布不覆盖。
- Reaction：SQL唯一(userId,resourceId,kind)，LIKE和FAVORITE独立；Favorite与FAVORITE依旧由现有触发器同步。
- ReadingEvent：访问事件唯一eventKey，由用户、资源、上海业务日和访问键哈希生成；同访问取最大累计时长；历史按资源聚合最近访问时间与总时长。
- Note：继续使用articleVersion/blockId/quote/text，补用releaseId/rangeStart/rangeEnd；范围UTF-16起止不得切断代理对。读取、修改、删除、导出均限定本人。
- Comment / Report / UserRestriction / UserBlock：评论先审后发、引用快照、举报和可见性约束。
- SourceEvidence / ResourceEvidence / ContentRelation：公开来源、审核与有效期、文章关联。

通用编辑器额外收归6类流程记录：comment、reaction、private_note、source_evidence、resource_evidence、content_relation；禁止通用CRUD改写私人成果摘录或绕过审核。现为52类完整通用CRUD、1类用户资料受限编辑、91类受控实体，查询144类；以前63/58类统计保留为对应历史阶段记录。

| 接口 | 用途 |
| --- | --- |
| GET /discovery/search?q=&type=&tag=&sort=&page=&size= | 综合搜索，最多50条/页 |
| GET /discovery/tags；GET /discovery/recommendations | 可用标签及当前用户/游客推荐 |
| GET /discovery/articles/:id/context；GET /discovery/live/:id | 文章证据/关联与直播安全元数据 |
| POST /articles/:id/reactions；DELETE /articles/:id/reactions/LIKE；GET /articles/:id/reaction-state | 点赞 |
| POST /articles/:id/reading-events；GET /me/reading-history | 阅读访问和本人历史 |
| POST /articles/:id/reports | 举报 |
| GET/POST /articles/:id/comments；GET追加parentId/cursor | 评论、引用、回复 |
| GET /admin/comments；POST /admin/comments/:id/review | 待审评论及版本审核 |
| POST /me/notes；GET/PATCH/DELETE /me/notes[/:id] | 私人笔记与标注，修改仅笔记文本 |
| GET /me/articles/:id/annotations；GET /me/notes/export | 当前版本高亮与即时Markdown导出 |
| GET/POST /admin/articles/:id/editorial/... | 证据录入/审核、关联查询/新增/移除；具体路由见editorial.ts |
| GET /admin/live-discovery；POST /admin/live-discovery/:id/publication | 直播展示资料审核发布/下架 |
| POST /share/links；GET /share/links/:code/resolve；GET /share/open/:code | 分享生成、解析和浏览器落地 |

接口统一前缀 `/api/v1`。分享code仅是公开资源身份，不是鉴权票据；完整会员正文继续经过正常访问权检查。

## 4. 实现选择和限制

1. 初期采用PostgreSQL精确子串匹配和标签规则，不新增搜索集群。关键词不把 `%` 或 `_` 当通配符。大规模数据时根据实测延迟增加检索索引/服务，当前没有做大规模压力测试。
2. AR14使用段落/连续原文范围的降级交互；笔记和引用保存原摘录，旧笔记不随修订漂移。原生系统选文菜单/拖拽手柄仍未实现，不列入本次降级验收。
3. Markdown即时生成，不建立伪异步任务或公开云下载链接；NoteExport为将来异步大批量导出预留，当前不宣称使用。Android导出缓存文件在App沙盒，用户选择系统分享后可另存，已导出的副本由用户管理。
4. SourceEvidence是证据治理能力，不自动认定任意上传材料为权威。本机未伪造正式名师授权或出版许可；生产内容仍需运营实际核查并录入。
5. 分享使用`PUBLIC_API_URL`配置真实API公共地址（包含/api/v1），`PUBLIC_APP_URL`配置Web落地入口；缺省本机开发地址只用于联调，尚未部署生产域名。生产应用继续需要HTTPS API。
6. 不把直播资料页当直播播放器：当前`playbackAvailable:false`，腾讯云播放、推送和真实支付仍是其它阶段未完成内容。

## 5. 验收与剩余边界

- 全量回归日志：`outputs/content-2026-10-09/api-tests.log`；包括真实HTTP、Bearer/Cookie权限、外键、版本冲突、并发点赞/审核、会员正文保护、跨用户笔记/导出隔离、范围代理对校验、搜索筛选与下架联动。
- 界面证据：同目录的搜索、标注、私人笔记、后台关联与评论审核截图；Markdown真实下载保存在本地忽略目录，未提交私人导出正文。
- 后台基于官方Ant Design Pro，已通过类型检查和正式构建；仍运行于`http://127.0.0.1:5173`。API运行于本机`http://127.0.0.1:3000/api/v1`，手机通过ADB反向转发联调。
- Android最终安装包/真机检查记录和测试总数以同目录`acceptance.json`为准。构建成功与真机逐项通过分别记录，不混为一谈。
- iOS签名、iOS真机和跨系统文件接收应用兼容性未完成；Windows环境未执行iOS构建。原生精确系统选文、真实内容授权采购、生产域名部署、直播播放和支付不在本次已完成范围。

本次没有提交、推送或部署Git改动。测试夹具按ID清理，不删除用户原始Word或其它阶段成果；用于界面验收的示例记录属于本机测试数据。
