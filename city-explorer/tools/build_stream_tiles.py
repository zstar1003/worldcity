"""Lossless spatial glTF slicing. Copies original attribute bytes, transforms and images."""
import json, struct, copy, hashlib, sys
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
DT={5120:'i1',5121:'u1',5122:'<i2',5123:'<u2',5125:'<u4',5126:'<f4'}
SZ={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}
def read_glb(path):
 b=path.read_bytes(); n=struct.unpack_from('<I',b,12)[0]; j=json.loads(b[20:20+n]); return j,b[28+n:]
def accessor(j,b,index):
 a=j['accessors'][index];v=j['bufferViews'][a['bufferView']];assert 'sparse' not in a
 stride=v.get('byteStride',np.dtype(DT[a['componentType']]).itemsize*SZ[a['type']])
 return np.ndarray((a['count'],SZ[a['type']]),dtype=DT[a['componentType']],buffer=b,offset=v.get('byteOffset',0)+a.get('byteOffset',0),strides=(stride,np.dtype(DT[a['componentType']]).itemsize))
def matrix(n):
 if 'matrix' in n:return np.array(n['matrix']).reshape(4,4).T
 x,y,z,w=n.get('rotation',[0,0,0,1]);m=np.eye(4)
 m[:3,:3]=np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]])@np.diag(n.get('scale',[1,1,1]));m[:3,3]=n.get('translation',[0,0,0]);return m
class Tile:
 def __init__(self,base):
  self.j=copy.deepcopy(base);self.j.update(nodes=[],meshes=[],accessors=[],bufferViews=[],scenes=[{'nodes':[]}],scene=0,buffers=[]);self.data=bytearray();self.triangles=0;self.lo=np.full(3,np.inf);self.hi=-self.lo
 def array(self,arr,template):
  while len(self.data)%4:self.data.append(0)
  raw=np.ascontiguousarray(arr).tobytes();v=len(self.j['bufferViews']);self.j['bufferViews'].append({'buffer':0,'byteOffset':len(self.data),'byteLength':len(raw)});self.data.extend(raw)
  a={k:copy.deepcopy(val) for k,val in template.items() if k not in ['bufferView','byteOffset','count','min','max']};a.update(bufferView=v,count=len(arr));
  if a['type']=='VEC3':a.update(min=arr.min(axis=0).tolist(),max=arr.max(axis=0).tolist())
  i=len(self.j['accessors']);self.j['accessors'].append(a);return i
 def add(self,n,p,attrs,ids,faces,world,bounds):
  q=copy.deepcopy(p);q['attributes']={key:self.array(arr[ids],tmpl) for key,(arr,tmpl) in attrs.items()};q['indices']=self.array(faces.astype('<u4').reshape(-1,1),{'type':'SCALAR','componentType':5125});
  node={k:copy.deepcopy(v) for k,v in n.items() if k not in ['mesh','children']};node['mesh']=len(self.j['meshes']);node['extras']={**node.get('extras',{}),'sourceBounds':bounds};self.j['meshes'].append({'primitives':[q]});self.j['scenes'][0]['nodes'].append(len(self.j['nodes']));self.j['nodes'].append(node)
  self.triangles+=len(faces);self.lo=np.minimum(self.lo,world.min(axis=0));self.hi=np.maximum(self.hi,world.max(axis=0))
 def write(self,path):
  while len(self.data)%4:self.data.append(0)
  self.j['buffers']=[{'byteLength':len(self.data)}];raw=json.dumps(self.j,separators=(',',':'),ensure_ascii=False).encode();raw+=b' '*((-len(raw))%4)
  with path.open('wb') as f:f.write(struct.pack('<III',0x46546c67,2,28+len(raw)+len(self.data)));f.write(struct.pack('<II',len(raw),0x4e4f534a));f.write(raw);f.write(struct.pack('<II',len(self.data),0x004e4942));f.write(self.data)
def build(city):
 folder=ROOT/'public/cities'/city;out=folder/'stream';out.mkdir(exist_ok=True);(out/'textures').mkdir(exist_ok=True)
 source=folder/'architecture.glb';j,b=read_glb(source);base={k:copy.deepcopy(j[k]) for k in ['asset','materials','textures','samplers','images','extensionsUsed','extensionsRequired'] if k in j}
 for i,im in enumerate(base.get('images',[])):
  v=j['bufferViews'][im['bufferView']];data=b[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']];suffix='.png' if im['mimeType']=='image/png' else '.jpg';name=f'textures/{i}{suffix}';(out/name).write_bytes(data);im.pop('bufferView');im['uri']=name
 tiles={};total=0
 for ni,n in enumerate(j['nodes']):
  assert not n.get('children'), 'hierarchical nodes need explicit world matrices'
  if 'mesh' not in n:continue
  m=matrix(n)
  for p in j['meshes'][n['mesh']]['primitives']:
   assert p.get('mode',4)==4 and not p.get('targets')
   attrs={key:(accessor(j,b,a),j['accessors'][a]) for key,a in p['attributes'].items()};pos=attrs['POSITION'][0];world=pos.astype('f8')@m[:3,:3].T+m[:3,3];faces=accessor(j,b,p['indices']).reshape(-1,3) if 'indices' in p else np.arange(len(pos)).reshape(-1,3)
   centers=(world[faces[:,0]]+world[faces[:,1]]+world[faces[:,2]])/3;cells=np.floor(centers/[250,160,250]).astype('i4');keys,labels=np.unique(cells,axis=0,return_inverse=True);coverage=np.zeros(len(faces),dtype='u1');bounds={'min':pos.min(axis=0).tolist(),'max':pos.max(axis=0).tolist()}
   for ki,key in enumerate(keys):
    selected=np.flatnonzero(labels==ki);coverage[selected]+=1;ids,remap=np.unique(faces[selected],return_inverse=True);key=tuple(key)
    if key not in tiles:tiles[key]=Tile(base)
    tile=tiles[key];tile.add(n,p,attrs,ids,remap.reshape(-1,3),world[ids],bounds)
   assert np.all(coverage==1);total+=len(faces)
  if ni%500==0:print(city,ni,'/',len(j['nodes']),flush=True)
 manifest={'version':1,'cellSize':[250,160,250],'sourceSHA256':hashlib.sha256(source.read_bytes()).hexdigest(),'triangles':total,'precision':'Original attribute bytes and node transforms; no quantization, simplification or image resampling.','tiles':[]}
 for key,tile in sorted(tiles.items()):
  name='t_'+'_'.join(map(str,key))+'.glb';path=out/name;tile.write(path);manifest['tiles'].append({'id':name,'url':name,'bounds':{'min':tile.lo.tolist(),'max':tile.hi.tolist()},'triangles':tile.triangles,'bytes':path.stat().st_size})
 assert sum(t['triangles'] for t in manifest['tiles'])==total
 (out/'tiles.json').write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':')))
 print(city,'DONE',len(tiles),'tiles',total,'triangles',sum(t['bytes'] for t in manifest['tiles'])//1048576,'MiB',flush=True)
if __name__=='__main__':
 for city in sys.argv[1:] or ['shenzhen','beijing','shanghai','guangzhou']:build(city)
