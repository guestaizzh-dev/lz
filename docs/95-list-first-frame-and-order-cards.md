# 列表首帧状态与订单卡片一致性（2026-10-25 第 5 轮）

本轮处理上一轮发现的列表页首帧问题，并顺手统一两个仍是旧纸色的订单页。未改接口、筛选条件与订单状态规则。

## 本轮评估的不足

1. 课程订单、会员订单、学习档案、直播列表、商品订单、预约订单、训练营订单首帧 `loading=false`，会先闪一下“还没有…/暂无已发布直播”，随后才进入加载。直接把 `loading` 初始值改成 true 会命中各页 `load()` 的 `loading` 互斥，首次请求被挡掉并停在加载态（上一轮已尝试并回退）。
2. 预约订单与训练营订单的卡片仍是 `#FFFEFA`、4px 圆角、旧描边，与课程/会员订单的纸面卡（`#FCF9F2`、12px 圆角、`#E3DCCF`）不一致。
3. 预约/训练营订单刷新时会在已加载列表上方插入整页加载块；商品订单每次刷新先把列表清空再显示加载，返回页面时列表消失一下。

## 改动

| 页面 | 改动 |
| --- | --- |
| `pages/course/orders.uvue`、`pages/membership/orders.uvue`、`pages/live/index.uvue`、`pages/course/library.uvue`、`pages/shop/orders.uvue`、`pages/booking/orders.uvue`、`pages/cohort/orders.uvue`、`pages/booking/mine.uvue`、`pages/booking/workbench.uvue`、`pages/cohort/index.uvue` | 增加 `ready` 标记，只在完成过一次真实请求后显示空状态；首帧保持安静，不误报“没有内容” |
| `pages/booking/orders.uvue`、`pages/cohort/orders.uvue`、`pages/booking/mine.uvue`、`pages/booking/workbench.uvue`、`pages/cohort/index.uvue` | 刷新时保留已加载列表（仅无数据时显示加载）；订单/场次/训练营卡片改为统一的纸面卡（`#FCF9F2`、1px `#E3DCCF`、12px 圆角、16px 内边距）；核销凭证卡、工作台输入框同步到同一纸面与输入样式 |
| `pages/shop/orders.uvue` | 返回页面时保留列表后再刷新；仅切换筛选时清空并显示加载 |
| `pages/course/library.uvue` | 刷新时不再用整页加载挡住已加载档案，仅在无内容时显示加载 |

## 验证

- HBuilderX 5.26 Web 导出成功、Android 蒸汽模式字节码编译覆盖全部 76 页面，0 编译错误（既有 `<button>` 子元素与 `aria-hidden` 警告不变）。
- 本轮只改条件渲染与样式，未改接口与数据契约，因此未重跑 API 回归。
- 列表页需要登录态与订单数据，未做数据态截图；验证以构建与代码路径为主。

## 仍未处理

- 预约购买页的少量分隔线与选中底色仍是旧色值（`#E2DDD3`、`#EAF0EB`、`#9B3F32` 等，与 `#E3DCCF`、`#E6EDE9`、`#B4533F` 只差一两级）；已不再使用 `#FFFEFA`，这些细项留到统一色板清理。
- 会员中心套餐选择、订单/档案列表中的可点击卡片在 Web 仍不可键盘操作。
- 退款准入规则三处不一致、直播租约清扫重试上限见 [91](91-code-and-interaction-review-2026-10-25.md)；原生 `<button>` 子元素疑点见 [93](93-live-room-performance-and-payment-feedback.md)。
