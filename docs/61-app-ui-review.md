# 61 App 全页面 UI 与交互细节复查

日期：2026-10-15（本机工作日期）。范围：App现有58个路由及共享组件。沿用产品需求01、技术决定02和执行计划26；保留七板块与原版式，优先处理截图揭示的共性问题，不更换设计体系。

## 1. 本批修复

| 问题 | 根因与处理 | 涉及范围 |
| --- | --- | --- |
| 大片默认白按钮、返回/分享图标带方框 | 页面使用了未定义的text-button/text-action/outline-action；补齐共享样式，Web默认按钮边框移入真正全局入口 | 公共样式、订单/会员/预约/教学等调用方 |
| 学堂分类横向滚动不明确 | 横向scroll-view内的伸展view影响内容测量；选项直接排列并禁止收缩，明确row方向与宽度 | 学堂、发现、搜索、社区、商城订单共7条栏 |
| 标题重复、订单入口抢占主视觉 | 保留固定PageHead，列表采用紧凑工具栏；移除诗化重复大标题 | 预约/训练营/订单/学习档案/通知/工作台/研习任务 |
| 空态没有下一步、网络错误混入空态 | ContentState增加明确行动；错误/加载和正常空态互斥 | 训练营去报名、预约去找老师/活动、笔记去阅读、商城去好物 |
| 空态入口无法打开tab页 | openPage按目标类型使用switchTab/navigateTo；训练营筛选由学堂消费一次 | 五个主tab与训练营定向入口 |
| 小屏换行、标题及操作互相挤压 | 标题flex与min-width、操作区换行、主要按钮44px点击区、辅助字号及黑体正文 | PageHead、CourseRow、列表卡、会员套餐、预约确认 |
| 弹窗展开日期后保存超屏 | 编辑正文放入可收缩scroll-view；头部/保存区独立，按可用窗口高度限制，处理底部安全区 | 日志、笔记、评论、提问、举报、售后等共用ComposeSheet |
| 双重页面滚动 | 全局关闭外层页面滚动，各页保留自己的scroll-view；分享错误页补齐内部滚动容器 | 全部58页 |
| 内部错误直接展示 | 空响应安全处理，500统一中文提示，Cannot GET等路径错误转可理解文案；保留业务错误和401状态 | App共享请求层 |
| 原生样式不支持 | 弹窗max-height改像素值，直播页gap改显式间距 | 弹窗、直播详情 |

颜色仍采用米白纸色与墨青，宋体用于标题、黑体用于正文/操作；未追加重装饰或改变原七板块导航。会员/课程/报名价格、权益、审核与交易逻辑保持原业务规则。

## 2. 验证与证据

- 入口：[浏览器回归脚本](../scripts/browser/app-ui-review.mjs)，读取pages.json而非手写遗漏页面。
- 证据：[逐页结果](../outputs/app-ui-review-2026-10-15/report.json)；同目录按路由存PNG。登录流程也通过真实页面操作。
- 浏览器使用本地隔离数据库副本；夹具、登录和报名写入副本，finally关闭连接并删除副本，不向正式库或日常测试库写入。
- 58个路由均有渲染与截图，检查空白、整页横向溢出及JavaScript运行异常；51页为登录/正常内容/正常空态，另7页仅覆盖受限或错误态，详见下一节。
- 八类重点页面另做320px窄屏检查；学堂真实横向滚动及末分类选择、训练营空态跳转并选中、预约订单入口、日志弹窗、断网重试及500中文反馈为交互专项。
- Android：HBuilderX 5.26、蒸汽模式、字节码目标，58页编译及资源导出成功（19:11:32）；未生成新的签名APK，也未安装。
- Web：最终源码导出成功（19:14:08）；保留一条HBuilderX对onResize导入的类型声明警告。官方API及当前随包运行时均有此钩子，实际横屏事件专项用于验证运行行为；未通过屏蔽警告或修改编译器来处理。
- 最终补充复验：58页/8项专项通过，0个JavaScript运行异常；横屏保存区可见，实际内部滚动可到达输入框，输入草稿原文保留。结果时间为2026-10-16T03:16:30Z（本机10月15日）。

## 3. 逐页覆盖

“内容/空态”只表示本轮夹具下页面渲染与视觉走查，不表示该页全部状态或对应需求已达商用验收。

