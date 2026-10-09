# 老子道学书院 App：技术调研与选型决策

日期：2026-10-06；版本：1.0；适用范围：`01-product-requirements.md` 中的 Android、iOS App、运营后台及服务端。

## 1. 已选定的整体方案

| 层次 | 采用方案 | 选择原因与边界 |
| --- | --- | --- |
| 手机 App | **uni-app x 蒸汽模式 + Vue 3 + TypeScript + `.uvue`** | 遵循用户建议；共用业务页面，原生渲染；优先新的蒸汽模式，不从旧 VDOM/5+ 工程开始 |
| 原生扩展 | **UTS 插件；必要时 Kotlin / Swift 混编** | 只用于内购、实时音视频、受控下载等内置 API 不能覆盖的功能 |
| App 工具链 | **HBuilderX 正式版 5.26.2026091802 作为初始候选，配套云构建** | 官方正式版变更页当前列出该版本；开始开发前下载核验并固定编译器/插件组合；不使用 Alpha 作为发布基线 |
| 运营后台 | **Ant Design Pro官方模板二次开发；Umi Max 4.7.22 + React 19.2.7 + TypeScript 5.9 + Ant Design 6.6.0 + ProComponents 3.1.14-2** | 用户明确要求直接使用模板；直接导入官方完整模板源码，保留原版布局/分析图表/主题设置，裁剪无关演示并接回书院真实API；来源与许可见apps/admin/THIRD_PARTY.md |
| 服务端 | **Node.js 24 LTS + NestJS 12 + TypeScript 5.9，Express 适配器** | 统一类型语言、模块组织清楚、接口文档和权限治理成熟；使用一个应用，不做微服务 |
| 数据库/ORM | **PostgreSQL 17 + Prisma ORM 7 + `@prisma/adapter-pg` + `pg`** | 订单、库存、预约、账本依赖关系和事务；迁移与查询类型检查；复杂锁与约束允许参数化 SQL |
| 缓存/异步 | **Redis 7.4 + BullMQ 6 + `@nestjs/bullmq` 12** | 验证码限流、直播房间状态、延迟关单、通知、回调补偿和异步审核；数据库仍是财务/权益事实来源 |
| 搜索/推荐 | **PostgreSQL 查询 + 可选 `pg_trgm`；规则推荐** | 初始内容规模不需要独立搜索集群；中文短词用明确字段匹配，不声称默认英文分词就是中文搜索 |
| 图片/资料 | **腾讯云 COS 私有桶 + 短期签名访问；公开封面独立发布** | 上传、权限隔离、减少业务服务器带宽；数字资料不返回永久公开下载地址 |
| 点播/转码 | **腾讯云 VOD + CDN；App 内置 video 起步** | 课程、音视频文章、回放；使用服务商上传、转码、回调，避免自己搭建媒体系统 |
| 直播观看 | **腾讯云 CSS，R1 HTTPS HLS 播放 + 自有 WebSocket 评论** | 内置 video 可覆盖 HLS；R1 接受传统直播延迟并在业务说明中明确 |
| 连麦/实时咨询 | **腾讯云 TRTC，经 UTS 原生插件接入，R2** | 多人互动/一对一需要实时音视频 SDK；不能用 HLS 冒充实时连麦 |
| 手机短信 | **腾讯云 SMS** | 正式短信签名和模板；开发环境只在非生产允许固定测试验证码 |
| 内容审核 | **腾讯云内容安全 + 人工审核后台** | 文本/图片自动检查，公开音视频送审或人工复核；第三方判断不替代运营复核 |
| 推送 | **uni-push 2.0；NestJS → 小型 uniCloud 签名网关 → uni-cloud-push** | 使用官方客户端能力；uniCloud 只承担推送桥接，不承载订单、用户或会员数据库 |
| 支付 | **Android 微信 App 支付/支付宝 App 支付；iOS 数字内容 StoreKit 内购，实物/线下服务走外部支付** | 支付路由按平台和商品性质确定，不能所有商品共用一个第三方收款入口 |
| 部署 | **Linux + Docker Compose + Nginx + 独立备份** | 单体 API/worker、后台静态资源、PostgreSQL/Redis；不引入 Kubernetes、服务网格 |
| 文档与测试 | **OpenAPI；Node 内置测试优先；后台 Vitest/必要的 Playwright；App 官方自动化 + 真机** | 测试资金、权限、库存和主要业务流程；不机械地为每个 getter 写测试 |

以上是技术选择，不是声明已经安装、采购、注册、打包或完成 SDK 兼容验证。

## 2. 调研方法与证据范围

优先核查 DCloud、Apple、框架官方文档、官方代码仓库、官方 npm 注册表以及腾讯云产品页面。

