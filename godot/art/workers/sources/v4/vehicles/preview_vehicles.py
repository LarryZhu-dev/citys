"""Review only: reproduce the Godot sprite transform without altering source art."""
from pathlib import Path
import json,math
import numpy as np
from PIL import Image,ImageDraw
B=Path(__file__).resolve().parent
M=json.loads((B/'vehicle-manifest.json').read_text())
S=M['sprites']
ZOOM=4
D=[(-.894427,-.447214),(.894427,-.447214),(-.894427,.447214),(.894427,.447214)]

def sprite(canvas,key,center,phase=0):
 s=S[key];im=Image.open(B/s['file']).convert('RGBA');sc=s['world_scale']*ZOOM
 im=im.resize((round(im.width*sc),round(im.height*sc)),Image.Resampling.LANCZOS)
 xy=(round(center[0]-s['pivot'][0]*sc),round(center[1]-s['pivot'][1]*sc))
 canvas.alpha_composite(im,xy)
 for w in s.get('wheels',[]):
  wheel=Image.open(B/S[w['sprite']]['file']).convert('RGBA')
  r=w['radius']*sc; ax=w['axis']
  a=phase*.3
  rot=np.array([[math.cos(a),-math.sin(a)],[math.sin(a),math.cos(a)]])
  mat=np.array([[ax[0]*r,0],[ax[1]*r,r]])@rot
  extent=np.abs(mat).sum(axis=1)
  size=(math.ceil(extent[0]*2)+4,math.ceil(extent[1]*2)+4)
  inv=np.linalg.inv(mat)
  off=np.array(size)/2
  transform=np.column_stack((inv,-inv@off))
  transform*=wheel.width/2
  transform[:,2]+=wheel.width/2
  part=wheel.transform(size,Image.Transform.AFFINE,tuple(transform.ravel()),Image.Resampling.BICUBIC)
  wc=(xy[0]+w['center'][0]*sc,xy[1]+w['center'][1]*sc)
  canvas.alpha_composite(part,(round(wc[0]-size[0]/2),round(wc[1]-size[1]/2)))

def render(phase):
 out=Image.new('RGBA',(1440,1120),(97,114,88,255));draw=ImageDraw.Draw(out)
 for row in range(4):
  for col in range(4):
   center=(col*360+180,row*280+180)
   typ='horse_cart' if col<2 else 'handcart'
   key=f'{typ}/{row}/{col%2}'
   draw.text((col*360+8,row*280+8),f'{M["directions"][row]} {typ} {col%2} phase {phase}',fill='white')
   horse=(center[0]+D[row][0]*S[key].get('horse_distance',0)*ZOOM,center[1]+D[row][1]*S[key].get('horse_distance',0)*ZOOM)
   if col<2 and row<2:sprite(out,f'horse_walk/{row}/{phase}',horse,phase)
   sprite(out,key,center,phase)
   if col<2 and row>=2:sprite(out,f'horse_walk/{row}/{phase}',horse,phase)
 return out
frames=[render(p).convert('RGB') for p in range(4)]
frames[0].save(B/'review-transport-assembly.png')
frames[0].save(B/'review-transport-motion.gif',save_all=True,append_images=frames[1:],duration=180,loop=0)
print('review assets written')
