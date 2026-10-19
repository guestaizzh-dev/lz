from pathlib import Path
import json,re,csv,hashlib
root=Path.cwd();out=root/'outputs/audit-2026-10-09'
read=lambda n:json.loads((out/n).read_text(encoding='utf-8'))
rows=read('requirements-data.json');tables=read('target-schema-data.json');inventory=read('evidence-inventory.json');stats=read('completion-stats.json')
assert len(rows)==stats['total']==164
assert sum(r['status']=='已完成' for r in rows)==stats['done']==27
assert sum(r['status']=='未完成' for r in rows)==stats['undone']==137
assert len({r['id'] for r in rows})==len(rows)
with (out/'02-requirements.csv').open(encoding='utf-8-sig',newline='') as f: assert list(csv.DictReader(f))==rows
full=(out/'02-requirements-completion.md').read_text(encoding='utf-8')
unfinished=(out/'02a-unfinished-requirements.md').read_text(encoding='utf-8')
for r in rows:
    assert full.count('|'+r['id']+'|')==1,r['id']
    assert unfinished.count('|'+r['id']+'|')==(1 if r['status']=='未完成' else 0),r['id']
    for path in r['evidence'].split('；'):assert (root/path).exists(),path
    for n in re.findall(r'P(\d+)',r['source']): assert 1<=int(n)<=inventory['originalParagraphs']
tablecols={t['name']:{c.split()[0] for c in t['columns']} for t in tables}
assert len(tablecols)==len(tables)==144
fk_count=0
for t in tables:
    assert len(tablecols[t['name']])==len(t['columns']),t['name']
    assert 'id' in tablecols[t['name']] and 'created_at' in tablecols[t['name']]
    for col in t['columns']+t['constraints']:
        for target,cols in re.findall(r'REFERENCES\s+(\w+)\(([^)]+)\)',col):
            fk_count+=1;assert target in tablecols,(t['name'],target)
            assert all(c.strip() in tablecols[target] for c in cols.split(',')),(t['name'],target,cols)
    for con in t['constraints']:
        m=re.match(r'FOREIGN KEY\s*\(([^)]+)\)',con)
        if m: assert all(c.strip() in tablecols[t['name']] for c in m[1].split(',')),(t['name'],con)
ddl=(out/'database-target-reference.sql').read_text(encoding='utf-8')
assert len(re.findall(r'CREATE TABLE ',ddl))==len(tables)
assert len(re.findall(r'ALTER TABLE .* ADD FOREIGN KEY',ddl))==fk_count
dbdoc=(out/'01-database-design.md').read_text(encoding='utf-8')
for t in tables: assert dbdoc.count('### '+t['name']+'\n')==1,t['name']
assert dbdoc.count('## 状态与字段业务字典')==1
assert inventory['modelCount']==29 and len(inventory['migrations'])==8 and inventory['pageCount']==25
current=(out/'01a-database-current.md').read_text(encoding='utf-8')
assert '查完整SQL' not in current
for model in inventory['models']:assert current.count('## '+model+'\n')==1,model
for p in out.glob('*.md'):
    s=p.read_text(encoding='utf-8')
    for link in re.findall(r'\]\(([^)]+)\)',s):
        if link.startswith(('https:','http:','#')):continue
        assert (p.parent/link).exists(),(p.name,link)
for entry in inventory['files']:
    p=root/entry['path'];assert hashlib.sha256(p.read_bytes()).hexdigest()==entry['sha256'],entry['path']
source=Path('C:/Users/l6658/Documents/xwechat_files/wxid_sw6mj1r3vhq922_460c/msg/file/2026-09/老子道学书院——道学文化传承与实践一体化小程序策划文案.docx')
assert hashlib.sha256(source.read_bytes()).hexdigest()==inventory['originalHash']
result={'date':'2026-10-09','reportValidation':'passed','requirements':stats,'targetTables':len(tables),'targetColumns':sum(len(t['columns']) for t in tables),'targetForeignKeys':fk_count,'currentModels':29,'currentMigrations':8,'appPages':25,'sourceUnchanged':True,'businessSourceHashesMatch':True,'allEvidenceAndLocalLinksExist':True,'targetSqlExecuted':False,'targetSqlPostgresParsed':False,'currentDatabaseVerified':False,'notes':['Structural report validation only; no business fixture tests or migration run.']}
(out/'report-verification.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(result,ensure_ascii=False))
