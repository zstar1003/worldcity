import json,struct
from pathlib import Path
from build_stream_tiles import read_glb
root=Path(__file__).resolve().parents[1]/'public/cities'
for folder in root.glob('*/stream'):
 manifest=json.loads((folder/'tiles.json').read_text())
 for tile in manifest['tiles']:
  path=folder/tile['url'];j,b=read_glb(path);used=sorted({p['material'] for m in j['meshes'] for p in m['primitives'] if 'material'in p});remap={old:new for new,old in enumerate(used)};j['materials']=[j['materials'][i] for i in used]
  for m in j['meshes']:
   for p in m['primitives']:
    if 'material'in p:p['material']=remap[p['material']]
  raw=json.dumps(j,separators=(',',':'),ensure_ascii=False).encode();raw+=b' '*((-len(raw))%4)
  path.write_bytes(struct.pack('<III',0x46546c67,2,28+len(raw)+len(b))+struct.pack('<II',len(raw),0x4e4f534a)+raw+struct.pack('<II',len(b),0x004e4942)+b);tile['bytes']=path.stat().st_size
 (folder/'tiles.json').write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':')))
 print(folder.parent.name,len(manifest['tiles']),sum(t['bytes']for t in manifest['tiles'])//1048576,'MiB',flush=True)