本次联网搜索工具返回网关 404，因此通过 HTTPS 直接获取官方页面，正文提取到 `work/research/`，包含来源 URL、最终重定向地址及版本元数据。未从第三方教程推断 uni-app x 支持能力。

- **已核实**：蒸汽模式的平台版本门槛、TS/JS 业务代码、UTS 原生插件路径、内置 video 协议变化、微信/支付宝客户端支付、推送客户端/云端 API、云打包签名配置、Apple 支付类别、Prisma 7 环境/ESM/driver adapter 要求、后端依赖版本关系。
- **尚未实际验证**：本项目的 Android/iOS 构建、StoreKit UTS 桥接、TRTC UTS 组件、音视频离线缓存、长文章选文标注、具体推送厂商通道和真实支付回调。
- HBuilderX CLI 文档站是动态页面，直接 HTTP 读取未获得其完整构建命令正文。官方 uni-app x 文档确认 CLI 的存在，官方测试文档确认 `uniapp.test`；**不编造尚未读取/运行的打包命令**。
- 腾讯云某些旧文档 URL 已重定向到其他产品，不作为对应能力证据；采用已读取的产品页和有效的新文档。
- 网页和注册表可变化；下面的兼容版本是候选基线，创建工程时以实际安装、编译和锁文件验证作为最终版本记录。

## 3. uni-app x 的关键结论

### 3.1 选择蒸汽模式，业务代码使用 TypeScript

