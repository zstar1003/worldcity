from pathlib import Path
import concurrent.futures,tarfile,json,hashlib
ROOT=Path(__file__).resolve().parents[1]
GROUPS={
 'source-beijing':['Beijing_Models_Engineering'],
 'source-shanghai':['Shanghai_V10_All_Projects'],
 'source-guangzhou':['广州_完整模型_3版本'],
 'source-shenzhen':['Shenzhen_Futian'],
 **{'browser-'+c:['city-explorer/public/cities/'+c] for c in ['beijing','shanghai','guangzhou','shenzhen']},
 'browser-shared':['city-explorer/public/characters','city-explorer/public/render'],
}
def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(8*1024*1024),b''):h.update(b)
 return h.hexdigest()
def pack(item):
 name,dirs=item;dest=ROOT/'archives'/f'{name}.tar.gz';files=[]
 with tarfile.open(dest,'w:gz',compresslevel=3) as archive:
  for folder in dirs:
   for p in sorted((ROOT/folder).rglob('*')):
    if not p.is_file() or p.name=='.DS_Store' or '__pycache__' in p.parts or p.suffix in {'.log','.pid','.mp4','.mkv','.pyc'}:continue
    rel=p.relative_to(ROOT).as_posix();files.append({'path':rel,'bytes':p.stat().st_size,'sha256':digest(p)})
    archive.add(p,arcname=rel,recursive=False)
 result={'archive':dest.relative_to(ROOT).as_posix(),'bytes':dest.stat().st_size,'sha256':digest(dest),'files':files}
 print(name,len(files),dest.stat().st_size,flush=True);return result
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor: results=list(executor.map(pack,GROUPS.items()))
(ROOT/'archives/manifest.json').write_text(json.dumps({'format':1,'archives':results},ensure_ascii=False,indent=2)+'\n')
print('TOTAL',sum(x['bytes'] for x in results),flush=True)
