# 代码整理、规范与静态检查

日期：2026-11-02。用户要求整理全仓代码、删除死代码和不用的代码、提高可维护性并做静态检查。本轮仅本地代码、依赖和验证；不连接生产、不部署。

## 已实施

1. 从 API `main.ts`、Umi 约定入口与路由、App `pages.json`/入口及原生模块追踪引用。删除31个无运行入口的源码文件，共63,092字节：官方模板的演示图表和示例数据、废弃展示组件和 barrel 导出、欢迎页旧样式、未引用的直播礼物展示组件等。真实礼物业务及当前页面保持；不能把未被App引用的旧展示组件等同于删除礼物余额/订单业务。删除清单和摘要见 `outputs/code-quality/deleted-files.json`。
2. 移除后端/后台未使用导入、变量、构造注入、废弃表单状态和移动端未使用的分享/复制函数和类型。再清理22条无模板/脚本/跨组件引用的局部CSS规则；动态拼接等级类、全局和跨组件样式保留。内部咨询折扣函数移除无用参数，同步生产调用和测试调用。保留装饰器上的UUID验证；未使用的绑定变量明确为 `_id`，不删除验证步骤。
3. 后端及后台 `tsconfig` 持续检查 `strict`、`noUnusedLocals`、`noUnusedParameters`、`noFallthroughCasesInSwitch`、`allowUnreachableCode=false` 和文件名大小写一致性。后台原有 `noImplicitReturns` 保持。
4. 新增 `.editorconfig` 与固定版本 Prettier 3.9.10，统一TS/TSX、uni-app x脚本/模板/样式、Node脚本及JSON的排版。生成代码、迁移SQL、第三方媒体SDK及构建产物排除，避免篡改历史迁移或重新格式化外部代码。业务长行展开，便于审查事务、权限、退款和异常分支。
5. 新增 `scripts/code-quality/`：类型、未使用声明、移动端脚本语法/模板绑定与类型引用、Node语法、JSON/JSONC、入口引用与格式检查。移动端检查识别解构绑定，保留平台条件代码；它不替代HBuilderX对原生和平台API的编译。
6. Android独立预览准备脚本不再依赖固定空格/单行函数。`android-preview-overrides.mjs`使用可验证的结构标记和TypeScript AST定位推送hook，保留源码与其他设置；新增格式化前后测试。
7. 媒体库列表的错误状态接入真实失败分支，失败明确显示原错误并允许列表重试。短信错误只对白名单安全提示开放，补齐现有预览账号不可用提示，其余服务端错误仍隐藏。
8. 历史会员等级修复测试在独立临时数据库运行，避免全量测试先前生成的会员/销售历史使修复保护机制按设计拒绝执行。没有放松SQL保护，也没有删除历史数据来通过测试。
9. 提供 `scripts/test-local.mjs`，从显式 `DATABASE_URL` 或已有本地数据库配置运行测试，强制loopback并使用可丢弃测试库。不输出数据库口令，不访问生产。资料转换程序是运维工具入口，明确保留，不因App/API运行图无入口而删除。
10. 本地商户工具、证书目录和解压桌面运行库加入Git/Docker忽略，防止误提交或打入应用构建上下文；原文件保留。

## 依赖安全修复

首次 `pnpm audit --prod --json` 检出20条告警：9高、9中、2低。按已发布修复版本锁定9组间接依赖：

| 包 | 修复版本 |
| --- | --- |
| deepmerge-ts（Prisma配置工具链） | 8.0.0 |
| urllib | 4.9.1 |
| mysql2（Prisma工具链，业务数据库仍PostgreSQL） | 3.23.1 |
| js-yaml 5.x | 5.4.1 |
| body-parser 2.x | 2.4.0 |
| undici 7.x | 7.30.1 |
| multer 2.x | 2.5.0 |
| fast-uri 3.x | 3.1.9 |
| qs 6.x | 6.16.1 |

