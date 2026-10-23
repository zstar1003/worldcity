"""Independently compare the complete ordered triangle-attribute hashes across source and tiles."""
import json,hashlib,sys
from collections import defaultdict
import numpy as np
from build_stream_tiles import ROOT,read_glb,accessor,matrix
MASK=(1<<64)-1

def signatures(path):
 j,b=read_glb(path); result=defaultdict(lambda:[0,0,0])
 for node in j['nodes']:
  if 'mesh' not in node:continue
  for prim in j['meshes'][node['mesh']]['primitives']:
   arrays=[np.ascontiguousarray(accessor(j,b,a)).view('u1').reshape(j['accessors'][a]['count'],-1) for name,a in sorted(prim['attributes'].items())]
   count=len(arrays[0]);h=np.full(count,14695981039346656037,dtype='u8')
   for arr in arrays:
    for col in arr.T:h=(h^col)*np.uint64(1099511628211)
   faces=accessor(j,b,prim['indices']).ravel().reshape(-1,3)
   tri=(h[faces[:,0]]*np.uint64(0x9e3779b185ebca87))^(h[faces[:,1]]*np.uint64(0xc2b2ae3d27d4eb4f))^(h[faces[:,2]]*np.uint64(0x165667b19e3779f9))
   key=(node['name'],j['materials'][prim['material']]['name'],matrix(node).tobytes(),tuple(sorted(prim['attributes'])))
   value=result[key];value[0]+=len(tri);value[1]=(value[1]+int(tri.sum(dtype='u8')))&MASK;value[2]=(value[2]+int((tri*tri).sum(dtype='u8')))&MASK
 return result,j,b

reports=[]
for city in sys.argv[1:] or ['shenzhen','beijing','shanghai','guangzhou']:
 root=ROOT/'public/cities'/city;manifest=json.loads((root/'stream/tiles.json').read_text());expected,j,b=signatures(root/'architecture.glb');actual=defaultdict(lambda:[0,0,0])
 for tile in manifest['tiles']:
  values,_,_=signatures(root/'stream'/tile['url'])
  assert (root/'stream'/tile['url']).stat().st_size==tile['bytes']
  for key,value in values.items():
   for i in range(3):actual[key][i]=(actual[key][i]+value[i])&(MASK if i else (1<<96)-1)
 assert expected==actual,city+' triangle-attribute fingerprint mismatch'
 assert sum(x[0] for x in actual.values())==manifest['triangles']
 for i,image in enumerate(j.get('images',[])):
  view=j['bufferViews'][image['bufferView']];start=view.get('byteOffset',0);original=b[start:start+view['byteLength']];suffix='.png' if image['mimeType']=='image/png' else '.jpg'
  assert original==(root/f'stream/textures/{i}{suffix}').read_bytes()
 report={'city':city,'tiles':len(manifest['tiles']),'triangles':manifest['triangles'],'allTriangleAttributeFingerprintsMatch':True,'nodeTransformsMatch':True,'embeddedImagesByteIdentical':True,'sourceSHA256':hashlib.sha256((root/'architecture.glb').read_bytes()).hexdigest()}
 assert report['sourceSHA256']==manifest['sourceSHA256'];reports.append(report);print(city,report,flush=True)
(ROOT/'audit/stream-fidelity.json').write_text(json.dumps(reports,indent=2))
