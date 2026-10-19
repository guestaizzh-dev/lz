from pathlib import Path

builder = Path(__file__).with_name('build_management_brief.py')
head = builder.read_text(encoding='utf-8').split('\ndoc.add_paragraph(')[0]
tail = '''
from management_technical_content import write_content

write_content(doc, md, heading, para, table, page)
doc.core_properties.title = '老子道学书院技术说明'
doc.core_properties.subject = '管理层阅读版 技术架构 选型 数据处理 内容交付 安全与部署'
doc.core_properties.author = '道学书院项目'
OUT.parent.mkdir(parents=True, exist_ok=True)
doc.save(OUT)
SOURCE.write_text('\\n'.join(md), encoding='utf-8')
print(OUT)
'''
builder.write_text(head + '\n' + tail, encoding='utf-8')
