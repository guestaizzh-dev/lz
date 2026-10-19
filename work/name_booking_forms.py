from pathlib import Path
p=Path('apps/admin/src/pages/services/index.tsx');s=p.read_text(encoding='utf-8')
for key,name in [('form','service-offering'),('slotForm','service-slot'),('fulfilForm','service-fulfilment')]:
    s=s.replace('<Form form={'+key+'}', '<Form name="'+name+'" form={'+key+'}')
p.write_text(s,encoding='utf-8')
p=Path('apps/admin/src/pages/events/Sessions.tsx');s=p.read_text(encoding='utf-8').replace('<Form form={form}', '<Form name="event-session" form={form}')
p.write_text(s,encoding='utf-8')
