# App全页面交互与视觉返修

日期：2026-10-31。用户要求检查全部页面，解决反复加载、重复请求、白底控件、字体/间距/对齐问题；保持书院主题及实际业务。不能以网页截图代替原生视觉验收。

## 执行清单

- [ ] 请求层：并发GET去重、公共目录短时内存复用；按会话隔离，写入后失效；交易、权益、播放授权不缓存。
- [ ] 页面生命周期：排除onLoad/onShow/子组件重复加载；返回时保留内容和滚动，初次进入才显示加载，失败可重试。
- [ ] 公共组件：简化加载/空态/错误态，统一按钮、表单与正文，修复默认白底及行高/对齐。
- [ ] 全部76页逐项阅读与实际界面检查，覆盖正常/空态/失败；需要参数或权限的页面单独标记，不能冒充正常流程通过。
- [ ] 320/390/宽屏、关键返回链路与请求次数验证；Web与Android蒸汽构建，更新本地/固定下载包及交付记录。

## 已定位问题

1. `ContentState`用大号“正在整理内容”及长副文案覆盖内容，快速请求也会渲染。
2. 部分onShow直接重载，清空已有列表/隐藏内容；分类配置与首页主图每次出现都请求。
3. 课程详情及关联子组件初次监听和onShow均请求；请求层没有并发GET合并。
4. 按钮缺全局默认值，部分Web默认block与原生flex有差异；正文依赖自定义字体及零散行高，控件出现平台白底。

## 全部页面清单

| 页面 | 代码检查 | 视觉/交互验证 | 问题与处理 |
| --- | --- | --- | --- |
| `pages/payment/native` | 待检查 | 待验证 | — |
| `pages/index/index` | 待检查 | 待验证 | — |
| `pages/academy/index` | 待检查 | 待验证 | — |
| `pages/discover/index` | 待检查 | 待验证 | — |
| `pages/shop/index` | 待检查 | 待验证 | — |
| `pages/profile/index` | 待检查 | 待验证 | — |
| `pages/article/detail` | 待检查 | 待验证 | — |
| `pages/course/detail` | 待检查 | 待验证 | — |
| `pages/product/detail` | 待检查 | 待验证 | — |
| `pages/auth/login` | 待检查 | 待验证 | — |
| `pages/profile/library` | 待检查 | 待验证 | — |
| `pages/profile/settings` | 待检查 | 待验证 | — |
| `pages/profile/accounts` | 待检查 | 待验证 | — |
| `pages/profile/privacy` | 待检查 | 待验证 | — |
| `pages/teacher/index` | 待检查 | 待验证 | — |
| `pages/teacher/detail` | 待检查 | 待验证 | — |
| `pages/teacher/questions` | 待检查 | 待验证 | — |
| `pages/course/player` | 待检查 | 待验证 | — |
| `pages/live/index` | 待检查 | 待验证 | — |
| `pages/community/index` | 待检查 | 待验证 | — |
| `pages/event/index` | 待检查 | 待验证 | — |
| `pages/event/detail` | 待检查 | 待验证 | — |
| `pages/membership/index` | 待检查 | 待验证 | — |
| `pages/membership/purchase` | 待检查 | 待验证 | — |
| `pages/membership/orders` | 待检查 | 待验证 | — |
| `pages/profile/service` | 待检查 | 待验证 | — |
| `pages/order/confirm` | 待检查 | 待验证 | — |
| `pages/course/library` | 待检查 | 待验证 | — |
| `pages/shop/cart` | 待检查 | 待验证 | — |
| `pages/shop/addresses` | 待检查 | 待验证 | — |
| `pages/course/practice` | 待检查 | 待验证 | — |
| `pages/profile/messages` | 待检查 | 待验证 | — |
| `pages/reading-history/reading-history` | 待检查 | 待验证 | — |
| `pages/shared/index` | 待检查 | 待验证 | — |
| `pages/search/index` | 待检查 | 待验证 | — |
| `pages/live/watch` | 待检查 | 待验证 | — |
| `pages/live/detail` | 待检查 | 待验证 | — |
| `pages/order/detail` | 待检查 | 待验证 | — |
| `pages/course/checkin` | 待检查 | 待验证 | — |
| `pages/profile/feedback` | 待检查 | 待验证 | — |
| `pages/profile/progression` | 待检查 | 待验证 | — |
| `pages/community/detail` | 待检查 | 待验证 | — |
| `pages/community/editor` | 待检查 | 待验证 | — |
| `pages/community/manage` | 待检查 | 待验证 | — |
| `pages/profile/edit` | 待检查 | 待验证 | — |
| `pages/course/certificate` | 待检查 | 待验证 | — |
| `pages/course/purchase` | 待检查 | 待验证 | — |
| `pages/course/orders` | 待检查 | 待验证 | — |
| `pages/shop/orders` | 待检查 | 待验证 | — |
| `pages/shop/order-detail` | 待检查 | 待验证 | — |
| `pages/booking/confirm` | 待检查 | 待验证 | — |
| `pages/booking/mine` | 待检查 | 待验证 | — |
| `pages/cohort/detail` | 待检查 | 待验证 | — |
| `pages/cohort/index` | 待检查 | 待验证 | — |
| `pages/booking/credential` | 待检查 | 待验证 | — |
| `pages/booking/workbench` | 待检查 | 待验证 | — |
| `pages/booking/purchase` | 待检查 | 待验证 | — |
| `pages/booking/orders` | 待检查 | 待验证 | — |
| `pages/cohort/purchase` | 待检查 | 待验证 | — |
| `pages/cohort/orders` | 待检查 | 待验证 | — |
| `pages/profile/note-export` | 待检查 | 待验证 | — |
| `pages/live/host` | 待检查 | 待验证 | — |
| `pages/booking/consult` | 待检查 | 待验证 | — |
| `pages/booking/consultations` | 待检查 | 待验证 | — |
| `pages/course/downloads` | 待检查 | 待验证 | — |
| `pages/profile/gifts` | 待检查 | 待验证 | — |
| `pages/marketing/coupons` | 待检查 | 待验证 | — |
| `pages/marketing/group` | 待检查 | 待验证 | — |
| `pages/marketing/community` | 待检查 | 待验证 | — |
| `pages/marketing/case-authorize` | 待检查 | 待验证 | — |
| `pages/marketing/referrals` | 待检查 | 待验证 | — |
| `pages/marketing/points` | 待检查 | 待验证 | — |
| `pages/marketing/charity` | 待检查 | 待验证 | — |
| `pages/membership/gifts` | 待检查 | 待验证 | — |
| `pages/shop/digital` | 待检查 | 待验证 | — |
| `pages/shop/digital-order` | 待检查 | 待验证 | — |

