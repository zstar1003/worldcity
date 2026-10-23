import bpy,sys,json
from pathlib import Path
base=Path('/Users/zstar/worldcity/city-explorer');sys.path.insert(0,str(base/'tools'))
from procedural_materials import generate_material_sidecar
for city in ['shenzhen','shanghai','beijing','guangzhou']:
 folder=base/'public/cities'/city;manifest=json.load(open(folder/'city.json'));bpy.ops.wm.open_mainfile(filepath=manifest['source']['path'])
 data=generate_material_sidecar(folder)
 manifest['files']['materials']='materials.json'
 manifest['fidelity']['proceduralFallback']='materials.json restores linked non-image procedural base colors and scalar PBR values as representative linear colors; does not recreate spatial patterns.'
 manifest['filesBytes']['materials.json']=(folder/'materials.json').stat().st_size
 with (folder/'city.json').open('w') as f:json.dump(manifest,f,ensure_ascii=False,separators=(',',':'))
 print('MATERIAL_SIDECAR',city,len(data['materials']),len(data['skipped']),flush=True)
