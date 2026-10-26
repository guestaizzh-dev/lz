#!/usr/bin/env bash
# Run after uploading the prepared download directory; existing packages remain recoverable.
set -Eeuo pipefail
base=${DOWNLOAD_DIR:-/opt/daoxue-academy/download}
staging=${1:?Pass an uploaded staging directory}
python3 - "$base" "$staging" <<'PY'
from pathlib import Path
import hashlib,json,os,shutil,sys
base,staging=map(lambda x:Path(x).resolve(),sys.argv[1:])
info=json.loads((staging/'release.json').read_text())
assert isinstance(info['build'],int) and info['build']>0
import re
assert re.fullmatch(r'\d+\.\d+\.\d+',info['version'])
apk=staging/'android.apk'
digest=hashlib.sha256()
with apk.open('rb') as f:
 for chunk in iter(lambda:f.read(1024*1024),b''):digest.update(chunk)
assert digest.hexdigest()==info['sha256']
assert apk.stat().st_size==info['bytes']
for name in ['index.html','style.css','page.js','qr.svg','qr.png','icon.png','poster.png','poster-share.png']:
 assert (staging/name).is_file() and not (staging/name).is_symlink()
base.mkdir(parents=True,exist_ok=True)
if (base/'current/release.json').exists():
 old=json.loads((base/'current/release.json').read_text());assert info['build']>old['build'],'Version must advance; rollback requires explicit operator action'
dest=base/'releases'/f"{info['version']}-code{info['build']}"
assert not dest.exists(),'Release already exists'
dest.parent.mkdir(parents=True,exist_ok=True);shutil.copytree(staging,dest)
for p in [dest,*dest.rglob('*')]:p.chmod(0o755 if p.is_dir() else 0o644)
next_link=base/'.current-next';assert not next_link.exists() and not next_link.is_symlink()
next_link.symlink_to(dest.relative_to(base),target_is_directory=True)
os.replace(next_link,base/'current')
print('Published',info['version'],info['build'],'at fixed /download/ URL')
PY
