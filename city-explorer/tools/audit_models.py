import bpy, sys, json, os, collections, time
from mathutils import Vector
started=time.time()
output=sys.argv[sys.argv.index('--')+1]
scene=bpy.context.scene
scene.frame_set(1)
deps=bpy.context.evaluated_depsgraph_get()
def v(x): return [round(float(i),4) for i in x]
def bounds(o):
    pts=[o.matrix_world@Vector(c) for c in o.bound_box]
    return [v([min(p[i] for p in pts) for i in range(3)]), v([max(p[i] for p in pts) for i in range(3)])]
render_names=set(); collection_info=[]
def collect(c,hidden=False):
    hidden=hidden or c.hide_render
    collection_info.append({'name':c.name,'hidden_render':hidden,'hidden_viewport':c.hide_viewport,'direct_objects':len(c.objects)})
    if not hidden: render_names.update(o.name for o in c.objects)
    for child in c.children: collect(child,hidden)
collect(scene.collection)
objects=[]; meshes={}; modifiers=collections.Counter(); material_names=set()
for o in scene.objects:
    if o.type != 'MESH' or o.hide_render or o.name not in render_names: continue
    m=o.data
    if m.name not in meshes:
        meshes[m.name]={'vertices':len(m.vertices),'polygons':len(m.polygons),'triangles':sum(max(0,len(p.vertices)-2) for p in m.polygons),'users':m.users}
    mods=[{'type':x.type,'name':x.name,'viewport':x.show_viewport,'render':x.show_render} for x in o.modifiers]
    modifiers.update(x['type'] for x in mods)
    mats=[s.material.name if s.material else None for s in o.material_slots]
    material_names.update(x for x in mats if x)
    objects.append({'name':o.name,'mesh':m.name,'triangles':meshes[m.name]['triangles'],'bounds':bounds(o),'location':v(o.matrix_world.translation),'materials':mats,'modifiers':mods,'visible':o.visible_get(),'hide_viewport':o.hide_viewport})
materials=[]; node_types=collections.Counter()
for name in sorted(material_names):
    m=bpy.data.materials[name]; nodes=[]
    if m.use_nodes:
        for n in m.node_tree.nodes:
            node_types[n.bl_idname]+=1
            item={'type':n.bl_idname,'name':n.name}
            if n.type=='BSDF_PRINCIPLED':
                item['inputs']={}
                for key in ['Base Color','Metallic','Roughness','IOR','Alpha','Transmission Weight','Emission Color','Emission Strength']:
                    s=n.inputs.get(key)
                    if s: item['inputs'][key]={'linked':s.is_linked,'value':v(s.default_value) if hasattr(s.default_value,'__len__') else round(float(s.default_value),4)}
            if n.type=='TEX_IMAGE' and n.image:
                item['image']={'name':n.image.name,'path':n.image.filepath,'size':list(n.image.size),'packed':bool(n.image.packed_file)}
            nodes.append(item)
    materials.append({'name':name,'diffuse_color':v(m.diffuse_color),'nodes':nodes})
instances=0; instance_tri=0; eval_meshes={}; instance_source=collections.Counter()
for instance in deps.object_instances:
    o=instance.object
    if o.type!='MESH' or o.hide_render: continue
    instances+=1
    key=o.data.as_pointer()
    if key not in eval_meshes:
        eval_meshes[key]=sum(max(0,len(p.vertices)-2) for p in o.data.polygons)
    instance_tri+=eval_meshes[key];instance_source[o.original.name]+=1
cam=scene.camera
camera=None
if cam:
    camera={'name':cam.name,'location':v(cam.matrix_world.translation),'direction':v(cam.matrix_world.to_quaternion()@Vector((0,0,-1))),'lens':cam.data.lens,'clip_start':cam.data.clip_start,'clip_end':cam.data.clip_end,'constraints':[{'type':c.type,'target':c.target.name if hasattr(c,'target') and c.target else None} for c in cam.constraints]}
world=[]
if scene.world and scene.world.use_nodes:
    for n in scene.world.node_tree.nodes:
        a={'type':n.bl_idname,'name':n.name}
        if n.type=='TEX_ENVIRONMENT' and n.image: a['image']={'path':n.image.filepath,'size':list(n.image.size),'packed':bool(n.image.packed_file)}
        if n.type=='BACKGROUND': a.update({'color':v(n.inputs['Color'].default_value),'strength':n.inputs['Strength'].default_value})
        world.append(a)
lights=[{'name':o.name,'type':o.data.type,'energy':o.data.energy,'color':v(o.data.color),'location':v(o.matrix_world.translation),'rotation':v(o.rotation_euler),'angle':getattr(o.data,'angle',None)} for o in scene.objects if o.type=='LIGHT' and not o.hide_render]
allbounds=[[min(o['bounds'][0][i] for o in objects) for i in range(3)],[max(o['bounds'][1][i] for o in objects) for i in range(3)]]
report={'source':bpy.data.filepath,'blender':bpy.app.version_string,'elapsed_s':time.time()-started,'unit_system':scene.unit_settings.system,'unit_scale':scene.unit_settings.scale_length,'camera':camera,'bounds':allbounds,'summary':{'visible_mesh_objects':len(objects),'unique_meshes':len(meshes),'unique_triangles':sum(m['triangles'] for m in meshes.values()),'instantiated_base_triangles':sum(o['triangles'] for o in objects),'evaluated_instances':instances,'evaluated_instance_triangles':instance_tri,'evaluated_unique_triangles':sum(eval_meshes.values()),'reused_meshes':sum(m['users']>1 for m in meshes.values()),'materials':len(materials),'modifiers':dict(modifiers),'node_types':dict(node_types)},'collections':collection_info,'lights':lights,'world':world,'materials':materials,'objects':objects,'meshes':meshes,'repeated_instances':{k:v for k,v in instance_source.items() if v>1}}
os.makedirs(os.path.dirname(output),exist_ok=True)
with open(output,'w') as f: json.dump(report,f,ensure_ascii=False,indent=2)
print('AUDIT_RESULT',json.dumps({'output':output,'summary':report['summary'],'camera':camera,'bounds':allbounds,'elapsed_s':report['elapsed_s']}))
