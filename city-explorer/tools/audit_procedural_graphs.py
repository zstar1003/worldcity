import bpy,json,sys
from pathlib import Path
base=Path('/Users/zstar/worldcity/city-explorer');sys.path.insert(0,str(base/'tools'))
from procedural_materials import exported_materials,upstream_has_image
for city in ['shenzhen','shanghai','beijing','guangzhou']:
 folder=base/'public/cities'/city;m=json.load(open(folder/'city.json'));bpy.ops.wm.open_mainfile(filepath=m['source']['path'])
 exported=exported_materials(folder);result=[]
 for name in exported:
  mat=bpy.data.materials.get(name)
  if not mat or not mat.use_nodes:continue
  p=next((n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
  if not p:continue
  inputs={}
  for field in ['Base Color','Roughness','Normal']:
   s=p.inputs.get(field)
   if not s or not s.is_linked or upstream_has_image(s):continue
   reachable={}
   def walk(sock):
    if not sock.is_linked:return
    n=sock.links[0].from_node
    if n.name in reachable:return
    row={'type':n.bl_idname,'output':sock.links[0].from_socket.name,'inputs':[]}
    for attr in ['operation','noise_dimensions','noise_type','normalize','blend_type','vector_type','offset','offset_frequency','squash','squash_frequency','invert']:
     if hasattr(n,attr):row[attr]=getattr(n,attr)
    if n.type=='VALTORGB':row['color_ramp']=[{'position':e.position,'color':list(e.color)} for e in n.color_ramp.elements]
    reachable[n.name]=row
    for index,i in enumerate(n.inputs):
     item={'index':index,'name':i.name,'identifier':i.identifier}
     if i.is_linked:item['link']={'node':i.links[0].from_node.name,'socket':i.links[0].from_socket.name};walk(i)
     elif hasattr(i,'default_value'):
      try:item['value']=list(i.default_value)
      except TypeError:item['value']=i.default_value
     row['inputs'].append(item)
   walk(s);inputs[field]={'root':[s.links[0].from_node.name,s.links[0].from_socket.name],'nodes':reachable}
  if inputs:result.append({'name':name,'channels':inputs})
 (base/'audit'/f'{city}-procedural-graphs.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
 print('GRAPHS',city,len(result),flush=True)
