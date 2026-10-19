from pathlib import Path
p=Path('docs/26-remaining-development-plan.md')
s=p.read_text(encoding='utf-8')
updates={
'A01':('已实现服务报价/老师统一时段、活动基础票种及免费取消延期/通知/学员确认；多票种专用维护、负责人员和付费补偿仍待补','39；44项隔离后端回归及API/Pro/App Web构建通过，免费改期取消界面验证中；正式履约未验收'),
'A02':('免费报名事务库存、幂等、取消一次释放和延期确认已实现；付费超时/晚付补偿、已开始和权益售后仍待补','39；并发取消/改期确认、历史保留、批量通知恢复及共用容量保护专项通过；免费基础不替代付费商用'),
'A05':('已实现运营逐人签到、时间窗、幂等及未确认延期禁签到/履约；委派EventStaff、核销凭证/撤销与结算待补','39；新安排未确认拒绝、接受后签到/履约及历史冻结通过；实际现场、委派及二维码未验收'),
'A06':('App确认/拒绝延期、原新安排及原因、Pro延期取消/库存/履约工作台已实现；付费订单与完整核销待补','39；44项回归与构建通过，实际Web流程验证中；未更新APK或部署'),
}
lines=s.splitlines()
for i,line in enumerate(lines):
    cols=line.split('|')
    if len(cols)==10 and cols[1].strip() in updates:
        gap,evidence=updates[cols[1].strip()];cols[7]=' '+gap+' ';cols[8]=' '+evidence+' ';lines[i]='|'.join(cols)
s='\n'.join(lines)+'\n'
start=s.index('**当前停点（2026-10-12）')
end=s.index('**',start+2)+2
s=s[:start]+'**当前停点（2026-10-12）：A01免费服务/活动取消延期子流程已实现，学员确认/拒绝、最新安排签到履约、原记录保留及持久分批通知接通；44项后端回归与API/Pro/App Web构建通过，实际界面验证中。无新表，新增第29个迁移仅在隔离库应用。A01/A02/A05/A06完整任务仍进行中；下一补A01多票种/负责人员，再A03营期教学与A05委派核销。线上仍member-shop-01，未部署/更新APK，商用38/131不变。详见39。**'+s[end:]
s+='\n| 2026-10-12 | A01取消延期及A02/A05/A06调用端 | 免费子流程实现完成，完整任务仍进行中 | 44项隔离回归、API/Pro/App Web构建通过；专用版本、学员确认/取消、终态快照、活动周期调整与50条分批通知恢复；实际Web验证中，详见39 | 本轮未操作手测/正式库、未部署/更新APK；付费权益/已开始补偿、争议处理、多票种/人员/完整营期待续办；商用38/131不变 |\n'
p.write_text(s,encoding='utf-8')
head='2026-10-12取消延期续办：免费服务/活动整场取消、延期通知、学员确认或取消、终态实际安排冻结及未确认禁履约/签到已实现；44项隔离回归与API/官方Pro/App Web构建通过，实际页面验证中。155表/29迁移，未操作手测/正式库或部署/更新APK；A01/A02/A05/A06完整任务与商用验收仍未完成，38/131保持，下一多票种/负责人员及营期教学。详见[39](39-booking-schedule-changes.md)。\n\n'
for name in ['03-development-progress.md','19-current-progress.md','33-development-status-summary.md']:
    p=Path('docs')/name;p.write_text(head+p.read_text(encoding='utf-8'),encoding='utf-8')
decide='2026-10-12取消延期规则补充：只处理未开始、未签到、无付费/权益预占的免费服务时段或场次。延期晚于原安排，学员须确认最新版本，新开始前可取消；新报名沿普通规则。原服务/报名快照保留，终态另存实际安排，未确认不得签到/记完成或缺席。单场准确时间及必要活动周期由专用延期事务同步、审计；其他场次不改动。站内通知同事务入持久队列，分批/幂等/租约恢复；未接短信或系统推送。本地44项回归、构建通过，实际页面验证中、未上线，边界见[39](39-booking-schedule-changes.md)。\n\n'
for name in ['01-product-requirements.md','02-technical-research-and-decisions.md']:
    p=Path('docs')/name;p.write_text(decide+p.read_text(encoding='utf-8'),encoding='utf-8')
p=Path('docs/07-database-and-crud.md');s=p.read_text(encoding='utf-8')
for title,fields in [('AppointmentSlot / appointment_slot','|scheduleVersion|integer|是|1且大于0|安排专用流程维护|\n|changeReason|text|否|—|最新延期/运营取消原因|\n'),('EventSession / event_session','|scheduleVersion|integer|是|1且大于0|安排专用流程维护|\n|changeReason|text|否|—|最新延期/运营取消原因|\n'),('Appointment / appointment','|acceptedScheduleVersion|integer|是|1且大于0|学员确认专用流程维护|\n|scheduleSnapshot|jsonb|否|—|终态实际安排，不覆盖原快照|\n'),('EventRegistration / event_registration','|acceptedScheduleVersion|integer|是|1且大于0|学员确认专用流程维护|\n|scheduleSnapshot|jsonb|否|—|终态实际安排，不覆盖原快照|\n')]:
    start=s.index('### '+title);end=s.index('\n约束：',start);s=s[:end].rstrip()+'\n'+fields+s[end:]
s='2026-10-12取消延期增量：155表不变，29迁移；AppointmentSlot/EventSession新增scheduleVersion与changeReason，Appointment/EventRegistration新增acceptedScheduleVersion与终态scheduleSnapshot，新增两个流程/通知索引。原快照与历史保留，不提供通用事实编辑。迁移仅在隔离测试库验证，未应用手测或线上数据库，详见[39](39-booking-schedule-changes.md)。\n\n'+s
p.write_text(s,encoding='utf-8')
p=Path('docs/README.md');p.write_text(p.read_text(encoding='utf-8')+'\n- [39 服务预约与活动取消延期](39-booking-schedule-changes.md)：免费整场取消、延期与学员确认、最新安排履约保护、历史冻结及持久通知；付费和完整商用验收边界。\n',encoding='utf-8')
