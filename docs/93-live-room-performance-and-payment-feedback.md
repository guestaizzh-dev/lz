# 直播房间查询与支付/直播状态反馈（2026-10-25 第 3 轮）

本轮按“整体优化”目标继续：一处直播热点查询、两处用户可见的状态反馈。未改业务规则与页面结构。

## 本轮评估的不足

1. 直播详情每 15 秒轮询一次；房间内每个场次都单独查询一次已发布回放，最多 50 个场次就多出 50 次查询，而录制状态已经批量查询。
2. 购课订单超过付款期限后仍显示“待支付”，按钮只给“查询订单状态”；接口返回的 `paymentStatus`（EXPIRED/CHECK_REQUIRED/UNAVAILABLE）App 从未使用，用户看不到卡住的原因。
3. 服务端 ZEGO 通道不可用时，直播详情页仍显示“进入直播”，只有点击后才弹一次错误，页面本身不说明原因。

## 改动

| 位置 | 改动 |
| --- | --- |
| `services/api/src/live.ts` `room()` | 回放与录制改为一次批量查询并并行执行，替代每场次一次查询；字段与返回结构不变 |
| `apps/mobile/lib/course-sales.ts` | `orderLabel` 在订单仍待支付但 `paymentStatus=EXPIRED` 时显示“支付已超时”，购课订单列表与购课页共用 |
| `apps/mobile/pages/course/purchase.uvue` | 状态卡补充不可付款原因：渠道待确认、当前方式不可用、付款已超时（超时只在状态正文说明一次，不重复） |
| `apps/mobile/pages/live/detail.uvue` | 服务端报告 `rtcReady=false` 时，在“本场内容”下说明观看通道维护中，预告/预约/回放不受影响 |

## 验证

- API 构建通过；直播相关测试 45/45 通过（含房间排序、回放审核与凭证、取消、心跳、录制恢复）。
- 购课 UI 单元测试 4/4 通过，新增“超时订单与普通待支付订单标签不同”的断言。
- HBuilderX 5.26 Web 导出与 Android 蒸汽模式字节码编译均覆盖 76 页面，0 编译错误（既有 `<button>` 子元素与 `aria-hidden` 警告不变）。
- 未做数据态截图：购课页与直播详情需要登录态，本地 Web 预览直连生产 API 被跨域限制；状态文案改动由构建与单元测试覆盖，真机/线上登录态复核仍待补。

## 仍未处理（需要设备或业务决定）

- `<button>` 内含 `<text>`/`<image>` 的原生警告集中在 `pages/live/watch.uvue`（3 处，菜单箭头）、`pages/cohort/index.uvue`（训练营卡片，2 处）、`pages/booking/workbench.uvue`（场次按钮，2 处）、`pages/booking/confirm.uvue`、`pages/profile/note-export.uvue`（3 处）、`pages/profile/gifts.uvue`。未接手机无法确认原生是否丢弃这些子元素；其中训练营卡片与场次按钮若被丢弃会变成空白行，应优先做真机核对，确认后再决定改为可访问的点击容器或拆分按钮。
- 直播房间仍按场次逐个做准入判断（`access()`），同一房间的课程/会员上下文重复查询；再优化需要给准入加只读缓存，先补并发与退款场景测试。
- 退款准入规则三处不一致、直播租约清扫重试上限，见 [91](91-code-and-interaction-review-2026-10-25.md)。
