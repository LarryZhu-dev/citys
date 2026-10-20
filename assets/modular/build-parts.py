"""Extract generated front-elevation parts. Does not synthesize replacement art."""
from pathlib import Path
from PIL import Image
from scipy.ndimage import label, find_objects, binary_dilation
import numpy as np
import json

ROOT=Path(__file__).resolve().parent
MATERIALS=['roof-tiles','wall-plaster','wall-brick','foundation-stone','wood-planks','awning-cloth']
STRUCTURES=['column-red','column-wood','beam-red','beam-wood','dougong','roof-ridge','window-lattice','door-double','door-wood','kiln-mouth','roof-corner','wood-railing']
PEOPLE=['head','torso','upper-arm','forearm','thigh','shin','shoe','hammer','hoe','pole','basket','hat']
# Normalized pivots and distal joints were checked against the generated pieces.
JOINTS={
 'head':{'anchor':[.50,.91],'tip':[.50,.11],'worldSize':[.18,.24]},
 'torso':{'anchor':[.50,.10],'tip':[.50,.92],'worldSize':[.29,.35],'shoulderL':[.17,.21],'shoulderR':[.83,.21],'hipL':[.35,.87],'hipR':[.65,.87]},
 'upper-arm':{'anchor':[.52,.12],'tip':[.47,.90],'worldSize':[.10,.21]},
 'forearm':{'anchor':[.47,.10],'tip':[.52,.90],'worldSize':[.08,.22]},
 'thigh':{'anchor':[.50,.10],'tip':[.59,.91],'worldSize':[.12,.25]},
 'shin':{'anchor':[.49,.10],'tip':[.61,.92],'worldSize':[.09,.24]},
 'shoe':{'anchor':[.24,.23],'tip':[.88,.75],'worldSize':[.15,.08]},
 'hammer':{'anchor':[.50,.77],'tip':[.50,.16],'worldSize':[.12,.26]},
 'hoe':{'anchor':[.71,.28],'tip':[.15,.88],'worldSize':[.36,.34]},
 'pole':{'anchor':[.50,.50],'tip':[.96,.50],'worldSize':[.75,.05]},
 'basket':{'anchor':[.50,.10],'tip':[.50,.87],'worldSize':[.19,.21]},
 'hat':{'anchor':[.50,.67],'tip':[.50,.12],'worldSize':[.27,.13]}
}
manifest={'schemaVersion':1,'parts':{},'coordinateSystem':'orthographic-front','sourceImageEditing':'crop and pack only; generated original pixels retained'}
def save_part(name,im,atlas,rect,kind,extra=None):
 filename=name.replace('/','-')+'.webp'
 path=ROOT/'parts'/filename
 if kind=='material':im.convert('RGB').save(path,'WEBP',quality=97,method=4)
 else:im.save(path,'WEBP',lossless=True,method=4,exact=True)
 data={'name':name,'file':'parts/'+filename,'width':im.width,'height':im.height,'sourceRect':[0,0,im.width,im.height],'originalAtlas':'originals/'+atlas+'.png','atlasRect':[int(x) for x in rect],'kind':kind,'anchor':[.5,.5]}
 if kind=='material':data.update(repeatMode='mirror',sourceSeamless=False)
 if extra:data.update(extra)
 manifest['parts'][name]=data

texture=Image.open(ROOT/'originals'/'materials.png')
for i,name in enumerate(MATERIALS):
 x=(i%3)*512;y=(i//3)*512
 save_part(name,texture.crop((x,y,x+512,y+512)),'materials',[x,y,512,512],'material')

for atlas,names in [('architecture',STRUCTURES),('people',PEOPLE)]:
 im=Image.open(ROOT/'originals'/f'{atlas}.png').convert('RGBA');pixels=np.array(im)
 components,n=label(pixels[:,:,3]>20)
 objects=[]
 for idx,box in enumerate(find_objects(components)):
  if box is None:continue
  if (components[box]==idx+1).sum()<500:continue
  ys,xs=box
  objects.append({'id':idx+1,'box':box,'x':(xs.start+xs.stop)/2,'y':(ys.start+ys.stop)/2})
 assert len(objects)==12,(atlas,len(objects))
 objects.sort(key=lambda o:o['y']);ordered=[]
 for row in range(3):ordered.extend(sorted(objects[row*4:row*4+4],key=lambda o:o['x']))
 for name,obj in zip(names,ordered):
  mask=binary_dilation(components==obj['id'],iterations=2)
  yy,xx=np.where(mask);x0=max(0,int(xx.min())-2);x1=min(im.width,int(xx.max())+3);y0=max(0,int(yy.min())-2);y1=min(im.height,int(yy.max())+3)
  crop=pixels[y0:y1,x0:x1].copy();crop[:,:,3]=np.where(mask[y0:y1,x0:x1],crop[:,:,3],0)
  part=Image.fromarray(crop)
  key='people/'+name if atlas=='people' else name
  save_part(key,part,atlas,[x0,y0,x1-x0,y1-y0],'rig' if atlas=='people' else 'structure',JOINTS.get(name) if atlas=='people' else None)
(ROOT/'parts.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print('Extracted',len(manifest['parts']),'parts.')
