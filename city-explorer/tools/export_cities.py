"""Read-only Blender scene conversion; only writes derived browser assets."""
import bpy, sys, os, json, math, collections, hashlib, time
from pathlib import Path
from mathutils import Vector, Matrix
city=sys.argv[sys.argv.index('--')+1]
base=Path('/Users/zstar/worldcity/city-explorer')
out=base/'public/cities'/city;out.mkdir(parents=True,exist_ok=True)
audit=json.load(open(base/'audit'/f'{city}.json'))
scene=bpy.context.scene;scene.frame_set(1)
C=Matrix(((1,0,0,0),(0,0,1,0),(0,-1,0,0),(0,0,0,1)))
def xyz(v):return [float(v[0]),float(v[2]),float(-v[1])]
def vec(v):return [float(x) for x in v]
def log(s):print('CITY_EXPORT',city,s,flush=True)
def matrix(m):return [float(m[r][c]) for c in range(4) for r in range(4)]
def write(name,data):
 with open(out/name,'w') as f:json.dump(data,f,ensure_ascii=False,separators=(',',':'))
source=Path(bpy.data.filepath)
h=hashlib.sha256()
with open(source,'rb') as f:
 while data:=f.read(8*1024*1024):h.update(data)
# Source objects are filtered by original render visibility, including ancestor collections.
objects=[bpy.data.objects[r['name']] for r in audit['objects']]
uses=collections.Counter(o.data.name for o in objects)
vegetation={name for name,n in uses.items() if n>10}
architecture=[o for o in objects if o.data.name not in vegetation]
# Restore representative colors for procedural graphs unsupported by glTF.
sys.path.insert(0,str(base/'tools'))
from procedural_materials import generate_material_sidecar
procedural_fallbacks=generate_material_sidecar(out,objects,apply_fallbacks=True)
source_cam=scene.camera
camera={'position':xyz(source_cam.matrix_world.translation),'direction':xyz(source_cam.matrix_world.to_quaternion()@Vector((0,0,-1))),'fov':math.degrees(2*math.atan(max(abs(p.y/p.z) for p in source_cam.data.view_frame(scene=scene)))),'near':0.1,'far':30000}
# Pull HDR pixels from packed source with no resampling.
env=None
if scene.world and scene.world.use_nodes:
 for node in scene.world.node_tree.nodes:
  if node.type=='TEX_ENVIRONMENT' and node.image:
   im=node.image
   (out/'env.hdr').write_bytes(bytes(im.packed_file.data)) if im.packed_file else __import__('shutil').copyfile(bpy.path.abspath(im.filepath), out/'env.hdr')
   env='env.hdr';break
# Native glTF retains supported Principled image inputs. Cycles LightPath wrappers are ignored.
changed=[];conversions=[]
for mat in {s.material for o in objects for s in o.material_slots if s.material}:
 if not mat.use_nodes:continue
 tree=mat.node_tree;output=next((n for n in tree.nodes if n.type=='OUTPUT_MATERIAL' and n.is_active_output),None)
 if not output:continue
 principals=[n for n in tree.nodes if n.type=='BSDF_PRINCIPLED']
 if principals:
  main=principals[0]
  if not output.inputs['Surface'].is_linked or output.inputs['Surface'].links[0].from_node != main:
   tree.links.new(main.outputs['BSDF'],output.inputs['Surface']);changed.append(mat.name)
 else:
  gloss=next((n for n in tree.nodes if n.type in {'BSDF_GLOSSY','BSDF_ANISOTROPIC','BSDF_GLASS'}),None)
  if gloss:
   main=tree.nodes.new('ShaderNodeBsdfPrincipled')
   col=gloss.inputs.get('Color');rough=gloss.inputs.get('Roughness')
   if col:
    main.inputs['Base Color'].default_value=col.default_value
    if col.is_linked:tree.links.new(col.links[0].from_socket,main.inputs['Base Color'])
   main.inputs['Metallic'].default_value=.32
   main.inputs['Roughness'].default_value=max(.08,rough.default_value if rough else .18)
   tree.links.new(main.outputs['BSDF'],output.inputs['Surface'])
   changed.append(mat.name);conversions.append(mat.name)
