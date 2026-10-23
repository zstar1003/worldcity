"""Bake original procedural shader channels into sampled 2K spatial textures.
Original .blend and architecture.glb are strictly read-only. This is a documented
planar sampling of original nodes, not invented replacement surface textures.
"""
import bpy,sys,json,math,hashlib,time,os
from pathlib import Path
from mathutils import Matrix,Vector
BASE=Path('/Users/zstar/worldcity/city-explorer');sys.path.insert(0,str(BASE/'tools'))
from procedural_materials import exported_materials,upstream_has_image
C=Matrix(((1,0,0,0),(0,0,1,0),(0,-1,0,0),(0,0,0,1)))
RES=2048
args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
metalness_only='--metalness-only' in args
args=[arg for arg in args if arg!='--metalness-only']
cities=args or ['shenzhen','shanghai','beijing','guangzhou']
def matlist(m):return [float(m[r][c]) for c in range(4) for r in range(4)]
def simple(v):
 if isinstance(v,(str,bool,int,float)):return v
 try:return [float(x) for x in v]
 except:return str(v)
def write(path,data):
 temp=path.with_suffix(path.suffix+'.tmp');temp.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')));temp.replace(path)
def nodegraph(socket,seen=None):
 if not socket.is_linked:return {'constant':simple(socket.default_value) if hasattr(socket,'default_value') else None}
 output=socket.links[0].from_socket;n=output.node
 key=(n.as_pointer(),output.identifier)
 seen=set() if seen is None else seen
 if key in seen:return {'cycle':n.name}
 seen=seen|{key}
 row={'type':n.bl_idname,'output':output.name,'inputs':[]}
 for attr in ['operation','noise_dimensions','noise_type','normalize','blend_type','vector_type','offset','offset_frequency','squash','squash_frequency','invert','use_clamp','clamp','interpolation_type','data_type']:
  if hasattr(n,attr):row[attr]=simple(getattr(n,attr))
 if n.type=='VALTORGB':row['colorRamp']={'interpolation':n.color_ramp.interpolation,'elements':[{'position':e.position,'color':list(e.color)} for e in n.color_ramp.elements]}
 if n.type=='TEX_COORD' and n.object:row['referenceObject']=n.object.name;row['referenceWorldMatrix']=matlist(n.object.matrix_world)
 for i,s in enumerate(n.inputs):
  row['inputs'].append({'index':i,'name':s.name,'type':s.type,'value':nodegraph(s,seen)})
 return row
def reachable(socket):
 out=[];seen=set()
 def walk(s):
  if not s.is_linked:return
  o=s.links[0].from_socket;n=o.node;k=(n.as_pointer(),o.identifier)
  if k in seen:return
  seen.add(k);out.append((n,o))
  for i in n.inputs:walk(i)
 walk(socket);return out
