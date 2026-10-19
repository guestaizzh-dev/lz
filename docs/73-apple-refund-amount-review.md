# C07 Apple比例退款实际金额核查

日期：2026-10-17。结论：独立金额核查工具已实现并通过本地验证；C07及Apple商用验收仍未完成，商用基线保持38/131（29.0%）。

## 业务与使用

入口：后台「课程订单 → Apple交易与异常 → 退款金额核查」，操作指南已内置于后台。适用已验证的课程及固定期会员Apple比例退款；不向Apple发起退款。Apple撤销比例用于权限处理，不能据此推算顾客实际退款金额，也不能填写开发者净收入。

财务提交实际人民币退款金额、渠道编号、说明及私有PDF/图片凭证；另一名财务填写复核说明后确认。确认前重新查询Apple，核对原交易、退款轮次、凭证哈希及金额上限。权限为finance.read和finance.refund，且须ADMIN/FINANCE业务角色；提交人不可确认本人申请。拒绝保留原记录，可重新提交。

## 实现

- 新增AppleRefundReview：版本、原交易/付款、退款轮次哈希、整数分金额、CNY、私有凭证及SHA、渠道编号、提交人/幂等标识/请求哈希、复核人/说明/时间、关联退款。SQL约束限定金额和状态，同轮次只能存在一份待核查记录，原始事实及终态不可改写或删除。
- `apple-refund-reviews.ts`：专用查询、提交、复核和凭证端点；确认按账号与原始交易加锁，生成唯一退款、退款项及平衡财务分录。重复/并发确认不重复入账。
- `apple-refund-state.ts`及课程/会员Apple处理：相同可信退款事实识别已核查金额；退款撤回保留原记录，以反向分录冲回并按原规则恢复权益。
- `media.ts`：凭证票据绑定当前会话、复核记录、文件ID及SHA，读取时再次检查finance.read。撤权后原票据失效。
- 后台新增AppleRefundReview抽屉、错误重试、历史分页及操作指南。修复该表单及既有签名礼遇表单的Upload事件覆盖凭证ID问题，上传控件与隐藏字符串字段分开绑定。

端点均位于`/admin/apple-transactions`：`GET/POST :id/refund-review`、`POST refund-reviews/:id/decision`、`POST refund-review-proof`、`POST refund-reviews/:id/proof`。流程表不开放通用CRUD。

## 验证证据

- 关联Apple验证38项通过：`outputs/apple-refund-review/tests-final.log`。
- 扩展专项10项通过（与前述有重叠，不相加）：`tests-extra-final.log`。覆盖课程/会员并发、独立复核、实际金额与比例计算结果不一致、证据归属及变更、查询失败/事实变化、拒绝重提、凭证撤权、待核查期间退款撤回及平衡冲正。
- 7条后台浏览器检查通过：`browser-final.log`，含必填、按分提交、本人不可复核、查询失败保留历史、独立确认、390/768/1440px、指南和签名礼遇凭证绑定。此为API夹具交互，未写真实财务记录；截图`admin-review-mobile.png`、`admin-guide.png`。
- API及Pro最终构建通过：`api-build-final.log`、`admin-build-final.log`（包括tsc）。早期并发构建进程异常退出，限制堆后串行重建成功，保留失败日志。
- 本地第64条迁移已应用：`local-migration.log`。182张原业务表完整数据摘要及数量前后一致，新表0行：`data-check.json`。仅本机数据库，未操作正式库。
- `.runtime/backups/apple-refund-review-before.json.gz`为私有逻辑数据归档，已核对压缩回读；不是pg_dump，也未进行完整恢复演练。

## 保留边界与下一步

不覆盖礼物余额、自动续费订阅。部分金额入账后Apple改变为全额或出现冲突轮次时保持REFUND_CYCLE_CONFLICT人工核查，不自动补差/重复入账；更复杂的退款更正与正式Apple证据仍待。缺真实产品、StoreKit双端和渠道验收；本轮未部署、未打包、未手机验收。不改旧角色权限或测试数据。

下一按26继续M06课程会员折扣/新课提前开放，之后M07问答及活动权益等独立任务。

官方依据：[revocationType](https://developer.apple.com/documentation/appstoreserverapi/revocationtype)、[revocationPercentage](https://developer.apple.com/documentation/appstoreserverapi/revocationpercentage)。比例以milliunits表示（100000为100%），非确切顾客退款金额。
