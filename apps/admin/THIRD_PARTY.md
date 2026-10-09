# Ant Design Pro 官方模板二次开发

上游：[ant-design/ant-design-pro](https://github.com/ant-design/ant-design-pro/tree/v6.0.3)，标签 `v6.0.3`，提交 `adfd44085738ca953573a13322c1ba84aca8b9e3`，MIT。原许可保存在 `LICENSE.ant-design-pro`。参考演示：[官方分析页](https://preview.pro.ant.design/dashboard/analysis)。

直接拉取官方完整模板，导入 `src/`、`config/`、`public/`、TypeScript 配置和许可，再在模板内修改。原版运行时布局、混合导航、账户菜单、登录页布局、主题设置抽屉、分析页图表组件与样式、异常页和通用组件均保留。分析模块有19个文件与上游内容完全一致，校验记录见 `../../outputs/ui/admin-template-provenance.json`。

模板内的二次开发：

- `src/app.tsx`：保留官方布局与设置抽屉；接入真实会话、账户名与登录失效跳转。
- `src/pages/user/login/`、`src/services/ant-design-pro/api.ts`：保留官方 LoginForm；换为书院账号密码登录、HttpOnly Cookie、CSRF与刷新轮换；删除假验证码、第三方登录及默认演示账号提示。
- `src/pages/table-list/`：接入现有文章查询、新建、编辑、审核、发布、下架和审计工作流，地址 `/content/articles`；沿用 ProTable 查询及操作模式。
- `src/pages/dashboard/analysis/`：保留官方卡片、图表、筛选、排行榜、渠道与门店布局；原模板数据改为本地显式示例，页面标注其并非真实经营统计。
- 删除无关聊天机器人、注册、通用演示表单/列表/账户/详情/结果、监控与工作台以及旧手写概览；清理相关依赖。移除上游GA、演示API域名、请求录制和无用生成插件。

配套版本：React `19.2.7`、Ant Design `6.6.0`、ProComponents `3.1.14-2`、Plots `2.6.8`、React Query `5.101.2`、Umi Max `4.7.22`。采用上游模板使用的 ProComponents 预发布版本，版本由 `pnpm-lock.yaml` 固定。Umi内部ProComponents、Ant Design和React Query统一到工程配套版本，关闭不匹配的Query Devtools；未启用DVA。TypeScript保持项目 `5.9.3`，Web应用不生成库声明。

启动：`pnpm dev:admin`。构建：`pnpm --filter @daoxue/admin build`（包含类型检查）。开发访问 `http://127.0.0.1:5173/dashboard/analysis`。API与数据库需先按根目录脚本启动；初始化账号保存在本机忽略的 `.runtime/admin-bootstrap.json`，不写入源码。

生产产物 `dist/` 由Web服务器托管；同源 `/api/v1/`、`/static/` 代理至API；History路由需回退到 `index.html`。生产必须使用TLS、真实内容和经营统计，原版图表示例不能成为营业收入、用户数或支付事实。当前尚未交付全量后台业务模块。

构建与浏览器验证证据见 `../../docs/03-development-progress.md`；本机通过不等于已部署生产。
