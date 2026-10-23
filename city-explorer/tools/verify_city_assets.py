import json,struct,hashlib
from pathlib import Path
ROOT=Path('/Users/zstar/worldcity/city-explorer')
def sha(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  while b:=f.read(8*1024*1024):h.update(b)
 return h.hexdigest()
def glb(path):
 with path.open('rb') as f:
  magic,version,size=struct.unpack('<III',f.read(12));n,kind=struct.unpack('<II',f.read(8));g=json.loads(f.read(n))
 assert magic==0x46546c67 and version==2 and size==path.stat().st_size
 tris=sum(g['accessors'][p['indices']]['count']//3 for m in g.get('meshes',[]) for p in m['primitives'] if p.get('mode',4)==4)
 assert not any('KHR_draco_mesh_compression' in p.get('extensions',{}) for m in g['meshes'] for p in m['primitives'])
 return {'bytes':size,'triangles':tris,'meshes':len(g.get('meshes',[])),'primitives':sum(len(m['primitives']) for m in g['meshes']),'materials':len(g.get('materials',[])),'images':len(g.get('images',[])),'extensions':g.get('extensionsUsed',[]),'sha256':sha(path)}
results={}
for city in ['shenzhen','shanghai','beijing','guangzhou']:
 folder=ROOT/'public/cities'/city
 if not (folder/'city.json').exists():continue
 m=json.load(open(folder/'city.json'));i=json.load(open(folder/'instances.json'))
 arch=glb(folder/'architecture.glb');fol=glb(folder/'foliage.glb')
 assert fol['triangles']==sum(p['triangles'] for p in i['prototypes'])
 assert len(i['prototypes'])==m['counts']['foliagePrototypes']
 assert sum(len(p['matrices']) for p in i['prototypes'])==m['counts']['foliageInstances']
 assert all(len(t)==16 for p in i['prototypes'] for t in p['matrices'])
 for p in i['prototypes']:
  assert (folder/p['impostor']['url']).read_bytes()[:8]==b'\x89PNG\r\n\x1a\n'
 if m['files']['environment']:assert (folder/m['files']['environment']).read_bytes()[:10].startswith((b'#?RADIANCE',b'#?RGBE'))
 source=Path(m['source']['path']);unchanged=sha(source)==m['source']['sha256'];assert unchanged
 row={'architecture':arch,'foliage':fol,'sourceUnmodified':unchanged,'architectureBaseTriangles':m['counts']['architectureBaseTriangles'],'architectureModifierTriangleDelta':arch['triangles']-m['counts']['architectureBaseTriangles'],'foliageInstances':m['counts']['foliageInstances'],'impostors':len(i['prototypes']),'caveats':m['fidelity']['materialCaveats']}
 results[city]=row
 print(city,arch['triangles'],fol['triangles'],arch['bytes'],fol['bytes'])
with open(ROOT/'audit/export-fidelity.json','w') as f:json.dump(results,f,ensure_ascii=False,indent=2)
