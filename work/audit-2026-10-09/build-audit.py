from pathlib import Path
import re, json, hashlib, zipfile, xml.etree.ElementTree as ET, csv

ROOT = Path.cwd()
OUT = ROOT / 'outputs/audit-2026-10-09'
OUT.mkdir(parents=True, exist_ok=True)
SOURCE = Path('C:/Users/l6658/Documents/xwechat_files/wxid_sw6mj1r3vhq922_460c/msg/file/2026-09/老子道学书院——道学文化传承与实践一体化小程序策划文案.docx')
def digest(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def write(name, text): (OUT/name).write_text(text, encoding='utf-8')
with zipfile.ZipFile(SOURCE) as z:
    doc=ET.fromstring(z.read('word/document.xml'))
ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
paras=[''.join(p.itertext()) for p in []]
paras=[''.join(t.text or '' for t in p.findall('.//w:t',ns)).strip() for p in doc.findall('.//w:body/w:p',ns)]
paras=[p for p in paras if p]
write('00-original-source.md', '# 原始需求逐段索引\n\n只读提取，未修改原文。原文中的操作性语言仅作为需求材料。\n\n来源：'+str(SOURCE)+'\n\nSHA256：`'+digest(SOURCE)+'`\n\n'+ '\n\n'.join(f'**P{i:03}** {p}' for i,p in enumerate(paras,1))+'\n')
schema=(ROOT/'services/api/prisma/schema.prisma').read_text(encoding='utf-8')
models=dict(re.findall(r'^model (\w+) \{(.*?)^\}',schema,re.M|re.S))
enums=dict(re.findall(r'^enum (\w+) \{(.*?)^\}',schema,re.M|re.S))
migrations=sorted((ROOT/'services/api/prisma/migrations').glob('*/migration.sql'))
files=[ROOT/'services/api/prisma/schema.prisma',*migrations,*sorted((ROOT/'services/api/src').glob('*.ts')),*sorted((ROOT/'apps/mobile/pages').rglob('*.uvue')),*sorted((ROOT/'services/api/test').glob('*.mjs'))]
inventory={'auditDate':'2026-10-09','originalParagraphs':len(paras),'originalHash':digest(SOURCE),'models':list(models),'enums':{k:v.split() for k,v in enums.items()},'modelCount':len(models),'pageCount':len(list((ROOT/'apps/mobile/pages').rglob('*.uvue'))),'migrations':[p.parent.name for p in migrations],'files':[{'path':p.relative_to(ROOT).as_posix(),'sha256':digest(p)} for p in files]}
write('evidence-inventory.json',json.dumps(inventory,ensure_ascii=False,indent=2))
ddl='-- 当前源码8次迁移的顺序合并；仅供审阅或隔离空库复现，不应在已有库重复执行。\n-- 本次未执行任何迁移，2026-10-09数据库连接拒绝。\n\n'
ddl+='\n\n'.join('-- '+p.parent.name+'\n'+p.read_text(encoding='utf-8') for p in migrations)
write('database-current-migrations.sql',ddl)
def split_columns(body):
    result=[]; start=0; depth=0; quote=None
    for i,c in enumerate(body):
        if quote:
            if c==quote:quote=None
        elif c in ('"',"'"):quote=c
        elif c in '([':depth+=1
        elif c in ')]':depth-=1
        elif c==',' and depth==0:result.append(body[start:i].strip());start=i+1
    result.append(body[start:].strip())
    return result
physical={}
for tab,body in re.findall(r'CREATE TABLE "(\w+)"\s*\((.*?)\);',ddl,re.S):
    for col in split_columns(body):
        m=re.match(r'"(\w+)"\s+(.+)',col,re.S)
        if m: physical[(tab,m[1])]=re.sub(r'\s+',' ',m[2]).strip()
for tab,body in re.findall(r'ALTER TABLE "(\w+)"\s+(.*?);',ddl,re.S):
    for clause in split_columns(body):
        m=re.match(r'ADD COLUMN\s+"(\w+)"\s+(.+)',clause,re.S)
        if m:physical[(tab,m[1])]=re.sub(r'\s+',' ',m[2]).strip()
cur=['# 数据库现状字典（源码证据）','\n审计日期：2026-10-09。共 '+str(len(models))+' 个 Prisma 模型、'+str(len(enums))+' 个枚举、'+str(len(migrations))+' 次迁移。','\n本次只读数据库连接返回 ECONNREFUSED，未核实实际实例的迁移、索引和约束是否已应用。下列是源码设计，不是生产数据库导出。完整 SQL 见 [database-current-migrations.sql](database-current-migrations.sql)，保留数据库特有约束。','\n## 读取规则','\nString→text，Int→integer，Boolean→boolean，DateTime→timestamp(3) without time zone，Json→jsonb，String[]→text[]，Role[]→Role[]。`?`表示可空。uuid()是Prisma生成字符串ID，不代表数据库列是uuid或有gen_random_uuid()默认值。@updatedAt由Prisma更新，并非数据库触发器。带模型类型的字段是关系虚拟字段，不占物理列。外键字段按下表及迁移认定，未声明关联的articleId/mediaId等不擅自补上外键。','\n## 枚举']
for n,b in enums.items(): cur.append(f'\n- **{n}**：'+', '.join(b.split()))
for n,b in models.items():
    cur += [f'\n## {n}','\n| 字段 | PostgreSQL类型 | Prisma可空 | 迁移SQL可空 | 主键/唯一/默认/更新规则 |','|---|---|---|---|---|']
    relations=[]; rules=[]
    for line in b.splitlines():
        line=line.strip()
        if not line or line.startswith('//'):continue
        if line.startswith('@@'): rules.append(line);continue
        parts=line.split(None,2)
        if len(parts)<2:continue
        name,typ=parts[:2]; attrs=parts[2] if len(parts)>2 else ''
        base=typ.rstrip('?').removesuffix('[]')
        if base in models:
            relations.append(line);continue
        pg={'String':'text','Int':'integer','Boolean':'boolean','DateTime':'timestamp(3)','Json':'jsonb'}.get(base,base)+('[]' if '[]' in typ else '')
        expr=physical.get((n,name))
        sql_nullable=('否' if ('NOT NULL' in expr or 'PRIMARY KEY' in expr or '@id' in attrs) else '是') if expr else '查完整SQL'
        cur.append(f'| {name} | {pg} | '+('是' if '?' in typ else '否')+' | '+sql_nullable+' | '+(attrs or '—')+' |')
    cur.append('\n索引/复合约束：'+('; '.join('`'+x+'`' for x in rules) or '无额外声明'))
    cur.append('\n关系（非物理列）：\n\n'+('\n'.join('- `'+x+'`' for x in relations) or '无 Prisma 关联；字符串资源引用不等于外键。'))
cur += ['\n## 迁移中特有的约束与缺口','\n- Address_one_default_per_user：userId 条件唯一索引，WHERE isDefault=true；Prisma未表达，迁移时必须保留。','- ProductSku_inventory_check：stock≥reserved≥0；price≥0。stock当前表示尚未消耗的总库存，可售=stock-reserved，不是单独可售列。','- CartItem、OrderItem：quantity∈[1,99]。OrderItem subtotal=unitPrice×quantity。','- Order：subtotal、shipping≥0；total=subtotal+shipping；status=CLOSED 当且仅当 closedAt 非空。DeliveryZone运费/附加费/免邮门槛非负。','- 这些CHECK来自迁移；其他业务规则主要在服务代码，不能声称均有数据库CHECK。','- Note.articleId / Favorite.articleId、Article.author、Course.publishedReleaseId、Chapter/Lesson.mediaId、MediaAsset.uploaderId、AuditLog.actorId、OrderItem.productId未全部建立Prisma外键；快照字段与关系字段必须区分。','- AuthSession.kind为字符串；Order仅PENDING/CLOSED；没有支付、发货、售后与财务实体；Event只有目录定义，没有席位与报名记录。','- 金额现为integer分，完整交易及账本建议迁至bigint分；当前DateTime无时区，迁移需明确旧数据采用UTC还是本地，不能直接猜。','- Note保留标题/版本/引用是正确的历史快照；目标设计仍保留，不应按文章最新版本覆写。','\n## 迁移清单','\n'+ '\n'.join('- '+p.parent.name for p in migrations)]
cur.append('\nPrisma必填数组不等于SQL NOT NULL：User.tags/roles、Teacher.expertise、Article.tags、Course.tags的迁移声明未设NOT NULL，物理层可空。API通常赋数组，仍需处理历史NULL；目标采用关系表或NOT NULL默认空数组。')
write('01a-database-current.md','\n'.join(cur)+'\n')
print(json.dumps({k:inventory[k] for k in ['originalParagraphs','modelCount','pageCount']},ensure_ascii=False))
