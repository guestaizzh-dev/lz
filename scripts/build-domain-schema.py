"""Generate the domain expansion and CRUD registry from the reviewed contract.

Run before database reset. Existing API models keep their names and fields.
"""
from pathlib import Path
import re,json
ROOT=Path(__file__).resolve().parent.parent
P=ROOT/'services/api/prisma'
base=(P/'contracts/legacy-schema.prisma').read_text(encoding='utf-8')
base=base.replace('enum LessonFormat {\n  TEXT\n  VIDEO\n  AUDIO\n}', 'enum LessonFormat {\n  TEXT\n  VIDEO\n  AUDIO\n  LIVE\n  OFFLINE\n}')
target=json.loads((P/'contracts/target-schema.json').read_text(encoding='utf-8'))
models=dict(re.findall(r'^model (\w+) \{(.*?)^\}',base,re.M|re.S))
enums={n:b.split() for n,b in re.findall(r'^enum (\w+) \{(.*?)^\}',base,re.M|re.S)}
mapping=dict(zip(['app_user','auth_session','consumed_refresh','otp_challenge','rate_limit','private_note','practice_log','teacher','article','course','course_chapter','course_release','lesson','enrollment','membership_plan','membership_period','study_progress','study_event','media_asset','product','product_sku','cart_item','address','event','audit_log'],['User','AuthSession','ConsumedRefresh','OtpChallenge','RateLimit','Note','PracticeLog','Teacher','Article','Course','CourseChapter','CourseRelease','Lesson','Enrollment','MembershipPlan','Membership','StudyProgress','StudyEvent','MediaAsset','Product','ProductSku','CartItem','Address','Event','AuditLog']))
def camel(s):return re.sub(r'_([a-z])',lambda m:m[1].upper(),s)
def pascal(s):return camel(s)[0].upper()+camel(s)[1:]
mapping.update({'order_item':'TradeOrderItem','delivery_zone':'ShippingZone'})
for t in target:mapping.setdefault(t['name'],pascal(t['name']))
alias={
 'auth_session':{'refresh_expires_at':'expiresAt'},'consumed_refresh':{'token_hash':'hash'},'rate_limit':{'limit_key':'key'},
 'private_note':{'title_snapshot':'articleTitle','quote_snapshot':'quote','note_text':'text','block_stable_key':'blockId'},
 'practice_log':{'business_day':'day'},'teacher':{'honor_title':'title','portrait_asset_id':'portraitAssetId'},
 'article':{'draft_blocks':'blocks'},'course':{'current_release_id':'publishedReleaseId'},
 'course_release':{'release_no':'version'},'lesson':{'stable_key':'sourceId','kind':'format','asset_id':'mediaId'},
 'course_chapter':{'kind':'format','asset_id':'mediaId'},'study_progress':{'verified_seconds':'watchedSeconds'},
 'study_event':{'event_key':'id'},'media_asset':{'uploader_id':'uploaderId'},
 'membership_plan':{'current_version_id':'currentVersionId'},'product_sku':{'code':'code'},
}
def colname(table,col):return alias.get(table,{}).get(col,camel(col))
Q=lambda s:'"'+s+'"'
def rewrite(expr,table):
    # Contract uses SQL identifiers from a closed list, never user input.
    def ref(m):return 'REFERENCES '+Q(mapping[m[1]])+'('+','.join(Q(colname(m[1],c.strip())) for c in m[2].split(','))+')'
    expr=re.sub(r'REFERENCES (\w+)\(([^)]+)\)',ref,expr)
    names={c.split()[0] for c in table['columns']}
    # Do not rewrite literal strings such as MEMBER or identifier inside REFERENCES.
    segments=re.split(r"('(?:[^']|'')*'|\"[^\"]*\")",expr)
    for i in range(0,len(segments),2):
        segments[i]=re.sub(r'\b[a-z_][a-z_0-9]*\b',lambda m:Q(colname(table['name'],m[0])) if m[0] in names else m[0],segments[i])
    return ''.join(segments)
legacy={}
legacy_refs={}
reverse_mapping={v:k for k,v in mapping.items()}
for name,body in models.items():
    legacy[name]={}
    legacy_refs[name]={}
    for line in body.splitlines():
        line=line.strip();m=re.match(r'(\w+)\s+([\w\[\]?]+)(.*)',line)
        if m and m[2].rstrip('?').removesuffix('[]') not in models:legacy[name][m[1]]=(m[2],m[3].strip())
        elif m:
            relation=re.search(r'fields: \[(\w+)\], references: \[(\w+)\]',m[3])
            if relation and m[2].rstrip('?') in reverse_mapping:
                legacy_refs[name][relation[1]]={'entity':reverse_mapping[m[2].rstrip('?')],'field':relation[2]}
