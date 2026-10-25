"""Consistent SQLite backups with bounded retention; never copies a live WAL file alone."""
import argparse
import os
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


def backup(database, destination):
    now = datetime.now(timezone.utc)
    root = Path(destination)
    daily, weekly = root / 'daily', root / 'weekly'
    for folder in (root, daily, weekly):
        folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    target = daily / ('community-' + now.strftime('%Y%m%dT%H%M%SZ') + '.sqlite3')
    temporary = target.with_suffix('.tmp')
    source = sqlite3.connect('file:' + str(Path(database).resolve()) + '?mode=ro', uri=True)
    output = sqlite3.connect(temporary)
    try:
        source.backup(output)
        output.commit()
        # A standalone backup must not depend on a WAL sidecar at the old temporary filename.
        if output.execute('PRAGMA journal_mode=DELETE').fetchone()[0] != 'delete':
            raise RuntimeError('Backup could not leave WAL mode')
        if output.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise RuntimeError('Backup integrity check failed')
    finally:
        output.close()
        source.close()
    # Some older SQLite builds leave an inert SHM file after a backed-up WAL
    # database is switched to DELETE. Only clean this private temporary output.
    wal = Path(str(temporary) + '-wal')
    if wal.exists() and wal.stat().st_size:
        raise RuntimeError('Backup still has WAL data after closing')
    for suffix in ('-shm', '-wal'):
        Path(str(temporary) + suffix).unlink(missing_ok=True)
    os.chmod(temporary, 0o600)
    os.replace(temporary, target)
    if now.weekday() == 6 or not list(weekly.glob('community-*.sqlite3')):
        shutil.copy2(target, weekly / target.name)
    for folder, count in ((daily, 7), (weekly, 4)):
        for old in sorted(folder.glob('community-*.sqlite3'), reverse=True)[count:]:
            old.unlink()
    print('Community backup completed and integrity verified')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--database', default='/var/lib/tora-community/community.sqlite3')
    parser.add_argument('--output', default='/var/backups/tora-community')
    options = parser.parse_args()
    backup(options.database, options.output)