官方概述明确区分：旧 VDOM 模式用 UTS 跨语言编译；蒸汽模式业务层改用 JS/TS，UTS 主要继续用于原生插件。纯 JS npm 库能在蒸汽模式中使用，但依赖浏览器 DOM、Node 文件系统或特定平台 API 的库不能直接搬进 App。[官方概述](https://doc.dcloud.net.cn/uni-app-x/)

蒸汽模式 Android 门槛 HBuilderX 5.21+，iOS 5.11+；iOS 运行门槛 15+。项目可在 manifest 可视化配置中开启；不自行猜测 manifest 内部开关名。基于这个选择，**产品支持范围定为 Android 8+、iOS 15+**，Android 下限是本项目自行选择的测试与维护范围。[蒸汽模式](https://doc.dcloud.net.cn/uni-app-x/app-vapor.html)

官方正式版页当前列出 5.26.2026091802，作为候选基线；对应原生 SDK 蒸汽支持要求 5.25+。[正式版记录](https://doc.dcloud.net.cn/uni-app-x/release.html)、[原生 SDK](https://doc.dcloud.net.cn/uni-app-x/native/index.html)

实施纪律：

- `.uvue` 页面以官方新项目模板为准；业务 `<script setup lang="ts">` 在该基线实际编译验证后固定。
- App 不单独强行升级 DCloud 配套的 Vue/编译器；运营后台的React/Umi依赖不覆盖App配套编译环境。
- 不调用 `plus.*`、旧 nvue/weex API；不因旧 uni-app 插件名字相似而默认兼容。
- CSS 使用官方支持子集，主要采用 flex；正文放 `text` 等合适组件内。长列表优先官方列表能力，避免一次渲染全部文章/商品。
- 蒸汽模式采用 Composition API，不写 Options API；按官方2.0样式隔离规则组织组件，不依赖后代选择器。复用 list-item 的 v-for 必须有稳定 key；原生视图组件插件按 native-view 标准模式接入，不能套用旧兼容模式。
- App R1 全局状态用少量 Vue 响应式状态维护会话/购物车/播放；不为了和后台统一而先装复杂状态库。
- 网络先使用 `uni.request`、上传使用官方 API；不把 axios 的浏览器适配器当作必备 App 网络层。
- 页面和 UTS 插件通过轻量 JSON DTO/回调交互，避免共享 Nest/Prisma 运行时代码。

### 3.2 UI 组件

App 使用内置组件 + 项目自己的少量业务组件，统一颜色、间距、字体、卡片和按钮；需要复杂控件时优先核查官方 uni-ui x 的蒸汽兼容版本。

暂不引入只支持老 uni-app/VDOM 的 UI 库，不为了古风效果引入 Web DOM 动画库。后台使用Ant Design Pro官方模板的标准管理界面。App视觉以用户提供的两张设计图为基线：墨青#17292D、黛青#245564、米白#F4F0E7、暖灰#D8D4CA、朱砂#B95543；紧凑列表、细分隔、宋体与山水/器物图片。

### 3.3 构建与平台差异

- R1 使用 HBuilderX 工程和官方云打包；Android 输出 APK（国内市场），有明确需求再生成 AAB；iOS 输出使用正式开发者签名的 IPA/TestFlight 构建。
- 包名、Bundle ID、DCloud AppID、渠道签名、微信 AppID 与 Universal Links 按环境维护，生产身份不能随机更换。
- Android 自有签名私钥保存于构建密钥存储；App 包内不放支付私钥。iOS 需要匹配的证书与 provisioning profile，推送、内购及 SDK 权限也需匹配。
- Windows 可提交云构建；本地 Xcode 原生诊断和相应 iOS 自动化运行使用 macOS 节点。不能把当前 Windows 工作区描述为具备本地 Xcode 编译环境。
- HBuilderX 云环境随版本变化，插件支持的 compileSdk、Gradle、Kotlin、Xcode 和最低 OS 必须查对应版本；不要用普通 Android 工程的一套配置覆盖官方云环境。
- 构建记录包括编译器版本、插件版本、原生依赖、签名指纹、环境、构建号、提交哈希和产物校验值。

依据：[云打包](https://doc.dcloud.net.cn/uni-app-x/tutorial/app-package.html)、[云构建环境](https://doc.dcloud.net.cn/uni-app-x/tutorial/app-env.html)

### 3.4 自动化

已确认官方 HBuilderX 测试工具可被 CLI 调用，Windows 命令为安装目录中的 `./cli.exe uniapp.test <platform> --project <ProjectPath>`，需要先安装对应自动化插件并在 IDE 中可运行。正式脚本先读取本地 `--help` 并完成一次运行，再写入 CI。

App 的构建/测试 runner 与服务端 Linux runner 分开；服务端 `pnpm build` 或后台 `vite build` 成功，不能当作 App 已能打包。[官方测试 CLI](https://doc.dcloud.net.cn/uni-app-x/worktile/auto/hbuilderx-cli-uniapp-test.html)、[官方 CLI 说明](https://doc.dcloud.net.cn/uni-app-x/ai/cli-for-aimodel.html)

## 4. 后端架构与数据正确性

### 4.1 模块化单体

一个 NestJS 应用，内部按业务拆模块：identity、content、teacher、learning、commerce、membership、community、live、notification、admin。订单、支付、退款、权益是 commerce/membership 之间明确的事务边界，不为每个实体创建一个独立服务部署。

API 与后台任务共享同一源码和 Docker 镜像，可分别以 api/worker 入口启动。直播房间评论采用一个 WebSocket 服务；初期不采购独立 IM 系统，也不做陌生人私信。

选择 Express 是为了减少中间件/上传/安全相关兼容工作。没有性能证据前不换 Fastify，也不先做 CQRS、DDD 框架、事件总线平台或网关集群。Nest 官方支持 Express 与 Fastify 适配器。[Nest 官方基础文档](https://docs.nestjs.com/first-steps)

### 4.2 Prisma 7 不套用旧版本配置

已确认 Prisma 7 要求的 Node 版本包含 Node 24，且采用 ESM、driver adapter 与 `prisma.config.ts` 配置路径。项目使用 `type: module`，TypeScript NodeNext 模块配置，源码按 Node ESM 规则处理 import；编译、生成 client、迁移和启动须一起通过。

Prisma CLI、Client、adapter-pg 固定同一 7.x 补丁版。本次注册表核实 `7.10.0` 三者可用；`prisma` 的 latest 标签返回 `8.0.0-rc.20`，而 Client 返回 7.10.0，因此**禁止直接安装无版本限定的 latest**。版本标签不能替代稳定性判断。

选择 PostgreSQL 17 是保守的项目基线，不声称它是目前最新数据库。Prisma 负责常规 CRUD/事务；对库存条件更新、唯一约束、行锁、账本幂等和复杂索引使用必要 SQL migration，不绕开数据库一致性。

依据：[Prisma 环境](https://www.prisma.io/docs/orm/reference/system-requirements)、[Prisma 7 升级说明](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7)、[PostgreSQL connector](https://www.prisma.io/docs/orm/overview/databases/postgresql)

### 4.3 金额、库存、事务与账本

- 金额整数分，库内可用 BigInt；HTTP 输出数字前确认安全范围，主键/大整数按字符串传输。不同支付渠道金额/币种分别保存。
- 支付交易、退款交易、权益授予、积分、佣金有数据库唯一键，不能只依赖 Redis 锁。
- 商品预占使用原子条件更新 + 事务；预约容量使用同样的原则；超时释放任务重复执行不增加多份库存。
- 财务账本保留不可变交易和冲正记录；修改状态不等于发生退款/打款。
- 课程与会员授权集中计算；播放/下载签名仅在授权通过后发放，缓存短期有效，不把会员状态永久写入 App。
- 退款、会员撤销与商店通知按已验证的渠道事实重算权益，保留每个授权来源，不因退会员错误地删掉独立购课。
- 账本、订单项、套餐权益和合作分成保存版本快照。

身份安全：访问凭证初始有效15分钟、刷新会话30天，刷新时轮换并检查复用；服务端保存刷新凭证哈希。App 长期刷新凭证放入 iOS Keychain / Android Keystore 保护的存储，使用已验证 UTS 插件，普通 `uni.setStorage` 只存非敏感设置。后台凭证使用 HttpOnly/Secure Cookie 并防 CSRF，管理密码使用 Node crypto.scrypt（随机盐，参数与结果一并持久化，恒时比较）。生产密钥通过环境/密钥存储注入，不写到代码、构建包或正文日志。

### 4.4 异步任务与补偿

Redis/BullMQ 用于通知、关单、查单、审核查询、转码回调处理、报表和对账；初始只按需要创建少量队列。任务 jobId 有业务幂等标识，处理器按“可能重复交付”设计。

可靠性采用最小数据库 outbox：在收款/订单事务中写一条待发送事件，worker 将它投递队列；消费后按业务唯一键防重复。Redis 丢数据时能由数据库待办记录重新补齐。不会把投递成功当作业务处理成功。

Redis 开 AOF 持久化，队列实例使用 `noeviction`，限制普通缓存使用量，失败任务保留并可由后台重试。Redis 故障导致通知延迟时，已确认收款仍然有效；未能提供风控/支付查询的交易操作返回明确错误。

依据：[BullMQ](https://docs.bullmq.io/)、[生产配置](https://docs.bullmq.io/guide/going-to-production)、[幂等任务](https://docs.bullmq.io/patterns/idempotent-jobs)

### 4.5 中文搜索与推荐

初期按分类、标签、作者、标题和关键词匹配，中文短词不依赖默认英文全文搜索。内容数量少时参数化 ILIKE 足够；观察查询计划后加 `pg_trgm` 索引，并验证中文和一至两个字查询的实际结果。

推荐由后台置顶/关联、用户标签匹配、近期开播/上新、受控热度排序组合。浏览历史只用于用户明确知悉的推荐用途。仅当真实检索质量或数据规模不满足目标时再引入中文搜索服务。[PostgreSQL pg_trgm](https://www.postgresql.org/docs/current/pgtrgm.html)

## 5. 支付方案：按商品与平台路由

### 5.1 渠道矩阵

| 购买内容 | Android App | iOS App（大陆初始发行策略） |
| --- | --- | --- |
| 视频/音频课、数字资料、线上多人直播课/训练营 | 微信 App 支付、支付宝 App 支付 | Apple IAP |
| 数字会员、付费文章、数字直播礼物 | 微信/支付宝，独立商品与账本 | Apple IAP；礼物使用 consumable，购买余额不设过期 |
| 实物商品 | 微信/支付宝 | 微信/支付宝等允许的非 IAP 支付 |
| 线下讲座、线下课、研学、现场服务 | 微信/支付宝 | 非 IAP 支付，明示线下履约 |
| 真正实时的一对一咨询 | 微信/支付宝 | 按 Apple 3.1.3(d) 的一对一服务规则采用非 IAP 支付；异步内容和多人课程不能套用这个例外 |

Apple 对 App 内数字内容、订阅和功能解锁要求 IAP；实物/线下消费及真实实时一对一有不同规则。以上是项目遵循官方规则的实现决策，不推广全球各地区例外。[Apple 审核规则 3.1](https://developer.apple.com/app-store/review/guidelines/#payments)

### 5.2 微信与支付宝

- App 使用 `uni.requestPayment`，按 manifest 配置模块与服务商；申请的是 **App 支付**，不是小程序支付。
- 微信 App 支付按官方要求制作匹配配置的自定义基座、包签名和链接，普通运行基座不能证明正式包支持微信支付。
- 后端由官方协议/SDK发起、查单、退款、验签；App 只拿可公开的客户端订单参数。没有商户开通不执行生产收款。
- 客户端取消、未知状态、App 被杀、回调丢失，均用查单/对账处理。前端支付成功回调不能直接发课程权益。

依据：[uni-app x requestPayment](https://doc.dcloud.net.cn/uni-app-x/api/request-payment.html)、[微信 App 支付产品说明](https://pay.weixin.qq.com/doc/v3/merchant/4013070158)

### 5.3 Apple IAP 与服务端验证

`uni.requestPayment` 当前所读的 uni-app x 页面只明确微信/支付宝 provider，未提供可直接套用的 Apple IAP 通道。因此选定：**StoreKit 2 Swift 模块 → UTS 插件 → App TS 页面**，或者在实际查到并真机验证等效官方/维护中的兼容插件后复用；不先假设老 `appleiap` provider 可用。

客户端原生接口至少包含：获取产品、购买、恢复可恢复购买、监听未完成交易、提交交易给服务端、在服务端确认后 finish。原生业务代码不自行发放会员期限。

服务端使用 Apple 官方 Node 库 `@apple/app-store-server-library`，处理交易 JWS 验证、Server API、Server Notifications V2。验证环境、bundleId、productId、外部交易 ID、购买者绑定及撤销信息；沙箱和生产不能互混。[Apple 官方 Node 库](https://github.com/apple/app-store-server-library-node)

为用户生成稳定 UUID 作为 appAccountToken 绑定，不把用户提交的任意账号 ID 当购买者证明；恢复交易若已属于其他平台账号，进入账号恢复/客服流程，不能把权益直接转给当前登录人。乱序服务端通知结合已验证交易状态重算，不简单用“最后收到的一条消息”覆盖状态。

产品映射：

- 长期访问单门课程优先 non-consumable；固定月/季/年手动会员使用适合的 non-renewing 产品，具体恢复和有效期由服务器持久化。
- R2 自动续费才引入 auto-renewable subscription，并实现续费、宽限/账单重试、价格变更、撤销和服务端通知。
- 礼物币使用 consumable，购买余额与免费积分完全独立，不能到期清零；兑换礼物写余额账本和不可重复消费凭证。
- 一个渠道 productId 映射确定的业务 SKU/套餐版本，不使用“随意金额充值”代替所有课程订单。
- iOS 数字优惠不能让后端任意改 Apple 收款价；优惠、拼团和会员数字折扣必须映射已配置且允许的 IAP 产品/优惠机制。没有合法产品映射时，不显示一个执行不了的降价按钮。
- App 外已购可访问的权益按平台允许方式同步；iOS 不增加引导用户外部购买数字内容的链接/二维码。
- iOS 内购退款由商店处理并以撤销/退款通知更新账本；后台只能提供渠道申请说明和内部补偿记录，不能调用微信退款冒充退 Apple 钱。
- 有名额限制的线上课程/训练营需在上线前验证“名额预占 → IAP → 交易迟到 → 名额恢复/补偿”的完整流程；不能按普通可无限复制课程处理超卖，不能承诺商户能自动退款 Apple 交易。

### 5.4 数字与实物会员权益

付费会员以数字服务为主，iOS 购买走 IAP；实物商品结算按独立订单应用已拥有的可用权益。不做一个混合购物车同时收课程、实物与会员费用。商品和套餐页面在价格确认前说明生效时间与内容。

实际商店产品、税费/手续费、折扣和退款政策上线前核验；不把不同渠道售价一致当作技术前提。

## 6. 音视频及内容技术

### 6.1 点播

后台/老师上传媒体时由后端获取短期授权，客户端直传 VOD；业务数据库保存资源 ID、转码状态、审核状态、时长及可用码率，不保存第三方长期密钥。

公开内容使用发布后的播放信息；付费资源私有，权限检查后获取限时凭证。完成转码并审核通过后才可绑定可观看章节。[腾讯云 VOD](https://cloud.tencent.com/product/vod)

R1 使用官方 video + HTTPS MP4/HLS 和倍速、时间事件等能力。官方文档说明 HBuilderX 5.08+ Android/iOS 播放器分别基于 ExoPlayer/AVPlayer，流媒体使用 HLS，不继续提供原先的 RTMP/RTSP/FLV 支持。因此**不把旧版本 RTMP 播放方案写入新项目**。[video 组件](https://doc.dcloud.net.cn/uni-app-x/component/video.html)

限时 URL 不是绝对防录屏措施。若内容合同需要强 DRM 或防盗拷，不以简单 URL 过期声称满足；需另做播放器、许可证服务和设备测试。

### 6.2 直播与实时音视频

R1：后台配置直播/准入 → 授权主播推流到 CSS → 用户 App 请求房间与播放凭证 → HLS 观看 → WebSocket 收发评论 → 挂载课程/商品卡片 → 录制回放入 VOD 并审核。

传统 HLS 延迟适合讲解/观看，不适合老师和用户同时对话。R2 连麦、一对一咨询和 App 开播接入 TRTC/原生推流 SDK，UTS 包装两个平台的官方原生 SDK；房间权限/临时签名由服务端生成。用户申请/主持人批准/移出由业务 API 管理，SDK仅承担媒体传输。

已核实腾讯云 CSS 和 TRTC 分别提供直播、实时互动能力；**尚未找到并验证本项目可直接复用的 uni-app x 蒸汽模式 TRTC 插件**。旧 uni-app 或 Web SDK 示例不视为跨端原生兼容证据。

依据：[CSS](https://cloud.tencent.com/product/css)、[TRTC](https://cloud.tencent.com/product/trtc)、[TRTC iOS 官方接入](https://cloud.tencent.com/document/product/647/78730)、[UTS 插件](https://uniapp.dcloud.net.cn/plugin/uts-plugin.html)

### 6.3 离线学习与笔记标注

R2 离线缓存只用于有权限的课件：保存下载任务、进度、校验值、用户归属、权益来源和有效期。先验证文件 API、后台下载、HLS 分片及播放器能力；内置播放器不能覆盖时使用媒体 SDK。不能直接存永久公共 MP4 后宣称已完成受控缓存。

完整会员课件离线准入使用服务端签名离线许可证，默认每 72 小时联网刷新，会员到期时间是硬上限。整门永久购课按对应授权策略处理；退款撤销最多受已发离线许可证窗口限制，产品说明不得承诺离线立即撤销。

文章结构化为稳定段落块，R1 段落笔记；R2 选文范围记录段落 ID + 起止位置 + 引用快照，先验证原生选择能力。若需局部 WebView 标注工具，限定在文章正文并按严格消息协议通信，不把交易/个人中心整体做成网页壳。

## 7. 推送、上传、审核和分享

### 7.1 推送桥接

App 使用 uni-push 2.0 客户端，取得 push_clientid 后提交 NestJS，与用户/设备/环境绑定。退出移除绑定；同设备账号切换不能把前账号私人通知发给后账号。

NestJS 将指定客户端推送请求发给小型 uniCloud HTTP 云函数；使用 `uni-cloud-s2s` 文档规定的时间戳/数据签名协议，在云端验证后调用 `uni-cloud-push` 的指定 push_clientid 发送。NestJS 侧按同协议实现签名，不错误地把仅用于云函数的库作为服务端通用包安装。

不启用依赖 uni-id 的 user_id/user_tag 推送，不迁移用户体系到 uniCloud。桥接只接收经过授权的服务端请求，限定模板和目标，不接收 App 任意批量推送命令。

Android 厂商离线通道、iOS APNs 证书和通知权限需要实际配置；推送不保证送达，订单/课程事实留在站内消息与 API。

依据：[客户端推送](https://doc.dcloud.net.cn/uni-app-x/api/uni-push.html)、[服务端推送](https://doc.dcloud.net.cn/uniCloud/uni-cloud-push/api)、[安全通讯](https://doc.dcloud.net.cn/uniCloud/uni-cloud-s2s.html)

### 7.2 上传与审核

图片/附件存 COS，音视频存 VOD；先约定 MIME/扩展名/尺寸/时长限制。用户公共附件以私有状态上传、检查、审核后发布，禁止绕开审核直接使用 public-read 上传。

手机号验证码通过腾讯云 SMS；每手机号/IP/设备限流，存验证码哈希及用途/过期时间。生产环境禁止固定测试验证码。

社区图文采用腾讯云内容安全与人工队列；音视频审核按已开通的服务能力接入，未完成审核不公开。私人笔记和日志不默认送到公开内容池。

依据：[COS](https://cloud.tencent.com/product/cos)、[SMS](https://cloud.tencent.com/product/sms)、[内容安全](https://cloud.tencent.com/product/tscms)、[图片审核](https://cloud.tencent.com/product/ims)

### 7.3 分享及链接

R1 官方系统分享/可复制链接 + 简单公开落地页（后台/服务端同工程提供），用于查看公开介绍和打开 App；不假设用户手机一定装微信。R2 微信 SDK 分享需对应 AppID、签名、Universal Links 真机验证。

分享 URL 不带登录 token、手机号或私人笔记全文。分销链接只包含可验证来源 ID；后端校验来源资格与归因有效期。

## 8. 工程组织与版本策略

推荐一个 Git 仓库：

```text
docs/                      # 需求、选型、后续 API/发布说明
apps/mobile/               # uni-app x HBuilderX 工程
apps/admin/                # Ant Design Pro / React / Umi运营后台
services/api/              # NestJS；含 API/worker 入口、Prisma schema/migrations
functions/push-gateway/    # 只用于推送桥接的 uniCloud 函数
infra/                     # Docker Compose、Nginx、环境样例、备份脚本
work/research/             # 本地调研证据；不作为产品运行依赖
```

Node 工程用 pnpm workspace 管理；mobile 使用自己的 DCloud 工程入口，不能为追求 monorepo 形式强行转成未验证的普通 Vite App 构建。

共享先限于 JSON 数据定义/接口文档；不预先建立大型 shared SDK、组件平台、抽象支付框架或多云资源层。两个真实支付渠道需要的共同调用边界才做最小封装。

### 8.1 候选版本与兼容处理

官方 npm 注册表本次读取结果保存于 `work/research/npm-versions.json`。以下是可开始验证的组合：

| 依赖 | 候选基线 | 说明 |
| --- | --- | --- |
| Node | 24.x LTS | 在运行环境锁定安全补丁；开发/CI/容器同一大版本 |
| Nest core/common/platform | 12.1.2 / 同一 12.x | core 与适配器已核实，同系列其他包安装前核对 peer dependencies |
| TypeScript | 5.9.3 | 已核实可用；不因最新 7.x 标签而强制全栈升级 |
| Prisma CLI/client/adapter-pg | 7.10.0 | 同版本锁定；禁止 CLI 8 RC 与 Client 7 混装 |
| PostgreSQL | 17.x | 以容器/托管服务安全补丁固定；migration 在此版本实际运行 |
| Redis | 7.4.x | 队列持久化、noeviction；作为项目选择而非当前最新版声明 |
| BullMQ / Nest BullMQ | 6.3.11 / 12.0.0 | 本次 peer 范围包含 Nest 12 / BullMQ 6，建队列/重试/停机实测 |
| 后台 React/Umi | 19.2.7 / 4.7.22 | Ant Design Pro官方模板配套；本次验证见开发进度 |
| 后台 Ant Design/ProComponents | 6.6.0 / 3.1.14-2 | 采用上游v6.0.3配套版本；ProComponents为上游采用的预发布版，锁文件固定；升级需回归 |
| HBuilderX | 5.26.2026091802 | 正式版文档候选，需本地可下载、插件编译、双端设备验证 |

锁文件和镜像 digest 才是工程实际版本依据，禁止为了复现这份调研删除已经验证的更合适依赖版本。每次升级都先检查原生插件和支付兼容。

框架依据：[Node 发布策略](https://nodejs.org/en/about/previous-releases)、[Vue](https://vuejs.org/guide/quick-start.html)、[Ant Design Pro模板](https://github.com/ant-design/ant-design-pro/tree/v6.0.3)、[ProComponents](https://procomponents.ant.design/)、[Umi Max](https://umijs.org/docs/max/introduce)。注册表来源是各项目发布者维护的npm包元数据，不将latest标签视为无条件生产推荐。

## 9. 部署、运维和成本

### 9.1 初始部署

开发环境：本地 Node + Compose PostgreSQL/Redis；第三方默认沙箱。正式环境：国内同地域 Linux 主机 + Nginx + api + worker + 后台静态文件；数据库/Redis 初始可同机但独立持久卷与资源限制。

生产容量起始建议 4 vCPU/8GB，磁盘按数据库、日志、备份增长配置，**只是待压测的工程起点，不是当前市场报价或容量保证**。媒体存储与传输不走该主机；增长后优先把 PostgreSQL 迁移到托管数据库，再考虑增加 API 实例。

数据库不暴露公网，Redis 不暴露公网；第三方回调经 Nginx 验证和限流进入后端。先做健康检查、优雅停机、结构化日志、错误追踪与资金任务告警，不先部署一整套监控集群。[Docker Compose](https://docs.docker.com/compose/)

同机方案接受主机故障会暂停业务的限制；上线前把数据库加密备份复制到独立存储，验证恢复流程。资源/并发目标不满足时升级基础设施，而不是偷偷降低交易正确性。

### 9.2 发布与回滚

CI：依赖锁定 → API/后台类型检查与构建 → 资金/权限/库存测试 → Docker 镜像 → 测试环境。App 在固定工具链 runner 构建并保存日志和产物，双端核心能力通过后才进入发行流程。

数据库 migration 使用兼容旧代码的增量变更，先备份并在测试数据运行；禁止生产 `db push`、重建库或用 seed 覆盖用户数据。回滚应用镜像不等于回滚已经发生的收款或破坏性 schema 变更。

App 依靠正常渠道版本更新；没有对平台规则和具体能力验证前，不把热更新用于替代商店审核或原生 SDK 发布。

### 9.3 成本核算

不引用产品促销页的最低单价估算整体预算。成本按以下可量化项目计算，采购时按实际地域、合同和用量查询正式价格：

- 固定项：主机、域名、证书/开发者账户、基础存储、必要的服务套餐。
- 点播：存储 GB/月、转码分钟、出站流量；直播：流量/带宽、录制和转码；TRTC：参与人数 × 分钟及服务质量档位。
- 短信：成功发送条数；审核：文本/图片/音视频量；推送：正式开通套餐及厂商能力。
- 财务：各支付渠道手续费、Apple 商店佣金/税务、退款、老师分成与推广佣金。
- 运营：授权内容、人工审核、客服、物流与线下交付。

示例容量输入用于业务测算，不是服务商承诺：100 人观看 60 分钟、平均 1.5Mbps，大约产生 67.5GB 媒体出站流量（十进制，不计额外开销）；先控制直播码率和场次，比省少量 API CPU 更影响费用。

## 10. 被比较后未采用的方案

| 方案 | 本项目的结论 |
| --- | --- |
| 全套 uniCloud + uni-id + uniPay + uni-admin | 适合云端一体快速项目；本项目多类型订单、事务库存、Apple 内购及合作结算集中在 PostgreSQL/Nest 更清楚，uniCloud 只保留推送桥接 |
| Java/Spring Boot | 可以满足需求，但当前是空仓库，没有现成 Java 业务资产；选择 TypeScript 减少跨语言契约和工具维护 |
| Flutter / React Native | 也能开发 App；遵循用户建议采用 uni-app x，先验证关键原生能力，不额外维护另一套移动框架 |
| 自建流媒体、WebRTC、即时通信平台 | 维护工作明显超过当前业务需要，采用官方音视频服务和有限自有评论通道 |
| 微服务、Kubernetes、Kafka、Elasticsearch | 当前容量与团队形态没有对应需要；用模块化单体、关系型数据库、BullMQ 和数据库搜索 |
| 后台模板裁剪 | 已按用户要求采用Ant Design Pro；保留真实业务所需页面与组件，去除假登录、无关演示和菜单；原版分析图表作为明确标注的示例保留 |

这些是项目权衡，不是宣称其他方案技术上无法完成。

## 11. 开工前的技术验证任务

| 编号 | 验证内容 | 必须得到的证据 | 失败时处理 |
| --- | --- | --- | --- |
| S01 | HBuilderX 选定版本、新蒸汽工程 | Android 和 iOS 可安装/启动，记录完整版本和日志 | 调整已支持正式版组合；仍维持 uni-app x，明确具体阻断点 |
| S02 | 文章/列表/上传/网络/安全存储 | 真机中文长文、字体放大、图片、HTTPS API、会话续期、Keychain/Keystore存取 | 改用已支持组件/布局，不把 Web 预览当原生验收 |
| S03 | 微信/支付宝 App 支付 | 有正式配置的开发包，支付取消/未知/回调/查单沙箱路径 | 修正基座、签名、SDK配置；生产按钮保持未开放 |
| S04 | StoreKit 2 UTS | 产品获取、购买、服务端验证、恢复、退款/撤销通知，沙箱真机 | 复用已验证兼容插件或 Swift 混编；不能用外部数字支付规避 |
| S05 | 点播/HLS 直播 | 双端播放、倍速、后台切换、断线、限时播放凭证/回放 | 调整编码/协议，必要时接原生播放器 |
| S06 | uni-push 2.0 | 站内消息落库、指定设备推送、点击打开、退出解绑、离线通道 | 修正 APNs/厂商配置，站内消息维持真实可用 |
| S07 | Prisma 7/Nest ESM | create/generate/migrate/build/start，事务与 pg driver 可用 | 按官方配置修正，验证前不大量生成业务 CRUD |
| S08 | 交易和队列 | 断 Redis、重复回调、崩溃重启、outbox补投、重复消费 | 修正数据库约束和幂等，不靠手工删账本恢复 |
| S09 | R2 TRTC/App 开播 | 两台真机连麦、一对一、主持人控制、权限/音频中断 | 官方原生 SDK 的 UTS 包装/混编；记录未完成不展示假功能 |
| S10 | R2 离线课与选文笔记 | 两端下载续传/权限到期/标注恢复及导出 | 有限原生插件或文章局部工具，避免换掉整套 App |

S01/S04/S05/S07 是开始大规模 App/交易开发前的主要风险验证，不等到所有页面做完才发现无法接入。

## 12. 启动开发前的机器观察与后续接入

以下为最初调研的历史观察；当前HBuilderX已定位到D:/HBuilderX，原生PostgreSQL与API/后台已运行，最新实现及限制以03-development-progress.md为准。

本次只检查 PATH 和几个常见安装位置：可找到 Node/npm/pnpm/git/JDK 21；PATH 未找到 docker、adb；常见路径未发现 HBuilderX。**这不代表全盘确认未安装，只表示未定位到可用工具链。**

已能使用 Codex 捆绑 Python 读取 Word 和获取官方资料。没有在本轮安装开发环境、初始化应用、调用付费服务或运行真实支付。

后续由开发代理先检查现有工具真实版本和 HBuilderX 安装位置；正常开发环境配置在已授权的开发范围内推进。涉及真实账户、签名私钥、商户资料或发布权的步骤只能使用用户实际提供/配置的数据，不能自造身份。任何缺失接入都应记录具体能力状态，而不把整个工程停在一个泛泛的确认问题上。

## 13. 执行边界

按需求文档中的 R1/R2 覆盖表推进，不能因为采用简单技术栈删掉原文明确要求的业务能力。复杂能力先验证再接入，完成时提供可运行证据。

新的技术决策如影响平台覆盖、付款规则、数据结构或阶段范围，应同步修改本文和需求文档，使后续代理读取到同一套事实。未实际通过真机、支付沙箱或部署验证的能力，必须继续标注为未验证。
