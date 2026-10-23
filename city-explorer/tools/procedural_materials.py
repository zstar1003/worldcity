"""Representative linear PBR values for Blender-only procedural graphs.
Does not sample, resize, replace, or override image albedo. Source .blend is never saved.
"""
import bpy, json, math, struct, colorsys
from pathlib import Path
class Unsupported(Exception):pass
class ImageInput(Exception):pass
def array(x):
 try:return tuple(float(i) for i in x)
 except TypeError:return float(x)
def scalar(x):return sum(x[:3])/min(3,len(x)) if isinstance(x,(list,tuple)) else float(x)
def color(x):return tuple(x[:4]) if isinstance(x,(list,tuple)) and len(x)>=4 else (tuple(x[:3])+(1.,) if isinstance(x,(list,tuple)) else (x,x,x,1.))
def clamp(x,lo=0.,hi=1.):return max(lo,min(hi,x))
def mix(a,b,t):
 if isinstance(a,(tuple,list)) or isinstance(b,(tuple,list)):
  a=color(a);b=color(b);return tuple(a[i]*(1-t)+b[i]*t for i in range(4))
 return a*(1-t)+b*t
class Evaluator:
 def __init__(self):self.path=[];self.approx=[];self.stack=set()
 def inp(self,node,key):
  try:s=node.inputs[key]
  except (KeyError,IndexError):raise Unsupported(node.bl_idname+' input '+str(key))
  return self.socket(s)
 def socket(self,s):
  if s.is_linked:return self.output(s.links[0].from_socket)
  if not hasattr(s,'default_value'):raise Unsupported('no default '+s.name)
  return array(s.default_value)
 def output(self,s):
  n=s.node;k=(n.as_pointer(),s.identifier)
  if k in self.stack:raise Unsupported('cycle')
  self.stack.add(k);self.path.append(n.name+':'+s.name)
  try:return self.node(n,s)
  finally:self.stack.remove(k)
 def node(self,n,s):
  t=n.type;v=lambda x:self.inp(n,x);f=lambda x:scalar(v(x))
  if t in {'TEX_IMAGE','TEX_ENVIRONMENT'}:raise ImageInput(n.name)
  if t=='VALUE':return float(n.outputs[0].default_value)
  if t=='RGB':return array(n.outputs[0].default_value)
  if t=='REROUTE':return v(0)
  if t=='VALTORGB':return tuple(n.color_ramp.evaluate(clamp(f('Fac')))) if s.name!='Alpha' else n.color_ramp.evaluate(clamp(f('Fac')))[3]
  if t in {'TEX_NOISE','TEX_VORONOI','TEX_MUSGRAVE','TEX_WHITE_NOISE','TEX_WAVE','TEX_MAGIC'}:
   self.approx.append(n.name+': procedural sample at representative factor 0.5')
   return (.5,.5,.5,1.) if s.type=='RGBA' else .5
  if t=='TEX_GRADIENT':self.approx.append(n.name+': gradient midpoint');return (.5,.5,.5,1.) if s.type=='RGBA' else .5
  if t=='TEX_CHECKER':self.approx.append(n.name+': area-average checker colors');return mix(v('Color1'),v('Color2'),.5) if s.name=='Color' else .5
  if t=='TEX_BRICK':
   a=v('Color1');b=v('Color2');m=v('Mortar');mw=clamp(f('Mortar Size')*4,0,.25)
   self.approx.append(n.name+': average two brick colors and estimated mortar coverage '+str(round(mw,4)))
   return mix(mix(a,b,.5),m,mw) if s.name=='Color' else mw
  if t=='MIX_RGB':
   fac=clamp(f(0));a=color(v(1));b=color(v(2));mode=n.blend_type
   if mode=='MIX':result=mix(a,b,fac)
   else:
    def blend(x,y):
     if mode=='MULTIPLY':return x*y
     if mode=='ADD':return x+y
     if mode=='SUBTRACT':return x-y
     if mode=='DIVIDE':return x/y if abs(y)>1e-10 else 0
     if mode=='SCREEN':return 1-(1-x)*(1-y)
     if mode=='OVERLAY':return 2*x*y if x<.5 else 1-2*(1-x)*(1-y)
     if mode=='SOFT_LIGHT':return (1-2*y)*x*x+2*y*x
     if mode=='DARKEN':return min(x,y)
     if mode=='LIGHTEN':return max(x,y)
     if mode=='DIFFERENCE':return abs(x-y)
     raise Unsupported('MixRGB '+mode)
    result=tuple(a[i]*(1-fac)+blend(a[i],b[i])*fac for i in range(3))+(a[3],)
   return tuple(clamp(x) for x in result) if n.use_clamp else result
  if t=='MIX':
   if n.data_type=='RGBA':return mix(v(6),v(7),clamp(f(0)))
   if n.data_type=='FLOAT':return mix(v(2),v(3),clamp(f(0)))
   if n.data_type=='VECTOR':return mix(v(4),v(5),clamp(f(0)))
  if t=='MAP_RANGE':
   x=f('Value');a=f('From Min');b=f('From Max');lo=f('To Min');hi=f('To Max');u=(x-a)/(b-a) if abs(b-a)>1e-10 else 0
   if n.clamp:u=clamp(u)
   if n.interpolation_type=='SMOOTHSTEP':u=clamp(u);u=u*u*(3-2*u)
   if n.interpolation_type=='SMOOTHERSTEP':u=clamp(u);u=u*u*u*(u*(u*6-15)+10)
   return lo+(hi-lo)*u
  if t=='MATH':
   a=f(0);b=f(1) if len(n.inputs)>1 else 0;c=f(2) if len(n.inputs)>2 else 0;op=n.operation
   ops={'ADD':lambda:a+b,'SUBTRACT':lambda:a-b,'MULTIPLY':lambda:a*b,'DIVIDE':lambda:a/b if abs(b)>1e-10 else 0,'MULTIPLY_ADD':lambda:a*b+c,'POWER':lambda:a**b if a>=0 or b.is_integer() else 0,'MINIMUM':lambda:min(a,b),'MAXIMUM':lambda:max(a,b),'LESS_THAN':lambda:float(a<b),'GREATER_THAN':lambda:float(a>b),'COMPARE':lambda:float(abs(a-b)<=c),'ABSOLUTE':lambda:abs(a),'FLOOR':lambda:math.floor(a),'CEIL':lambda:math.ceil(a),'ROUND':lambda:math.floor(a+.5),'FRACT':lambda:a-math.floor(a),'MODULO':lambda:a%b if b else 0,'FLOORED_MODULO':lambda:a%b if b else 0,'TRUNC':lambda:math.trunc(a),'SINE':lambda:math.sin(a),'COSINE':lambda:math.cos(a),'TANGENT':lambda:math.tan(a),'SQRT':lambda:math.sqrt(max(a,0)),'EXPONENT':lambda:math.exp(min(a,80)),'SIGN':lambda:1 if a>0 else -1 if a<0 else 0,'PINGPONG':lambda:abs(((a-b)%(2*b))-b) if b else 0}
   if op not in ops:raise Unsupported('Math '+op)
   r=ops[op]();return clamp(r) if n.use_clamp else r
  if t in {'SEPXYZ','SEPARATE_XYZ'}:return color(v(0))[{'X':0,'Y':1,'Z':2}[s.name]]
  if t in {'SEPRGB','SEPARATE_COLOR'}:return color(v(0))[{'R':0,'Red':0,'G':1,'Green':1,'B':2,'Blue':2,'Alpha':3}[s.name]]
  if t in {'COMBXYZ','COMBINE_XYZ'}:return (f(0),f(1),f(2))
  if t in {'COMBRGB','COMBINE_COLOR'}:return (f(0),f(1),f(2),1.)
  if t=='RGBTOBW':c=color(v(0));return .2126*c[0]+.7152*c[1]+.0722*c[2]
  if t=='INVERT':c=color(v('Color'));return mix(c,tuple(1-x for x in c[:3])+(c[3],),f('Fac'))
  if t=='GAMMA':c=color(v('Color'));return tuple(max(0,x)**f('Gamma') for x in c[:3])+(c[3],)
  if t=='HUE_SAT':
   c=color(v('Color'));h,sat,val=colorsys.rgb_to_hsv(*c[:3]);rgb=colorsys.hsv_to_rgb((h+f('Hue')-.5)%1,sat*f('Saturation'),val*f('Value'));return mix(c,tuple(rgb)+(c[3],),f('Fac'))
  if t=='CLAMP':return clamp(f(0),f(1),f(2))
  if t=='TEX_COORD':self.approx.append(n.name+': representative texture coordinates');return (.5,.5,.5) if s.name=='Generated' else (0.,0.,0.)
  if t=='NEW_GEOMETRY':self.approx.append(n.name+': representative surface normal/position');return (0.,0.,1.) if 'Normal' in s.name else ((0.,0.,0.) if s.type=='VECTOR' else .5)
  if t=='FRESNEL':self.approx.append(n.name+': representative normal-incidence Fresnel');ior=f('IOR');return ((ior-1)/(ior+1))**2
  raise Unsupported(n.bl_idname+' '+s.name)
