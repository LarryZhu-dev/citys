"""Extract AI-generated transparent sprites; no synthetic replacement artwork.

The user's requested sprite composition permits cropping/packing generated art.
Requires Pillow, numpy, scipy. Run from anywhere: python assets/build-atlases.py
"""
from pathlib import Path
from PIL import Image
from scipy.ndimage import label, find_objects, binary_dilation
import numpy as np
import json, sys

ROOT = Path(__file__).resolve().parent
BUILDINGS = ['house1','house2','house3','palace','temple','market','well','granary','workshop','school','barracks','farm','harbor','garden','theater','observatory']
AUX = ['watch','police','clinic','repair','grainShop','vegShop','fruitShop','fishShop','meatShop','lumber','quarry','clayPit','kiln','mill','weaver','winery']
TERRAIN = ['grass','sand','water','road','oak','cypress','palm','cherry','stone','copper','clay','reeds','monument','pasture','orchard','bath']
names = {c: BUILDINGS for c in ['china','egypt','greece','persia','aztec']}
names.update(auxiliary=AUX, terrain=TERRAIN, construction=[f'stage{r+1}-{c}' for r in range(4) for c in range(4)])
names['landmarks']=['pagoda','china-wonder','sphinx','egypt-wonder','agora','greece-wonder','windTower','persia-wonder','sunTemple','aztec-wonder','university','bath','copperMine','warehouse','vegFarm','harbor']
manifest = json.loads((ROOT/'sprites.json').read_text()) if (ROOT/'sprites.json').exists() else {}
for atlas, keys in names.items():
    if len(sys.argv)>1 and atlas not in sys.argv[1:]: continue
    im = Image.open(ROOT/'atlases'/f'{atlas}.png').convert('RGBA')
    pixels = np.array(im)
    foreground = pixels[:,:,3] > 20
    # The generated harbor's water touches the neighboring crop plot by one pixel.
    if atlas == 'landmarks': foreground[int(im.height*.735):,int(im.width*.75)-1:int(im.width*.75)+1] = False
    components, _ = label(foreground)
    bounds = find_objects(components)
    objects = []
    for idx, box in enumerate(bounds):
        if box is None: continue
        area = int((components[box] == idx + 1).sum())
        if area < 800: continue
        ys, xs = box
        objects.append(dict(label=idx+1, box=box, x=(xs.start+xs.stop)/2, y=(ys.start+ys.stop)/2, area=area))
    if len(objects) != 16:
        raise ValueError(f'{atlas}: expected 16 sprites, found {len(objects)}')
    objects.sort(key=lambda o:o['y'])
    ordered = []
    for row in range(4): ordered.extend(sorted(objects[row*4:row*4+4],key=lambda o:o['x']))
    for key, obj in zip(keys,ordered):
        mask = binary_dilation(components==obj['label'],iterations=3)
        yy, xx = np.where(mask)
        x0,x1,y0,y1 = max(0,xx.min()-2),min(im.width,xx.max()+3),max(0,yy.min()-2),min(im.height,yy.max()+3)
        crop = pixels[y0:y1,x0:x1].copy()
        crop[:,:,3] = np.where(mask[y0:y1,x0:x1],crop[:,:,3],0)
        sprite = Image.fromarray(crop)
        # Fixed empty margin keeps antialiased edges intact.
        out = Image.new('RGBA',(sprite.width+8,sprite.height+8))
        out.alpha_composite(sprite,(4,4))
        if atlas=='construction':
            cw=max(o['box'][1].stop-o['box'][1].start for o in ordered)+24
            ch=max(o['box'][0].stop-o['box'][0].start for o in ordered)+24
            frame=Image.new('RGBA',(cw,ch))
            frame.alpha_composite(out,((cw-out.width)//2,ch-out.height))
            out=frame
        prefix = 'common' if atlas=='auxiliary' else atlas
        filename = f'{prefix}-{key}.webp'
        out.save(ROOT/'sprites'/filename,'WEBP',quality=90,method=4)
        fullkey = f'{prefix}/{key}'
        manifest[fullkey] = {'file':f'sprites/{filename}','width':out.width,'height':out.height,'atlas':f'atlases/{atlas}.png','sourceRect':[int(x0),int(y0),int(x1-x0),int(y1-y0)],'anchor':[0.5,1]}
    print(atlas, '16 sprites extracted')
    if atlas=='construction':
        framefiles=[ROOT/'sprites'/f'construction-{k}.webp' for k in keys]
        frames=[Image.open(p).convert('RGBA') for p in framefiles]
        fw,fh=frames[0].size
        sheet=Image.new('RGBA',(fw*4,fh*4))
        for index,frame in enumerate(frames):sheet.alpha_composite(frame,((index%4)*fw,(index//4)*fh))
        sheet.save(ROOT/'construction-animation.webp','WEBP',quality=93,method=4)
(ROOT/'sprites.json').write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':')))
print('Total:',len(manifest),'sprites')
