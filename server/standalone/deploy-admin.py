"""Root-only additive admin deployment. The private config must live outside the source tree."""
import argparse
import datetime
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tarfile
import tempfile
import time
import urllib.request


def run(*args):
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL)


def deploy(bundle, private_config):
    if os.geteuid() != 0:
        raise RuntimeError('Run through the existing root SSH administration channel')
    stamp = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).strftime('%Y%m%d-%H%M%S')
    backup = Path('/root/tmcl-admin-backups') / stamp
    backup.mkdir(parents=True, mode=0o700)
    config = json.loads(Path(private_config).read_text())
    if len(config.get('admin_token', '')) < 48 or not config.get('review_key'):
        raise RuntimeError('Private management and review configuration is incomplete')
    platform = Path('/opt/tora-platform'); community = Path('/opt/tora-community')
    secret_file = Path('/etc/tora-platform/secrets.json'); forum_env = Path('/etc/tora-community/forum.env')
    credential_file = Path('/etc/tora-community/review-key')
    dropin = Path('/etc/systemd/system/tora-community.service.d/tmcl-admin.conf')
    tracked = [platform / 'platform.mjs', platform / 'admin', platform / 'admin-auth.mjs', platform / 'admin-code.mjs', secret_file, forum_env, credential_file, dropin]
    tracked += [community / name for name in ('app.py', 'forum.py', 'admin_console.py', 'features.py', 'moderation.py', 'backup.py')]
    previous = {}
    for index, path in enumerate(tracked):
        saved = backup / ('file-' + str(index))
        previous[path] = saved if path.exists() else None
        if path.is_dir(): shutil.copytree(path, saved)
        elif path.exists(): shutil.copy2(path, saved)
    counts = {}
    for name, path in (('platform', '/var/lib/tora-platform/platform.sqlite3'), ('community', '/var/lib/tora-community/community.sqlite3')):
        source = sqlite3.connect('file:' + path + '?mode=ro', uri=True, timeout=10)
        output = sqlite3.connect(backup / (name + '.sqlite3'))
        try:
            source.backup(output); output.commit(); output.execute('PRAGMA journal_mode=DELETE').fetchone()
            if output.execute('PRAGMA integrity_check').fetchone()[0] != 'ok': raise RuntimeError('Backup validation failed')
            if name == 'community':
                counts = {table: source.execute('SELECT COUNT(*) FROM ' + table).fetchone()[0] for table in ('profiles', 'posts', 'comments')}
        finally: output.close(); source.close()
        os.chmod(backup / (name + '.sqlite3'), 0o600)
    try:
        with tempfile.TemporaryDirectory(prefix='tmcl-admin-deploy-') as work:
            stage = Path(work)
            with tarfile.open(bundle) as archive:
                for member in archive.getmembers():
                    if member.issym() or member.islnk() or member.name.startswith('/') or '..' in Path(member.name).parts:
                        raise RuntimeError('Unsafe archive member')
                archive.extractall(stage)
            for name in ('platform.mjs', 'admin-auth.mjs', 'admin-code.mjs'):
                shutil.copy2(stage / name, platform / name); os.chmod(platform / name, 0o644)
            if (platform / 'admin').exists(): shutil.rmtree(platform / 'admin')
            shutil.copytree(stage / 'admin', platform / 'admin')
            for file in (platform / 'admin').rglob('*'): os.chmod(file, 0o755 if file.is_dir() else 0o644)
            os.chmod(platform / 'admin', 0o755)
            for file in (stage / 'community').iterdir():
                shutil.copy2(file, community / file.name); os.chmod(community / file.name, 0o644)
        secrets = json.loads(secret_file.read_text())
        secrets['COMMUNITY_ADMIN_TOKEN'] = config['admin_token']
        secret_file.write_text(json.dumps(secrets, ensure_ascii=False, indent=2) + '\n'); os.chmod(secret_file, 0o600)
        lines = [line for line in forum_env.read_text().splitlines() if not line.startswith('COMMUNITY_ADMIN_TOKEN=')]
        forum_env.write_text('\n'.join(lines + ['COMMUNITY_ADMIN_TOKEN=' + config['admin_token']]) + '\n'); os.chmod(forum_env, 0o600)
        credential_file.write_text(config['review_key']); os.chmod(credential_file, 0o600)
        dropin.parent.mkdir(parents=True, exist_ok=True)
        dropin.write_text('[Service]\nLoadCredential=review-key:/etc/tora-community/review-key\nEnvironment=COMMUNITY_REVIEW_KEY_FILE=%d/review-key\nEnvironment=COMMUNITY_AUTO_REVIEW=1\nEnvironment=COMMUNITY_REVIEW_MODEL=deepseek-flash\n')
        run('/opt/tora-platform/node/bin/node', '--check', str(platform / 'platform.mjs'))
        run('/opt/tora-community/venv/bin/python', '-m', 'py_compile', *[str(community / name) for name in ('app.py', 'forum.py', 'features.py', 'admin_console.py', 'moderation.py')])
        run('systemctl', 'daemon-reload'); run('systemctl', 'restart', 'tora-community'); run('systemctl', 'restart', 'tora-platform')
        ready = False
        for attempt in range(15):
            try:
                with urllib.request.urlopen('http://127.0.0.1:8770/health', timeout=2) as response:
                    ready = json.load(response).get('status') == 'ok'
                request = urllib.request.Request('http://127.0.0.1:8765/health', headers={'Authorization': 'Bearer ' + secrets['COMMUNITY_GATEWAY_TOKEN']})
                with urllib.request.urlopen(request, timeout=2) as response:
                    ready = ready and json.load(response).get('status') == 'ok'
                if ready: break
            except Exception: ready = False
            time.sleep(1)
        if not ready: raise RuntimeError('Platform health did not recover')
        run('systemctl', 'is-active', '--quiet', 'tora-platform', 'tora-community')
    except Exception:
        for path, saved in previous.items():
            if path.is_dir(): shutil.rmtree(path)
            elif path.exists(): path.unlink()
            if saved and saved.is_dir(): shutil.copytree(saved, path)
            elif saved: path.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(saved, path)
        run('systemctl', 'daemon-reload'); run('systemctl', 'restart', 'tora-community'); run('systemctl', 'restart', 'tora-platform')
        print(json.dumps({'deployed': False, 'rollback': 'code-and-configuration', 'backup': str(backup)}))
        raise RuntimeError('Admin deployment rolled back; databases and new data were retained') from None
    print(json.dumps({'deployed': True, 'backup': str(backup), 'previous_community_counts': counts, 'management_path': '/admin/'}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--bundle', required=True); parser.add_argument('--private-config', required=True)
    args = parser.parse_args(); deploy(args.bundle, args.private_config)
