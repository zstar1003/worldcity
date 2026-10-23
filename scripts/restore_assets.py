"""Restore and verify the lossless city archives after git lfs pull."""
from pathlib import Path
import tarfile,json,hashlib
ROOT=Path(__file__).resolve().parents[1]
def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for chunk in iter(lambda:f.read(8*1024*1024),b''): h.update(chunk)
 return h.hexdigest()
manifest=json.loads((ROOT/'archives/manifest.json').read_text())
for entry in manifest['archives']:
 archive=ROOT/entry['archive']
 if archive.stat().st_size != entry['bytes'] or digest(archive)!=entry['sha256']:
  raise SystemExit(f'Archive missing/corrupt: {archive.name}. Run git lfs pull first.')
 with tarfile.open(archive,'r:gz') as tar:
  for member in tar:
   target=(ROOT/member.name).resolve()
   if not target.is_relative_to(ROOT) or not (member.isfile() or member.islnk()):raise SystemExit('Unsafe archive member: '+member.name)
   if target.exists():
    expected=next(f for f in entry['files'] if f['path']==member.name)
    if digest(target)!=expected['sha256']:raise SystemExit('Existing modified file; refusing to overwrite: '+str(target))
    continue
   target.parent.mkdir(parents=True,exist_ok=True)
   if member.islnk():
    linked=(ROOT/member.linkname).resolve()
    if not linked.is_relative_to(ROOT) or not linked.is_file(): raise SystemExit('Invalid hardlink: '+member.name)
   source = linked.open('rb') if member.islnk() else tar.extractfile(member)
   with source, target.open('wb') as destination:
    for chunk in iter(lambda:source.read(8*1024*1024),b''):destination.write(chunk)
 for item in entry['files']:
  if digest(ROOT/item['path'])!=item['sha256']: raise SystemExit('Checksum mismatch: '+item['path'])
 print('Verified:',entry['archive'],flush=True)
print('All assets restored. Run: cd city-explorer && npm ci && npm run dev')