# Procedural fallback values were evaluated and disconnected at the Principled inputs above.
# The JSON sidecar records node paths, approximation rules, and untouched image inputs.
settings=dict(export_format='GLB',use_selection=True,export_apply=True,export_yup=True,export_texcoords=True,export_normals=True,export_materials='EXPORT',export_image_format='AUTO',export_cameras=False,export_lights=False,export_animations=False,export_extras=False,export_draco_mesh_compression_enable=False)
def selected_export(path,items):
 if '--resume' in sys.argv and path.exists():
  log('Resume existing '+path.name);return
 bpy.ops.object.select_all(action='DESELECT')
 for o in items:
  o.hide_set(False);o.hide_viewport=False;o.select_set(True)
 bpy.context.view_layer.objects.active=items[0]
 log(f'Exporting {path} objects={len(items)}')
 bpy.ops.export_scene.gltf(filepath=str(path),**settings)
 log(f'Exported {path.name} bytes={path.stat().st_size}')
selected_export(out/'architecture.glb',architecture)
prototypes=[];proto_objects=[]
collection=bpy.data.collections.new('Browser foliage prototypes');scene.collection.children.link(collection)
for idx,name in enumerate(sorted(vegetation)):
 original=next(o for o in objects if o.data.name==name)
 proto=bpy.data.objects.new(f'foliage_{idx}',original.data);collection.objects.link(proto)
 # Preserve object-linked material slot overrides.
 for i,s in enumerate(original.material_slots):
  if s.link=='OBJECT':proto.material_slots[i].link='OBJECT';proto.material_slots[i].material=s.material
 proto_objects.append(proto)
 coords=[Vector(c) for c in proto.bound_box]
 lo=Vector([min(c[i] for c in coords) for i in range(3)]);hi=Vector([max(c[i] for c in coords) for i in range(3)])
 center=(lo+hi)*.5
 width=max(hi.x-lo.x,hi.z-lo.z)*1.1
 bl=[xyz(c) for c in coords]
 row={'name':proto.name,'sourceMesh':name,'triangles':audit['meshes'][name]['triangles'],'bounds':{'min':[min(c[i] for c in bl) for i in range(3)],'max':[max(c[i] for c in bl) for i in range(3)]},'impostor':{'url':f'impostor_{idx}.png','center':xyz(center),'width':width,'height':width},'matrices':[matrix(C@o.matrix_world@C.inverted()) for o in objects if o.data.name==name]}
 prototypes.append(row)
selected_export(out/'foliage.glb',proto_objects)
write('instances.json',{'coordinateSystem':'three-y-up','prototypes':prototypes})
# Render one alpha impostor per exact source mesh. Low-sample Cycles CPU avoids reliance on GUI GPU context.
render_scene=bpy.data.scenes.new('Browser foliage impostors');render_scene.render.engine='CYCLES';render_scene.cycles.device='CPU';render_scene.cycles.samples=8;render_scene.cycles.use_denoising=True
render_scene.render.resolution_x=512;render_scene.render.resolution_y=512;render_scene.render.resolution_percentage=100;render_scene.render.film_transparent=True
render_scene.render.image_settings.file_format='PNG';render_scene.render.image_settings.color_mode='RGBA';render_scene.render.image_settings.color_depth='8'
render_scene.view_settings.view_transform='AgX';render_scene.view_settings.look='AgX - Medium High Contrast'
world=bpy.data.worlds.new('Browser foliage daylight');world.use_nodes=True
world.node_tree.nodes.clear();bg=world.node_tree.nodes.new('ShaderNodeBackground');wo=world.node_tree.nodes.new('ShaderNodeOutputWorld');world.node_tree.links.new(bg.outputs[0],wo.inputs['Surface'])
bg.inputs['Color'].default_value=(.65,.74,.9,1);bg.inputs['Strength'].default_value=.65;render_scene.world=world
sun_data=bpy.data.lights.new('Impostor sun','SUN');sun_data.energy=2.0;sun=bpy.data.objects.new('Impostor sun',sun_data);render_scene.collection.objects.link(sun);sun.rotation_euler=(.6,-.3,-.5)
cam_data=bpy.data.cameras.new('Impostor camera');cam_data.type='ORTHO';cam=bpy.data.objects.new('Impostor camera',cam_data);render_scene.collection.objects.link(cam);render_scene.camera=cam
for i,(proto,row) in enumerate(zip(proto_objects,prototypes)):
 render_scene.collection.objects.link(proto)
 center=Vector((row['impostor']['center'][0],-row['impostor']['center'][2],row['impostor']['center'][1]));width=row['impostor']['width']
 cam.location=center+Vector((0,-width*3,0));cam.rotation_euler=(center-cam.location).to_track_quat('-Z','Y').to_euler();cam_data.ortho_scale=width;cam_data.clip_end=width*10
 render_scene.render.filepath=str(out/f'impostor_{i}.png');log('Rendering '+render_scene.render.filepath)
 bpy.ops.render.render(write_still=True,scene=render_scene.name)
 render_scene.collection.objects.unlink(proto)
