import bpy,json,math,struct
from pathlib import Path
base=Path('/Users/zstar/worldcity/city-explorer')
for city in ['shenzhen','shanghai','beijing','guangzhou']:
 path=base/'public/cities'/city/'city.json'
 if not path.exists():continue
 m=json.load(open(path));bpy.ops.wm.open_mainfile(filepath=m['source']['path']);s=bpy.context.scene;s.frame_set(1);cam=s.camera
 m['camera']['fov']=math.degrees(2*math.atan(max(abs(p.y/p.z) for p in cam.data.view_frame(scene=s))))
 m['source']['renderDimensions']=[s.render.resolution_x,s.render.resolution_y];m['source']['cameraFrame']=1
 with open(path.parent/'architecture.glb','rb') as f:
  f.read(12);n,t=struct.unpack('<II',f.read(8));g=json.loads(f.read(n))
 m['counts']['architectureExportTriangles']=sum(g['accessors'][p['indices']]['count']//3 for mesh in g['meshes'] for p in mesh['primitives'])
 m['counts']['architectureExportPrimitives']=sum(len(mesh['primitives']) for mesh in g['meshes'])
 m['fidelity']['navigation']='Original source ground elevations, ray-tested spawn positions. Render geometry includes merged multi-building meshes; whole-object bounding boxes are unsuitable collision proxies.'
 with open(path,'w') as f:json.dump(m,f,ensure_ascii=False,separators=(',',':'))
 print('METADATA',city,m['camera']['fov'],m['counts']['architectureExportTriangles'],flush=True)