def upstream_has_image(s,seen=None):
 seen=set() if seen is None else seen
 if not s.is_linked:return False
 n=s.links[0].from_node
 if n.as_pointer() in seen:return False
 seen.add(n.as_pointer())
 if n.type in {'TEX_IMAGE','TEX_ENVIRONMENT'}:return True
 if n.type=='GROUP' and n.node_tree and any(x.type in {'TEX_IMAGE','TEX_ENVIRONMENT'} for x in n.node_tree.nodes):return True
 return any(upstream_has_image(i,seen) for i in n.inputs if i.is_linked)
def exported_materials(folder):
 mats={}
 for name in ['architecture.glb','foliage.glb']:
  p=Path(folder)/name
  if not p.exists():continue
  with p.open('rb') as f:f.read(12);size,t=struct.unpack('<II',f.read(8));g=json.loads(f.read(size))
  for m in g.get('materials',[]):mats[m['name']]=m
 return mats
def generate_material_sidecar(folder,objects=None,apply_fallbacks=False):
 folder=Path(folder);gltf=exported_materials(folder)
 mats={s.material.name:s.material for o in objects for s in o.material_slots if s.material} if objects is not None else {m.name:m for m in bpy.data.materials if m.name in gltf}
 result={};skipped=[];pending=[]
 for name,m in mats.items():
  if not m.use_nodes:continue
  principal=next((n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
  if not principal:continue
  record={'source':{}}
  for field,key in [('baseColor','Base Color'),('roughness','Roughness'),('metalness','Metallic')]:
   s=principal.inputs.get(key)
   if not s or not s.is_linked:continue
   pbr=gltf.get(name,{}).get('pbrMetallicRoughness',{})
   if upstream_has_image(s) or (field=='baseColor' and 'baseColorTexture' in pbr) or (field in {'roughness','metalness'} and 'metallicRoughnessTexture' in pbr):
    skipped.append({'material':name,'field':field,'reason':'image texture preserved'});continue
   e=Evaluator()
   try:
    val=e.socket(s);val=list(color(val)) if field=='baseColor' else clamp(scalar(val))
    if field=='baseColor':val=[clamp(x) for x in val]
    record[field]=val;record['source'][field]={'path':e.path,'approximation':list(dict.fromkeys(e.approx)) or ['constant procedural arithmetic evaluated exactly']};pending.append((m,s,val))
   except (Unsupported,ImageInput,ValueError,OverflowError,ZeroDivisionError) as exc:skipped.append({'material':name,'field':field,'reason':str(exc)})
  if len(record)>1:result[name]=record
 if apply_fallbacks:
  for m,s,val in pending:
   for link in list(s.links):m.node_tree.links.remove(link)
   s.default_value=val
 data={'version':1,'colorSpace':'linear-srgb','approximation':'Representative procedural values; no spatial bake. Original image texture inputs are not overridden.','materials':result,'skipped':skipped}
 with (folder/'materials.json').open('w') as f:json.dump(data,f,ensure_ascii=False,separators=(',',':'))
 return data
