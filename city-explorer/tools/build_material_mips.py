"""Generate streaming levels from original-node bakes, preserving 2K masters.
Color mips filter in linear light; normal mips are averaged and renormalized.
"""
import json,sys
from pathlib import Path
from PIL import Image
import numpy as np
BASE=Path('/Users/zstar/worldcity/city-explorer')
def write(path,value):
 t=path.with_suffix('.json.tmp');t.write_text(json.dumps(value,ensure_ascii=False,separators=(',',':')));t.replace(path)
def resize_channels(values,size):
 return np.stack([np.asarray(Image.fromarray(values[:,:,i].astype(np.float32),mode='F').resize((size,size),Image.Resampling.LANCZOS)) for i in range(3)],axis=2)
for city in sys.argv[1:] or ['shenzhen','shanghai','beijing','guangzhou']:
 folder=BASE/'public/cities'/city;path=folder/'spatial-materials.json';data=json.load(open(path));cache={}
 for material in data['materials'].values():
  for channel,map in material['maps'].items():
   url=map['url']
   if url not in cache:
    source=folder/url;im=np.asarray(Image.open(source)).astype(np.float32)/255
    if channel=='baseColor':values=np.where(im<=.04045,im/12.92,((im+.055)/1.055)**2.4)
    elif channel=='normal':values=im*2-1
    else:values=im
    levels=[]
    for size in [256,1024]:
     name=source.with_name(source.stem+f'-{size}.png')
     if not name.exists():
      small=resize_channels(values,size)
      if channel=='baseColor':
       small=np.maximum(small,0);small=np.where(small<=.0031308,small*12.92,1.055*small**(1/2.4)-.055)
      elif channel=='normal':small=small/np.maximum(np.linalg.norm(small,axis=2,keepdims=True),1e-6)*.5+.5
      small=np.rint(np.clip(small,0,1)*255).astype(np.uint8);Image.fromarray(small).save(name,compress_level=6)
     levels.append({'url':str(name.relative_to(folder)),'resolution':[size,size],'bytes':name.stat().st_size})
    levels.append({'url':url,'resolution':map['resolution'],'bytes':source.stat().st_size})
    cache[url]=levels
   map['levels']=cache[url]
 # Publish the complete level description atomically, avoiding repeated reloads of an existing city.
 write(path,data)
 print('MIPS_COMPLETE',city,len(cache),'textures',flush=True)