## 全站视觉审查（2026-11-01，App 为目标）

审查方式：76 页 × 390/320 双宽截图逐页人工审（8 组并行），加代码度量统计。截图为 uni-app x Web 预览，不是原生验收；Web 预览里只有「底部条与内容交界」「tabbar」两类差异，其余问题原生同样存在。截图证据在 `outputs/ui-full-review`。

### 代码度量的硬事实

| 项 | 实测 |
| --- | --- |
| font-size 声明 | 459 处 / 25 个不同值（11–26 混 10/13/15/16/17/18/19/20） |
| line-height 声明 | 411 处 / 33 个不同值 |
| border-radius | 173 处 / 24 个不同值（2/3/4/6/8/10/20/22/23） |
| margin-top | 296 处 / 24 个不同值 |
| padding | 13 个不同值（7/8/9/10/11/12/14/16/18/20/22/24/28） |
| 次级灰 #6A7578 on #F5F0E6 | 4.18:1（12px 不达 AA） |
| 金色眉题 #A67C46 | 3.30:1 |
| 卡片描边 #E3DCCF vs 页面 | 1.2:1 |
| 禁用主按钮（40% 青 + 白字） | 2.53:1 |

### 五类系统性问题（按影响排序）

1. **状态语义被一个模板吞掉**：`ContentState` 把「加载失败 / 无权限 / 平台不支持 / 参数非法 / 404」都渲染成「暂时无法加载 + 重试」。重试在这五类里只有一类有效。涉及 practice、checkin、certificate、community/detail、live/host、booking/workbench、booking/consult、booking/purchase、cohort/purchase、payment/native、order/detail、shop/order-detail、marketing/group、shared/index 共 14 页。
2. **空态/错误态没有主操作**：全站 25+ 个空态的主按钮是描边（填充等于页面底色），与输入框无法区分；一只书页图标复用在订单、地址、笔记、礼物、课程档案 5 类语境。
3. **小字承载关键信息**：11–12px 灰字承担退款规则、报名截止、有效期、下载校验、积分规则；同页并存 3 套说明字号；320 下出现「期限。」「看。」「点）」孤字行。
4. **没有设计令牌**：字号/行高/圆角/间距各自为政（见上表），同层级标题 18/19/20px 混用，跨页跳转时左右边界在 16/17/22/24/30 之间跳。
5. **测试文案进了正式界面**：`手动测试内容：原文阅读、选文笔记、评论审核及内容关联。`、`书院测试编辑`、`此帖子为测试样例。`、`（测试）`、`（测试地点）`、`示例内容 · 不收款` —— 首页/学堂/发现/搜索/商城/名师/课程详情/活动/直播/读书营共 10+ 页可见。这是「不能交付付费用户」的一票否决项，但它是数据层 seed 文案，不是样式。

