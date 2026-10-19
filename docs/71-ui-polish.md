# 前端 UI 细节打磨

范围：现有 uni-app x App 与 Ant Design Pro 运营后台。保留业务接口、路由、导航层级、表单字段顺序、支付/审核/登录流程和原有页面结构。本次不推进R15或其他业务开发。

## 修改前审查

- App 保留米白 `#F4F0E7`、墨青 `#17292D`、黛青 `#245564`，朱砂只用于原有价格/提示；宋体标题、黑体正文和原有书法品牌字。按钮保留胶囊形，内容卡片8px，编辑面板16px，重点用留白和细分隔。
- 后台保留官方Pro侧边导航、蓝色主色 `#1677FF`、白色工作面和原有模块入口；使用Ant Design主题token统一控件，而不另建组件库。
- 当前问题：App辅助文字偏淡，搜索/登录输入偏小，正文卡片和局部操作文字尺度不一；共用状态未明确区分加载、空态和错误的视觉层级；Web缺少一致焦点/禁用/触控反馈。
- 响应式风险：后台全表格强制 `white-space:pre`，复杂文字无法换行；登录表单最小宽度与可用宽度冲突；离线条定位缺少窄屏宽度；弹窗、图文行和编辑面板需要收缩及内部滚动保护。
- 不引入装饰动画、新字体依赖、大面积渐变或新设计体系。只使用短反馈，尊重减少动态效果设置。现有信息架构、URL、品牌、说明及同意文案保持。
- 改前截图：`outputs/ui-polish/before-app-login.png`、`before-admin-login.png`、`before-admin-workspace.png`。逐文件修改前副本仅保存在 `.runtime/ui-polish-baseline/`，避免把此前已有改动算成本次工作。

## 规范

| 项目 | App | 后台 |
| --- | --- | --- |
| 间距 | 4/8/12/16/24px；延续原有紧凑列表 | 8/12/16/24px；小屏收紧外边距 |
| 圆角 | 卡片8px、输入8px、主次按钮22px、编辑面板16px | 小控件6px、默认8px、大面板12px |
| 字体 | 标题17—23px宋体；正文15—16px黑体；说明12—13px黑体 | 保留Pro无衬线，正文14px，标题沿用原生组件层级 |
| 阴影 | 阅读区不堆阴影；仅Web浮层轻阴影 | 表格/内容靠边界分层，弹层统一轻阴影 |
| 操作反馈 | 主要控件至少44px；Web悬停/焦点/按下/禁用清楚 | 沿Ant Design状态token；键盘焦点独立可见 |

实施日期：2026-10-16至17；具体位置及验证如下。构建/浏览器检查不等于手机实际验收。

## 逐文件修改位置与理由

### App 共用规范与组件

| 文件 | 具体位置 | 调整内容与理由 |
| --- | --- | --- |
| `apps/mobile/styles/app.css` | `.search`、`.search-input`、`.section-heading`、`.meta`、`.article-summary`、`.empty-description`、`.footer-note` | 搜索输入44px、文字14px，章节标题18/28px、摘要13/23px，辅助说明统一更深的灰青；提高手机可读性，保持原版式。输入允许收缩，避免小屏被长内容撑宽。 |
| 同上 | `.chip`、`.chip-text`、`.product-card`、`.product-copy`、`.member-panel`、`.notice-strip` | 分类命中区44px；卡片/提示圆角8px，商品内边距12px、提示12×16px；减少局部尺寸差异。保留横向筛选模式。 |
| 同上 | `.primary-button`、`.secondary-button`、`.bar-primary`、`.bar-secondary`、`.retry` | 主次按钮最小44px、圆角22px；底部主按钮可收缩、次按钮不挤压，保持操作文字完整。 |
| `apps/mobile/styles/marketing.css` | `.filter-pill` | 未选分类文字改为统一辅助色，保留58px高横向滚动容器和单行标签，避免换行后被截断。 |
| `apps/mobile/App.uvue` | Web全局样式、`.button-hover`、`.row-pressed` | 按钮轻悬停、禁用透明度、可聚焦控件焦点框、输入光标与焦点反馈统一。原生沿用hover-class按下反馈；减少动态效果时停过渡/滚动淡入。宽屏登录内容限宽440px。修正Web框架默认禁用底色覆盖：主按钮/底部主按钮/保存按钮在禁用时保留黛青底与浅色字，以半透明表达禁用，避免按钮近乎消失。 |
| `apps/mobile/components/ContentState.uvue` | 状态容器、图标、说明、重试按钮 | 保留原状态判断和事件，仅按加载/错误增加样式类。32×16px留白、说明13/24px；加载浅青、错误浅红图标底和深红说明，空态中性。长错误文案可断行，加载轻呼吸尊重减少动态设置。 |
| `apps/mobile/components/ComposeSheet.uvue` | 输入区、标题区、计数/保存、错误提示、Web面板 | 增加仅用于外观的输入焦点状态；统一边框、黑体说明、禁用反馈与内嵌错误。Web浮层轻阴影、宽屏限640px；限制面板在可视容器内，正文可收缩，修复横屏顶部标题/关闭被挤出的问题。保留原键盘、安全区、草稿与提交逻辑。 |
| `apps/mobile/components/PageHead.uvue` | `.icon-hit-target` | 返回/分享/设置命中按钮增加8px圆角，使按下及焦点边界与控件协调。 |
| `apps/mobile/components/BottomBar.uvue` | `.action-bar` | 允许底部操作换行，避免窄屏多按钮互相挤压；安全区计算保持。 |
| `apps/mobile/components/ArticleRow.uvue` | 列表根节点、`.article-copy`、标题及元信息 | 增加原生按下反馈，正文可收缩；标题16/25px、元信息黑体12/20px，改善原10px说明的可读性。 |
| `apps/mobile/components/CourseRow.uvue` | 列表根节点、`.course-copy`、标题/副标题/元信息 | 与文章行统一触控反馈、标题16/25px、辅助文字12/20px和灰青色；长标题在自身区域换行。 |
| `apps/mobile/components/LessonRow.uvue` | 列表根节点、`.lesson-copy`、`.lesson-row-active` | 增加按下反馈和正文收缩；选中章节8px圆角、左内距12px，保持现有锁定/试学/直播标识。 |
| `apps/mobile/components/JournalDate.uvue` | `.month-control`、`.day-cell`、`.day-button` | 月切换及日期行44px；日期按钮宽100%且最多44px，避免320px屏幕七列日期越界。保留选日规则。 |

