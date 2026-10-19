本报告为前批历史记录；当前直播状态、用户接受权限位限制及暂缓云录制的决定以[55交付记录](55-live-course-r1-delivery.md)为准。

# ZEGO RTC 直播阶段交付与验收边界

日期：2026-10-13。本次按用户最新指令优先 M05 直播，服务商改为 **ZEGO RTC**。原始需求的五类直播、购课/会员准入、预约、讨论、回放与内容联动保留；R2 连麦、投票、礼物和老师 App 开播未被删减。

## 当前结论

直播场次、短期凭据、讨论治理、人工审核回放和关联交易入口已实现，本地接口和页面验证见下文。实际 ZEGO 推流与接收解码成功，但**项目权限认证实测尚未生效**。当前 `ZEGO_ROOM_TOKEN_AUTH_ENABLED=false`，受限场次不发 RTC 凭据。不能将此阶段描述为可商用直播，也不能据此增加 38/131（29.0%）的商用完成率。

本次未部署线上、未更新 APK、未做手机验收；现有线上版本与本地新增代码须分别看待。

## 已实现的业务流程

| 范围 | 实现行为 | 当前边界 |
| --- | --- | --- |
| 五类直播 | 文化讲解、研习答疑、实践教学、会员专属、活动同步；直播间和场次分开维护 | 已有规范预告不伪造为实际直播 |
| 场次管理 | 预告、准备、实际直播、结束、审核回放、取消；版本校验和审计 | 不接受手填 LIVE 状态 |
| 准入 | 公开、当前有效购课、冻结会员内容权益；每次续凭据重查 | 停权、过期、退款暂停和下架影响继续访问 |
| 开播台 | Pro 指定管理员主播，官方 Web SDK 摄像头/麦克风、开始/停止、重连 | 普通老师的独立桌面入口及老师 App 开播未实现；不能给老师全房间管理权限来绕过 |
| RTC 凭据 | Token04 GCM；每场独立房间、固定推流 ID；主播和观众权限分开 | 正式权限位验证未通过，入口保持关闭 |
| 回调与恢复 | SHA1 验签、AppID/时间检查、去重/乱序/流 SID 保护、持久记录；服务商查流纠正 | 实际公网回调送达和故障演练未完成 |
| 预约 | 预约/取消幂等、开播前十分钟与开播站内提醒；预告改期保留预约并通知 | 系统推送和短信尚未接入 |
| 讨论 | 弹窗发言、点击经典段落引用、复制正文；本人待审可见，审核后公开 | 只可引用公开经典；结束/回放时只读 |
| 房间治理 | 审核、拒绝、删除、举报处理、房间禁言/解除；复用社区审核表 | WebSocket 只通知刷新，正文始终通过鉴权 API 读取 |
| 回放 | 媒体库 MP4 提交、独立审核/撤下、复用原准入、短期范围播放 | 云录制自动入库、VOD、字幕/资料和直播课程交付绑定未完成 |
| 联动卡片 | 已审核关联的课程、实物商品、可报名活动与实际会员套餐；走既有详情/报价 | 不允许挂载绕过库存、发布或报价授权；正式购买和原生回跳仍待验收 |
| UI | 既有纸色/墨绿/宋体、小幅完善状态提示、弹窗、北京时间、按钮、回放搜索 | 没有重新大改视觉布局 |

App 研习安排优先展示直播中、准备中、最近预告，最后展示近期历史。避免大量未来预告挤掉正在直播的场次。

## 技术实现与安全约束

官方依赖固定为 `zego-express-engine-webrtc@3.13.0`，由 API 构建/启动前复制官方 UMD 至播放器资源目录；不会把后台 React 依赖当作原生 App 依赖。

观看页使用受控播放器：Web iframe、App web-view。App 原生工程继续使用 uni-app x 蒸汽模式，Web 使用官方编译器支持的 VDOM 模式。ZEGO 原有 uni-app 插件要求 nvue/nativeplugins，不能据其示例声称本项目蒸汽双端兼容。当前 WebRTC 在 Android/iOS web-view 的播放、声音、全屏、后台恢复尚未正式验证；必要时改用经过验证的 UTS 原生桥接。

- ServerSecret、CallbackSecret 仅在忽略的 API `.env` 中，AppSign 未使用；不写入 App、后台构建或任务证据。
- 120 秒 Token、90 秒可续租约、最长四小时；租约只保存随机凭据的哈希，并绑定账号与登录会话。
- 结束、退出、撤权、租约过期后停止续凭据，恢复任务调用官方 `KickoutUser`；不能假定 Token 到期会自动终止已经建立的流。
- 加入/续约与场次结束共用行锁，避免结束后并发生成仍可用凭据。新主播会话撤销同场旧主播租约。
- 回调确认开始前核查实际授权主播与未过期租约；旧流结束事件不能终止新流。
- 服务商查流错误不能被当作已断流。连续断流或无有效主播且服务商确认无流时，才结束场次；15 秒恢复任务保留失败重试。
- `DescribeRTCStreamState` 查询序列在当前单 API 进程内严格递增；扩成多实例前需改用共享序列/分布式协调。
- WebSocket 首帧验证租约，不把 Token 或长期登录令牌放到 URL；限制帧大小和连接数。无效连接不能读取内容。
- 讨论 HTTP 十秒回退刷新与 WebSocket 重连分别管理，避免重连不断重置计时器，导致审核/禁言迟迟不更新。
- 回放每次取票和实际 Range/HEAD/GET 都再次核查原权益、审核、资源身份和下架；撤下或更换视频后旧票据即时无效。

