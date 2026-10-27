# 阿里云验证码接入

## 状态

代码与部署参数已支持阿里云，API 构建及 18 项短信/生产配置/App 错误提示专项测试通过。凭据已私有配置，API 已发布 `20261025-aliyun-sms-01`（源码 `1addb06`），短信启用、固定验证码预览关闭。充值后真实发送请求返回 HTTP 200 / 业务码 `OK`，验证码挑战已创建；运营商实际送达及使用验证码登录仍待用户确认。商用 38/131 不变。

用户确认的模板：

- 签名：北京华夏知古文化院
- 模板：`SMS_512591994`
- 内容：`您的注册码为：${code}，如非本人操作，请忽略本短信！`
- 模板变量只有 `code`，沿用服务端随机 6 位验证码、5 分钟有效期、60 秒发送间隔、单号码每日 10 次、单 IP 每小时 30 次、单挑战最多 5 次验证。短信文本未写有效期，App 显示服务端有效期。

## 服务器私有配置

在现有生产私有环境文件设置以下参数，不把密钥写进仓库、App 或后台页面：

```dotenv
SMS_ENABLED=true
SMS_PROVIDER=aliyun
ALIYUN_SMS_SIGN_NAME=北京华夏知古文化院
ALIYUN_SMS_TEMPLATE_CODE=SMS_512591994
ALIBABA_CLOUD_ACCESS_KEY_ID=<RAM用户凭据ID>
ALIBABA_CLOUD_ACCESS_KEY_SECRET=<RAM用户凭据Secret>
PREVIEW_LOGIN_ENABLED=false
```

生产不得配置 `DEV_OTP_CODE`。现有预览配置要求真实短信关闭，切换时必须同时关闭预览入口。腾讯云为兼容默认值；选择阿里云后不再要求腾讯云 SMS SDK AppID 等配置。临时 STS 凭据支持额外 `ALIBABA_CLOUD_SECURITY_TOKEN`，本实现不自动申请/刷新 STS，不声称支持无凭据发送。

RAM 用户仅授予发送需要的 `dysms:SendSms`，签名/模板须归属同一主账号，签名审核/报备、余额由所有者确认。准备凭据之后按现有备份发布流程部署 API 并重建容器，无数据库迁移，不需要因本改动重新打包 App。

## 发送与失败处理

固定 HTTPS 官方地址，ACS3-HMAC-SHA256 签名、UTC 日期、随机 nonce；签名及验证码不写日志。10 秒超时，不跟随重定向，仅 HTTP 成功且业务 `Code=OK` 视为提交成功，不等于运营商最终送达。超时不自动重试，避免重复发码计费；失败统一安全提示，由既有挑战流程作废验证码。

## 验证与恢复条件

- 已验证：签名请求组成/中文参数/STS、随机 nonce、正确模板变量、成功响应、业务拒绝/HTTP 错误/异常 JSON/null、超时不重试、缺凭据不发请求、生产配置分渠道校验、App 安全文案。
- 待验证：真实号码收码登录、错误/到期/重复验证码拒绝、真实控制台记录、并发与费用控制。
- 原权限阻塞已解除；授权后真实调用业务码 `isv.AMOUNT_NOT_ENOUGH`，RequestId `01A17697-7BAF-5313-8E30-AD9941D66838`，账户余额不足。恢复：所有者充值/确认可用套餐，遵守现有限流创建新挑战，验证实际收码登录。最小策略见 [infra/aliyun-sms-send-policy.json](../infra/aliyun-sms-send-policy.json)。

## 线上部署证据

- 当前发行 `20261025-aliyun-sms-01`，上一版 `20261025-review-polish-01`；无数据库迁移，81 迁移/198 表不变，17 类业务计数一致。
- 备份 `academy-20261026T045425Z-Es9XpC.dump` 及媒体归档 SHA256 通过（名称为服务器 UTC）；回退文件 `/opt/daoxue-academy/rollback-20261025-aliyun-sms-01.txt`，环境备份 `production.env.before-20261025-aliyun-sms-01`。回退时需同时恢复环境、镜像与发行路径，不还原业务数据库。
- API healthy，公网健康与 `/catalog/home` 为 200，watch/backup timer active。首次核查误用 `/home` 得到 404，正确路径已补验，不是产品路由故障。
- 环境只改变发行及短信相关字段、预览开关，支付/推送/RTC设置未改。生产环境文件权限 0600，临时凭据传输文件已删除，密钥不进入仓库/日志；本机私有 `.env` 保留配置。未生成新 APK。
- 磁盘剩余约 4.7GB（92%），发布前 9.6GB，本次完整镜像构建产生新层/缓存；容量风险仍需跟踪，未删除业务媒体/备份/回退镜像。
- 证据 `outputs/deploy-2026-10-25-sms/`：发行清单、构建/切换、环境字段核查、业务计数、受限错误码。没有把渠道提交失败写成送达成功；失败挑战作废，重复尝试仍受到 60 秒限制。

测试：`pnpm --filter @daoxue/api build`；在 `services/api` 执行 `node --test test/aliyun-sms.test.mjs test/runtime-config.test.mjs test/mobile-api-errors.test.mjs`（18/18，网络为替身，无真实计费）。本轮未重跑全量或手机测试。

官方依据：[SendSms](https://help.aliyun.com/zh/sms/developer-reference/api-dysmsapi-2017-05-25-sendsms)、[ACS3签名](https://help.aliyun.com/zh/sdk/product-overview/v3-request-structure-and-signature)。


## 充值后真实发送复测

用户充值后，向用户指定测试号码发起一次真实验证码挑战，阿里云返回 HTTP 200、Code `OK`，RequestId `01A17B1F-9CFD-5E20-A797-D6E74DBC09B8`，服务端生成有效期 300 秒的挑战。此结果证明渠道接受发送请求，不代表手机实际收到或登录验证成功；两项仍待用户确认。未修改服务配置、未重启、未发版。