### App 页面

| 文件 | 具体位置 | 调整内容与理由 |
| --- | --- | --- |
| `apps/mobile/pages/auth/login.uvue` | 手机/验证码输入、验证码按钮、协议区、错误提示及媒体查询 | 两项仅增加焦点外观状态；输入48px、黑体15px，验证码按钮不收缩，协议12/22px；错误浅红内嵌。≤360px边距20px/品牌30px，短屏收紧品牌留白。保留验证、计时、协议确认及登录逻辑。 |
| `apps/mobile/pages/profile/library.uvue` | 笔记/日志卡片、引用、标题来源、`.record-actions`、`.record-time` | 卡片16px内距和浅细边框；引用/辅助文字统一黑体，操作13px。日期占独立一行，解决日期被一排按钮挤成两行；操作仍可换行，原有全部入口保留。 |
| `apps/mobile/pages/course/library.uvue` | 学习汇总统计列、课程卡片 | 统计列允许收缩，课程卡补浅细边框，强化摘要/课程/操作层级，保留全部筛选及课程状态。 |

### Ant Design Pro 后台

| 文件 | 具体位置 | 调整内容与理由 |
| --- | --- | --- |
| `apps/admin/config/config.ts` | `antd.configProvider.variant/theme.token` | 保留蓝色Pro体系，统一文字/辅助色、背景和边界；控件高度28/36/44px、圆角6/8/12px、轻阴影和焦点色；输入改outlined，让表单边界更清楚。补中文系统字体回退。 |
| `apps/admin/src/global.less` | ≤768px布局、表格及通用收缩规则 | 统一小屏内容外距/卡片16px内距，移除旧表格强制pre及span强制block；长说明允许换行，表格内部横向滚动，修复商品列表撑宽页面。 |
| 同上 | Modal、Drawer、表单Space与Select | 弹窗限视口宽度、正文限高并内部滚动；高度上限优先于页面原内联vh，修复844×390横屏底部按钮超屏。窄屏表单横向分组可换行、固定宽度选择器不超出父层；抽屉限视口宽度。 |
| 同上 | `:focus-visible`、Empty、Alert、表单说明、reduced-motion | 键盘焦点独立可见，空态24×16px留白、辅助说明统一；告警/说明可换行；减少动态设置关闭控件过渡和骨架动画。 |
| `apps/admin/src/components/OfflineBanner/index.tsx` | 离线Alert定位样式 | 内联样式移至公共类，提示限视口宽度、固定顶部居中、统一层级和轻阴影，避免窄屏提示截断。 |
| `apps/admin/src/components/ErrorBoundary/index.tsx` | 错误Result容器 | 水平方向去掉额外24px margin，保留垂直留白，避免小屏错误页被二次缩窄。 |
| `apps/admin/src/pages/workspace/index.less` | 工作流入口焦点与动态偏好 | 卡片键盘焦点更清楚，减少动态时取消过渡；保持原工作台布局与入口。 |
| `apps/admin/src/pages/user/login/index.tsx` | 页面高度、LoginForm宽度 | 改为min-height:100dvh；表单宽度取360px与视口减48px较小值，解除原最小宽度与75vw冲突，320px屏幕不溢出。 |