| 路由 | 本轮覆盖 | 截图 |
| --- | --- | --- |
| `pages/auth/login` | 验证码登录页面与完整登录操作。 | [查看](../outputs/app-ui-review-2026-10-15/auth-login.png) |
| `pages/index/index` | 内容/空态：已渲染、截图，未发现整页横向溢出。 | [查看](../outputs/app-ui-review-2026-10-15/index-index.png) |
| `pages/academy/index` | 内容/空态：已渲染、截图，未发现整页横向溢出。 | [查看](../outputs/app-ui-review-2026-10-15/academy-index.png) |
| `pages/discover/index` | 内容/空态：已渲染、截图，未发现整页横向溢出。 | [查看](../outputs/app-ui-review-2026-10-15/discover-index.png) |
| `pages/shop/index` | 内容/空态：已渲染、截图，未发现整页横向溢出。 | [查看](../outputs/app-ui-review-2026-10-15/shop-index.png) |
| `pages/profile/index` | 内容/空态：已渲染、截图，未发现整页横向溢出。 | [查看](../outputs/app-ui-review-2026-10-15/profile-index.png) |
| `pages/article/detail` | 内容/空态：已渲染、截图，未发现整页横向溢出。 | [查看](../outputs/app-ui-review-2026-10-15/article-detail.png) |
| `pages/course/detail` | 内容/空态：已渲染、截图，未发现整页横向溢出。 | [查看](../outputs/app-ui-review-2026-10-15/course-detail.png) |
| `pages/product/detail` | 内容/空态：已渲染、截图，未发现整页横向溢出。 | [查看](../outputs/app-ui-review-2026-10-15/product-detail.png) |
| `pages/profile/library` | 内容/空态：已渲染、截图，未发现整页横向溢出。 | [查看](../outputs/app-ui-review-2026-10-15/profile-library.png) |
| `pages/profile/settings` | 内容/空态：已渲染、截图，未发现整页横向溢出。 | [查看](../outputs/app-ui-review-2026-10-15/profile-settings.png) |
| `pages/profile/privacy` | 内容/空态：已渲染、截图，未发现整页横向溢出。 | [查看](../outputs/app-ui-review-2026-10-15/profile-privacy.png) |
| `pages/teacher/index` | 内容/空态：已渲染、截图，未发现整页横向溢出。 | [查看](../outputs/app-ui-review-2026-10-15/teacher-index.png) |
| `pages/teacher/detail` | 内容/空态：已渲染、截图，未发现整页横向溢出。 | [查看](../outputs/app-ui-review-2026-10-15/teacher-detail.png) |
| `pages/course/player` | 内容/空态：已渲染、截图，未发现整页横向溢出。 | [查看](../outputs/app-ui-review-2026-10-15/course-player.png) |
| `pages/live/index` | 内容/空态：已渲染、截图，未发现整页横向溢出。 | [查看](../outputs/app-ui-review-2026-10-15/live-index.png) |
| `pages/community/index` | 内容/空态：已渲染、截图，未发现整页横向溢出。 | [查看](../outputs/app-ui-review-2026-10-15/community-index.png) |
| `pages/event/index` | 内容/空态：已渲染、截图，未发现整页横向溢出。 | [查看](../outputs/app-ui-review-2026-10-15/event-index.png) |
| `pages/event/detail` | 内容/空态：已渲染、截图，未发现整页横向溢出。 | [查看](../outputs/app-ui-review-2026-10-15/event-detail.png) |
| `pages/membership/index` | 内容/空态：已渲染、截图，未发现整页横向溢出。 | [查看](../outputs/app-ui-review-2026-10-15/membership-index.png) |
| `pages/membership/purchase` | 内容/空态：已渲染、截图，未发现整页横向溢出。 | [查看](../outputs/app-ui-review-2026-10-15/membership-purchase.png) |
| `pages/membership/orders` | 内容/空态：已渲染、截图，未发现整页横向溢出。 | [查看](../outputs/app-ui-review-2026-10-15/membership-orders.png) |
| `pages/profile/service` | 内容/空态：已渲染、截图，未发现整页横向溢出。 | [查看](../outputs/app-ui-review-2026-10-15/profile-service.png) |
| `pages/order/confirm` | 内容/空态：已渲染、截图，未发现整页横向溢出。 | [查看](../outputs/app-ui-review-2026-10-15/order-confirm.png) |
| `pages/course/library` | 内容/空态：已渲染、截图，未发现整页横向溢出。 | [查看](../outputs/app-ui-review-2026-10-15/course-library.png) |
| `pages/shop/cart` | 内容/空态：已渲染、截图，未发现整页横向溢出。 | [查看](../outputs/app-ui-review-2026-10-15/shop-cart.png) |
| `pages/shop/addresses` | 内容/空态：已渲染、截图，未发现整页横向溢出。 | [查看](../outputs/app-ui-review-2026-10-15/shop-addresses.png) |
| `pages/course/practice` | 内容/空态：已渲染、截图，未发现整页横向溢出。 | [查看](../outputs/app-ui-review-2026-10-15/course-practice.png) |
| `pages/profile/messages` | 内容/空态：已渲染、截图，未发现整页横向溢出。 | [查看](../outputs/app-ui-review-2026-10-15/profile-messages.png) |
| `pages/reading-history/reading-history` | 内容/空态：已渲染、截图，未发现整页横向溢出。 | [查看](../outputs/app-ui-review-2026-10-15/reading-history-reading-history.png) |
| `pages/shared/index` | 无效分享链接404，验证错误反馈与返回入口；不是有效分享交付验收。 | [查看](../outputs/app-ui-review-2026-10-15/shared-index.png) |
| `pages/search/index` | 内容/空态：已渲染、截图，未发现整页横向溢出。 | [查看](../outputs/app-ui-review-2026-10-15/search-index.png) |
| `pages/live/watch` | 未开播场次409，仅检查受限提示；本轮未进行实际RTC播放。 | [查看](../outputs/app-ui-review-2026-10-15/live-watch.png) |
| `pages/live/detail` | 内容/空态：已渲染、截图，未发现整页横向溢出。 | [查看](../outputs/app-ui-review-2026-10-15/live-detail.png) |
| `pages/order/detail` | 内容/空态：已渲染、截图，未发现整页横向溢出。 | [查看](../outputs/app-ui-review-2026-10-15/order-detail.png) |
| `pages/course/checkin` | 内容/空态：已渲染、截图，未发现整页横向溢出。 | [查看](../outputs/app-ui-review-2026-10-15/course-checkin.png) |
| `pages/profile/feedback` | 内容/空态：已渲染、截图，未发现整页横向溢出。 | [查看](../outputs/app-ui-review-2026-10-15/profile-feedback.png) |
| `pages/profile/progression` | 内容/空态：已渲染、截图，未发现整页横向溢出。 | [查看](../outputs/app-ui-review-2026-10-15/profile-progression.png) |
| `pages/community/detail` | 内容/空态：已渲染、截图，未发现整页横向溢出。 | [查看](../outputs/app-ui-review-2026-10-15/community-detail.png) |
| `pages/community/editor` | 内容/空态：已渲染、截图，未发现整页横向溢出。 | [查看](../outputs/app-ui-review-2026-10-15/community-editor.png) |
| `pages/community/manage` | 内容/空态：已渲染、截图，未发现整页横向溢出。 | [查看](../outputs/app-ui-review-2026-10-15/community-manage.png) |
| `pages/profile/edit` | 内容/空态：已渲染、截图，未发现整页横向溢出。 | [查看](../outputs/app-ui-review-2026-10-15/profile-edit.png) |
| `pages/course/certificate` | 未完成课程400，仅检查未满足条件状态。 | [查看](../outputs/app-ui-review-2026-10-15/course-certificate.png) |
| `pages/course/purchase` | 内容/空态：已渲染、截图，未发现整页横向溢出。 | [查看](../outputs/app-ui-review-2026-10-15/course-purchase.png) |
| `pages/course/orders` | 内容/空态：已渲染、截图，未发现整页横向溢出。 | [查看](../outputs/app-ui-review-2026-10-15/course-orders.png) |
| `pages/course/versions` | 内容/空态：已渲染、截图，未发现整页横向溢出。 | [查看](../outputs/app-ui-review-2026-10-15/course-versions.png) |
| `pages/shop/orders` | 内容/空态：已渲染、截图，未发现整页横向溢出。 | [查看](../outputs/app-ui-review-2026-10-15/shop-orders.png) |
| `pages/shop/order-detail` | 源库无新商城交易，以旧订单ID返回404；新订单详情正常内容未由此轮覆盖。 | [查看](../outputs/app-ui-review-2026-10-15/shop-order-detail.png) |
| `pages/booking/confirm` | 内容/空态：已渲染、截图，未发现整页横向溢出。 | [查看](../outputs/app-ui-review-2026-10-15/booking-confirm.png) |
| `pages/booking/mine` | 内容/空态：已渲染、截图，未发现整页横向溢出。 | [查看](../outputs/app-ui-review-2026-10-15/booking-mine.png) |
| `pages/cohort/detail` | 内容/空态：已渲染、截图，未发现整页横向溢出。 | [查看](../outputs/app-ui-review-2026-10-15/cohort-detail.png) |
| `pages/cohort/index` | 内容/空态：已渲染、截图，未发现整页横向溢出。 | [查看](../outputs/app-ui-review-2026-10-15/cohort-index.png) |
| `pages/booking/credential` | 内容/空态：已渲染、截图，未发现整页横向溢出。 | [查看](../outputs/app-ui-review-2026-10-15/booking-credential.png) |
| `pages/booking/workbench` | 普通学员无工作人员委派403，检查拒绝访问反馈。 | [查看](../outputs/app-ui-review-2026-10-15/booking-workbench.png) |
| `pages/booking/purchase` | 隔离夹具为免费席位，付费报价400；不是付费确认页正常内容验收。 | [查看](../outputs/app-ui-review-2026-10-15/booking-purchase.png) |
| `pages/booking/orders` | 内容/空态：已渲染、截图，未发现整页横向溢出。 | [查看](../outputs/app-ui-review-2026-10-15/booking-orders.png) |
| `pages/cohort/purchase` | 隔离夹具为免费营期，付费报价400；不是付费确认页正常内容验收。 | [查看](../outputs/app-ui-review-2026-10-15/cohort-purchase.png) |
| `pages/cohort/orders` | 内容/空态：已渲染、截图，未发现整页横向溢出。 | [查看](../outputs/app-ui-review-2026-10-15/cohort-orders.png) |

