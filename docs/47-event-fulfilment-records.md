# A05：免费活动实际履约与更正记录

2026-10-12。活动结束后的实际交付记录子流程已实现并本地验证。完整A05仍进行中，付费退款、结算积分及真实现场验收未完成。

## 实际流程

Pro现场工作台将到场与履约分开。运营在活动结束后记录实际完成服务人数、内部依据、学员可见结果和说明；人数不能超过有效签到人数。服务端区分完整交付、部分交付、到场未交付和未到场。尚未结束、取消、未确认最新安排及付费/权益报名不能按免费活动记录完成。老师/助教仅可查看获委派场次，不能确认履约。

签到保留原COMPLETED存储语义，App改为「已签到」，不冒充服务完成。我的报名显示独立的最新交付结果、实际人数、北京时间和学员可见说明，未登记时明确等待书院记录。内部依据、原因、工作人员和请求哈希不返回学员。站内通知可回到我的预约与报名。

误录通过追加更正版本处理，保留旧证据和旧结果；不覆盖或删除原记录。版本冲突要求刷新，重复提交使用同一请求编号，不重复创建事实/通知/审计。网络结果不确定时保留原提交，并提供重试原提交入口。免费活动没有消费金额，不生成消费积分或合作结算。

## 数据与接口

第35迁移`20261012220000_event_fulfilment_facts`已应用本地。新增EventFulfilment：id、createdAt、registrationId、sessionId、revision、requestKey、requestHash、actorId、outcome、quantity、attendanceCount、deliveredCount、evidence、publicSummary、reason、scheduleSnapshot、attendanceSnapshot。

同报名/修订与请求编号唯一。CHECK约束人数及结果关系，外键绑定报名、场次和工作人员；触发器禁止修改/删除，插入再次校验场次、安排确认、结束时间、免费身份、人数和修订顺序。签到事实快照与安排保留。新增事实仅专用流程可写，不开放通用CRUD。

- `GET /admin/events/workbench/registrations/:id/fulfilments`：运营读取历史；老师可从`/admin/teaching/event-workbench`读取获委派报名。
- `POST /admin/events/workbench/registrations/:id/fulfilments`：expectedRevision、deliveredCount、evidence、publicSummary、reason、requestKey；运营角色与events.write双重校验。
- 原工作台分页名单增加最新结果与canFulfil，原`GET /me/bookings`只返回本人最新公开摘要。

## 验证与环境

43/43关联HTTP/PostgreSQL测试通过，覆盖到场不自动完成、截止时间、重复通知/审计、四类结果、并发更正、不可变事实、过期版本、角色缩限、本人隐私、付费禁用及取消/未确认安排。9/9实际页面流程通过（含6条既有核销流程），errors=[]；Pro真实保存和更正、学员最新结果及内部证据不泄露。测试使用独立临时数据库与真实API、App测试OTP、后台受控会话，时刻推进仅是隔离夹具，不是实际活动执行证明。

API、Pro类型/生产构建与App Web导出通过。Web为HBuilderX 5.26 VDOM，手机摄像头及双端蒸汽原生未验收。浏览器前次因恢复了不存在的Web持久登录而失败，修正脚本保留学员原页面的内存会话；未改会话存储策略。

执行时Windows进程与本地PostgreSQL中断，核实端口拒绝后用已有dev:db恢复，PostgreSQL完成WAL恢复；不删除PID、不清库、不重建数据。之后第35迁移成功应用。161表含元数据、160业务模型、35迁移；用户15、课程8、交易0、提交3、打卡2和原普通授权/作业/人员摘要前后一致。

证据：[关联回归](../outputs/event-fulfilment-2026-10-12/targeted-tests-final.log)、[真实页面](../outputs/event-fulfilment-2026-10-12/browser-checks.json)、[最终页面日志](../outputs/event-fulfilment-2026-10-12/browser-checks-final-3.log)、[本地迁移](../outputs/event-fulfilment-2026-10-12/local-migration-final.log)、[迁移前](../outputs/event-fulfilment-2026-10-12/local-before.json)、[迁移后](../outputs/event-fulfilment-2026-10-12/local-after.json)。构建与截图同目录。

## 后续

下一处理A01/A02活动优先开放窗口与M07权益前置，再续付费预约/活动/营期和结算补偿。真实支付X03、直播/回放X05、实际内容/现场X07和原生X08缺失继续记录，不用免费流程替代。商用38/131＝29.0%，110任务统计不变。无上线、云包或手机验收，本批未连接线上；最后部署记录仍member-shop-01/28迁移。