# Ground spawns have been independently ray tested against original non-vegetation meshes.
spawns=[]
targets={'shenzhen':[(-478,-708,90),(-50,365,30)],'shanghai':[(150,200,100),(600,-270,150),(80,350,100)],'beijing':[(-560,840,15),(-540,280,18)],'guangzhou':[(0,-663,160),(145,575,150),(0,-663,150)]}
for i,s in enumerate(json.load(open(base/'audit'/f'{city}-spawns.json'))):
 if not s['hits'] or s['hits'][0]['z']>10:continue
 z=s['hits'][0]['z'];spawns.append({'name':s['name'],'position':xyz([*s['xy'],z+1.7]),'groundHeight':z,'target':xyz(targets[city][i])})
suns=[o for o in scene.objects if o.type=='LIGHT' and o.data.type=='SUN']
sun_info=None
if suns:
 s=suns[0];sun_info={'direction':xyz(s.matrix_world.to_quaternion()@Vector((0,0,-1))),'color':vec(s.data.color),'intensity':s.data.energy}
bounds=[xyz(Vector(c)) for c in [audit['bounds'][0],audit['bounds'][1]]]
manifest={'id':city,'name':{'shenzhen':'深圳','shanghai':'上海','beijing':'北京','guangzhou':'广州'}[city],'files':{'architecture':'architecture.glb','foliage':'foliage.glb','instances':'instances.json','materials':'materials.json','environment':env},'camera':camera,'bounds':{'min':[min(c[i] for c in bounds) for i in range(3)],'max':[max(c[i] for c in bounds) for i in range(3)]},'sun':sun_info,'spawns':spawns,'counts':dict(audit['summary'],architectureObjects=len(architecture),architectureBaseTriangles=sum(audit['meshes'][o.data.name]['triangles'] for o in architecture),foliagePrototypes=len(prototypes),foliageInstances=sum(len(p['matrices']) for p in prototypes)),'fidelity':{'geometry':'Full evaluated original architecture; no decimation or quantization; original foliage meshes retained as prototypes. Distant foliage uses single-view transparent impostors.','textureResolution':'Original image dimensions; no texture resampling in glTF export.','materialCaveats':['Realtime PBR approximates original Cycles shader and lighting; no pixel-equality claim.','Procedural noise, brick, bump, bevel, volume, LightPath and complex custom shader groups may not survive native glTF export.','Unsupported custom glossy/Fresnel glazing is converted to opaque reflective PBR to keep architectural visibility.'],'modifiedMaterials':changed,'customGlassPBRConversions':conversions},'source':{'path':str(source),'sha256':h.hexdigest()},'filesBytes':{p.name:p.stat().st_size for p in out.iterdir() if p.is_file()}}
write('city.json',manifest)
log('COMPLETE')
