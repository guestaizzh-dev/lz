# 119 · 直播黑屏、即时评论与后台生命周期整改（0.3.35）

## 1. 当前交付与验收边界

API/后台已发布 `20261102-live-media-0335`，85 迁移不变，21 类原业务表计数保持。Android **0.3.35/code40** 已签名并更新原下载页，release revision **16**，公网完整包 SHA256/Range206/健康通过。

- **真实 OBS 黑屏已恢复，用户确认手机已看到画面**。这是当前安装版本的媒体验证，不代替新 APK 所有 UI/后台/连麦真机验收。
- 评论即时公开已实现并配套发布；新原生 UI、后台聆听及连麦撤销修复已包含在新包；用户升级0.3.35后确认输入居中/分享退出图标及后台约30秒声音、返回画面均正常。双端真实连麦、锁屏/厂商省电/长时网络切换与 iOS 正式验收继续保留。
- 商用 **38/131** 不变；没有真实收退款操作，没有以局部媒体恢复代替整体商用验收。

## 2. WHIP 地址与真实根因

用户明确确认 `i-whip563636194.whip.zegotech.cn` 已配置免 token。OBS 服务选 WHIP，服务器填本场完整地址，**Bearer 留空**。地址沿用项目既有拼接：

```text
https://i-whip563636194.whip.zegotech.cn/whip/v1/563636194/lecture_本场UUID去横线?userId=本场推流用户ID&zgVer=v1&zgExpired=Unix秒&zgNonce=随机值
```

免 token 仅指该 WHIP 域名的 OBS 接入；App 会员观看、RTC Token04 房间权限、连麦授权及后台权限继续由服务端验证。正式地址在后台“OBS 推流设置”按本场生成，**新建场次需要重新复制本场地址**，不能把上一场已结束场次的地址当成本场地址。

最初真实拉流记录返回 `1003081 / B-frame is detected in the bitstream`，视频尺寸 0、解码 0 帧；同时 Windows OBS 留有上一场 `5a2f243f…` 的地址，该场已结束。用户提供的 Word 只作配置事实参考，没有修改原文；已核对 ZEGO 官方文档及项目 SDK 3.25.0 的实际方法签名。

Windows OBS 原配置先备份到 `.runtime/obs-encoder-before-fix`，通过界面调整为：**x264 / CBR 2500 Kbps / Baseline / zerolatency / 关键帧 2 秒 / 1280×720 / 30fps / 48kHz Opus**。Bearer 继续空白。已替换为当前“侧式2”场次 `ae0bfd65-7e8c-45d5-a9fd-6435bc26b541` 地址，并通过官方后台 ENTER_OBS 建立本场测试租约；用户当次确认公开推送预览品牌图片和桌面声音后才点击开始直播。

真实同场拉流 12 秒：解码帧数 **105 → 194 → 284 → 375**，尺寸 **1280×720**，B 帧错误和 JS 错误均 0，采样视频丢包 0。SDK peerToPeerDelay 为 **287/255/227/243ms**，不宣称是 OBS 原画面到手机的端到端测量。用户明确答复“手机已看到画面”。服务端本场 LIVE，录制 RECORDING，failure=null、retries=0。

证据：`outputs/obs-mode-diagnosis/windows-fixed/{result.json,received.png,encoder-settings.json}`；之前失败证据 `outputs/obs-mode-diagnosis/black-screen` 保留；服务端状态 `outputs/deploy-0335/live-actual-test.log`。旧合成传输延迟测试仍仅代表合成链路，见118。

官方资料：

- https://doc-zh.zego.im/real-time-video-ios-oc/live-streaming/obs-push-with-whip
- https://doc-zh.zego.im/faq/obs-stream-sync-issue
- https://doc-zh.zego.im/faq/audio-video-background-keep-alive
- https://developer.android.com/develop/background-work/services/fgs/service-types

## 3. 代码变化

- Android/iOS 拉流前按 ZEGO 文档开启兼容：LIVE 模式 `enableCheckPoc(false)`、`enableHardwareDecoder(false)`；实际 SDK jar 签名及 Android Kotlin 编译通过。原生主讲视频不再以音频首帧或 PLAYING 连接信号直接判为画面播放，改用视频渲染首帧；Android 连续无视频质量样本给出明确提示。Web B 帧/无视频错误也保留明确错误，不被成功连接信号覆盖。
- 原生评论入口用统一 44px 高度与行高居中；分享/退出图标由独立视图承载，避开原生 button 混合图片渲染缺失。
- **仅 LIVE 评论**直接创建为 APPROVED，保留入场权限、禁言、频率限制、幂等、举报、事后移除和审计；其他文章/课程等评论规则不变。历史待审内容继续独立处理，不批量追溯公开。发送文案改为实时公开与已发送。
- 连麦仍按申请→主播邀请→用户明确同意→采集权限→连接；取消/移除立即撤销本地 consent，刷新播放与发布凭据；权限撤回及账号切换停止采集。后台原生续约拿到移除后的 publishStreamId=null 也立即停采集，避免 JS 挂起时仍继续开麦。
- Android 增加 mediaPlayback/microphone 前台服务、持续通知、通知栏退出、部分唤醒锁及后台原生 20 秒 HTTPS 租约续约。仅在已验证直播且设置允许时启用，观看不申请麦克风；连麦服务类型需用户已同意设备权限。切到后台继续声音、关闭摄像头；返回前台恢复经确认的画面设置。鉴权终止立即停止，临时网络失败最多 60 秒；退出直播、账号切换、移除任务停止服务与采集。租约只在内存，不落盘，不自动重启已退出的直播。
- 页面区分切到其他应用与在应用内离开直播，后台服务确认就绪后才保留页面租约；App 前台退出/卸载页面仍释放；回放及 iOS 未实现后台服务时仍按原释放逻辑。
- iOS 本轮完成解码与播放信号修正；**iOS 后台音频与正式签名构建仍未实现/验收**，不宣称双端后台保活完成。

