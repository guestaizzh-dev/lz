# ZEGO 服务端本地录制

使用 ZEGO 官方 Linux C++ 本地服务端录制 SDK；不使用浏览器录制，不依赖 COS/OSS。API 在 Linux 子进程中为每场直播登录 RTC 房间，仅订阅指定主讲流，使用 SDK 分片 MP4 落盘；结束后统一处理为受控回放。没有推流不会生成虚假录像。

SDK 不提交仓库。构建下载自官方地址并校验 SHA256，版本以实际 SDK `--version` 输出为准。服务端 Token 经 stdin 传入和续期，不进入命令行或日志。进程退出、服务重启后依持久任务恢复，旧分片保留。源文件保存在私有媒体卷，不由 Nginx 直接公开。

官方依据：

- https://doc-zh.zego.im/local-recording-linux-cpp/overview
- https://doc-zh.zego.im/local-recording-linux-cpp/downloadsdk
- https://doc-zh.zego.im/local-recording-linux-cpp/integration/singlestreamrecording

当前记录主讲单流；学员连麦作为课堂互动，不纳入发布的主讲回放。录制失败不会伪装成可回放，后台提供原因及重试。
