from PIL import Image,ImageDraw
from pathlib import Path
import math,json,shutil
import os
root=Path(__file__).resolve().parents[4]
os.chdir(root)
(root/'work').mkdir(exist_ok=True)
source=Path('godot/art/components/sources')
# Original mathematical diagrams, solely image-generation pose references, not production assets.
N=1536;k=300;inner=.72
quads=[('nw',math.pi,1.5*math.pi,(-.5,-.5)),('ne',1.5*math.pi,2*math.pi,(.5,-.5)),('sw',.5*math.pi,math.pi,(-.5,.5)),('se',0,.5*math.pi,(.5,.5))]
def proj(p):
 x,y,z=p;return (k*(x-y),k*.5*(x+y)-k*z)
for name,h in [('W1',.22),('K1',.36)]:
 im=Image.new('RGBA',(N,N));draw=ImageDraw.Draw(im);metadata=[]
 for i,(key,a0,a1,anchor) in enumerate(quads):
  cx=384+(i%2)*768;cy=384+(i//2)*768
  ax,ay=proj((*anchor,0));ox=cx-ax;oy=cy-ay
  faces=[]
  def point(radius,a,z):return (radius*math.cos(a),radius*math.sin(a),z)
  def face(v,col):
   depth=sum(x+y for x,y,z in v)/len(v)
   faces.append((depth,v,col))
  for j in range(72):
   a=a0+(a1-a0)*j/72;b=a0+(a1-a0)*(j+1)/72;m=(a+b)/2
   # Face culling preserves only physically visible portions.
   if math.cos(m)+math.sin(m)>0:
    face([point(1,a,0),point(1,b,0),point(1,b,h),point(1,a,h)],(108,107,99,255))
   if math.cos(m)+math.sin(m)<0:
    face([point(inner,a,0),point(inner,b,0),point(inner,b,h),point(inner,a,h)],(92,91,83,255))
   face([point(inner,a,h),point(1,a,h),point(1,b,h),point(inner,b,h)],(172,170,155,255))
  # End faces: source geometry keeps exact radial endpoints even when hidden.
  for a,sgn in [(a0,-1),(a1,1)]:
   nx=-math.sin(a)*sgn;ny=math.cos(a)*sgn
   if nx+ny>0.0001:
    face([point(inner,a,0),point(1,a,0),point(1,a,h),point(inner,a,h)],(128,126,115,255))
  for _,verts,col in sorted(faces,key=lambda f:f[0]):
   draw.polygon([(ox+proj(v)[0],oy+proj(v)[1]) for v in verts],fill=col)
  metadata.append({'direction':key,'circle_center_source':[ox,oy],'quarter_center_source':[cx,cy], 'full_ground_ellipse_size':[2*math.sqrt(2)*k,math.sqrt(2)*k],'wall_height_pixels':k*h,'outer_radial_ground_endpoints':[[ox+proj(point(1,a,0))[0],oy+proj(point(1,a,0))[1]] for a in [a0,a1]]})
 im.save(f'work/{name}-geometry-reference.png')
 Path(f'work/{name}-geometry-reference.json').write_text(json.dumps(metadata,indent=2))
 print(name,metadata)