## 4. 验证与构建

- 播放器/连麦/生命周期 **26/26**，含宿主移除后撤销 consent、切后台保留租约与前台离开释放。
- 隔离数据库直播与 OBS **23/23**，补充连麦/咨询业务 **8/8**（独立角色、重复申请、邀请与确认分离、移除、结束场次撤权），连同原生交互共 **57** 项专项；直播消息新创建后另一观众立即可见，仍覆盖禁言/举报/移除。没有向生产直播间自动发布评论。
- 浏览器 **17 组**、0 JS 异常；RTC 交互部分为替身，真实传输证据按第2节单独记录。生产只读后台6页、17项API检查通过；业务写入仅明确授权的本场推流准备/租约、状态、录制及版本配置。
- `npm run check` 通过：122 移动脚本、206 Node、17 JSON、127 CSS/SFC，引用无孤立项，733 文件格式0待修，工具测试8项通过。API/后台/Web构建通过。
- Android Kotlin 使用实际 SDK 3.25.0 与 Android35 编译通过；仅低版本通知 API 兼容分支存在 deprecated 警告。
- 79 页蒸汽编译通过，**514** 源文件比对仅两项原授权无系统推送覆盖；云任务 `7d835880-d73b-11f1-999c-198ab9ae9f25` OK。
- APK **50,158,628 字节**，SHA256 `39a685a961300346d94d55fab3333dd10f297889be80a4821e06489398087536`。原证书 `81d6c07aa2d22b2e022bcc6f00148f984c8bc5aac427f60207e1233c1e8df248`，Android 官方 apksig8.8.2 v1/v2 验证通过。包内已核对前台服务声明、服务类、原生续约与视频渲染回调、首页启动和生产HTTPS。
- 用户已确认升级新包后UI、后台约30秒听播与返回画面正常；本机ADB无设备，未由代理安装。反馈见 `outputs/live-media-fix-0335/phone-user-feedback.json`，不冒称长时或双端连麦验收。专项及静态日志在 `outputs/live-media-fix-0335`。证据 `outputs/android-preview-0335`、`outputs/android/daoxue-academy-0.3.35.{apk,json}`。

## 5. 发布与恢复

主机 ubuntu@43.160.229.173，目录 /opt/daoxue-academy。当前 API/后台 `20261102-live-media-0335`；归档875文件，SHA256 `c71e7205d82b0dfd5916cafd089adf5d3a61689cd5299fb2ed464449437b5d4c`，包含0334后的播放器热修；运行镜像已包含该热修，不再依赖覆盖层。

备份 `academy-20261103T040637Z-MtSbJm.dump` 及媒体包 SHA256/pg_restore目录可读。回退 `rollback-20261102-live-media-0335.txt`；上一版0334保留，无迁移，环境仅 API_IMAGE_TAG 变化。发布前阻止活跃流/实际录制，当前准备场次经 ZEGO 41004 与 ARMED/startedAt=null 验证后允许准备任务重连；没有停止实际推流录制。21类业务计数一致，服务healthy、watch/backup timer active；备份与发布后约9GB可用。

固定下载页 https://cuecanvas.top/download/ 已原子发布 `releases/0.3.35-code40`，10项文件校验通过；release revision16，整包公网哈希、Range206、二维码与健康通过。数据库只前向兼容，不用旧备份覆盖新业务。

发布暂存清理：10个校验一致的本轮下载暂存文件、上传源码归档和下载归档共111,664,929字节已清理；在删除前后核对活动APK完整哈希，业务媒体、备份、原下载版本与回退点保留，未重启服务。证据 `outputs/deploy-0335/cleanup.log`。临时测试控制租约已正常释放、临时保活进程已自行停止；OBS测试流和本场LIVE/RECORDING保持，未结束用户场次，见 `live-after-test-handoff.log`。

发布中的两项失败留档：首次构建脚本上传 CRLF 导致 shell pipefail 失败，规范 LF 后构建成功；首次备份读取权限与只读诊断 relation 查询失败，改用已有 sudo 管道与合法查询后通过，未改业务数据。

## 6. 尚待验收

- [x] 当前真实 OBS 推流、后台同 SDK 解码和手机有画面
- [x] 免 token 域名及当前场次地址、OBS低延迟编码配置
- [x] 评论即时公开、UI/连麦撤销/Android后台服务实现、配套发布和APK交付
- [x] 用户升级0.3.35确认按钮对齐/图标、约30秒后台听播及返回画面正常
- [ ] 主播与学员真实双端连麦、撤销/断网/锁屏/省电及长时恢复
- [ ] 实际 OBS 源时钟→后台/手机端到端延迟测量
- [ ] iOS后台音频实现、正式签名构建与设备验收
