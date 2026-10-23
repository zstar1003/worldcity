"""Read-only texture/mapping checks plus independent UV facade graph evaluation."""
import json,math,struct,hashlib
from pathlib import Path
from PIL import Image
import numpy as np
BASE=Path('/Users/zstar/worldcity/city-explorer')
def eval_graph(g,uv):
 if 'constant' in g:return g['constant']
 ns=g['type'];ins=g.get('inputs',[])
 def v(k):return eval_graph(ins[k]['value'],uv)
 if ns=='ShaderNodeTexCoord' and g['output']=='UV':return [uv[0],uv[1],0]
 if ns=='ShaderNodeSeparateXYZ':return v(0)[{'X':0,'Y':1,'Z':2}[g['output']]]
 if ns=='ShaderNodeMath':
  a=v(0);b=v(1);op=g['operation']
  ops={'DIVIDE':lambda:a/b,'FRACT':lambda:a-math.floor(a),'GREATER_THAN':lambda:float(a>b),'LESS_THAN':lambda:float(a<b),'MULTIPLY':lambda:a*b,'PINGPONG':lambda:abs(((a-b)%(2*b))-b),'ADD':lambda:a+b,'SUBTRACT':lambda:a-b}
  if op not in ops:raise ValueError(op)
  return ops[op]()
 if ns=='ShaderNodeMixRGB' and g['blend_type']=='MIX':
  fac=v(0);a=v(1);b=v(2);return [a[i]*(1-fac)+b[i]*fac for i in range(4)]
 if ns=='ShaderNodeMapRange':
  a,b,c,d,e=[v(i) for i in range(5)];t=(a-b)/(c-b)
  if g.get('clamp'):t=max(0,min(1,t))
  return d+(e-d)*t
 raise ValueError(ns)
def srgb(x):return 12.92*x if x<=.0031308 else 1.055*x**(1/2.4)-.055
report={}
for city in ['shenzhen','shanghai','beijing','guangzhou']:
 folder=BASE/'public/cities'/city;path=folder/'spatial-materials.json'
 if not path.exists():continue
 data=json.load(open(path));graphs=json.load(open(folder/data['sourceGraphs']));files={};comparisons=[]
 for name,material in data['materials'].items():
  for channel,desc in material['maps'].items():
   p=folder/desc['url'];assert p.exists(),p
   with Image.open(p) as im:
    assert im.size==tuple(desc['resolution']);a=np.asarray(im.resize((128,128)))
   files[desc['url']]={'bytes':p.stat().st_size,'minRGB':a.reshape(-1,3).min(0).tolist(),'maxRGB':a.reshape(-1,3).max(0).tolist(),'stdRGB':a.reshape(-1,3).std(0).round(5).tolist()}
   assert all(abs(desc['mapping']['tileSize'][i]*desc['mapping']['repeat'][i]-1)<1e-5 for i in range(2))
   if channel in ['baseColor','roughness','metalness'] and desc['mapping']['space']=='uv':
    image=np.asarray(Image.open(p));h,w=image.shape[:2];graph=graphs[name][channel];size=desc['mapping']['tileSize'];errors=[]
    try:
     for iy in [.07,.19,.33,.47,.62,.78,.93]:
      for ix in [.08,.22,.36,.51,.67,.81,.92]:
       x=int(ix*w);y=int(iy*h);uv=((x+.5)/w*size[0],(1-(y+.5)/h)*size[1]);value=eval_graph(graph,uv)
       if channel=='baseColor':rgb=[round(max(0,min(1,srgb(c)))*255) for c in value[:3]]
       else:rgb=[round(value*255)]*3
       errors.append(max(abs(int(image[y,x,i])-rgb[i]) for i in range(3)))
    except (ValueError,TypeError,KeyError):continue
    comparisons.append({'material':name,'channel':channel,'samples':len(errors),'max8BitError':max(errors),'mean8BitError':round(sum(errors)/len(errors),4)})
    assert max(errors)<=3,(city,name,channel,max(errors))
 report[city]={'materials':len(data['materials']),'uniqueTextures':len(files),'bytes':sum(x['bytes'] for x in files.values()),'textures':files,'independentFacadeChecks':comparisons,'excluded':data['excluded']}
 print(city,len(data['materials']),len(files),'facade checks',len(comparisons),flush=True)
(BASE/'audit/spatial-fidelity.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