使用按受影响版本限定的pnpm overrides及锁文件，不改Nest/React/Umi/Prisma主版本。deepmerge-ts自身从7到8，已验证Prisma Client生成与测试迁移，不把它描述为普通补丁。修复后生产依赖审计为0条已知告警，证据 `outputs/code-quality/dependency-audit-after.json`；这不等于整个系统绝无漏洞。开发工具链仍有上游废弃包/peer提示，不以批量大版本升级掩盖兼容风险。

审计依据含上游已公开的 [body-parser压缩请求DoS](https://github.com/advisories/GHSA-27r3-jxmh-p828)、[multer请求终止DoS](https://github.com/advisories/GHSA-q7qp-rjg7-q26m)、[deepmerge-ts递归堆栈耗尽](https://github.com/advisories/GHSA-ggr8-5vv4-36mx)。代码规范分别采用 [TypeScript未使用声明检查](https://www.typescriptlang.org/tsconfig/noUnusedLocals.html)和 [Prettier项目配置](https://prettier.io/docs/configuration)。

## 常用门禁

```text
npm run check
npm run format:check
npm run format
npm run test:local
npm run audit:prod
```

安装仍按项目固定pnpm及锁文件执行；`npm run`这里只执行脚本，不生成npm锁文件。静态入口先生成Prisma Client（不连接数据库），测试入口自动构建API。`test:local`也可追加明确测试文件名；测试库及媒体目录由测试运行器创建和清理。

## 验证记录

- 类型、引用、格式门禁：507个源码模块/样式全部可追踪到业务/框架/运维入口；无未处理孤立源码。122个App页面与组件脚本检查0问题，730个格式目标；最终格式检查为730文件0待修正。
- Node语法205文件、JSON/JSONC17文件与CSS/SFC127文件通过；Python5文件、PowerShell1文件、Shell5文件仅做语法解析，无服务器操作。
- API构建、Prisma生成、官方Pro生产构建通过。Android79页蒸汽本地资源编译/导出通过，无无效样式选择器或本轮CSS错误。App Web构建通过；末次清理22条未用局部CSS后补Web与静态检查，末次原生资源也重新编译导出核查，不生成新APK。
- 静态检查工具、预览准备逻辑、下载页准备、短信竞态与类型遗漏回归8项通过。
- 第一轮全量901项：897通过/4失败（含父测试），定位为一处已移除参数的测试调用、共享历史修复测试和预览短信提示。修正后最终901/901通过（历史修复独立1项 + 其余900项，后者748秒），无跳过/取消，证据`outputs/code-quality/full-regression.log`。

## 边界与上一批APK

代码检查和本地回归只能提供对应范围证据，不能证明生产集群高可用、真实渠道收退款、弱网长时媒体或iOS原生通过；本轮未进行生产故障演练、压测或部署，不调整商用38/131。

此前0.3.32/code37云任务 `a6779c00-d6ca-11f1-a8a6-21441e799010`来自独立冻结的会员/UI快照，不包含本轮清理和依赖修复；已调整跟进按记录的冻结哈希校验，避免和新工作区误比。云任务继续按115交付，不能宣称该APK含本轮代码整理。


## 最终本地状态

最终API回归901项全部通过；静态检查入口、生产依赖审计和三端构建证据见 `outputs/code-quality/summary.json` 与同目录日志。没有提交或推送Git，没有部署、修改生产数据、重新seed或发布APK。本轮对现有大工作区原有改动的整理仍留在工作区，删除源码的快照仅作本地追溯，不加入生产构建。


末次静态门禁完整通过（730格式目标/507模块/122App脚本/205Node脚本/17JSON/127CSS-SFC），Web与79页Android本地资源导出均成功，原生未出现本轮样式错误；新测试入口自动构建后19项专项通过（与901有重叠，不相加）。最终结果均已复制到 `outputs/code-quality/`，不依赖临时日志定位。

上一批0.3.32冻结APK已在本轮收尾时完成下载与官方apksigner v1/v2验证，仅作115交付；本轮清理仍为源码与本地构建成果，未制作含清理内容的新APK。
