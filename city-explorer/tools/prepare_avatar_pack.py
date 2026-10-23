"""Repack only opaque albedo as quality-95 JPEG; retain original 2K dimensions and all mesh/skin bytes."""
import struct,json,io,hashlib
from pathlib import Path
from PIL import Image
R=Path(__file__).resolve().parents[1];D=R/'public/characters/rocketbox-male-09';p=D/'tourist.glb'
with p.open('rb')as f:f.read(12);n,_=struct.unpack('<II',f.read(8));j=json.loads(f.read(n));n,_=struct.unpack('<II',f.read(8));binary=f.read(n)
replacements={};audit=[]
for mat in j['materials']:
 if mat.get('alphaMode','OPAQUE')!='OPAQUE':continue
 ti=mat.get('pbrMetallicRoughness',{}).get('baseColorTexture',{}).get('index')
 if ti is None:continue
 im=j['images'][j['textures'][ti]['source']];vi=im['bufferView'];v=j['bufferViews'][vi];src=binary[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']]
 image=Image.open(io.BytesIO(src)).convert('RGB');out=io.BytesIO();image.save(out,format='JPEG',quality=95,subsampling=0,optimize=True);replacements[vi]=out.getvalue();im['mimeType']='image/jpeg'
 audit.append({'material':mat['name'],'resolution':image.size,'originalBytes':len(src),'packedBytes':len(replacements[vi]),'encoding':'JPEG 95, 4:4:4'})
# KHR_materials_specular reads the alpha channel. FBX-imported gray RGB maps
# need explicit alpha packing; luminance-white is unused by this extension.
for mat in j['materials']:
 ti=mat.get('extensions',{}).get('KHR_materials_specular',{}).get('specularTexture',{}).get('index')
 if ti is None:continue
 im=j['images'][j['textures'][ti]['source']];vi=im['bufferView'];v=j['bufferViews'][vi];src=binary[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']]
 image=Image.open(io.BytesIO(src));alpha=image.getchannel('A') if 'A' in image.getbands() else image.getchannel('R')
 packed=Image.merge('LA',(Image.new('L',image.size,255),alpha));out=io.BytesIO();packed.save(out,format='PNG',optimize=True);replacements[vi]=out.getvalue();im['mimeType']='image/png'
 audit.append({'material':mat['name'],'resolution':image.size,'originalBytes':len(src),'packedBytes':len(replacements[vi]),'encoding':'Specular grayscale packed losslessly into alpha (KHR_materials_specular)'})
new=bytearray();untouched=0
for i,v in enumerate(j['bufferViews']):
 data=binary[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']];new.extend(b'\0'*((-len(new))%4));v['byteOffset']=len(new)
 if i in replacements:data=replacements[i]
 else:untouched+=1
 v['byteLength']=len(data);new.extend(data)
new.extend(b'\0'*((-len(new))%4));j['buffers'][0]['byteLength']=len(new);raw=json.dumps(j,separators=(',',':')).encode();raw+=b' '*((-len(raw))%4)
p.write_bytes(struct.pack('<III',0x46546c67,2,28+len(raw)+len(new))+struct.pack('<II',len(raw),0x4e4f534a)+raw+struct.pack('<II',len(new),0x004e4942)+new)
for report in [D/'rig.json',R/'audit/avatar-export.json']:
 r=json.loads(report.read_text());r['packing']={'albedo':audit,'unchangedBufferViews':untouched,'normalSpecularAlpha':'Lossless PNG; original dimensions'};r['bytes']=p.stat().st_size;r['sha256']=hashlib.sha256(p.read_bytes()).hexdigest();report.write_text(json.dumps(r,indent=2))
print('FINAL',p.stat().st_size,'bytes',audit)
