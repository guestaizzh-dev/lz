# 阿里云验证码接入

## 状态

代码与部署参数已支持阿里云，API 构建及 18 项短信/生产配置/App 错误提示专项测试通过。没有提供阿里云身份凭据，未真实发送、未部署，线上保持原短信开关。商用 38/131 不变。

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
- 阻塞：未提供阿里云身份凭据。恢复：服务器私有环境配置有效发送凭据，完成真实收码验证。不能仅凭签名和模板编号发送。

测试：`pnpm --filter @daoxue/api build`；在 `services/api` 执行 `node --test test/aliyun-sms.test.mjs test/runtime-config.test.mjs test/mobile-api-errors.test.mjs`（18/18，网络为替身，无真实计费）。本轮未重跑全量或手机测试。

官方依据：[SendSms](https://help.aliyun.com/zh/sms/developer-reference/api-dysmsapi-2017-05-25-sendsms)、[ACS3签名](https://help.aliyun.com/zh/sdk/product-overview/v3-request-structure-and-signature)。
