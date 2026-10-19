from pathlib import Path
p=Path('apps/admin/src/pages/services/index.tsx');s=p.read_text(encoding='utf-8')
component='<BookingScheduleChange selection={scheduleChange} base="/admin/services/slots" onClose={()=>setScheduleChange(undefined)} onSaved={()=>{if(selected)void loadSlots(selected);work.current?.reload();}}/>'
s=s.replace('    '+component+'\n','')
target='</Drawer>\n    <Modal title="记录服务履约结果"'
assert target in s
s=s.replace(target,component+'</Drawer>\n    <Modal title="记录服务履约结果"')
p.write_text(s,encoding='utf-8')
p=Path('work/booking_schedule_browser.mjs');s=p.read_text(encoding='utf-8')
s=s.replace("await start.fill(beijing", "await start.click();await start.fill(beijing")
s=s.replace("await end.fill(beijing", "await end.click();await end.fill(beijing")
s=s.replace("await admin.locator('.ant-modal-content:visible').count()", "await admin.getByRole('dialog').count()")
s=s.replace("await admin.locator('.ant-modal-content:visible').waitFor({state:'hidden'})", "await admin.getByRole('dialog').waitFor({state:'hidden'})")
p.write_text(s,encoding='utf-8')
