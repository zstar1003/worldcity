import bpy,json,pathlib
root=pathlib.Path('/Users/zstar/worldcity/city-explorer')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=str(root/'audit/avatar-source/Export/Male_Adult_09.fbx'))
r={'objects':[],'materials':[]}
for o in bpy.data.objects:
 d={'name':o.name,'type':o.type,'location':list(o.location),'scale':list(o.scale),'rotation':list(o.rotation_euler)}
 if o.type=='ARMATURE':d['bones']=[{'name':b.name,'parent':b.parent.name if b.parent else None,'head':list(b.head_local),'tail':list(b.tail_local)}for b in o.data.bones]
 if o.type=='MESH':d.update(vertices=len(o.data.vertices),polygons=len(o.data.polygons),materials=[m.name for m in o.data.materials],bounds=[list(v)for v in o.bound_box])
 r['objects'].append(d)
for m in bpy.data.materials:
 r['materials'].append({'name':m.name,'nodes':[{'type':n.bl_idname,'image':n.image.filepath if n.type=='TEX_IMAGE' and n.image else None}for n in m.node_tree.nodes]})
(root/'audit/avatar-import.json').write_text(json.dumps(r,indent=2))
print(json.dumps(r,indent=2))
