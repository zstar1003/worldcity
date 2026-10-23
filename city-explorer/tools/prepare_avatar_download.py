from pathlib import Path
import json,subprocess,concurrent.futures,hashlib
root=Path(__file__).resolve().parents[1];target=root/'audit/avatar-source';target.mkdir(exist_ok=True)
tree=json.loads((root/'audit/avatar-rocketbox-tree.json').read_text())['tree'];prefix='Assets/Avatars/Adults/Male_Adult_09/'
paths=[x['path'] for x in tree if x.get('type')=='blob' and x['path'].startswith(prefix) and not x['path'].endswith('_facial.fbx')]+['LICENSE.md']
def fetch(path):
 rel=path.removeprefix(prefix);out=target/rel;out.parent.mkdir(parents=True,exist_ok=True)
 url='https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/master/'+path
 subprocess.run(['curl','-sS','-L','--fail','--max-time','90','--retry','3','-o',str(out),url],check=True)
 data=out.read_bytes();print(rel,len(data),flush=True);return {'path':path,'url':url,'file':str(out.relative_to(root)),'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
with concurrent.futures.ThreadPoolExecutor(4) as pool:items=list(pool.map(fetch,paths))
(root/'audit/avatar-source-downloads.json').write_text(json.dumps(items,indent=2))
