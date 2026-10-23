import bpy,json,sys
from mathutils import Vector
city=sys.argv[sys.argv.index('--')+1]
root='/Users/zstar/worldcity/city-explorer/audit/'
audit=json.load(open(root+city+'.json'))
points={'beijing':[('太和殿前广场',-560,700),('天安门前轴线',-540,100)],'shanghai':[('陆家嘴滨江步道',-380,200),('上海中心附近',500,-350),('东方明珠广场',80,250)],'shenzhen':[('平安金融中心东侧',-425,-707),('市民中心南广场',-50,170),('平安中心南侧前庭',-450,-800)],'guangzhou':[('广州塔南侧',0,-750),('花城广场',70,350),('海心沙北侧',0,40)]}[city]
results=[]
for name,x,y in points:
 hits=[]
 for row in audit['objects']:
  if audit['meshes'][row['mesh']]['users']>10: continue
  lo,hi=row['bounds']
  if not(lo[0]<=x<=hi[0] and lo[1]<=y<=hi[1]):continue
  o=bpy.data.objects.get(row['name'])
  if not o:continue
  inv=o.matrix_world.inverted_safe();origin=inv@Vector((x,y,1000));direction=(inv.to_3x3()@Vector((0,0,-1))).normalized()
  hit,loc,nor,index=o.ray_cast(origin,direction)
  if hit:
   world=o.matrix_world@loc
   normal=(o.matrix_world.to_3x3().inverted().transposed()@nor).normalized()
   hits.append({'object':o.name,'z':round(world.z,4),'normal_z':round(normal.z,4)})
 hits.sort(key=lambda h:h['z'],reverse=True)
 results.append({'name':name,'xy':[x,y],'hits':hits[:12]})
with open(root+city+'-spawns.json','w') as f:json.dump(results,f,ensure_ascii=False,indent=2)
print(json.dumps(results,ensure_ascii=False))
