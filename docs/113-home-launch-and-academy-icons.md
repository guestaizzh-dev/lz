# 首页启动与学堂按钮返修

日期：2026-11-01。用户要求：学堂分类按钮按 Git 恢复；普通打开 App 应进入首页。

## 原因与修改

- 学堂方形分类块来自未提交的页面改动。对照 Git 中 `apps/mobile/pages/academy/index.uvue`，恢复 `category-circle`、21px 图标与图标下方文字，移除本页方形块样式，沿用共享圆形按钮及选中态。保留现有七种分类、动态分类与课程筛选。
- `pages.json` 的第一页原为 `pages/payment/native`；旧 Android 0.3.29 的 `app-config.js` 实际也将 `entryPagePath` 设置为该页。普通启动缺少订单参数，于是显示“付款入口无效”。恢复 `pages/index/index` 为第一页，付款页仍保留为独立订单路由。
- Android 副本准备脚本增加启动页必须为首页且属于 tabBar 的检查；新增配置回归用例。避免之后新增页面时把收银台放到启动位置。

## 验证

- `node --test services/api/test/mobile-launch-route.test.mjs`：1/1通过。
- App Web 构建通过；浏览器五项检查通过、0 JS 异常：普通根地址启动首页、320/390px七个圆形入口无页面溢出、视频分类切换、重新打开根地址仍为首页。课程列表使用线上只读 API，未写业务数据。证据 `outputs/startup-academy-0330/browser-checks.log` 及截图。
- Android 0.3.30/code35 云签名成功；506文件比对仅两项既有授权推送覆盖，ZIP/JAR签名、同证书、76页蒸汽字节码、生产地址及原生模块通过。实际APK的启动页为首页、收银台非启动页、学堂圆形样式通过，见 `artifact-checks.json`。本节不替代真机验收。

## 边界

本轮只修改 App 与构建检查，不修改支付渠道、订单、内容、价格或数据库；真实收退款、iOS 与 Android 真机验收仍按既有状态，商用38/131保持。

## Android 发布

- Android **0.3.30/code35**，50,098,771字节；SHA256 `73844c155cff172b4bbc3f9a56d241532cefa251e65408f2c146a323c58e30e5`。
- 同原证书 `81d6c07aa2d22b2e022bcc6f00148f984c8bc5aac427f60207e1233c1e8df248`。云任务 `0d779e40-d668-11f1-bb21-63cbd18455ae`；云排队后签名成功，下载中断后按Range续传，完整ZIP及JAR验签通过。
- 固定入口 https://cuecanvas.top/download/ ，10个发行文件全部校验后原子发布。FeatureConfig.release revision12 指向0.3.30/35，更新通过后台受审接口；API/Pro仍为20261101-payment-ui-03，无业务迁移。回退记录 `/opt/daoxue-academy/rollback-download-0330.txt`。
- 当前服务器可用约4.4GB，未清理业务数据或备份；真机安装及iOS验收仍未做。

- 最终公网整包下载SHA256/大小、Range206、下载页与release配置一致通过，见 `outputs/startup-academy-0330/download-checks.json`；API healthy。