sql=['-- Full domain foundation; preserves current API names. Test database reset is authorized.','CREATE EXTENSION IF NOT EXISTS btree_gist;']
foreign=[]; constraints=[];indexes=[];schema_add={};registry=[]
default_state={'outbox_job':'READY','inventory_reservation':'HELD','trade_order':'PENDING'}
for table in target:
    name=table['name'];physical=mapping[name];old=legacy.get(physical,{})
    added=[];columns=[];fields=[]; seen=set()
    for raw in table['columns']:
        source,expr=raw.split(' ',1);field=colname(name,source)
        if field in seen:continue
        seen.add(field)
        # PostgreSQL char(3) and text[] need no word boundary after brackets.
        m=re.match(r'(text\[\]|text|timestamptz|integer|bigint|boolean|jsonb|date|char\(3\))(.*)',expr)
        typ,rest=m.groups()
        nullable='NOT NULL' not in rest and 'PRIMARY KEY' not in rest
        fk=re.search(r'REFERENCES (\w+)\(([^)]+)\)',expr)
        if fk:
            foreign.append(f'ALTER TABLE {Q(physical)} ADD CONSTRAINT {Q("domain_"+physical+"_"+field+"_fk")} FOREIGN KEY ({Q(field)}) REFERENCES {Q(mapping[fk[1]])} ('+','.join(Q(colname(fk[1],c.strip())) for c in fk[2].split(','))+');')
            rest=rest[:rest.index('REFERENCES')].rstrip()
        if field in old:
            ptype,attr=old[field];nullable='?' in ptype
            typ={'String':'text','Int':'integer','BigInt':'bigint','Boolean':'boolean','DateTime':'timestamptz','Json':'jsonb'}.get(ptype.rstrip('?').removesuffix('[]'),ptype.rstrip('?').removesuffix('[]'))+('[]' if '[]' in ptype else '')
            if '[]' in ptype:nullable=False
            default=bool('@default' in attr or '@updatedAt' in attr)
            pdef=attr
        else:
            # Old controllers do not supply newly added supplementary columns.
            if physical in models and not nullable and 'DEFAULT' not in rest and 'PRIMARY KEY' not in rest:
                default_expr={'text':"''",'integer':'0','bigint':'0','boolean':'false','jsonb':"'{}'",'text[]':"'{}'",'timestamptz':'now()','date':'CURRENT_DATE'}.get(typ,"''")
                if field in ('grantKey','stableKey','code'):default_expr='gen_random_uuid()::text'
                if fk and field not in ('offerId','planVersionId'):
                    pass # A required reference must be supplied, never default to an invalid ID.
                elif field=='planVersionId':rest=rest.replace('NOT NULL','') # filled by membership snapshot trigger
                else:rest+=' DEFAULT '+default_expr
            if source=='id':rest=rest.replace('PRIMARY KEY','NOT NULL DEFAULT gen_random_uuid()::text'+(' UNIQUE' if physical in models else ' PRIMARY KEY'))
            expr=typ+' '+rest
            expr=rewrite(expr,table)
            nullable='NOT NULL' not in expr and 'PRIMARY KEY' not in expr
            columns.append(Q(field)+' '+expr)
            if physical in models:sql.append(f'ALTER TABLE {Q(physical)} ADD COLUMN {Q(field)} {expr};')
            # Prisma represents FK as scalar here; database constraints remain in SQL.
            pt={'text':'String','integer':'Int','bigint':'BigInt','boolean':'Boolean','jsonb':'Json','timestamptz':'DateTime','date':'DateTime','char(3)':'String','text[]':'String[]'}[typ]
            pdef=''
            if source=='id':pdef='@unique @default(dbgenerated("gen_random_uuid()::text"))' if physical in models else '@id @default(dbgenerated("gen_random_uuid()::text"))'
            elif 'DEFAULT now()' in expr:pdef='@default(now())'
            elif 'DEFAULT gen_random_uuid()::text' in expr:pdef='@default(dbgenerated("gen_random_uuid()::text"))'
            else:
                d=re.search(r"DEFAULT (true|false|-?\d+|'[^']*')",expr)
                if d:
                    v=d[1];v=json.dumps(v[1:-1]) if v.startswith("'") else v
                    if pt=='String[]':v='[]'
                    pdef=f'@default({v})'
            if typ=='timestamptz':pdef+=' @db.Timestamptz(6)'
            if typ=='date':pdef+=' @db.Date'
            if typ=='char(3)':pdef+=' @db.Char(3)'
            if physical not in models and ' UNIQUE' in expr and source!='id':pdef+=' @unique'
            if nullable:pt+='?'
            added.append('  '+field+' '+pt+' '+pdef.strip())
            default='DEFAULT' in expr
        choices=[]
        if typ in enums:choices=enums[typ]
        pattern=r"\b"+re.escape(source)+r"\s+IN\s*\(([^)]+)\)"
        for con in table['constraints']:
            opt=re.search(pattern,con)
            if opt:choices=re.findall(r"'([^']*)'",opt[1])
        initial=(True if '@default(true)' in pdef else False if '@default(false)' in pdef else None) if typ=='boolean' else None
        fields.append({'name':field,'source':source,'type':typ,'nullable':nullable,'default':default,'initial':initial,'choices':choices,'reference':{'entity':fk[1],'field':colname(fk[1],fk[2])} if fk and ',' not in fk[2] else None})
    for field,(ptype,attrs) in old.items():
        if field in seen:continue
        typ={'String':'text','Int':'integer','Boolean':'boolean','DateTime':'timestamptz','Json':'jsonb'}.get(ptype.rstrip('?').removesuffix('[]'),ptype.rstrip('?').removesuffix('[]'))+('[]' if '[]' in ptype else '')
        initial=(True if '@default(true)' in attrs else False if '@default(false)' in attrs else None) if typ=='boolean' else None
        fields.append({'name':field,'source':field,'type':typ,'nullable':'?' in ptype,'default':'@default' in attrs or '@updatedAt' in attrs,'initial':initial,'choices':enums.get(typ,[]),'reference':legacy_refs[physical].get(field)})
    if physical not in models:sql.append(f'CREATE TABLE {Q(physical)} (\n  '+',\n  '.join(columns)+'\n);')
    schema_add[physical]='\n'.join(added)
    for i,con in enumerate(table['constraints']):
        # Existing day strings preserve the App date contract; no date comparison here.
        converted=rewrite(con,table)
        constraints.append(f'ALTER TABLE {Q(physical)} ADD CONSTRAINT {Q("domain_"+physical+"_"+str(i))} '+converted+';')
    for i,idx in enumerate(table['indexes']):
        unique=idx.endswith(' UNIQUE');idx=idx.removesuffix(' UNIQUE')
        indexes.append('CREATE '+('UNIQUE ' if unique else '')+f'INDEX {Q("domain_"+physical+"_idx_"+str(i))} ON {Q(physical)} '+rewrite(idx,table)+';')
    registry.append({'key':name,'table':physical,'module':table['domain'],'phase':table['phase'],'description':table['purpose'],'fields':fields,'versioned':any(f['name']=='version' for f in fields) and 'updated_at' in [c.split()[0] for c in table['columns']]})