以上共20个源码文件。未引入依赖，未修改路由、接口、业务字段、提交处理、支付或权限逻辑；新增状态仅用于焦点外观。修改前后SHA256见 `outputs/ui-polish/changes.json`。原始工作区已有大量未提交业务文件，本报告只包含本轮基线之后的调整。

## 验证与证据

### 构建

- 后台 `pnpm --dir apps/admin build`：通过，包含 `tsc --noEmit` 与Umi正式构建；见 `outputs/ui-polish/admin-build.log`。
- App Web正式构建：通过，编译器5.26、VDOM；见 `outputs/ui-polish/app-build.log`。
- Android蒸汽资源编译：通过，实际日志为 `nativecode`；见 `outputs/ui-polish/android-build.log`。这是资源编译，不是签名APK或手机运行验收。

### 浏览器检查

| 范围 | 尺寸/操作 | 结果 |
| --- | --- | --- |
| App登录 | 320、390、768px；手机输入焦点、空手机号请求验证码 | 无整页横向溢出，焦点边框为黛青；保留原校验并以浅红错误提示呈现。 |
| App主要列表 | 学堂、商城、学习档案、研习笔记、书院共创、会员礼遇；320、390、768px | 检查范围内无整页横向溢出；横向分类栏保留可滑动形式。 |
| App笔记操作区 | 原有三条笔记，390px | 日期独立一行、高20px，原文/编辑/分享/案例/导出/复制/删除仍保留。 |
| App共用状态 | 浏览器暂缓本地笔记请求，返回空列表/503，再恢复真实本地响应并重试 | 加载、空态、错误三种外观已查看；重试恢复原笔记。拦截只在测试浏览器中生效，未清除或保存业务记录。 |
| App编辑面板 | 最终构建直接打开日志、展开日期；320×844、390×844、844×390、768×1024 | 四种尺寸标题/关闭/保存均在视口内，无横溢出；横屏滚动后输入框171.8至318px、保存区330至374px，输入后关闭未保存。见 `outputs/ui-polish/app-browser.log` 与 `after-app-compose-landscape-input.png`。 |
| 后台登录 | 320、390、768、1440px | 表单无整页横向溢出。 |
| 后台主要页面 | 工作台、课程与名师、商品库存、会员礼遇、推广服务；390、768、1440px | 15个页面/尺寸组合无整页横向溢出。宽表格在内部滚动。最终构建结果见 `outputs/ui-polish/admin-browser.log`。 |
| 后台课程抽屉 | 390px打开新建课程，不提交 | 分类/课程分类/名师等横向字段分组换行；正文scrollWidth与clientWidth均390px。 |
| 后台短屏弹窗 | 844×390px打开库存表单，空表单确认触发原校验 | 底部按钮bottom354px，小于屏高390px，正文内部可滚动；无业务保存。 |
| 后台离线提示 | 390px断网再恢复 | 提示边界x45至345px，完整在视口内，恢复网络后移除。 |
| 后台键盘与动态 | Tab切换、减少动态设置 | 按钮`:focus-visible`命中且outline为solid；减少动态时按钮transition为0s。见 `outputs/ui-polish/admin-focus.log`。 |

代表截图在 `outputs/ui-polish/`：`after-app-login-390.png`、`after-app-course-library.png`、`after-app-notes.png`、`after-app-journal.png`、`after-app-compose-844.png`、`after-app-loading.png`、`after-app-empty.png`、`after-app-error.png`、`after-admin-workspace.png`、`after-admin-course-form.png`、`after-admin-modal-landscape-fixed.png`、`after-admin-offline.png`、`after-admin-login.png`。早期诊断截图名含 `overflow` 或 `before`，不能当作最终效果。

### 验证边界

- 本轮通过的是上述浏览器交互、选定尺寸、前端构建和Android蒸汽资源编译；不宣称全部业务用例或所有设备验收。
- App Web中可聚焦输入已验证。uni-app x Web自定义按钮的完整键盘语义不由CSS保证；本轮未改框架运行时，不能把后台原生按钮的Tab结果外推到App全部控件。
- 按本轮范围未做手机安装/验收、iOS编译、云打包或线上部署。未改数据库结构、未seed/清库。登录测试仅使用本地已有测试账号，App请求代理至本地3001，未用测试流程修改线上数据。
- 一次性浏览器检查脚本保存在 `.runtime/ui-polish-browser/`，修改前副本保存在 `.runtime/ui-polish-baseline/`。未执行Git提交；已有未提交业务改动保留。
