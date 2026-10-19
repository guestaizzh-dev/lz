# A03：免费营期延期、取消与结营通知

记录日期：2026-10-12，沿用本批证据目录，实际执行时刻见日志。未开营免费营期的安排变更子流程已实现并通过本地验证；已开营补偿、付费营期与完整CO05商用验收仍未完成。

## 用户与运营流程

Pro营期管理新增“延期”和“取消本期”。延期按整数天整体顺延，保留原时刻和营期时长，报名截止、章节开放、作业截止及打卡日期一起移动。表单预览新开营、结营和报名截止北京时间，要求填写学员可理解的通知原因。关闭报名的营期延期后继续保持关闭；取消整期与停止新增报名是不同动作，取消不能重新开放。

仅允许尚未开营、无占位及学习/作业/打卡/成果交付的免费营期变更。已发布教学要求不改写，日期通过保存的开营锚点按相对日程计算；之后新增任务以当次开营日期为锚点，编辑作业草稿可重新记录日期。固定版本、章节开放日、教学要求与原始报名快照继续保留。

原学员须明确确认最新安排后才能进入营期学习、媒体、作业、打卡和讨论；确认旧版本返回冲突，其他账号不能确认。新报名按最新安排确认。本人不便参加可退出，重复取消只释放一次席位；尚未确认的新营期已开始时仍可退出，不能强迫用户接受改期。普通购课与同课其他营期不受影响。

App延期消息直达对应营期，显示最新日期、原因、原报名安排和明确的确认/退出入口。退出记录保存当时安排，后续延期不改变退出历史。整期取消释放全部免费席位、关闭讨论，保留报名和教学事实。我的训练营区分“待确认新安排”“本人已退出”和“本期已取消”。延续现有字体、配色和留白，没有重做UI。

## 通知与可靠性

变更、审计及Outbox通知同事务提交。COHORT_CHANGE_NOTICE与COHORT_END_NOTICE使用租约、SKIP LOCKED、最多50人的批次、幂等事件键、重试与DEAD状态。确认/退出后的旧延期提醒不再投递；不同变更保留独立事实。结营任务随新安排重建，旧安排任务过期后直接结束，不发送提前结营通知。结营后停止学习与新增提交，原私有作业、打卡和点评保留只读历史。

## 数据与接口

第33迁移`20261012180000_cohort_schedule_changes`已在本地应用：

| 实体 | 增量 |
| --- | --- |
| CourseCohort | scheduleVersion正整数、changeReason |
| CohortRegistration | acceptedScheduleVersion、originalScheduleSnapshot、scheduleSnapshot；原报名快照不可改，已确认版本不可倒退 |
| CohortScheduleChange | id、cohortId、scheduleVersion、action、beforeSnapshot、afterSnapshot、reason、actorId、createdAt；同营期/安排版本唯一，禁止更新删除 |
| Assignment、PracticeTask | 可空scheduleStartsAt日期锚点；历史营期任务回填原开营日期，普通任务保持null |
| OutboxJob | 新两类通知任务，历史营期补结营任务，复用已有表 |

新事实通过专用流程维护，不开放通用CRUD。

- `POST /admin/cohorts/:id/postpone`：expectedVersion、days、reason，courses.write及运营角色。
- `POST /admin/cohorts/:id/cancel`：expectedVersion、reason，同权限；拒绝已开始/已有交付的营期。
- `POST /me/cohorts/:id/accept-schedule`：本人有效报名、expectedScheduleVersion；重复确认幂等。
- 原详情增加schedulePending、canAcceptSchedule、原始/退出安排；原学习/教学/论坛接口统一准入和实际日期。
- Pro学员名单增加安排确认状态。

## 验证结果

- **146/146关联测试通过，0失败**；最后新增数据库防倒退和历史结营任务初始化后，18项迁移/日期边界专项通过（与146重叠，不累加）。覆盖整数日程、原事实保护、普通权益隔离、确认冲突、并发延期/退出、已开营拒绝、55人通知批次、租约恢复与结营通知。
- **7/7实际页面流程通过，errors=[]**：Pro延期、App消息新旧安排、确认、二次延期退出、整期取消、取消消息和历史列表。独立临时数据库、真实API及测试OTP；后台受控会话，无业务假响应。
- API、Pro类型检查/生产构建及App Web编译通过。Web使用HBuilderX 5.26 VDOM模式，不代表双端蒸汽原生验收。
- 修复既有排程测试的时间边界夹具：分别取当前时刻创建开营/结营会留下毫秒差，导致第3天实际早于结营；改为同一时间基准验证准确结营边界，未放宽业务校验。页面首次失败为带字数统计的表单定位及弹窗关闭等待，修正脚本后通过。
- 本地**160表含元数据、159个业务模型、33迁移**。用户15、课程8、交易0、营期0；原普通授权、作业、打卡任务、人员摘要及提交3/打卡2前后一致。未清理或重建规范数据，测试夹具只在隔离库。
- 25审查快照哈希保持`c24a94ff6fb6e1735cc85b57a0412a249858dd2d77d1cfd46edf771958222d04`。

证据：[关联测试](../outputs/cohort-changes-2026-10-12/targeted-tests-final-2.log)、[迁移日期专项](../outputs/cohort-changes-2026-10-12/migration-and-boundary-tests.log)、[实际页面](../outputs/cohort-changes-2026-10-12/browser-checks.json)、[本地迁移](../outputs/cohort-changes-2026-10-12/local-migration.log)、[迁移前](../outputs/cohort-changes-2026-10-12/local-before.json)、[迁移后](../outputs/cohort-changes-2026-10-12/local-after.json)。构建日志与截图同目录。

## 下一步与发布边界

完整A03保持进行中。下一A05工作人员委派、凭证核销和撤销，再补付费/已开营补偿以及实际履约。正式云媒体、支付/原生等依赖仍缺。没有部署、云打包或手机验收，最后记录线上仍member-shop-01/28迁移；本轮未连接服务器确认实时状态。

软件商用完成率仍**38/131＝29.0%**，110项任务状态统计不变。免费营期子流程完成不代替付费训练营或完整商用验收。
