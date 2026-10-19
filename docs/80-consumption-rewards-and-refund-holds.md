# 80 · 消费奖励、退款冻结与原来源冲回

状态：内部实现及本地验证完成，正式商用仍待。

日期：2026-10-18（北京）。对应26计划会员M08、A05结算积分及O04恢复任务子项。

## 1. 本批范围与业务规则

复用统一交易、实际收入账本、原积分/成长流水及待抵扣账户。覆盖课程、会员、实物、咨询、活动、营期六类正现金人民币新订单。

- 实际交付后观察7天，每满1元实际保留金额得1积分，每满10元得1成长值；实物运费不计。
- 消费积分按北京结算资格日最多500，成长与原学习、审核、打卡合计每日20。积分类别和礼物购买余额独立，成长称号不替代付费会员等级。
- 课程以实际授权后的课程收入为依据，未成团的预收不算交付。会员等待本次排队生效时间再观察。实物须确认完成且所有出库/换货包裹已收货；服务须有79的独立财务复核及实际收入，签到/预收/未到场不发奖励。
- 退款申请冻结原奖励，不因此立即编造退款金额；拒绝后释放。可信退款或履约纠正按累计原基数同比例冲回，保留满元取整；已花掉的不足部分计入原待抵扣，后续积分先抵扣，已确认兑换继续履约。
- 同一来源重试不多发。已冲回奖励恢复使用原发放份额和原资格日，不挤占新一天名额；只对超过历史最高有效基数的新增部分分配新份额。
- 新订单冻结规则，报价指纹包含当前规则；变更新规不能改旧订单。旧订单、免费/积分/会员赠品、礼物充值及B2B运营服务不补发消费积分。2026-10-18前原购入、此后才恢复入库的Apple课程亦不追溯奖励。

以上是依据用户允许自主确定的未明确普通规则所作的本批决定，正式运营应沿版本发布新规，不能直接改旧订单快照。

## 2. 已实现清单

- [x] 新增 ConsumptionReward 来源状态与 ConsumptionAward 发放份额；数据库验证本人/原订单/冻结规则关联。
- [x] 六类消费按原接受收款、净收入、实物原数量/运费、会员实际开始与已复核服务核对；币种或接受收款金额不一致时保留旧分并拒绝继续消费。
- [x] 观察期、北京日上限、部分退款累计取整、拒绝释放、Apple未知金额冻结、退款反转和待抵扣接入原账本。
- [x] 四类正成长写入统一按分配份额核日限额；恢复旧奖励不再次消耗当天额度。
- [x] 数据来源变化同事务写 CONSUMPTION_SYNC；租约/代次/退避/失败恢复。明确dirty标记避免数据库微秒时间与App毫秒时间差造成漏核。
- [x] 兑换事务同步核对，未核完不花旧分；每批最多100笔，用户摘要分批提交并显示处理中。订单详情可直接核对所查看的来源。
- [x] App售前规则、订单状态、积分与成长原订单链接，以及消费结算分页；保留原主题和布局。
- [x] Pro积分商城新增只读消费奖励核查，原订单下钻、北京日期/人民币元展示；finance.read与会员编辑分权，操作指南/导航/任务恢复名称同步。
- [x] 修复原积分明细HTTP响应残留BigInt导致500的问题；未获奖励就关闭的订单明确显示未产生奖励，累计积分不误写成新增。原账户、余额及审计事实保持。

## 3. 实现入口

| 范围 | 位置 |
| --- | --- |
| 规则与统一成长日限额 | services/api/src/consumption-policy.ts；learning.ts、practices.ts、forum.ts、community-enhancements.ts |
| 核对/冻结/冲回及持久恢复 | services/api/src/consumption-rewards.ts、points-accounting.ts、points-redemptions.ts、operations-admin.ts |
| 用户与后台接口 | services/api/src/progression.ts、admin-permissions.ts、main.ts |
| 六类报价规则指纹 | course-sales.ts、membership-sales.ts、product-sales.ts、booking-sales.ts、cohort-sales.ts；Apple会员复用appleTerms |
| 数据库 | services/api/prisma/schema.prisma；20261018130000_consumption_rewards（第71迁移） |
| App | components/ConsumptionReward.uvue、lib/consumption.ts、profile/progression与原课程/会员/商品/预约/营期购买页 |
| 官方Pro | pages/points-rewards/Consumption.tsx、原积分商城、access/routes、导航/指南及运行恢复页 |

接口：公开`GET /catalog/consumption-rule`；本人`GET /me/progression/consumption`及`/:id`；财务`GET /admin/points/consumption`。均无任意改分接口，列表分页/状态筛选、后台订单号查询均验证参数。

## 4. 验证证据

- 隔离临时数据库232/232关联回归通过：六类交易、Apple收退款、积分兑换、实际履约、学习/帖子/品质成长及后台恢复；`outputs/consumption-rewards/tests-final.log`。
- 最后调整订单详情聚焦核对后，48/48专项通过（与上述关联重叠，不相加），新增101笔分批核对/处理中不可用及未获分关闭订单说明验证；`tests-focused-final.log`。
- 本地71迁移已应用；迁移前184张原业务表，按原字段投影与精确JSON文本逐表数量/摘要一致；`data-before.json`、`data-after.json`、`local-migration.log`。新增两表不回填旧订单。
- 私有逻辑归档`.runtime/backups/consumption-rewards-before.json.gz`保留，经过压缩往返一致性验证。此归档不是pg_dump整套恢复演练。
- API/Pro/App Web最终构建通过：api-build-verified.log、admin-build-verified.log、mobile-web-build-verified.log。App最终构建无本批新增可空/嵌套类型警告。
- 最终8/8实际Pro/App Web页面交互通过：browser-final.log。覆盖财务只读/原订单链接、课程会员商品售前规则/读取失败重试、预约营期冻结、积分分页切换与北京时间、服务错误重试保留当前页签，以及320/390/768px无整页溢出。0个JS运行异常、0次支付SDK调用；2次HTTP503为明确注入的失败。界面采用API夹具，业务以隔离数据库/HTTP回归为证。
- 最终运行API健康200且规则版本正确，原184表再次完整核对保持；data-after-final.log。源码清单见source-manifest.json。

失败证据保留：初次夹具缺售卖来源/Apple交易号不符合约束；测试未显式授予finance.read且未恢复角色、旧会员测试额度定义未启用；真实接口BigInt序列化及dirty时间边界问题均已修复。App首轮可空/嵌套类型警告已修复；Pro提示条件编辑时的JSX括号错误已修复并重新构建。浏览器脚本初次整数金额格式、Web重载需重新登录及返回页签保持的断言不符合现有行为，按实际契约修正后8项通过，失败日志保留。

## 5. 商用边界与下一步

本批内部交付不代替正式收退款、云媒体、真实服务合同及双端原生验收；未部署、未生成APK或进行手机验收。商用保持38/131（29.0%），不以回归数量提高完成率。

按26接续最靠前依赖就绪未完任务：下一A07直播及线下课与活动真实联动，随后A08服务活动营期联调，再O01统一收入/合同分成快照与O02渠道对账；iOS营期门禁独立记录；实际渠道/合同/签名缺失时记录具体恢复条件，继续能独立完成的代码。R15仍按70，不伪造渠道订阅。
