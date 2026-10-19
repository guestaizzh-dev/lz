import getpass
import hashlib
import json
import os
from pathlib import Path
import shlex
import sys
import time

import paramiko

ROOT=Path(__file__).resolve().parents[1]
OUTPUT=ROOT/'outputs/member-shop-pricing-2026-10-11'
HOST='43.160.229.173'
client=paramiko.SSHClient()
client.load_host_keys(str(Path.home()/'.ssh/known_hosts'))
client.set_missing_host_key_policy(paramiko.RejectPolicy())
client.connect(HOST,username='ubuntu',password=getpass.getpass('SSH password: '),look_for_keys=False,allow_agent=False,timeout=15)

def command(text):
    _,stdout,stderr=client.exec_command(text,timeout=60)
    while not stdout.channel.exit_status_ready():
        if stdout.channel.recv_ready():
            chunk=stdout.channel.recv(16384).decode('utf-8','replace')
            print(chunk,end='',flush=True)
            with (OUTPUT/'deployment.txt').open('a',encoding='utf-8') as log: log.write(chunk)
        if stdout.channel.recv_stderr_ready():print(stdout.channel.recv_stderr(16384).decode('utf-8','replace'),end='',flush=True)
        time.sleep(.2)
    tail=stdout.read().decode('utf-8','replace');errors=stderr.read().decode('utf-8','replace')
    print(tail+errors,end='',flush=True)
    with (OUTPUT/'deployment.txt').open('a',encoding='utf-8') as log:log.write(tail+errors)
    code=stdout.channel.recv_exit_status()
    if code:raise RuntimeError('Remote operation failed with exit code '+str(code))

try:
    command("date -u; uptime; df -h /opt; free -m; readlink -f /opt/daoxue-academy/current; ls -la /opt/daoxue-academy; docker ps --format '{{.Names}} {{.Status}}'; curl -fsS https://academy.43-160-229-173.sslip.io/api/v1/health")
    print('\nREADY_FOR_NEXT_COMMAND',flush=True)
    for line in sys.stdin:
        task=line.strip()
        if task=='quit':break
        if task=='inspect':
            command("cd /opt/daoxue-academy/current && ls -la infra && docker inspect daoxue-api-1 --format '{{.Config.Image}}' && systemctl is-active academy-backup.timer")
        elif task=='diagnose':
            command("readlink -f /opt/daoxue-academy/current; docker ps --filter name=daoxue --format '{{.Names}} {{.Status}}'; docker logs --tail 12 daoxue-edge-1; curl -fsS https://academy.43-160-229-173.sslip.io/api/v1/health")
        elif task=='deploy':
            archive=OUTPUT/'release.tar.gz'
            if not archive.is_file():raise RuntimeError('Release archive missing')
            with client.open_sftp() as sftp:sftp.put(str(archive),'/tmp/academy-member-shop-pricing.tar.gz')
            digest=hashlib.sha256(archive.read_bytes()).hexdigest()
            command("printf '%s  %s\\n' "+shlex.quote(digest)+" /tmp/academy-member-shop-pricing.tar.gz | sha256sum -c -")
            script=(ROOT/'work/member_shop_deploy.sh').read_text(encoding='utf-8')
            with client.open_sftp() as sftp:
                with sftp.file('/tmp/academy-member-shop-pricing-deploy.sh','w') as remote:remote.write(script)
            command('bash /tmp/academy-member-shop-pricing-deploy.sh')
        print('\nREADY_FOR_NEXT_COMMAND',flush=True)
finally:
    client.close()
