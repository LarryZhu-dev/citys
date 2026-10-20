"""Pack generated icons and normalize generated nine-patch material borders."""
from pathlib import Path
from PIL import Image
from scipy.ndimage import label,find_objects,binary_dilation
import numpy as np
import json

SOURCE=Path(__file__).resolve().parent
OUTPUT=SOURCE.parent
CELL=384
GROUPS={
 'resources':['grain','veg','fruit','fish','meat','wood','stone','clay','copper','brick','pottery','cloth','bread','wine','gold','pop'],
 'actions':['build','road','world','view','menu','inventory','task','save','load','center','zoom-in','zoom-out','day','night','demolish','cancel'],
 'controls':['pause','play','settings','help','move','confirm','trade','export','import','new-city','checkbox-on','checkbox-off','overlay-water','overlay-pollution','speed','lock']
}
LABELS=dict(zip(GROUPS['resources'],['粮食','蔬菜','水果','鱼类','肉食','木材','石料','黏土','铜矿','砖块','陶器','布匹','面包','酒','金币','人口']))
LABELS.update(dict(zip(GROUPS['actions'],['营造','道路','世界','视野','菜单','仓库','任务','保存','读取','回城','放大','缩小','白昼','夜晚','拆除','取消'])))
LABELS.update(dict(zip(GROUPS['controls'],['暂停','继续','设置','帮助','迁移','确认','交易','导出','导入','新城','已勾选','未勾选','供水覆盖','污染覆盖','速度','未解锁'])))
manifest={'schema_version':1,'style':'Original hand-painted bronze, walnut and antique gold Chinese city-builder interface','origin':'Generated with image_gen.imagegen for this project; no third-party game artwork imported.','generation_record':'godot/art/ui/sources/ui-generation-record.json','atlases':{},'regions':{}}
OUTPUT.mkdir(parents=True,exist_ok=True)
for group,names in GROUPS.items():
 image=Image.open(SOURCE/f'ui-{group}-original.png').convert('RGBA')
 pixels=np.array(image);components,_=label(pixels[:,:,3]>20);objects=[]
 for index,bounds in enumerate(find_objects(components)):
  if bounds is None:continue
  if (components[bounds]==index+1).sum()<500:continue
  ys,xs=bounds
  objects.append({'id':index+1,'x':(xs.start+xs.stop)/2,'y':(ys.start+ys.stop)/2})
 assert len(objects)==16,(group,len(objects))
 objects.sort(key=lambda item:item['y']);ordered=[]
 for row in range(4):ordered.extend(sorted(objects[row*4:row*4+4],key=lambda item:item['x']))
 atlas=Image.new('RGBA',(CELL*4,CELL*4))
 for index,(name,item) in enumerate(zip(names,ordered)):
  mask=binary_dilation(components==item['id'],iterations=2)
  yy,xx=np.where(mask);x0=max(0,int(xx.min())-2);x1=min(image.width,int(xx.max())+3);y0=max(0,int(yy.min())-2);y1=min(image.height,int(yy.max())+3)
  crop=pixels[y0:y1,x0:x1].copy()
  crop[:,:,3]=np.where(mask[y0:y1,x0:x1],crop[:,:,3],0)
  crop[crop[:,:,3]==0,:3]=0
  icon=Image.fromarray(crop)
  assert max(icon.size)<=CELL-32,(name,icon.size)
  cell_x=(index%4)*CELL;cell_y=(index//4)*CELL
  offset_x=(CELL-icon.width)//2;offset_y=(CELL-icon.height)//2
  atlas.alpha_composite(icon,(cell_x+offset_x,cell_y+offset_y))
  manifest['regions'][name]={'atlas':group,'kind':'resource' if group=='resources' else 'action','label_zh':LABELS[name],'rect':[cell_x,cell_y,CELL,CELL],'content_rect':[cell_x+offset_x,cell_y+offset_y,icon.width,icon.height],'source_rect':[x0,y0,x1-x0,y1-y0],'native_size':[icon.width,icon.height],'pivot':[.5,.5]}
 atlas.save(OUTPUT/f'{group}.png',optimize=True)
 manifest['atlases'][group]={'path':f'res://art/ui/{group}.png','cell_size':[CELL,CELL],'columns':4,'rows':4,'size':[CELL*4,CELL*4],'alpha':True,'order':names}
 print(group,len(names),'icons packed',atlas.size)

# Border thickness is normalized by nine-patch resampling, without painting
# replacement pixels. The untouched generation remains in this directory.
PANEL_SLICES={'paper':(68,32),'wood':(64,24),'card':(48,16),'red':(56,20)}
panel_source=SOURCE/'ui-panels-original.png'
if panel_source.exists():
 image=Image.open(panel_source).convert('RGBA')
 pixels=np.array(image);components,_=label(pixels[:,:,3]>20);objects=[]
 for index,bounds in enumerate(find_objects(components)):
  if bounds is None:continue
  if (components[bounds]==index+1).sum()<10000:continue
  ys,xs=bounds
  objects.append({'id':index+1,'x':(xs.start+xs.stop)/2,'y':(ys.start+ys.stop)/2})
 assert len(objects)==4,len(objects)
 objects.sort(key=lambda item:item['y']);ordered=[]
 for row in range(2):ordered.extend(sorted(objects[row*2:row*2+2],key=lambda item:item['x']))
 manifest['panels']={}
 for name,item in zip(PANEL_SLICES,ordered):
  mask=binary_dilation(components==item['id'],iterations=1)
  yy,xx=np.where(mask);x0=max(0,int(xx.min()));x1=min(image.width,int(xx.max())+1);y0=max(0,int(yy.min()));y1=min(image.height,int(yy.max())+1)
  crop=pixels[y0:y1,x0:x1].copy()
  crop[:,:,3]=np.where(mask[y0:y1,x0:x1],crop[:,:,3],0)
  crop[crop[:,:,3]==0,:3]=0
  native=Image.fromarray(crop)
  source_margin,target_margin=PANEL_SLICES[name]
  sx=[0,source_margin,native.width-source_margin,native.width]
  sy=[0,source_margin,native.height-source_margin,native.height]
  target=[0,target_margin,512-target_margin,512]
  result=Image.new('RGBA',(512,512))
  for row in range(3):
   for col in range(3):
    patch=native.crop((sx[col],sy[row],sx[col+1],sy[row+1]))
    patch=patch.resize((target[col+1]-target[col],target[row+1]-target[row]),Image.Resampling.LANCZOS)
    result.alpha_composite(patch,(target[col],target[row]))
  result.save(OUTPUT/f'{name}.png',optimize=True)
  manifest['panels'][name]={'path':f'res://art/ui/{name}.png','size':[512,512],'slice_margins':[target_margin]*4,'source':'godot/art/ui/sources/ui-panels-original.png','source_rect':[x0,y0,x1-x0,y1-y0],'source_slice_margins':[source_margin]*4,'processing':'Connected-alpha crop and mechanical nine-patch border normalization; original generated image preserved.'}
  print(name,'nine-patch packed',(512,512),'margin',target_margin)
(OUTPUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print('Godot manifest ready:',OUTPUT/'manifest.json')
