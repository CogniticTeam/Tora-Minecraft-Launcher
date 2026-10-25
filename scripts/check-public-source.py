"""Check the exact Git index before publishing; never print credential values."""
from pathlib import Path
import argparse
import json
import re
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--private-values-json', type=Path, help='Optional private JSON array of values to reject; keep it outside the repository.')
args = parser.parse_args()
known = []
if args.private_values_json:
    values = json.loads(args.private_values_json.read_text())
    if not isinstance(values, list) or not all(isinstance(value, str) for value in values):
        raise SystemExit('Private values input must be a JSON array of strings.')
    known = [value.encode() for value in values if len(value) >= 8]

patterns = [
    ('provider-api-key', re.compile(rb'(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{24,}')),
    ('github-token', re.compile(rb'(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})')),
    ('aws-access-key', re.compile(rb'AKIA[0-9A-Z]{16}')),
    ('curseforge-key', re.compile(rb'\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}')),
    ('private-key-bytes', re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\r\n]+[A-Za-z0-9+/=\r\n]{80,}-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----')),
]
private_dirs = {'node_modules', '.wrangler', '.secrets', '.tora-state', 'backup', '备份', 'logs', '__pycache__'}
private_suffixes = {'.pem', '.key', '.p12', '.pfx', '.jks', '.sqlite', '.sqlite3', '.db', '.log', '.dmg', '.asar', '.heapsnapshot'}
entries = subprocess.check_output(['git', '-C', str(root), 'ls-files', '--stage', '-z']).split(b'\0')
batch = subprocess.Popen(['git', '-C', str(root), 'cat-file', '--batch'], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
findings = []
count = 0
try:
    for entry in entries:
        if not entry:
            continue
        metadata, raw_path = entry.split(b'\t', 1)
        mode, oid, stage = metadata.split()
        path = raw_path.decode('utf8')
        file = Path(path)
        count += 1
        if stage != b'0' or mode == b'120000':
            findings.append({'path': path, 'reason': 'unmerged-or-symbolic-link'})
            continue
        example = file.name.endswith(('.example', '.sample'))
        if (any(part in private_dirs for part in file.parts) or file.suffix in private_suffixes
                or file.name in {'secrets.json', 'gateway.env', 'forum.env'}
                or (file.name.startswith(('.env', '.dev.vars')) and not example)
                or file.parts[0] in {'release', 'release-xmcl'} or 'dist' in file.parts):
            findings.append({'path': path, 'reason': 'private-or-generated-path'})
        batch.stdin.write(oid + b'\n'); batch.stdin.flush()
        header = batch.stdout.readline().split()
        if len(header) != 3 or header[1] != b'blob':
            findings.append({'path': path, 'reason': 'unreadable-index-object'})
            continue
        data = batch.stdout.read(int(header[2])); batch.stdout.read(1)
        if any(value in data for value in known):
            findings.append({'path': path, 'reason': 'known-private-value'})
        for label, pattern in patterns:
            if pattern.search(data):
                findings.append({'path': path, 'reason': label})
finally:
    batch.stdin.close(); batch.stdout.close(); batch.wait()

print(json.dumps({'indexed_files': count, 'findings': findings}, ensure_ascii=False))
sys.exit(1 if findings else 0)
