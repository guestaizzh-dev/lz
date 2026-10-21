"""Probe a restored database/media copy; never connect the test app to production data."""
import http.cookiejar
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

database, directory = sys.argv[1:]
root = Path(directory).resolve()
assert re.fullmatch(r"academy_restore_drill_[0-9_]+", database)
assert root.parent == Path('/opt/daoxue-academy') and root.name.startswith('restore-drill-')
assert os.environ.get('ACADEMY_RESTORE_PASSWORD'), 'Supply the real administrator password securely for the isolated login check'

def run(*args):
    return subprocess.check_output(args, text=True).strip()

settings = dict(line.split('=', 1) for line in Path('/opt/daoxue-academy/production.env').read_text().splitlines() if '=' in line and not line.startswith('#'))
image = run('docker', 'inspect', 'daoxue-api-1', '--format', '{{.Config.Image}}')
assert image.startswith('daoxue-api:')
name = 'academy-restore-check-' + str(os.getpid())
env_file = root / '.restore-check.env'
values = {key: settings[key] for key in ['DOMAIN_ENCRYPTION_KEY', 'OTP_HASH_SECRET', 'MEDIA_TOKEN_SECRET']}
values.update({
    'DATABASE_URL': 'postgresql://academy_app:' + urllib.parse.quote(settings['DATABASE_APP_PASSWORD'], safe='') + '@database:5432/' + database,
    'NODE_ENV': 'test', 'MEDIA_DIR': '/data/media', 'API_HOST': '0.0.0.0', 'PORT': '3000',
    'CORS_ORIGINS': 'http://127.0.0.1:5173', 'PUBLIC_API_URL': 'http://127.0.0.1:3000/api/v1',
    'SMS_ENABLED': 'false', 'PUSH_ENABLED': 'false', 'PAYMENT_SIMULATION_ENABLED': 'false',
    'ZEGO_RTC_ENABLED': 'false', 'ZEGO_LOCAL_RECORDING_ENABLED': 'false',
    'COURSE_PAYMENT_WORKER_ENABLED': 'false', 'MEMBERSHIP_PAYMENT_WORKER_ENABLED': 'false',
})
env_file.write_text('\n'.join(key + '=' + value for key, value in values.items()) + '\n')
env_file.chmod(0o600)
try:
    run('docker', 'run', '-d', '--name', name, '--user', '0', '--network', 'daoxue_backend',
        '-p', '127.0.0.1::3000', '--env-file', str(env_file), '-v', str(root) + ':/data/media', image)
    port = run('docker', 'port', name, '3000/tcp').rsplit(':', 1)[1]
    base = 'http://127.0.0.1:' + port
    for attempt in range(45):
        try:
            with urllib.request.urlopen(base + '/api/v1/health', timeout=2) as response:
                assert response.status == 200
            break
        except Exception:
            if attempt == 44:
                raise RuntimeError('Restored API failed its health check') from None
            time.sleep(1)
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    headers = {'Origin': 'http://127.0.0.1:5173', 'Content-Type': 'application/json'}

    def request(path, payload=None, extra=None):
        data = json.dumps(payload).encode() if payload is not None else None
        return opener.open(urllib.request.Request(base + path, data=data, headers={**headers, **(extra or {})}), timeout=15)

    with request('/api/v1/admin/auth/login', {'username': os.environ.get('ACADEMY_RESTORE_USERNAME', 'admin'), 'password': os.environ['ACADEMY_RESTORE_PASSWORD']}) as response:
        session = json.load(response)
    headers['X-CSRF-Token'] = session['csrfToken']
    with request('/api/v1/catalog/home') as response:
        home = json.load(response)
        assert all(isinstance(home[key], list) for key in ['articles', 'courses', 'products', 'events'])
    order = run('docker', 'exec', 'daoxue-database-1', 'psql', '-U', 'academy_owner', '-d', database, '-At', '-c', 'SELECT id FROM "TradeOrder" ORDER BY id LIMIT 1;')
    assert re.fullmatch(r'[a-f0-9-]{36}', order), 'A restored order is required for the application check'
    with request('/api/v1/admin/finance/orders/' + order) as response:
        assert response.status == 200
        json.load(response)
    with request('/api/v1/admin/media-library?size=5') as response:
        assets = json.load(response)['items']
    played = False
    for asset in assets:
        if not asset['mime'].startswith(('audio/', 'video/')):
            continue
        try:
            with request('/api/v1/admin/media/assets/' + asset['id'] + '/preview', {}) as response:
                path = json.load(response)['path']
            assert path.startswith('/media/stream')
            with request('/api/v1' + path, extra={'Range': 'bytes=0-15'}) as response:
                assert response.status == 206 and len(response.read()) == 16
            played = True
            break
        except Exception:
            continue
    assert played, 'Restored private media must pass authenticated Range delivery'
    with request('/api/v1/admin/auth/logout', {}):
        pass
    print(json.dumps({'restoredApplication': True, 'adminLogin': True, 'catalog': True, 'originalOrder': True, 'privateMediaRange': True, 'productionDatabaseTouched': False, 'externalProvidersEnabled': False}))
finally:
    subprocess.run(['docker', 'rm', '-f', name], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    env_file.unlink(missing_ok=True)