## 4. 验收边界与下一步

- 本轮是小幅UI及导航、反馈、弹窗交互修复，不能把58张截图当作58个完整业务流程商用通过。
- 原生字体实际加载、真实滑动选文/分类手势、软键盘覆盖、旋转与底部安全区，仍需配套基座/APK及iOS真机验证。Android编译成功只证明资源/字节码工具链通过。
- 7个受限/错误页面的正常内容，须有已完成课程、新商城订单、付费报价、工作人员委派及实际开播场次后补验；历史业务回归不能自动替代本批UI证据。
- 保留既有数据库与后台；本批没有部署线上、消耗云打包或覆盖手机安装包。
- 商用统计仍为38/131（29.0%），原审查快照不改。完整剩余业务按26依赖继续，云录制沿用户决定暂缓。

横向滚动/页面尺寸核对来源：[DCloud scroll-view](https://doc.dcloud.net.cn/uni-app-x/component/scroll-view.html)、[页面onResize](https://doc.dcloud.net.cn/uni-app-x/page.html)。


## 5. Android 0.3.6 安装包交付（本次续办）

用户随后要求更新手机安装包。本地58页蒸汽字节码编译通过，原DCloud云端签名打包完成，任务`b088e370-c910-11f1-aec6-8580bbe619dc`状态OK。

- [APK安装包](../outputs/android/daoxue-academy-0.3.6.apk)：0.3.6/code11，包名`cn.daoxue.academy`，39,511,821字节。
- SHA256：`7ffc7b01692254731665efd8087482011cf962f86f608ace69f87d058d4ea88b`。
- ZIP完整性、包名、版本、线上HTTPS接口地址及与0.3.5签名一致性检查通过；`jarsigner -verify`返回0。
- [安装包元数据](../outputs/android/daoxue-academy-0.3.6.json)。保留原0.3.5安装包，使用同一证书，可覆盖安装保留原数据。
- 手机USB在Windows中反复出现/消失，未建立ADB连接；一次针对当前接口的修复因设备已经消失而退出，未执行注册表写入。用户明确回复“暂时无法更换，请先给安装包”，因此本次交付本地APK，手机尚未更新。
- 本节补充实际打包证据；上文未生成APK是前一阶段状态。原生UI/手势、键盘及iOS验收仍未完成，商用状态不变。
