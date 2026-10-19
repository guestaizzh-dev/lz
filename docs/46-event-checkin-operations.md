# A05：活动工作人员、凭证与现场核销

2026-10-12。本子流程已实现并本地验证，完整A05仍进行中。

运营在官方Pro活动场次中选择有效老师/助教，分别授予签到与误签到撤销权限；委派只适用于对应场次，撤销即时生效。App与后台现场工作台均复验角色能力和场次归属，通用数据维护不能改写EventStaff。

本人从「我的预约与报名」出示15分钟临时二维码，也可复制完整凭证。凭证包含报名标识和随机令牌，不含联系方式；数据库只保留哈希和有效期，刷新使旧码失效。工作人员核对脱敏号码与人数，逐人确认到场；拒绝跨场次、过期、取消、未确认最新改期及时间窗外核销。

重复或并发核销同一参加者只创建一条有效签到。误签到必须填写原因，原核销人与时刻保留；撤销幂等，再次到场生成新事实。网络结果不确定时客户端保留请求编号。有效到场统计排除已撤销记录；历史签到仍阻止整场延期，保留保守边界。

第34迁移`20261012200000_event_checkin_operations`本地已应用。EventRegistration新增checkinExpiresAt，EventCheckin新增revokedAt/revokedBy/revokeReason，有效签到使用部分唯一索引，数据库禁止删除签到及改写原事实/已撤销记录。160表含元数据、159业务模型、34迁移；原144实体仍查询，完整通用CRUD从33减至32，112类受控。规范用户15、课程8、交易0、提交3和打卡2及原普通授权/作业/人员摘要一致，未清库。

接口：本人`POST /me/bookings/registrations/:id/checkin-code`；委派位于`/admin/events/sessions/:id/staff`；现场工作台为`/me/event-workbench`、`/admin/events/workbench`及`/admin/teaching/event-workbench`，提供场次、分页名单、inspect、checkin和checkins/:id/revoke。

验证：88/88关联HTTP/数据库测试通过；最后锁内重读报名修复后7/7核销专项通过（与88重叠，不累加）；6/6真实页面流程通过，errors=[]。API、Pro类型/生产构建、App Web导出通过。表单补充委派说明可访问名称；App登录白名单补齐预约、凭证、工作台和带营期的作业/打卡返回路径。

证据位于[本批目录](../outputs/event-checkin-2026-10-12/)：targeted-tests-final.log、event-lock-tests.log、browser-checks.json、browser-checks-final.log、api-build-final-2.log、admin-build-final.log、app-web-build-final.log、local-before.json、local-after.json和local-migration.log。页面使用隔离数据库与真实API，后台受控会话、App测试OTP，无业务假响应。

二维码生成与粘贴核销已验证，手机摄像头及双端原生未验收。全部签到的旧COMPLETED状态仅代表全部到场，不代表实际履约/结算。下一补活动结束后的履约记录与学员可见结果；付费订单、退款、结算积分及真实现场验收仍未完成。无部署、云打包或APK更新，最后记录线上member-shop-01/28迁移，本批未连接线上。商用38/131＝29.0%，110项执行任务统计不变。
