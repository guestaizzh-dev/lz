import hashlib
import json
from pathlib import Path
import tarfile

root=Path(__file__).resolve().parents[1]
out=root/'outputs/member-shop-pricing-2026-10-11'
files=[root/p for p in ['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','services/api/package.json','services/api/tsconfig.json','services/api/prisma.config.ts','services/api/prisma/schema.prisma']]
for folder in ['services/api/src','services/api/prisma/migrations','apps/admin/dist']:
    files.extend(p for p in (root/folder).rglob('*') if p.is_file() and 'generated' not in p.relative_to(root).parts)
assert (root/'apps/admin/dist/index.html').is_file()
assert all('.env' not in p.name and p.suffix not in ['.pem','.key','.keystore'] for p in files)
archive=out/'release.tar.gz'
with tarfile.open(archive,'w:gz') as package:
    for p in files:package.add(p,arcname=p.relative_to(root).as_posix(),recursive=False)
metadata={'files':len(files),'bytes':archive.stat().st_size,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest()}
(out/'release-archive.json').write_text(json.dumps(metadata,indent=2),encoding='utf-8')
print(json.dumps(metadata))