### 本轮已改（原生安全，未新增依赖）

- `styles/app.css`：次级灰 6A7578→5C6869、菜单值 7C878A→5C6869、眉题 11px/#8A6635、demo-note 10→11px、footer-note 11→12px、卡片描边 #D8CFBC、小节标题 19→18、条目标题 16.5→16、价格 20→19、禁用主按钮改浅纸底深字（2.5:1→3.6:1）、详情页签去掉与整行描边叠出的双线。
- `components/ContentState.uvue`：新增 `errorTitle / retryable / icon` 三个可选 prop；错误态标题可按业务语义覆盖；`retryable=false` 时不出重试；唯一操作改为实心墨青按钮；标题 17/600、说明 13/22、上下留白 44/56。
- `pages/index/index.uvue`：首屏水墨横幅文字加纸色半透明底衬，解决浅色画面上文字对比不足。
- `pages/membership/index.uvue`：去掉首屏「注册会员」重复（标题/状态/档位/章节四处同名），档位卡副行改「权益与套餐 ›」。
- `scripts/browser/app-ui-full-review.mjs`：截图前等待图片加载完成（此前 tabbar 激活图标会被截成裂图，属工具假象而非产品缺陷）、导航超时重试并记为 `NAV-TIMEOUT`、每页新增 tiny/clipped/overlap/left-edge 度量输出。

### 未完成 / 阻塞

- 76 页里已按页修的是 2 页（首页、会员中心）；其余页只吃到共享样式改动。逐页返修清单已按页留在这份审查里，未落代码。
- **原生验证未做**：没有连接设备，也没有本地模拟器；本机 dev Postgres（127.0.0.1:55432）WAL 损坏无法启动，导致本轮重建后无法重跑截图流程（`pg_ctl start` 报 invalid checkpoint record）。修复该库需要重新初始化或用 `pg_resetwal`，两者都会动开发库数据，未擅自执行。
- 新 APK 未出：当前源码包含上一轮 76 页返修 + 本轮改动，未云打包，也未在手机上验收。

## 第二轮：逐页重构 + 文案清理（2026-11-01 01:00 前后）

### 口径修正
上一轮依据的是 Web 预览截图；本机 dev Postgres（55432）WAL 损坏后无法重跑截图，本轮改为「逐页读代码 + 规格化改值 + 编译与静态守卫」。同时核查了线上：`https://cuecanvas.top/api/v1/catalog/home` 返回的是真实内容（刘高奇《关于开展新道学文化沙龙公益系列活动的通知》、道学入门第一/二讲），线上库 `academy_manual_20261010` 内没有 `测试/示例` 文案 —— 测试文案只存在于本地 seed 与旧构建里。

### 规格
新增 `docs/ui-refactor-spec.md`：颜色 14 项、字号 10 档（配固定行高）、间距 4/8/12/16/24/32、圆角 14/10/23–24、组件规则（列表行/卡片/按钮/胶囊/页签/输入/开关/空错态/底部条）、7 条硬性检查、7 类原生禁用 CSS、允许改动范围。

### 共享层改动
- `styles/app.css`：次级灰 6A7578→5C6869、眉题 11/#8A6635、小节标题 19/28/600、条目标题 16/24、价格 19/27、卡片描边 #CFC5B1 + 圆角 14、详情页签去掉整行描边（消除双线）、菜单行 54/线 #E0D8C8、禁用按钮 #E4DED2/#6F6A5F、正文 15/26、详情标题 24/34、页尾 40。
- `components/ContentState.uvue`：新增 `errorTitle / retryable / icon`；唯一操作改实心墨青按钮；标题 17/26/600、说明 13/22、留白 44/56。
- `components/CourseRow.uvue`、`ArticleRow.uvue`、`LessonRow.uvue`、`Recommendations.uvue`、`PageHead.uvue`、`BottomBar.uvue`：统一行高、字号、线色；LessonRow 选中态不再改 padding（消除整行横跳），徽章 11/17、元信息 12/20。
- `pages/index`、`membership/index`：首屏横幅加纸色底衬、去掉「注册会员」四处重复。

### 文案清理
- App 源码：删除 6 处 `isDemo` 提示（开发示例 / 示例内容 / 演示来源）与「测试验证码登录」提示、「示例课程」角标；`lib/api.ts` 里「预览测试账号不可用」→「账号暂不可用」；隐私说明去掉「测试内容/预览通道」表述。
- `prisma/manual-seed.mjs`：课程/文章/名师/商品/活动/直播/会员套餐/论坛/作业/媒体名的演示文案全部改写为正式表达；管理员账号名去掉「测试」；地址改为示例自住地址；`（测试）`、`（测试地点）`、`（售罄）` 统一清除。仅保留 seed 内部的防误写守卫文案（`手动测试数据只允许写入本机开发数据库`），不进入界面。

