"""Verified one-time relocation of this workspace to the root filesystem.

Stop the MAHA server before running. Keeps the original path as a compatibility
symlink for virtualenv entry points and the saved desktop project.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

SOURCE = Path('/home/nj/MAHA')
TARGET = Path('/opt/MAHA')
BACKUP = Path('/home/nj/MAHA.migration-backup')


def manifest(root):
    entries = {}
    for folder, dirs, files in os.walk(root, followlinks=False):
        for name in dirs + files:
            path = Path(folder) / name
            relative = str(path.relative_to(root))
            mode = path.lstat().st_mode & 0o777
            if path.is_symlink():
                entries[relative] = ('link', os.readlink(path))
            elif path.is_dir():
                entries[relative] = ('directory', mode)
            elif path.is_file():
                digest = hashlib.sha256()
                with path.open('rb') as stream:
                    for chunk in iter(lambda: stream.read(1024*1024), b''):
                        digest.update(chunk)
                entries[relative] = ('file', mode, path.stat().st_size, digest.hexdigest())
            else:
                raise RuntimeError(f'Unsupported file type: {path}')
    return entries


def main():
    if SOURCE.is_symlink():
        raise SystemExit('Source already relocated; no changes made.')
    if not TARGET.is_dir() or TARGET.is_symlink() or not os.access(TARGET, os.W_OK):
        raise SystemExit('Create the user-owned /opt/MAHA directory first.')
    if any(TARGET.iterdir()) or BACKUP.exists():
        raise SystemExit('Destination or backup is not empty; inspect before retrying.')
    if TARGET.stat().st_dev == SOURCE.stat().st_dev:
        raise SystemExit('Destination must be on a different filesystem.')
    subprocess.run(['rsync', '-a', '--', str(SOURCE)+'/', str(TARGET)+'/'], check=True)
    expected = manifest(SOURCE)
    if expected != manifest(TARGET):
        raise SystemExit('Verification failed; original was preserved.')
    SOURCE.rename(BACKUP)
    try:
        SOURCE.symlink_to(TARGET, target_is_directory=True)
    except Exception:
        BACKUP.rename(SOURCE)
        raise
    # The full verified copy is now accessible through both paths.
    shutil.rmtree(BACKUP)
    report = {'source': str(SOURCE), 'destination': str(TARGET),
              'verified_entries': len(expected), 'method': 'SHA-256, modes and symlink targets',
              'compatibility_link': True}
    (TARGET/'artifacts/qa/storage-migration.json').write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
