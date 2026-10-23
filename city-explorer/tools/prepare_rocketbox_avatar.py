"""Convert Microsoft Rocketbox Male_Adult_09 without changing geometry or bind pose."""
import bpy,json,pathlib,math,shutil,hashlib
from mathutils import Vector
R=pathlib.Path('/Users/zstar/worldcity/city-explorer');S=R/'audit/avatar-source';O=R/'public/characters/rocketbox-male-09';O.mkdir(exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.fbx(filepath=str(S/'Export/Male_Adult_09.fbx'))
arm=next(o for o in bpy.data.objects if o.type=='ARMATURE');meshes=[o for o in bpy.data.objects if o.type=='MESH']
mapping={'Bip01 Pelvis':'Hips','Bip01 Spine':'Spine','Bip01 Spine1':'Spine1','Bip01 Spine2':'Spine2','Bip01 Neck':'Neck','Bip01 Head':'Head'}
for letter,side in [('L','Left'),('R','Right')]:
 for old,new in [('Clavicle','Shoulder'),('UpperArm','Arm'),('Forearm','ForeArm'),('Hand','Hand'),('Thigh','UpLeg'),('Calf','Leg'),('Foot','Foot'),('Toe0','ToeBase')]:mapping[f'Bip01 {letter} {old}']=side+new
 for i,finger in enumerate(['Thumb','Index','Middle','Ring','Pinky']):
  for j,suffix in enumerate(['','1','2']):mapping[f'Bip01 {letter} Finger{i}{suffix}']=side+'Hand'+finger+str(j+1)
report={'source':'https://github.com/microsoft/Microsoft-Rocketbox/tree/master/Assets/Avatars/Adults/Male_Adult_09','license':'MIT','character':'Fictional East Asian adult male tourist; source does not specify nationality.','boneMap':{},'sourceVertices':sum(len(o.data.vertices)for o in meshes),'sourceTriangles':sum(sum(len(p.vertices)-2 for p in o.data.polygons)for o in meshes),'bindPoseUnchanged':True,'textures':[]}
for old,new in mapping.items():
 b=arm.data.bones.get(old)
 if b: b.name='mixamorig:'+new;report['boneMap'][old]=b.name
for o in meshes:
 for vg in o.vertex_groups:
  if vg.name in report['boneMap']:vg.name=report['boneMap'][vg.name]
# Repair stale FBX paths while retaining all original maps and full pixel dimensions.
for im in bpy.data.images:
 p=S/'Textures'/pathlib.Path(im.filepath).name
 if p.exists():im.filepath=str(p);im.reload();report['textures'].append({'source':p.name,'resolution':list(im.size),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
for m in bpy.data.materials:
 bs=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
 bs.inputs['Metallic'].default_value=0
 bs.inputs['Roughness'].default_value=.72 if 'body' in m.name else .58
 if 'opacity' in m.name:
  tex=next(n for n in m.node_tree.nodes if n.type=='TEX_IMAGE');m.node_tree.links.new(tex.outputs['Alpha'],bs.inputs['Alpha']);m.surface_render_method='DITHERED';m.use_backface_culling=False
 else:bs.inputs['Alpha'].default_value=1
# Export only original rig and meshes, with original object transforms and bind matrices.
bpy.ops.object.select_all(action='DESELECT');arm.select_set(True)
for o in meshes:o.select_set(True)
bpy.context.view_layer.objects.active=arm
bpy.ops.export_scene.gltf(filepath=str(O/'tourist.glb'),export_format='GLB',use_selection=True,export_animations=False,export_image_format='AUTO',export_yup=True,export_skins=True,export_morph=False)
shutil.copyfile(S/'LICENSE.md',O/'LICENSE-Microsoft-Rocketbox.txt')
report['bones']=[{'name':b.name,'parent':b.parent.name if b.parent else None,'matrixLocal':[v for row in b.matrix_local for v in row]}for b in arm.data.bones]
points=[o.matrix_world@Vector(p)for o in meshes for p in o.bound_box];lo=Vector([min(p[i]for p in points)for i in range(3)]);hi=Vector([max(p[i]for p in points)for i in range(3)])
report['boundsBlender']={'min':list(lo),'max':list(hi)};report['heightMeters']=hi.z-lo.z;report['forwardThree']=[0,0,1];report['notes']=['Original skin weights, topology, proportions, bone hierarchy and bind transforms retained.','Only semantic locomotion bone names changed to Mixamo; facial bones retain original names.','FBX specular workflow converted by Blender glTF exporter; roughness chosen for everyday cotton/skin; no original physically calibrated roughness map exists.','No baked animations; use world-space bind-aware transferLocomotion with traveler.glb Idle/Walk/Run; Jump driven by navigation.','Hair alpha is blended; source normal map direction retained.']
report['bytes']=(O/'tourist.glb').stat().st_size;(O/'rig.json').write_text(json.dumps(report,indent=2));(R/'audit/avatar-export.json').write_text(json.dumps(report,indent=2))
# Actual converted asset preview under neutral lighting.
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=24;scene.render.resolution_x=800;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
scene.world=bpy.data.worlds.new('Preview world');scene.world.use_nodes=True;next(n for n in scene.world.node_tree.nodes if n.type=='BACKGROUND').inputs[0].default_value=(.19,.19,.19,1);next(n for n in scene.world.node_tree.nodes if n.type=='BACKGROUND').inputs[1].default_value=.7
scene.view_settings.view_transform='AgX';scene.render.film_transparent=False
center=(lo+hi)/2;height=hi.z-lo.z
for name,location,power,size in [('Key',(2,-3,3),450,3),('Fill',(-2,-1,2),180,2),('Rim',(0,2,3),300,2)]:
 data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='DISK';data.size=size;obj=bpy.data.objects.new(name,data);scene.collection.objects.link(obj);obj.location=Vector(location);obj.rotation_euler=(center-obj.location).to_track_quat('-Z','Y').to_euler()
data=bpy.data.cameras.new('Preview');cam=bpy.data.objects.new('Preview',data);scene.collection.objects.link(cam);scene.camera=cam;data.type='ORTHO';data.ortho_scale=height*1.2
cam.location=center+Vector((height*.7,-height*2,height*.15));cam.rotation_euler=(center-cam.location).to_track_quat('-Z','Y').to_euler();scene.render.filepath=str(R/'audit/avatar-converted-front.png');bpy.ops.render.render(write_still=True)
cam.location=center+Vector((-height*.7,height*2,height*.15));cam.rotation_euler=(center-cam.location).to_track_quat('-Z','Y').to_euler();scene.render.filepath=str(R/'audit/avatar-converted-back.png');bpy.ops.render.render(write_still=True)
print('AVATAR_DONE',report['bytes'],report['heightMeters'],flush=True)
