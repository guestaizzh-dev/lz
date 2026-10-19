from pathlib import Path
import hashlib
import json
import re
from collections import Counter

root = Path.cwd()
snapshot = root / 'docs/25-commercial-readiness-review.md'
snapshot_hash = hashlib.sha256(snapshot.read_bytes()).hexdigest()

def read(name):
    return (root / 'docs' / name).read_text(encoding='utf-8')

def write(name, text):
    (root / 'docs' / name).write_text(text, encoding='utf-8')

def replace_line(text, prefix, replacement):
    lines = text.splitlines()
    matches = [i for i, line in enumerate(lines) if line.startswith(prefix)]
    if len(matches) != 1:
        raise ValueError(f'Expected one line for {prefix}; got {len(matches)}')
    lines[matches[0]] = replacement
    return '\n'.join(lines) + '\n'

status = '当前状态以[33进度汇总](33-development-status-summary.md)为唯一汇总入口；任务状态、依赖和下一项以[26执行计划](26-remaining-development-plan.md)第4/6/7节为准。下方各日期段落是对应阶段的规则或历史证据，不能据其旧状态判断当前完成度；[25商用审查](25-commercial-readiness-review.md)保留为2026-10-10快照。'
current = '2026-10-12：项目仍为Android/iOS App + Web运营后台，七板块R1/R2保留、R3展望暂不开发。本轮用`pnpm dev:db`恢复本机隔离验证环境，预约/活动与后台45/45 HTTP及数据库回归、9/9真实浏览器流程通过；修复Pro活动表单漏提交负责人字段。155表、29迁移。未更新手测/正式库、部署或生成APK，原始软件商用基线38/131（29.0%）保持。A01/A02/A05/A06完整任务仍进行中；下一继续A03营期专属教学与A05委派核销，详见[39](39-booking-schedule-changes.md)。'

for name, title in [
    ('01-product-requirements.md', '# 老子道学书院 App：产品需求与实施契约'),
    ('02-technical-research-and-decisions.md', '# 老子道学书院 App：技术调研与选型决策'),
]:
    text = read(name)
    text = text.replace(title + '\n', '', 1)
    text = text.replace('本地44项回归、构建通过，实际页面验证中、未上线', '本地最新45项关联回归、9项实际页面流程通过、未上线')
    text = text.replace('API/后台构建通过，数据库回归因本地PostgreSQL未运行而待验证，见26与39；不计为完整A01验收。', 'API/后台构建、多票种与负责人HTTP回归及真实表单保存已通过，见26与39；不计为完整A01验收。')
    text = text.replace('数据库HTTP验证受本机PostgreSQL未启动阻塞。', '数据库HTTP与Pro实际负责人保存验证已通过；修复表单漏提交responsibleUserId的问题。')
    text = text.replace('代码/API/Pro构建通过；本机PostgreSQL未运行导致新增HTTP回归暂未执行。', '代码/API/Pro构建与新增HTTP回归、Pro实际多票种表单保存通过；付费差异报价与完整R2活动交付仍未完成。')
    write(name, title + '\n\n' + status + '\n\n' + text.lstrip())

for name, title in [
    ('03-development-progress.md', '# 开发与上线验收进度'),
    ('19-current-progress.md', '# 项目整体进度（2026-10-09）'),
]:
    text = read(name).replace(title + '\n', '', 1)
    heading = '# 开发与上线验收进度' if name.startswith('03') else '# 项目整体进度'
    write(name, heading + '\n\n## 当前状态（2026-10-12）\n\n' + status + '\n\n' + current + '\n\n## 历史阶段记录\n\n以下记录保留原日期、当时结果和统计，不作为当前任务状态源。\n\n' + text.lstrip())

name = '07-database-and-crud.md'
text = read(name)
text = replace_line(text, '2026-10-12当前入口：', '2026-10-12当前入口：预约、活动、营期及六类内容联动复用既有表；取消延期新增一项字段与索引迁移，仓库共29迁移、155表，已在本轮隔离空库完整应用，未应用手测或线上数据库。144实体当前33类完整通用CRUD、111类受控流程；服务、时段、活动场次/票种、营期采用专用工作流，不允许通用数据维护直接改席位和权限事实。营期讨论区禁止经通用CRUD创建归属、改范围或删除，普通公共讨论区保留原CRUD。当前增量见[39](39-booking-schedule-changes.md)，此前38阶段的28迁移和下方结构统计是历史证据。')
write(name, text)

