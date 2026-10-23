"""Read-only extraction of source render settings and unsupported shader parameters."""
import bpy, json, sys, struct, math
from pathlib import Path
from mathutils import Vector

city=sys.argv[sys.argv.index('--')+1]
base=Path('/Users/zstar/worldcity/city-explorer')
out=base/'public/cities'/city
scene=bpy.context.scene
scene.frame_set(1)
def value(v):
    if isinstance(v,(int,float,str,bool)):return v
    try:return list(v)
    except:return str(v)
def inp(n,key,default=None):
    s=n.inputs.get(key)
    return value(s.default_value) if s and hasattr(s,'default_value') else default
def graph(n,seen=None):
    seen=set() if seen is None else seen
    if n.name in seen:return {'node':n.name,'reused':True}
    seen.add(n.name)
    r={'node':n.name,'type':n.bl_idname,'inputs':[]}
    for s in n.inputs:
        row={'name':s.name}
        if s.is_linked:row['link']=graph(s.links[0].from_node,seen);row['socket']=s.links[0].from_socket.name
        elif hasattr(s,'default_value'):row['value']=value(s.default_value)
        r['inputs'].append(row)
    if n.type=='MATH':r['operation']=n.operation;r['useClamp']=n.use_clamp
    if n.type=='BEVEL':r['samples']=n.samples
    if n.type=='GROUP':r['group']=n.node_tree.name
    return r
def target(s):return s.links[0].from_node if s and s.is_linked else None
def shader_fields(n):
    names={'coatIOR':'Coat IOR','coatTint':'Coat Tint','coatWeight':'Coat Weight','coatRoughness':'Coat Roughness','ior':'IOR','specularIORLevel':'Specular IOR Level','specularTint':'Specular Tint','transmission':'Transmission Weight','roughness':'Roughness','metalness':'Metallic','baseColor':'Base Color'}
    return {k:inp(n,v) for k,v in names.items() if n.inputs.get(v)}
f=open(out/'architecture.glb','rb');f.seek(12);n,t=struct.unpack('<II',f.read(8));gltf=json.loads(f.read(n));f.close()
materials={}
for exported in gltf['materials']:
    name=exported['name'];m=bpy.data.materials.get(name)
    if not m or not m.use_nodes:continue
    nodes=m.node_tree.nodes
    principal=next((n for n in nodes if n.type=='BSDF_PRINCIPLED'),None)
    output=next((n for n in nodes if n.type=='OUTPUT_MATERIAL' and n.is_active_output),None)
    row={'sourceMaterial':name,'sourceType':'principled' if principal else 'custom'}
    if principal:
        row.update(shader_fields(principal))
        row['linkedInputs']={s.name:[s.links[0].from_node.name,s.links[0].from_socket.name] for s in principal.inputs if s.is_linked}
        normal=target(principal.inputs.get('Normal'))
        if normal:
            # Keep evidence rather than inventing a single normal strength for a graph.
            row['normalGraph']=graph(normal)
        if row.get('coatWeight',0)>0:
            row['coatF0']=((row['coatIOR']-1)/(row['coatIOR']+1))**2
            row['coatColorSemantics']='Blender Coat Tint colors transmission through the coat, not the first surface reflection.'
    surface=target(output.inputs.get('Surface')) if output else None
    if surface and surface.type=='MIX_SHADER':
        a=target(surface.inputs[1]);b=target(surface.inputs[2]);factor=target(surface.inputs[0])
        if b and b.type in {'BSDF_ANISOTROPIC','BSDF_GLOSSY'} and a and a.type in {'BSDF_TRANSPARENT','BSDF_PRINCIPLED'}:
            row['reflectionMix']={'baseType':a.bl_idname,'reflectionColor':inp(b,'Color'),'reflectionRoughness':inp(b,'Roughness'),'factor':graph(factor) if factor else {'constant':inp(surface,'Fac')}}
            if a.type=='BSDF_TRANSPARENT':row['reflectionMix']['transmissionColor']=inp(a,'Color')
    row['sourceSurface']=surface.bl_idname if surface else None
    row['gltfExtensions']=list(exported.get('extensions',{}))
    materials[name]=row
worldnodes=scene.world.node_tree.nodes
background=next(n for n in worldnodes if n.type=='BACKGROUND' and target(n.inputs.get('Color')) and target(n.inputs.get('Color')).type=='TEX_ENVIRONMENT')
environment=target(background.inputs['Color'])
mapping=target(environment.inputs.get('Vector'))
suns=[]
for o in scene.objects:
    if o.type=='LIGHT' and o.data.type=='SUN' and not o.hide_render:
        direction=o.matrix_world.to_quaternion()@Vector((0,0,-1))
        suns.append({'name':o.name,'energy':o.data.energy,'color':list(o.data.color),'angle':o.data.angle,'direction':[direction.x,direction.z,-direction.y],'energyUnits':'Blender source sun strength (W/m²); calibrate renderer radiometric convention before multiplying.'})
settings={
 'version':1,'source':{'path':bpy.data.filepath,'blenderVersion':bpy.app.version_string,'frame':1},
 'viewSettings':{p:value(getattr(scene.view_settings,p)) for p in ['view_transform','look','exposure','gamma','use_curve_mapping']},
 'viewLook':{'processSpace':'AgX Log','contrast':[1.2,1.2,1.2],'pivot':-.2,'normalizedLogPivot':.4,'normalizedLogFormula':'(x - 0.4) * 1.2 + 0.4','sourceLog2Range':[-12.47393,12.5260688117],'physicalLog2Pivot':-2.47393047532,'threeR180NormalizedLogPivot':10/16.5,'saturation':1,'source':'Blender 4.5 OCIO config.ocio: AgX - Medium High Contrast; normalized pivot independently sampled using PyOpenColorIO 2.5.2','implementationNote':'Blender uses a 25-stop normalized log range; Three r180 sigmoid uses 16.5 stops. Apply contrast in log2 light around physicalLog2Pivot, or rescale pivot before applying to Three normalized log.'},
 'worldStrength':inp(background,'Strength'),
 'worldRotation':inp(mapping,'Rotation',[0,0,0]) if mapping else [0,0,0],
 'worldRotationSpace':'Blender Z-up source texture-coordinate Mapping rotation; apply the equivalent sampling transform after Three-to-Blender equirectangular basis conversion.',
 'worldGraph':graph(next(n for n in worldnodes if n.type=='OUTPUT_WORLD')),
 'sun':suns[0] if suns else None,'suns':suns,'materials':materials,
 'limitations':['This file records source values. Its presence does not imply all unsupported Cycles features are implemented by the browser.','Normal graphs include procedural evidence; source spatial texture sidecars implement a separate sampled approximation.','Coat Tint is transmission attenuation through the coating; multiplying the coat reflection by the tint is not equivalent.','Do not replace custom transparent/glossy Fresnel mixtures with arbitrary metallic paint.']
}
(out/'render-settings.json').write_text(json.dumps(settings,ensure_ascii=False,separators=(',',':')))
print('RENDER_SETTINGS_DONE',city,len(materials),flush=True)