sql+=[c for c in constraints if 'FOREIGN KEY' not in c]+foreign+[c for c in constraints if 'FOREIGN KEY' in c]+indexes
sql.append('ALTER TABLE "Membership" ADD CONSTRAINT domain_member_no_overlap EXCLUDE USING gist ("userId" WITH =, tstzrange("startsAt" AT TIME ZONE \'UTC\',"endsAt" AT TIME ZONE \'UTC\',\'[)\') WITH &&) WHERE ("revokedAt" IS NULL);')
sql.append('ALTER TABLE "AppointmentSlot" ADD CONSTRAINT domain_slot_no_overlap EXCLUDE USING gist ("teacherId" WITH =, tstzrange("startsAt","endsAt",\'[)\') WITH &&) WHERE (state <> \'CANCELLED\');')
sql.append((P/'contracts/compatibility-triggers.sql').read_text(encoding='utf-8'))
schema=base
for name in models:
    if schema_add.get(name):schema=re.sub(r'(model '+name+r' \{.*?)(\n\})',lambda m:m[1]+'\n'+schema_add[name]+m[2],schema,count=1,flags=re.S)
for name,body in schema_add.items():
    if name not in models:schema+='\nmodel '+name+' {\n'+body+'\n}\n'
P.joinpath('schema.prisma').write_text('\n'.join(line.rstrip() for line in schema.splitlines())+'\n',encoding='utf-8')
dest=P/'migrations/20261009120000_full_domain_foundation';dest.mkdir(exist_ok=True)
dest.joinpath('migration.sql').write_text('\n\n'.join(sql)+'\n',encoding='utf-8')
ROOT.joinpath('services/api/src/domain-registry.json').write_text(json.dumps(registry,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'contractEntities':len(registry),'physicalModels':len(models)+sum(n not in models for n in schema_add)},ensure_ascii=False))