name = '26-remaining-development-plan.md'
text = read(name)
text = replace_line(text, '| A01 |', '| A01 | 进行中 | **统一服务及活动可售模型**：复用ServiceOffering/Slot/EventSession/Ticket等现有实体；价格时长、场地容量、负责人员及取消规则专用配置。 | TE06、TE08、LK10、SH03、CO06 | — | 咨询、见面、线下课、商品服务共用同一库存；不可售服务无结账入口，时间均北京时间。 | 服务报价/老师统一时段、免费取消延期与通知、多票种及有效活动负责人选择已实现并本地验证；多票种为R2免费基础能力，付费报名和差异票价保持关闭，不替代正式履约 | 39；最新API构建与Pro类型/生产构建通过，45/45隔离HTTP与数据库回归、9/9实际页面流程通过；含多票种表单、负责人选择保存、服务与活动延期确认/取消/消息跳转。完整商用A01仍未验收 |')
text = replace_line(text, '| A06 |', '| A06 | 进行中 | **App预约与后台服务工作台**：App选择日期时段、确认订单、我的预约/报名；Pro服务库存、待履约、取消及核销专用入口。 | TE06、TE08、SH03、LK10、LK08 | A01、A04、A05 | 无大量手填内部ID；占位倒计时以服务端时间；状态对应合法动作，退回/失败不丢输入。 | App确认/拒绝延期、原新安排/原因、Pro延期取消/库存/履约已本地验证；负责人漏提交已修复；付费订单与完整核销待补 | 39；9/9真实浏览器流程及45/45关联HTTP回归通过，后台构建通过；Web不替代双端原生，未更新APK或部署 |')
text = replace_line(text, '| TE06 |', '| TE06 | R1 | 一对一咨询预约 | A01、A02、A04、A06、A08 | 未完成 | 38/39：免费咨询时段、预约/取消、授权联系方式、延期确认与老师履约保护已本地验证；付费、争议补偿及正式履约未完成 |')
text = replace_line(text, '| TE08 |', '| TE08 | R1 | 线下见面预约 | A01、A02、A04、A05、A06、A08 | 未完成 | 38/39：线下服务规则、统一免费时段与取消延期已实现；付费、现场委派核销与正式验收未完成 |')
text = replace_line(text, '| LK10 |', '| LK10 | R1 | 统一活动报名支付席位核销 | A01、A02、A04、A05、A06、A08 | 未完成 | 38/39：免费报名/席位/逐人签到、改期确认、整场取消/通知已本地验证；付费、委派核销/二维码及正式履约未完成，多票种免费基础不代替R2整体验收 |')
text = replace_line(text, '**当前停点（2026-10-12）', '**当前停点（2026-10-12）：A01免费服务/活动取消延期、场次多票种与有效负责人选择已完成本地实现及验证。已用仓库`pnpm dev:db`恢复PostgreSQL 55432；最新3文件45/45 HTTP与数据库回归、9/9实际浏览器流程通过，API构建及Pro类型/生产构建通过。修复Pro表单漏提交responsibleUserId，真实保存回归通过；测试导航改为正确离开/返回子页面，不更改业务规则。155表/29迁移，只在隔离库应用，未操作手测/正式库、未部署或更新APK。下一A03分日解锁/营期助教作业打卡与延期，随后A05委派核销；A02付费补偿与正式渠道依赖保持未完成。线上仍member-shop-01，商用38/131不变。详见39、40及outputs/booking-schedule-2026-10-12。**')
text = text.replace('当前中断处：M03 Apple', '2026-10-11历史中断处（不覆盖第7节当前停点）：M03 Apple', 1)
text += '\n| 2026-10-12 | 上下文统一/A01验证收尾 | A01/A02/A05/A06完整任务保持进行中，解除本地数据库验证阻塞 | 重新完整读取原始Word，七板块/R1/R2和任务映射保持；修复Pro活动负责人提交字段，45/45隔离HTTP/数据库、9/9真实页面流程通过，API/Pro构建通过；29迁移，README/01/02/03/07/19/33/39统一当前入口，25快照未改，见40 | 下一A03专属教学、A05委派核销；付费/原生/正式资源仍待，商用38/131不提高；未上线/未更新APK |\n'
write(name, text)

name = '33-development-status-summary.md'
text = read(name)
text = text[text.index('# 剩余开发计划当前进度汇总'):]
text = text.replace('汇总日期：2026-10-12。依据26逐行状态、36/37/38交付记录及实际验证产物；25商用审查快照保持原样。', '汇总日期：2026-10-12。本文为当前唯一进度汇总入口；逐项状态和依赖以26第4/6/7节为准，实施与新证据见36—40。25是保留的商用审查快照，历史交付不覆盖当前状态。')
text = replace_line(text, '最新A01增量：', '最新A01增量：多票种API/Pro创建、共享容量校验及有效负责人选择已实现并本地验证；本轮修复负责人表单漏提交，实际保存回归通过。`pnpm dev:db`已恢复本地数据库；最新45/45隔离HTTP与数据库、9/9真实浏览器流程通过，API/Pro构建通过。A01/A02/A05/A06完整任务仍进行中，付费/委派核销及正式履约尚未齐，商用38/131保持。详见39与40。')
text = text.replace('免费时段/报名/取消、营期访问与讨论、基础签到已实现；付费、取消延期、营期专属教学、委派核销及售后待完成', '免费时段/报名/取消延期及确认通知、营期访问讨论、基础签到已实现并本地验证；付费、营期专属教学、委派核销及售后待完成')
text = text.replace('本轮本地业务交付见[38]', '38阶段本地业务交付见[38]', 1)
text = text.replace('无新表/迁移，仍155表/28迁移；通用管理33 CRUD/111受控流程。', '该阶段无新表/迁移，为155表/28迁移；39新增第29项迁移，已在隔离库验证；通用管理33 CRUD/111受控流程。', 1)
text = text.replace('1. 按用户新优先级继续阶段M03/M04/M06：从A01取消/延期规则及冻结安排开始，完善受影响用户通知；接着A03分日解锁、营期助教/作业/打卡和A05 EventStaff委派核销。当前基础营期不能替代完整训练营。', '1. 按用户优先级继续阶段M03/M04/M06：A01免费取消延期/通知、多票种和负责人本地验证已收尾，下一推进A03分日解锁、营期助教/作业/打卡和延期，再做A05 EventStaff委派核销。基础营期不能替代完整训练营，A01商业验收继续等待关联交易/履约证据。')
write(name, text)