def describe_mapping(sock):
 reach=reachable(sock);spaces=set();refs=set()
 for n,o in reach:
  if n.type=='TEX_COORD':
   if o.name=='Object':spaces.add('object');refs.add(n.object.name if n.object else '')
   elif o.name=='UV':spaces.add('uv')
   elif o.name=='Generated':spaces.add('generated')
   elif o.name in ['Normal','Reflection','Camera','Window']:return None,'View/normal dependent coordinate '+o.name
  if n.type=='UVMAP':spaces.add('uv')
  if n.type in ['TEX_NOISE','TEX_BRICK','TEX_WAVE','TEX_VORONOI'] and n.inputs.get('Vector') and not n.inputs['Vector'].is_linked:spaces.add('generated')
  if n.type=='NEW_GEOMETRY':
   if o.name=='Position':spaces.add('world')
   else:return None,'Geometry-dependent '+o.name
 if len(spaces)>1:return None,'Mixed coordinate spaces '+','.join(sorted(spaces))
 space=next(iter(spaces),'uv');size=[1.,1.];periodic=False
 bricks=[n for n,o in reach if n.type=='TEX_BRICK']
 noises=[n for n,o in reach if n.type=='TEX_NOISE']
 if bricks:
  n=bricks[0];scale=max(abs(n.inputs['Scale'].default_value),.0001)
  size=[4*n.inputs['Brick Width'].default_value/scale,4*n.inputs['Row Height'].default_value/scale]
  periodic=True
 elif space=='uv':
  for n,o in reach:
   if n.type=='MATH' and n.operation=='DIVIDE' and n.inputs[0].is_linked and not n.inputs[1].is_linked:
    link=n.inputs[0].links[0]
    if link.from_node.type=='SEPXYZ' and link.from_socket.name in ['X','Y']:
     # Four fundamental intervals, valid for FRACT (1) and PINGPONG (2).
     size[['X','Y'].index(link.from_socket.name)]=4*abs(n.inputs[1].default_value)
  periodic=any(n.type=='MATH' and n.operation in ['FRACT','PINGPONG'] for n,o in reach)
 elif noises and space!='generated':
  scales=[abs(n.inputs['Scale'].default_value) for n in noises if not n.inputs['Scale'].is_linked and abs(n.inputs['Scale'].default_value)>1e-6]
  span=8/min(scales) if scales else 4.;size=[span,span]
 if space=='generated':size=[1.,1.]
 size=[max(.01,x) for x in size]
 result={'space':space,'projection':'uv' if space=='uv' else 'triplanar','tileSize':size,'repeat':[1/x for x in size],'offset':[0,0],'wrap':'repeat','blenderAxes':space!='uv','sourcePlane':'xy-z0','periodicSourcePattern':periodic,'uvFromGltf':{'scale':[1,-1],'offset':[0,1]} if space=='uv' else None}
 if refs- {''}:
  if len(refs)>1:return None,'Multiple Texture Coordinate reference objects'
  ref=bpy.data.objects[next(iter(refs))];result['worldThreeToReferenceObjectBlender']=matlist(ref.matrix_world.inverted_safe()@C.inverted())
 return result,None
def priority(name):
 n=name.lower()
 if any(x in n for x in ['asphalt','lawn','grass','mapped plaza','pedestrian paving','mineral base','variegated']):return 0
 if any(x in n for x in ['facade','mineral wall','commercial envelope']):return 1
 if any(x in n for x in ['civic roof','clay roof','roof tile','pale stone']):return 2
 return 3