## 数据库与本地迁移

第 **41** 项迁移 `20261013060000_zego_rtc_live` 已应用本地 `daoxue_dev`；线上尚未应用。本地 **161 业务模型、162 表（含迁移元数据）**。

| 表 | 本次调整 |
| --- | --- |
| LiveSession | providerEventAt、providerSequence、providerStreamSid、disconnectedAt、providerCheckedAt；状态 CHECK 和房间/恢复查询索引 |
| LiveRtcLease（新增） | id、sessionId、authSessionId、userId、rtcUserId、role、keyHash、expiresAt、absoluteExpiresAt、revokedAt、kickedAt、createdAt、updatedAt；外键、唯一哈希和恢复索引 |
| Comment | liveSessionId、requestKey；直播文字长度/无父评论 CHECK、按场次/作者/请求键唯一、时间游标索引 |
| LiveReservation / Notification | Prisma 唯一约束声明对应既有数据库索引名称，不重复建立平行索引 |

继续复用 LiveRoom、LiveReservation、LiveReplay、ProviderCallback、Comment、Report、ModerationAction、UserRestriction、ContentRelation；未新增另一套 LiveMessage 存储。

迁移前后逐表行数和原字段内容摘要一致；LiveRtcLease 初始为空。规范测试用户、文章、课程、媒体、授权和教学数据完整保留。证据：[本地迁移](../outputs/zego-rtc-2026-10-13/local-migration.json)。

## 本地验证

- API 构建、官方 Pro 类型检查/生产构建、App Web 生产构建通过。后台首次构建遭遇本机内存不足，设置 Node 内存上限后成功；未通过杀掉用户进程处理。
- 最新 **38/38** 后端关联回归通过：官方 Token04/验签向量、配置门禁、状态/预约/改期、并发凭据结束、回调身份与乱序、会员/购课撤权、讨论审核/引用/禁言/举报、实际 WebSocket、回放 Range/撤权、断流恢复、卡片库存与发布过滤、查询序列。回放接口测试的小文件不作为视频解码证据。[接口日志](../outputs/zego-rtc-2026-10-13/api-regression.log)
- **9/9** 实际浏览器流程通过：[页面验证](../outputs/zego-rtc-2026-10-13/browser-checks.json)。使用独立临时数据库、真实 API、实际 OTP 登录和 Pro 操作；ZEGO 状态适配器明确隔离模拟，不计实际 RTC 观看验收。回放使用本地生成的二十秒 H.264/AAC 样本实际解码播放，回放采用16:9高度，避免复用直播工具栏高度造成多余黑边。
- 独立正式 ZEGO 探针：[provider-probe.json](../outputs/zego-rtc-2026-10-13/provider-probe.json)。真实主播与观众登录、官方 SDK 推流、观众视频解码成功，收到 320×180 视频帧；不是本地状态模拟。

## 当前真实阻塞 X05

用户已确认在控制台开启房间及推流权限认证；实际探针仍得到：

| 实测 | 结果 |
| --- | --- |
| 正常主播/观众登录 | 成功 |
| 主播 RTC 推流与观众解码 | 成功 |
| 使用 A 房间 Token 登录 B 房间 | **仍成功，应拒绝** |
| 观众 Token 的推流权限为 0，直接调用推流 | **仍成功，应拒绝** |

依据 [ZEGO 权限认证文档](https://doc-zh.zego.im/live-streaming-web/communication/use-token-authentication)，基础鉴权默认开通，房间 ID 和推流 ID 权限位需联系 ZEGO 技术支持开通。当前不能用控制台文字确认替代以上两项拒绝结果，也不会再次询问同一个开关问题。

恢复条件：ZEGO 对本 AppID 确认房间/推流权限位已实际生效；跨房间、观众推流和主播错误 streamId 均被拒绝，合法推流/观看仍正常；随后才允许设置 `ZEGO_ROOM_TOKEN_AUTH_ENABLED=true`。正式上线还需配置公网回调、验证云录制/回放、原生及购买联调。

## 后续执行入口

1. L04：补云录制回调、自动媒体入库/VOD、字幕资料和直播课程版本交付绑定；保持独立审核。
2. L02/L03/L06：服务商权限位修复后重测负向准入，验证实际开播/结束回调、断线/撤权退房；正式双端与交易验收仍记录为未完成。
3. A07：直播课程、名师统一日程和活动交付联动，再回到 A05 付费实际履约/预收结算。

后台入口 `/content/live`，App 入口 `/pages/live/detail?id=<直播间ID>`。后台先新建直播间并在展示审核发布，再安排场次、准备开播；只有指定管理员账号能进入当前 Pro 开播台。回放在已结束场次提交，审核通过后才出现在 App。

部署时同时发布 API/player/SDK 和 Pro，应用第 41 迁移，并更新双层 Nginx 的 `/api/v1/live/socket` Upgrade 转发及播放器专属 iframe 策略。现有反代文件已补齐配置，尚未部署验证；不全局关闭安全响应头。

官方依据：[Web 开播](https://doc-zh.zego.im/live-streaming-web/quick-start/implementing-live-streaming)、[服务端回调](https://doc-zh.zego.im/live-streaming-server/callback/receiving-callback)、[查流](https://doc-zh.zego.im/live-streaming-server/api-reference/media-service/describe-rtc-stream-state)、[退房](https://doc-zh.zego.im/live-streaming-server/api-reference/room/kick-out-user)、[uni-app SDK 边界](https://doc-zh.zego.im/live-streaming-uniapp/quick-start/integrating-sdk)。
