#!/usr/bin/env python3
"""Mechanical isolation/packing only. No painted geometry or retouching.

Image-generated sheets contain irregular gutters; alpha connected components locate
sprites, then nearest-component ownership isolates overlapping bounding boxes.
The original RGBA pixels are preserved. The wheel alone is downsampled to 256 px.
"""
from pathlib import Path
import json
from PIL import Image, ImageDraw
import numpy as np
from scipy import ndimage

BASE = Path(__file__).resolve().parent
OUT = BASE / 'frames'
OUT.mkdir(exist_ok=True)
DIRECTIONS = ['NW', 'NE', 'SW', 'SE']


def isolate(name, rows=4, columns=4):
    im = Image.open(BASE/'sources'/name).convert('RGBA')
    rgba = np.asarray(im)
    labels, _ = ndimage.label(rgba[:,:,3] > 16)
    counts = np.bincount(labels.ravel())
    large = np.flatnonzero(counts > 1000)
    large = large[large != 0]
    core = np.where(np.isin(labels,large), labels, 0)
    _, nearest = ndimage.distance_transform_edt(core == 0, return_indices=True)
    owner = core[tuple(nearest)]
    items = []
    for label in large:
        yy,xx=np.nonzero(labels==label)
        box=[max(0,int(xx.min())-4),max(0,int(yy.min())-4),min(im.width,int(xx.max())+5),min(im.height,int(yy.max())+5)]
        x0,y0,x1,y1=box
        tile=rgba[y0:y1,x0:x1].copy()
        tile[owner[y0:y1,x0:x1] != label,3] = 0
        items.append({'box':box, 'center':[(x0+x1)/2,(y0+y1)/2], 'image':Image.fromarray(tile)})
    assert len(items)==rows*columns,(name,len(items))
    items.sort(key=lambda v:v['center'][1])
    ordered=[]
    for row in range(rows):
        group=items[row*columns:(row+1)*columns]
        group.sort(key=lambda v:v['center'][0])
        ordered+=group
    return ordered

manifest={
 'version':4,
 'status':'new_original_art_candidate_for_engine_playback_review',
 'provenance':{
  'reference':'User-provided Sim Empire China screenshot, inspected in conversation on 2026-10-20',
  'derivation':'Original newly generated horses and vehicles. Reference contains insufficient visible horse/cart detail for direct extraction.',
  'method':'image_gen creation and edit; mechanical alpha-component extraction and atlas-ready crop only',
  'source_dimensions':[1254,1254],
  'generation_ids':['exec-ef9dadad-e147-4fdc-a6ec-59b49a64ab49','exec-bd2011b6-b86b-48ea-9243-5469b2e02e64','exec-4b396255-4952-4a85-ab95-4298af262c87','exec-fa62a763-5c36-4b81-b107-f5d89a10e5cd'],
  'rejected_sources':['horse-walk-v4-draft.png'],
 },
 'directions':DIRECTIONS,
 'sprites':{},'animations':{}
}
horses=isolate('horse-walk-v4.png')
# Same row ground registration for every phase. Cell offsets follow painted
# spacing, not the sprite's changing foot bbox, avoiding foot-anchored bobbing.
horse_origin=[(178,299),(147,606),(170,898),(151,1201)]
for row in range(4):
 for col in range(4):
  item=horses[row*4+col]
  key=f'horse_walk/{row}/{col}'
  name=f'horse-walk-{DIRECTIONS[row].lower()}-{col}.png'
  item['image'].save(OUT/name)
  x0,y0,x1,y1=item['box']
  px,py=horse_origin[row]
  manifest['sprites'][key]={'file':f'frames/{name}','source':'sources/horse-walk-v4.png','source_rect':[x0,y0,x1-x0,y1-y0],'pivot':[round(px+313.5*col-x0,2),py-y0],'world_scale':0.09,'direction':DIRECTIONS[row],'pose':['left_contact','left_passing','right_contact','right_passing'][col]}
 manifest['animations'][f'horse_walk/{row}']={'frames':[f'horse_walk/{row}/{col}' for col in range(4)],'cycles_per_tile':1.0,'fps':5,'loop':True}

carts=isolate('cart-bodies-v4.png')
# Visible axle caps measured on the actual generated source, not guessed grid cells.
axles=[[(174,215),(491,217),(812,235),(1094,234)],[(187,521),(525,522),(813,543),(1106,542)],[(254,795),(581,794),(882,806),(1182,807)],[(108,1098),(428,1098),(737,1094),(1038,1098)]]
# Projected travel-plane basis: both signs are meaningful for actual spoke motion.
axes=[[-0.894427,-0.447214],[0.894427,-0.447214],[-0.894427,0.447214],[0.894427,0.447214]]
for row in range(4):
 for col in range(4):
  item=carts[row*4+col]
  kind='horse_cart' if col<2 else 'handcart'
  loaded=col%2
  key=f'{kind}/{row}/{loaded}'
  name=f'{kind.replace("_","-")}-{DIRECTIONS[row].lower()}-{loaded}.png'
  item['image'].save(OUT/name)
  x0,y0,x1,y1=item['box']
  ax,ay=axles[row][col]
  radius=64 if kind=='horse_cart' else 39
  across=49 if kind=='horse_cart' else 36
  sign=1 if row in (0,3) else -1
  ground=(ax+sign*across,ay-across*0.5+radius)
  manifest['sprites'][key]={'file':f'frames/{name}','source':'sources/cart-bodies-v4.png','source_rect':[x0,y0,x1-x0,y1-y0],'pivot':[ground[0]-x0,ground[1]-y0],'world_scale':0.108,'direction':DIRECTIONS[row],'loaded':bool(loaded),'wheels':[{'sprite':'wheel','center':[ax-x0,ay-y0],'radius':radius,'axis':axes[row]}]}
  if kind=='horse_cart': manifest['sprites'][key]['horse_distance']=23

wheel=isolate('wheel-v4.png',rows=1,columns=1)[0]
wheel['image'].resize((256,256),Image.Resampling.LANCZOS).save(OUT/'wheel.png')
x0,y0,x1,y1=wheel['box']
manifest['sprites']['wheel']={'file':'frames/wheel.png','source':'sources/wheel-v4.png','source_rect':[x0,y0,x1-x0,y1-y0],'pivot':[128,128],'world_scale':0.108,'round_front_view':True,'spokes':12}
(BASE/'vehicle-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')

# Review-only grid. Text/ground marks are never written into production sprites.
for kind,items in [('horses',horses),('cart-bodies',carts)]:
 review=Image.new('RGB',(1440,1440),(92,109,88))
 draw=ImageDraw.Draw(review)
 for n,item in enumerate(items):
  row,col=divmod(n,4)
  im=item['image']
  review.paste(im,(col*360+(360-im.width)//2,row*360+30),im)
  draw.text((col*360+10,row*360+8),f'{DIRECTIONS[row]} / {col}',fill='white')
 review.save(BASE/f'review-{kind}.png')

print(json.dumps({'frames':len(manifest['sprites']),'animations':len(manifest['animations']),'manifest':str(BASE/'vehicle-manifest.json')}))
