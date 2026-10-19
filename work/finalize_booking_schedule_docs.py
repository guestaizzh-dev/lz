from pathlib import Path
for name in ['01-product-requirements.md','02-technical-research-and-decisions.md']:
    p=Path('docs')/name;s=p.read_text(encoding='utf-8');s=s.replace('学员须确认最新版本，新开始前可取消；新报名沿普通规则。','学员须确认最新版本，接受后可在新开始前取消；尚未接受时过时仍可拒绝，不记缺席。新报名沿普通规则。',1);p.write_text(s,encoding='utf-8')
p=Path('docs/39-booking-schedule-changes.md');s=p.read_text(encoding='utf-8')
s=s.replace('原学员延期后保留新开始前自助取消的选择，已确认也不缩短取消权；', '原学员接受延期后保留新开始前自助取消的选择；尚未确认时即使时间已过也可拒绝，避免记录长期卡住或误记缺席；')
s=s.replace('44/44后端HTTP与数据库回归通过，含本批13项（12子场景及父场景）', '44/44关联后端HTTP与数据库回归通过；最终新增过时拒绝保护后，`outputs/booking-schedule-final-tests.log`的2文件27/27专项通过，含本批14项（13子场景及父场景）')
s=s.replace('计数包含父场景，不与前批107项重复相加。','计数包含父场景，44与27以及前批107有重叠，不重复相加。')
s=s.replace('未确认延期且已经开始的预约保留待处理记录，不擅自记缺席；后续补运营争议处理。','未确认延期且已经开始的免费预约可由学员拒绝，不擅自记缺席；已接受且已开始的争议、权益与交易补偿仍须后续专用售后处理。')
s=s.replace('共享改期对话框处理输入、错误与提交状态。','共享改期对话框处理输入、错误与提交状态，并在对应抽屉作用域内展示，避免弹窗与抽屉焦点争抢。')
p.write_text(s,encoding='utf-8')