### 后台（apps/admin）
- 换掉 Ant Pro 默认 logo（改为书院印章 SVG）、`favicons` 指向自绘 `favicon.svg`、删除 `public/CNAME`（preview.pro.ant.design）。
- `defaultSettings`：墨青主色、纸色页头/侧栏 token、`fixedHeader`、`contentWidth: Fixed`、`locale:false`（关掉 8 语言空壳）。
- `app.tsx`：删除三张支付宝 CDN 装饰图、启用按账号水印、「操作指南」收进右上 actions（不再每页顶一行），4 个页面里的重复指南链接删除。
- `global.less`：纸色底 #F6F2E9、卡片边 #E4DED2、表头 #F3EEE4、hover #F8F4EA、Drawer 底部留白。
- 数据概览：补 `PageContainer`（全站唯一缺页头的正式页）、图表墨青/金色板、指标卡改带边框。
- `utils/money.ts`：金额加千分位。
- 文案：示例/测试/演示字样在列表标签、系统配置、商品订单、审计动词、请求错误兜底（英文）中清除。
- `pnpm --filter @daoxue/admin build` 通过（dist 01:22 生成）。

### 事故与恢复（必须记录）
第一轮并行改页时有 6 个代理中途失败，其中一个用脚本做了全局替换，把 4 个页面（index/academy/discover/search）里的 `.` 全部换成了 `s`，另有 login 引号重复、order/confirm 标签不闭合，导致整包编译失败。处理：4 个页面 `git checkout` 回退到 HEAD（丢失该组本轮改动），login/confirm 手工修复或回退，随后重新派工并强制「只读+精确编辑、禁用批量替换、每批跑 `node .runtime/uvue-parse-check.mjs`」。当前 `publish web` 编译通过。

### 静态守卫
新增 `.runtime/ui-guard.mjs`：一次跑完模板解析、测试文案、禁用 CSS（gap/grid/vh/vw/calc/sticky/伪元素/aspect-ratio/line-clamp/text-wrap）、10px 字号、纯白按钮五项检查。

### 第三轮：全量逐页落地（2026-11-01 01:00）

按 `docs/ui-refactor-spec.md` 分 6 组并行完成全部 76 页 + 共享组件，最终状态：

- `HBuilderX publish web` **编译成功**（01:49）。
- `.runtime/ui-guard.mjs`：模板解析失败 0、测试文案命中 0、禁用 CSS 0、10px 字号 0、纯白按钮 0。
- 后台 `pnpm --filter @daoxue/admin build` 通过（01:22），之后又补了 403 页与指南入口调整，构建通过。

分组结果：
1. 首页/学堂/发现/搜索/商城/我的/登录/分享：横幅纸面浮层、快捷入口 4+3 两行、精选卡 96×72、分类行 44 高可滑、三级筛选拆成三种形态、售罄态、会员卡等级串收敛、协议行热区、失效态出口。
2. 内容详情 8 页：标题 24/34、byline 13/22、封面圆角 10 固定高、价格行基线对齐、页签去双线、目录行选中不跳动、错误态语义。
3. 直播/活动/社区 10 页：日期与状态胶囊 nowrap、观看页画面从 56% 屏降到 46%、活动分类 44 热区、社区两行筛选视觉分层、编辑器输入与上传区统一纸面卡、错误态按权限/网络分档。
4. 会员/课程 10 页：费用明细三级、渠道按钮 46/23、条款 13/22、档案三列等宽、打卡/作业去掉贴顶、证书纸面。
5. 订单/商城 10 页：确认订单骨架 + 常驻主按钮、购物车步进器 44 热区、地址表单纸面框、404/参数/网络三态、收银台防重复付款提示、离线课件页签统一。
6. 个人中心 11 页：开关行尾状态文字、研习方向选中描边、账号入口行、隐私三段式、积分两列带单位、0 数据禁用导出、消息文字链热区、导出页输入与日期框同规格。
7. 营销 7 页 + 会员礼遇：页题 24/34、券额/积分/团价 24/34 + 单位、邀请码输入 44 描边、空态实心出口、参数缺失不可重试。

共享层（主代理统一改）：`.pill` 加 flex-shrink、`.pill-muted` 改 #F0EADD、`.product-card` 圆角 14/边 #CFC5B1、`.is-disabled` 透明度 0.42→0.6、`PageHead` 标题 17/26、`ArticleRow` 缩略图 96×72 圆角 10、`CourseRow` 标题两行上限、`ForumMediaUpload` 上传卡改正虚线纸面、`LiveDiscussion` 10px→11px、`date-time.ts` 新增 `formatChinaTimeRange`。