name = '39-booking-schedule-changes.md'
text = read(name)
text = text.replace('- 服务预约延期/确认、二次延期/取消、原取消期限和后台未确认履约保护的4项实际浏览器检查此前通过；活动确认、整场取消和消息跳转未验收。随后本地PostgreSQL停止，`127.0.0.1:55432`返回ECONNREFUSED，且没有PostgreSQL或Docker启动器；记录见`outputs/booking-schedule-2026-10-12/browser-checks.json`。恢复监听后重跑`work/booking_schedule_browser.mjs`。', '- 最新`outputs/booking-schedule-2026-10-12/targeted-tests.log`：3文件45/45 HTTP/数据库回归通过，含多票种容量/重名、有效负责人角色、取消延期确认、履约保护、并发幂等、批量通知及旧营期/联动。包含父场景且与旧批次重叠，不累加。API构建、Pro类型检查/生产构建通过。\n- 最新浏览器9/9通过，证据`outputs/booking-schedule-2026-10-12/browser-checks.json`明确标记passed：服务延期确认/二次延期拒绝、原取消期限、Pro所选负责人实际保存、Pro多票种实际创建、活动改期确认与未确认禁签到、整场取消及消息跳转。使用实际API和隔离库，测试注入管理员会话、测试OTP登录；不使用支付假响应，不作为商用或原生证据。\n- 此前数据库停机阻塞已解除：仓库已有`pnpm dev:db`和嵌入式PostgreSQL，启动55432后在唯一临时空库完整应用29迁移并回归，最终删除的仅为脚本新建的隔离库。此前“无启动器”的判断不成立。脚本改为从真实个人页返回预约列表，避免在隐藏底部导航的子页面点击“我的”，并收紧取消状态定位到可见场次表。')
text = text.replace('新增数据库回归用例尚未执行，阻塞原因同上；当前沿用活动统一票价，付费活动仍关闭。', '新增HTTP/数据库与Pro实际多票种、负责人保存回归已通过。审查发现活动保存函数遗漏responsibleUserId，现已补入请求字段并用另一有效运营人验证保存；当前沿用活动统一票价，付费活动仍关闭。')
text = text.replace('App Web编译通过，活动改期确认的实际点击问题仍待有数据库环境后复核。', '此前App Web编译通过，本轮实际活动改期确认、取消和消息跳转已通过；双端原生验收仍未执行。')
text = text.replace('多票种和负责人分配代码已补、等数据库回归，委派核销凭证/撤销、营期分日解锁/专属教学/延期仍未实现。', '多票种和负责人配置已通过本地HTTP及真实表单验证，完整付费/差异票价/候补未完成；委派核销凭证/撤销、营期分日解锁/专属教学/延期仍未实现。')
text = text.replace('下一优先补A01多票种及负责人员，再从A03营期专属教学和A05委派核销继续；', '下一从A03营期专属教学和A05委派核销继续；')
write(name, text)

assert hashlib.sha256(snapshot.read_bytes()).hexdigest() == snapshot_hash
tasks = read('26-remaining-development-plan.md').split('## 4. 分阶段可执行任务', 1)[1].split('## 5.', 1)[0]
rows = re.findall(r'^\| ((?:F|C|M|S|A|L|N|O|E|R|V|B)\d{2}) \| ([^|]+) \|', tasks, re.M)
assert len(rows) == 110 and len({row[0] for row in rows}) == 110
counts = dict(Counter(status.strip() for _, status in rows))
(root / 'outputs/booking-schedule-2026-10-12/context-counts.json').write_text(json.dumps({'date': '2026-10-12', 'tasks': len(rows), 'states': counts, 'commercialBaseline': {'completed': 38, 'total': 131, 'percentage': 29.0}, 'commercialReviewSnapshotUnchanged': True, 'commercialReviewSha256': snapshot_hash}, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'tasks': len(rows), 'states': counts, 'reviewSnapshotUnchanged': True}, ensure_ascii=False))
