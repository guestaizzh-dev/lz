# 直播稳定性与课堂体验专项

本轮以直播为最高优先级；会员代金券、真实支付暂停，安卓上架暂不处理。保留管理员直接发布、开播、会员观看、服务器录制及回放的现有流程，不增加审核岗位或礼物。

## 执行清单

- [x] 播放器：区分入房、收帧、重连和失效；短暂接口故障不立即销毁音视频，60秒内恢复续期；权限失效立即停止，超出续期宽限也停止。观众最多5次退避恢复，支持联网事件。
- [x] 授课端：设备拒绝/占用/不存在分别提示；设备选择、重复开播同步保护、重连确认、结束幂等；常用控制集中，互动栏可收起。
- [x] App：原生收帧与断线状态修正；短暂接口故障保留连接、权限拒绝保留设置入口；观看不申请采集权限，退出停止采集。
- [x] 观众端：完整授课画面、独立播放静音、清屏、连接反馈；横屏自动安静观看、回竖屏恢复原设置，前台保持亮屏。
- [x] 服务端：停止推流不再直接结束授课；明确结束或持续断流且服务商确认无流才结束。重复结束不重复写通知/版本；原会员与课程准入保持。
- [x] 验证：78项专项、16组最终页面流程、API/Pro/App Web 构建、Android Kotlin实际SDK编译通过。页面流程包含OBS地址、无采集监看、390px布局及明确结束；0个脚本异常。见 `outputs/live-hardening/ui/checks.json`。
- [x] OBS：已接入提供的 WHIP 域名，无 Bearer Token；后台生成本场地址与监看入口，监看令牌仅拉流，复用原准入/录制/结束流程。真实协议与服务器录制通过。
- [ ] Android 0.3.23/code28：已完成75页云编译并提交DCloud，当前排队；在成包校验和固定下载页发布前，不声称用户已获得新App。

## OBS 官方约束

已查阅 [ZEGO 官方 OBS WHIP 接入](https://doc-zh.zego.im/real-time-video-ios-oc/live-streaming/obs-push-with-whip) 与用户提供的《OBS(1).docx》。用户已提供开通后的 `i-whip563636194.whip.zegotech.cn`，并明确不传 Bearer Token。地址仍包含官方要求的 userId、zgVer、zgExpired、zgNonce；省略后实际返回401，补齐后201。WHIP域名通过环境变量传入，不将推流地址暴露到公开房间接口。

后台同时提示推荐编码：720p、30fps、H.264、B帧0、关键帧2秒、音频48kHz；禁止采用文档指出不兼容的24kHz。OBS外部软件的采集/停止由OBS控制，后台明确提示先停止OBS再结束本场。

## 关键修复位置与原因

| 位置 | 修复 |
| --- | --- |
| `services/api/src/live.ts` | 正常停流回调也先进入恢复期，防止主播重连时被永久关场；结束幂等；OBS监看仅拉流 |
| `services/api/src/live-broadcasts.ts`、`zego.ts` | OBS入口、配置核查、场次地址、开播方式冲突保护；仍须实际查流才确认LIVE |
| `services/recorder/recorder.cpp` | WHIP流可能没有本房间流新增事件，录制器改为登录后主动订阅已知主讲流，失败时有限频率重试 |
| `services/api/public/live/client.js` | 初次直接拉主讲流、观众退避重连、续期宽限、设备错误提示和切换、逐项释放资源、旧请求隔离 |
| `apps/admin/src/pages/live-host/Studio.tsx`、`studio.css` | 设备面板、OBS地址与参数、无采集监看、专注授课、在线数及统一控制区，390/768/1440适配 |
| `apps/mobile/components/NativeRtc.uvue`、`LivePlayer.uvue`、原生RTC双端实现 | 接口故障不误杀、真实播放状态、扬声器静音、后台退出清理 |
| `apps/mobile/pages/live/watch.uvue` | 空入口提示、网络恢复、横屏清屏、亮屏、播放声音控制 |
| `apps/admin/src/operations/workflows.ts` | OBS参数、设备操作、断流恢复与明确结束指南 |

## 真实传输与录制

`scripts/browser/live-whip.mjs` 使用独立随机流和合成音视频，未创建线上业务记录。WHIP HTTP201、RTC查流Code0，正式Web SDK实际解出音频和视频并持续出帧；远端新镜像中的官方Linux录制SDK6.39.0.51681录出13.316213秒MP4，H.264视频与AAC/44100Hz音频齐全。演练文件已定向清理，未挂载业务媒体/数据库卷。证据：`outputs/live-hardening/whip-recording/result.json`。

这是实际WHIP/RTC/服务端录制链路，发送端为标准WebRTC协议测试端；没有运行用户电脑的OBS界面，不代替OBS实机、不同设备与长时弱网验收。

## 线上状态

API、Pro后台与Linux录制程序已发布 `20261029-live-obs-01`，无新增数据库迁移。备份校验通过；17类业务表计数前后一致。公网健康、OBS就绪、录制就绪及备份/监控定时器正常。环境只改镜像标签与WHIP域名，未开启支付/模拟收款或改会员规则。

回退记录 `/opt/daoxue-academy/rollback-20261029-live-obs-01.txt`，原镜像保留。旧版本不识别OBS监看模式，已有OBS场次启用后须优先前向修复，不恢复旧库覆盖业务。线上证据：`outputs/live-hardening/online/checks.json`；服务器构建/切换/核查日志在 `.runtime/live-obs-*.log`，含运维信息，不提交原始日志或私有环境文件。

## 验收边界

界面测试使用真实隔离业务API及显式标注的RTC替身，不替代上述真实传输证据。Android实际SDK Kotlin编译通过（DCloud上下文边界使用编译桩）；HBuilderX单模块本机编译不能解析云端Maven依赖，不计成功。App Web成功，原有非本轮页面的类型警告不作为原生通过证据。未进行手机/iOS实际验收、OBS硬件及长时弱网验收，不提高既有商用完成率。