for city in cities:
 folder=BASE/'public/cities'/city;manifest=json.load(open(folder/'city.json'))
 bpy.ops.wm.open_mainfile(filepath=manifest['source']['path']);source_scene=bpy.context.scene;source_scene.frame_set(1)
 output=folder/'material-detail';output.mkdir(exist_ok=True)
 exported=exported_materials(folder)
 result={'version':1,'coordinateSystem':'original-blender-z-up','objectTransforms':'object-transforms.json','sourceGraphs':'material-detail/source-graphs.json','resolution':RES,'materials':{},'excluded':[],'limitations':['Original Cycles shader channel values are sampled on a planar patch. Repeated 3D noise uses original graph and physical frequency, but is not globally phase-identical to unbounded original noise.','Triplanar reconstruction is approximate on curved and oblique surfaces. UV periodic facade masks retain source periods; sampled normal derivatives are resolution dependent.','Original image textures are preserved and not replaced. View-dependent glass, light paths, true displacement and volume shading are not reconstructed.','Mixed image/procedural chains are left on the existing image material path; this bake pass does not reproduce their additional modulation.','PNG maps are 8-bit per channel. Very weak micro-normal deviations can quantize; material-node thresholds are sampled at finite resolution.']}
 if metalness_only:result=json.load(open(folder/'spatial-materials.json'))
 # Coordinate transforms work on actual world position and remain valid even when export baked object transforms.
 objects={}
 original_audit=json.load(open(BASE/'audit'/f'{city}.json'))
 for row in original_audit['objects']:
  o=bpy.data.objects.get(row['name'])
  if not o:continue
  coords=[Vector(c) for c in o.bound_box]
  objects[o.name]={'worldThreeToObjectBlender':matlist(o.matrix_world.inverted_safe()@C.inverted()),'generatedBounds':{'min':[min(c[i] for c in coords) for i in range(3)],'max':[max(c[i] for c in coords) for i in range(3)]}}
 if not metalness_only:write(folder/'object-transforms.json',{'version':1,'matrixLayout':'column-major','input':'world Three.js xyz','output':'original object Blender xyz','objects':objects})
 # Dedicated CPU render scene with one plane. Source lights and geometry are not copied.
 bake=bpy.data.scenes.new('Procedural channel sampling');bake.render.engine='CYCLES';bake.cycles.device='CPU';bake.cycles.samples=1;bake.cycles.use_denoising=False;bake.cycles.max_bounces=0
 bake.render.resolution_x=RES;bake.render.resolution_y=RES;bake.render.resolution_percentage=100;bake.render.image_settings.file_format='PNG';bake.render.image_settings.color_mode='RGB';bake.render.image_settings.color_depth='8';bake.render.film_transparent=False
 bake.render.filter_size=.5;bake.render.dither_intensity=0;bake.view_settings.look='None';bake.view_settings.exposure=0;bake.view_settings.gamma=1;bake.render.image_settings.compression=25
 mesh=bpy.data.meshes.new('Sampling patch mesh');mesh.from_pydata([(0,0,0),(1,0,0),(1,1,0),(0,1,0)],[],[(0,1,2,3)]);mesh.uv_layers.new(name='UVMap');plane=bpy.data.objects.new('Sampling patch',mesh);bake.collection.objects.link(plane)
 camd=bpy.data.cameras.new('Sampling camera');camd.type='ORTHO';camd.sensor_fit='HORIZONTAL';cam=bpy.data.objects.new('Sampling camera',camd);bake.collection.objects.link(cam);cam.rotation_euler=(0,0,0);bake.camera=cam
 graphs=json.load(open(output/'source-graphs.json')) if metalness_only else {};rendered=0;reused=0
 for name in sorted(exported,key=lambda n:(priority(n),n)):
  original=bpy.data.materials.get(name)
  if not original or not original.use_nodes:continue
  principal=next((n for n in original.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
  if not principal:continue
  entry=result['materials'].get(name,{'maps':{},'sourceMaterial':name}) if metalness_only else {'maps':{},'sourceMaterial':name};pbr=exported[name].get('pbrMetallicRoughness',{})
  channels=[('metalness','Metallic')] if metalness_only else [('baseColor','Base Color'),('roughness','Roughness'),('metalness','Metallic'),('normal','Normal')]
  for channel,input_name in channels:
   sock=principal.inputs.get(input_name)
   if not sock or not sock.is_linked:continue
   if upstream_has_image(sock) or (channel=='baseColor' and 'baseColorTexture' in pbr) or (channel in ['roughness','metalness'] and 'metallicRoughnessTexture' in pbr):continue
   mapping,reason=describe_mapping(sock)
   if not mapping:result['excluded'].append({'material':name,'channel':channel,'reason':reason});continue
   graph=nodegraph(sock);graphs.setdefault(name,{})[channel]=graph
   digest=hashlib.sha256(json.dumps({'graph':graph,'mapping':mapping,'channel':channel,'resolution':RES,'projectionVersion':3},sort_keys=True).encode()).hexdigest()[:16]
   filename=f'{digest}-{channel}.png';path=output/filename
   size=mapping['tileSize'];record={'url':'material-detail/'+filename,'colorSpace':'srgb' if channel=='baseColor' else 'none','resolution':[RES,RES],'textureFlipY':True,'mapping':mapping,'replaceFactor':True,'sourceGraphHash':digest,'sourceRoot':{'node':sock.links[0].from_node.name,'socket':sock.links[0].from_socket.name},'sampling':{'engine':'Cycles CPU','samples':1,'patchBlenderBounds':[[0,0,0],[size[0],size[1],0]]}}
   if channel=='normal':record['normalConvention']='OpenGL +Y';record['normalScale']=[1,1]
   if not path.exists():
    temp=original.copy();temp.name='BAKE '+digest;tree=temp.node_tree;p=next(n for n in tree.nodes if n.type=='BSDF_PRINCIPLED');value=p.inputs[input_name].links[0].from_socket
    outnode=next((n for n in tree.nodes if n.type=='OUTPUT_MATERIAL' and n.is_active_output),None)
    if outnode is None:outnode=tree.nodes.new('ShaderNodeOutputMaterial')
    emission=tree.nodes.new('ShaderNodeEmission');emission.inputs['Strength'].default_value=1
    if channel=='normal':
     # On the XY patch world and tangent axes are equal. Encode normal in OpenGL +Y convention.
     mul=tree.nodes.new('ShaderNodeVectorMath');mul.operation='SCALE';mul.inputs['Scale'].default_value=.5;tree.links.new(value,mul.inputs[0]);add=tree.nodes.new('ShaderNodeVectorMath');add.operation='ADD';add.inputs[1].default_value=(.5,.5,.5);tree.links.new(mul.outputs['Vector'],add.inputs[0]);value=add.outputs['Vector']
    tree.links.new(value,emission.inputs['Color']);tree.links.new(emission.outputs[0],outnode.inputs['Surface'])
    for link in list(outnode.inputs['Volume'].links):tree.links.remove(link)
    for link in list(outnode.inputs['Displacement'].links):tree.links.remove(link)
    mesh.materials.clear();mesh.materials.append(temp)
    for vertex,co in zip(mesh.vertices,[(0,0,0),(size[0],0,0),(size[0],size[1],0),(0,size[1],0)]):vertex.co=co
    for poly in mesh.polygons:
     for li in poly.loop_indices:
      v=mesh.vertices[mesh.loops[li].vertex_index].co;mesh.uv_layers.active.data[li].uv=(v.x,v.y)
    mesh.update();cam.location=(size[0]/2,size[1]/2,max(size)*3);camd.ortho_scale=size[0];camd.clip_end=max(size)*10;camd.clip_start=.001
    # Render aspect is adjusted through pixel aspect, preserving square pixel data domain in each UV direction.
    bake.render.pixel_aspect_x=size[0]/min(size);bake.render.pixel_aspect_y=size[1]/min(size)
    bake.view_settings.view_transform='Standard' if channel=='baseColor' else 'Raw'
    bake.render.filepath=str(path)
    print('SPATIAL_BAKE',city,name,channel,'size',size,'file',filename,flush=True)
    bpy.ops.render.render(write_still=True,scene=bake.name)
    mesh.materials.clear();bpy.data.materials.remove(temp);rendered+=1
   else:reused+=1
   record['bytes']=path.stat().st_size;entry['maps'][channel]=record
  if entry['maps']:result['materials'][name]=entry
  if not metalness_only:
   write(folder/'spatial-materials.json',result)
   write(output/'source-graphs.json',graphs)
 if metalness_only:
  write(folder/'spatial-materials.json',result)
  write(output/'source-graphs.json',graphs)
 latest=json.load(open(folder/'city.json'));latest.setdefault('files',{})['spatialMaterials']='spatial-materials.json';latest['files']['objectTransforms']='object-transforms.json';latest.setdefault('fidelity',{})['spatialMaterialBakes']={'materials':len(result['materials']),'resolution':RES,'limitations':result['limitations']};write(folder/'city.json',latest)
 print('SPATIAL_COMPLETE',city,'materials',len(result['materials']),'rendered',rendered,'reused',reused,'excluded',len(result['excluded']),flush=True)
