"""Mechanical alpha extraction; one shared RGBA atlas, fixed feet/axle anchors."""
from pathlib import Path
from PIL import Image
from scipy.ndimage import label,find_objects,binary_dilation
import numpy as np
import json

SOURCE=Path(__file__).resolve().parent
OUTPUT=SOURCE.parent
CELL=352
atlas=Image.new('RGBA',(CELL*8,CELL*6))
metadata={'schema':1,'atlas':'res://art/citizens/logistics-atlas.webp','cell_size':[CELL,CELL],'directions':['northwest','northeast','southwest','southeast'],'sprites':{}}

def components(path,count):
 image=Image.open(path).convert('RGBA');pixels=np.array(image)
 labels,_=label(pixels[:,:,3]>24);objects=[]
 for index,bounds in enumerate(find_objects(labels)):
  if bounds is None or (labels[bounds]==index+1).sum()<1000:continue
  ys,xs=bounds;objects.append((index+1,(ys.start+ys.stop)/2,(xs.start+xs.stop)/2))
 assert len(objects)==count,(path,len(objects))
 objects.sort(key=lambda item:item[1]);ordered=[]
 for row in range(count//4):ordered.extend(sorted(objects[row*4:row*4+4],key=lambda item:item[2]))
 crops=[]
 for component,_,_ in ordered:
  mask=binary_dilation(labels==component,iterations=1)
  yy,xx=np.where(mask);x0=int(xx.min());y0=int(yy.min());x1=int(xx.max())+1;y1=int(yy.max())+1
  crop=pixels[y0:y1,x0:x1].copy();crop[:,:,3]=np.where(mask[y0:y1,x0:x1],crop[:,:,3],0);crop[crop[:,:,3]==0,:3]=0
  crops.append((Image.fromarray(crop),[x0,y0,x1-x0,y1-y0]))
 return crops

def put(key,icon,index,pivot,extra=None):
 column=index%8;row=index//8
 offset=(round(CELL/2-pivot[0]),round(324-pivot[1]))
 assert min(offset)>=0 and offset[0]+icon.width<=CELL and offset[1]+icon.height<=CELL,(key,icon.size,offset)
 atlas.alpha_composite(icon,(column*CELL+offset[0],row*CELL+offset[1]))
 entry={'rect':[column*CELL,row*CELL,CELL,CELL],'pivot':[CELL/2,324],'content_rect':[offset[0],offset[1],icon.width,icon.height]}
 if extra:entry.update(extra)
 metadata['sprites'][key]=entry

people=components(SOURCE/'logistics-people-original.png',16)
bucket_centers=[[(91,146),(265,198)],[(400,197),(568,149)],[(701,189),(878,146)],[(1009,145),(1180,189)],[(86,439),(274,507)],[(391,508),(570,440)],[(697,501),(880,442)],[(1000,441),(1181,503)]]
for index,(icon,source_rect) in enumerate(people):
 row=index//4;direction=index%4;role='water' if row<2 else 'merchant';frame=row%2
 # The feet remain on the same ground point while the pose changes.
 put(f'{role}/{direction}/{frame}',icon,index,[icon.width/2,icon.height-1],{'source_rect':source_rect,'world_scale':.10})
 if role=='water':
  entry=metadata['sprites'][f'{role}/{direction}/{frame}'];ox,oy,_,_=entry['content_rect']
  entry['buckets']=[[ox+x-source_rect[0],oy+y-source_rect[1]]for x,y in bucket_centers[index]]

vehicles=components(SOURCE/'logistics-vehicles-original.png',16)
wheel_centers=[(183,278,27,45),(474,280,27,45),(867,227,25,42),(1008,225,25,42),(183,583,27,45),(476,587,27,45),(869,542,25,42),(1008,540,25,42),(181,844,24,36),(476,847,24,36),(805,845,23,35),(1061,846,23,35),(181,1104,24,36),(476,1104,24,36),(805,1107,23,35),(1061,1105,23,35)]
for index,(icon,source_rect) in enumerate(vehicles):
 row=index//4;direction=index%4;kind='horse' if row<2 else 'handcart';loaded=row%2
 put(f'{kind}/{direction}/{loaded}',icon,index+16,[icon.width/2,icon.height*.93],{'source_rect':source_rect,'world_scale':.17 if kind=='horse' else .125})
 entry=metadata['sprites'][f'{kind}/{direction}/{loaded}'];ox,oy,_,_=entry['content_rect'];wx,wy,rx,ry=wheel_centers[index]
 entry['wheel']=[ox+wx-source_rect[0],oy+wy-source_rect[1],rx,ry]

# Existing generated artisan walk frames are repacked into the same shared atlas.
# Its original generation and legacy extraction record are retained beside this script.
for direction in range(4):
 for frame in range(4):
  image=Image.open(OUTPUT/f'artisan-{direction}-{frame}.webp').convert('RGBA')
  pixels=np.array(image);mask=pixels[:,:,3]>24;labels,_=label(mask)
  objects=find_objects(labels);sizes=[(int((labels[b]==i+1).sum()),i+1) for i,b in enumerate(objects) if b is not None]
  largest=max(sizes)[1];keep=binary_dilation(labels==largest,iterations=1)
  pixels[:,:,3]=np.where(keep,pixels[:,:,3],0);pixels[pixels[:,:,3]==0,:3]=0
  image=Image.fromarray(pixels)
  put(f'artisan/{direction}/{frame}',image,32+direction*4+frame,[88,264],{'world_scale':.107142857})

pixels=np.array(atlas);pixels[pixels[:,:,3]==0,:3]=0
atlas=Image.fromarray(pixels)
# exact=True preserves the cleared transparent RGB; otherwise lossless WebP may
# invent invisible RGB blocks which some raw image viewers expose as artifacts.
atlas.save(OUTPUT/'logistics-atlas.webp',lossless=True,exact=True,method=6)
(OUTPUT/'logistics-atlas.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2)+'\n')
print('Packed',len(metadata['sprites']),'logistics sprites into',atlas.size)
