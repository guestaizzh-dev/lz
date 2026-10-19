# 书院 uni-push 2.0 网关

该网关只转发推送，不保存用户、课程、订单或会员业务。

## 发布

1. 在当前 DCloud App（`__UNI__AA1E366`）开通 uni-push 2.0，并按发行平台配置厂商通道及 iOS 推送证书。
2. 将 `academy-push` 作为 uniCloud 云函数导入；将同目录 `academy-push-deliveries.schema.json` 导入云数据库。集合禁止客户端读写，云函数通过服务端权限访问。
3. 云函数环境配置 `ACADEMY_PUSH_APP_ID` 为上述 AppID，`ACADEMY_PUSH_SECRET` 为至少32字符的随机密钥。密钥不写入仓库或 App。
4. 将云函数 URL 化为 HTTPS POST 入口；服务端设置 `PUSH_ENABLED=true`、`PUSH_GATEWAY_URL` 和同值 `PUSH_GATEWAY_SECRET`。这三个参数已透传 Compose。API 启动会校验配置，默认关闭。
5. 应用数据库增量迁移，重启 API；重新签名打包 App 后实测。推送模块由官方云打包按调用摇树结果引入，厂商 SDK 按 DCloud 项目开通配置生成，资源编译不能代替此步骤。

## 投递与排查

- 业务事务插入 Notification 时自动写 OutboxJob；API 内置执行器每10秒领取推送任务，数据库租约支持进程重启恢复。
- 同一个投递具有固定32位请求ID。网关先持久登记再调用官方 SDK，重试已接受的请求只返回原任务结果。
- `ACCEPTED` 表示服务商受理；不表示手机收到，也不表示已读。`DONE` 表示任务已处理，也可能因未开推送、无设备、已读或过期而无需发送。
- `UNKNOWN` / `PUSH_AMBIGUOUS` 表示发送结果不确定。先在云数据库和服务商控制台核对原请求ID及任务号，禁止删除登记后直接重发。后台不开放这类任务的盲目重排；站内消息始终保留。
- 断网、拒绝通知、退出后切换账号、杀进程离线厂商送达与 iOS 冷启动必须用正式签名 App 验证。当前项目尚未提供上述实际开通与送达证据。
- 通知栏只有通用提示和消息ID；具体详情须以当前账号重新鉴权读取，推送载荷不指定导航URL。

官方依据：[uni-app x 推送API](https://doc.dcloud.net.cn/uni-app-x/api/uni-push.html)、[uni-cloud-push发送API](https://doc.dcloud.net.cn/uniCloud/uni-cloud-push/api.html)、[Android推送模块](https://doc.dcloud.net.cn/uni-app-x/collocation/manifest-android.html)。
