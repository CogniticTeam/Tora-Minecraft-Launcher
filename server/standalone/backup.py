"""Consistent private backups of the SQLite account/signaling state."""
import os,sqlite3,shutil
from pathlib import Path
from datetime import datetime,timezone
root=Path('/var/backups/tora-platform');now=datetime.now(timezone.utc)
for folder in [root,root/'daily',root/'weekly']:folder.mkdir(parents=True,exist_ok=True,mode=0o700)
target=root/'daily'/('platform-'+now.strftime('%Y%m%dT%H%M%SZ')+'.sqlite3');temp=target.with_suffix('.tmp')
source=sqlite3.connect('file:/var/lib/tora-platform/platform.sqlite3?mode=ro',uri=True);output=sqlite3.connect(temp)
try:
 source.backup(output);output.commit();output.execute('PRAGMA journal_mode=DELETE')
 if output.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise RuntimeError('backup_integrity_failed')
finally:output.close();source.close()
os.chmod(temp,0o600);os.replace(temp,target)
if now.weekday()==6 or not list((root/'weekly').glob('*.sqlite3')):shutil.copy2(target,root/'weekly'/target.name)
for folder,count in [(root/'daily',7),(root/'weekly',4)]:
 for old in sorted(folder.glob('platform-*.sqlite3'),reverse=True)[count:]:old.unlink()
print('Platform backup completed; integrity verified')
