"""Mechanical packing of freshly generated leaf components; never paints parts."""
from pathlib import Path
from PIL import Image
from scipy.ndimage import label,find_objects,binary_dilation
import numpy as np
import json,hashlib,math,os

SOURCE=Path(__file__).resolve().parent
OUTPUT=SOURCE.parent
MAX_PAGE=4096
PADDING=16
ALPHA_FLOOR=5
GROUPS={
 'S1':['stone_block','stone_step','post_wood','post_red','beam_wood','beam_painted'],
 'S2':['wall_earth','wall_plaster','wall_timber','wall_brick','brace_wood','dougong'],
 'S3':['door_wood','door_red','window_lattice','window_paper','railing','lantern'],
 'R1':['tiles_gray','tiles_green','tiles_glazed','thatch_course','eave_gray','eave_gold'],
 'R2':['ridge_gray','ridge_gold','ridge_beast','rafter','fabric_canvas','fabric_awning'],
 'P1':['sack','crate','barrel','timber_stack','bucket','wheel'],
 'P2':['kiln_masonry','furnace_mouth','chimney_course','pottery_vessel','loom_frame','workbench'],
 'P3':['rice_seedling','rice_ripe','vegetable_patch','fruit_branch','well_stone','water_surface'],
 'P4':['gong','drum','banner','lion','incense_burner','rope'],
 'E1':['cattle','sheep','fish','meat','vegetable_basket','fruit_basket'],
 'W1':['well_stone_nw','well_stone_ne','well_stone_sw','well_stone_se'],
 'K1':['kiln_masonry_nw','kiln_masonry_ne','kiln_masonry_sw','kiln_masonry_se'],
 'M1':['millstone','armillary_ring_vertical','armillary_ring_horizontal','tree_trunk'],
}
SURFACES=set('beam_wood beam_painted wall_earth wall_plaster wall_timber wall_brick brace_wood door_wood door_red window_lattice window_paper railing tiles_gray tiles_green tiles_glazed thatch_course eave_gray eave_gold ridge_gray ridge_gold rafter fabric_canvas fabric_awning water_surface banner rope armillary_ring_vertical'.split())
EMISSION={'window_lattice':[.1,.1,.8,.8],'window_paper':[.1,.1,.8,.8],'lantern':[.12,.22,.76,.43],'furnace_mouth':[.2,.34,.6,.55]}
TOOL_OUTPUTS={
 'P1':'/workspace/generated_images/exec-2b2986fd-c228-4a14-9260-66f174da2d25.png',
 'P2':'/workspace/generated_images/exec-20e98af0-cd43-4c9f-be56-3bc14448fb31.png',
 'P3':'/workspace/generated_images/exec-25fdbc89-79f7-4ca4-9a15-8fe0262e1f3a.png',
 'P4':'/workspace/generated_images/exec-2901e55d-40fd-45e3-bdfe-55698942f2a8.png',
 'E1':'/workspace/generated_images/exec-84900b21-447c-4d61-8db9-19f9d6af5393.png',
}
parts=[];records=[];missing=[]

for group,keys in GROUPS.items():
 candidates=[SOURCE/(group+'-original.png'),SOURCE/(group.lower()+'.png')]
 path=next((p for p in candidates if p.exists()),None)
 if path is None:
  missing.extend(keys);continue
 record_path=SOURCE/(group+'-layout.json')
 original_record=json.loads(record_path.read_text())if record_path.exists()else{}
 if group in ('W1','K1') and original_record.get('accepted') is not True:
  missing.extend(keys);print(group,'awaiting four-piece assembly acceptance');continue
 authored_parts={part['key']:part for part in original_record.get('parts',[]) if isinstance(part,dict) and 'key' in part}
 image=Image.open(path).convert('RGBA');pixels=np.array(image);alpha=pixels[:,:,3]
 labels,_=label(alpha>24)
 objects=[]
 for index,bounds in enumerate(find_objects(labels)):
  if bounds is None:continue
  area=int((labels[bounds]==index+1).sum())
  if area<12:continue
  ys,xs=bounds
  objects.append({'id':index+1,'area':area,'x':(xs.start+xs.stop)/2,'y':(ys.start+ys.stop)/2})
 # Principal silhouettes may spill past nominal sheet cells, so use their
 # actual centers to establish row-major order, not a blind rectangular crop.
 count=len(keys);columns=count//2
 main=sorted(objects,key=lambda item:item['area'],reverse=True)[:count]
 assert len(main)==count and min(item['area']for item in main)>1000,(group,'missing principal object')
 main.sort(key=lambda item:item['y']);ordered=[]
 for row in range(2):ordered.extend(sorted(main[row*columns:row*columns+columns],key=lambda item:item['x']))
 assigned={item['id']:[item['id']]for item in ordered}
 for item in objects:
  if item in main:continue
  nearest=min(ordered,key=lambda base:((base['x']-item['x'])/image.width)**2+((base['y']-item['y'])/image.height)**2)
  assigned[nearest['id']].append(item['id'])
 for key,item in zip(keys,ordered):
  mask=binary_dilation(np.isin(labels,assigned[item['id']]),iterations=1)
  yy,xx=np.where(mask);x0=max(0,int(xx.min())-2);x1=min(image.width,int(xx.max())+3);y0=max(0,int(yy.min())-2);y1=min(image.height,int(yy.max())+3)
  crop=pixels[y0:y1,x0:x1].copy();crop[:,:,3]=np.where(mask[y0:y1,x0:x1],crop[:,:,3],0);crop[crop[:,:,3]==0,:3]=0
  crop[crop[:,:,3]<=ALPHA_FLOOR]=0
  icon=Image.fromarray(crop)
  assert max(icon.size)+PADDING*2<=MAX_PAGE,(key,icon.size)
  entry={'kind':'surface' if key in SURFACES else 'prop','pivot':[.5,1.0] if key in SURFACES else [.5,.98],'source':'godot/art/components/sources/'+path.name,'source_rect':[x0,y0,x1-x0,y1-y0],'native_size':[icon.width,icon.height],'sheet':group}
  authored=authored_parts.get(key,{})
  if 'pivot' in authored and 'pivot_source' not in authored:entry['pivot']=authored['pivot']
  if 'pivot_source' in authored:
   px,py=authored['pivot_source']
   entry['pivot']=[(px-x0)/icon.width,(py-y0)/icon.height]
   entry['pivot_source']=authored['pivot_source']
  if 'reference_size' in authored:entry['reference_size']=authored['reference_size']
  if 'anchor_role' in authored:entry['anchor_role']=authored['anchor_role']
  for field in ('pivot_semantics','reference_semantics','wall_height_reference_pixels','direction'):
   if field in authored:entry[field]=authored[field]
  if 'native_plan_ratio' in authored:entry['native_plan_ratio']=authored['native_plan_ratio']
  if 'planes_source' in authored:
   entry['source_planes']={face:[[(px-x0)/icon.width,(py-y0)/icon.height] for px,py in points] for face,points in authored['planes_source'].items()}
   entry['source_plane_order']={'top':'back,right,front,left','side_x':'right,front,bottom_front,bottom_right','side_y':'front,left,bottom_left,bottom_front'}
   entry['calibration']=authored.get('calibration','Authored source-face calibration')
  if key in SURFACES:entry['plane_bounds']=[2/icon.width,2/icon.height,1-2/icon.width,1-2/icon.height]
  if 'plane_bounds' in authored:entry['plane_bounds']=authored['plane_bounds']
  if 'calibration' in authored:entry['calibration']=authored['calibration']
  if key in EMISSION:entry['emission_rect']=EMISSION[key]
  if key=='window_lattice':entry['emission_mode']='aperture_inside_frame'
  parts.append({'key':key,'image':icon,'entry':entry})
 prompt_path=next((p for p in [SOURCE/(group+'-prompt.txt'),SOURCE/(group.lower()+'-prompt.md')]if p.exists()),None)
 records.append({'sheet':group,'source':path.name,'tool_output':TOOL_OUTPUTS.get(group,original_record.get('toolOutput',original_record.get('generated_original',original_record.get('source')))),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'original_size':list(image.size),'alpha_range':[int(alpha.min()),int(alpha.max())],'keys':keys,'prompt_file':prompt_path.name if prompt_path else None,'prompt':prompt_path.read_text() if prompt_path else original_record.get('prompt',original_record.get('actual_prompt','')),'original_generation_record':original_record})
 print(group,'extracted',len(keys),'fresh parts')

# Persisted placements preserve established atlas coordinates and page pixels.
# New source groups occupy new pages, never repacking old published components.
layout_path=SOURCE/'atlas-layout.json'
layout=json.loads(layout_path.read_text()) if layout_path.exists() else {'page_sizes':{},'placements':{}}
fixed=layout['placements'];available={part['key']for part in parts}
assert set(fixed)<=available,('Cannot rebuild stable atlas with missing established sources',sorted(set(fixed)-available))
if layout.get('layout_mode')=='single_shared_texture':
 assert available==set(fixed),('New components need an explicit shared-atlas layout update',sorted(available-set(fixed)))
pages=[{'id':int(index),'height':size[1],'width':size[0],'locked':True,'shelves':[]}for index,size in sorted(layout['page_sizes'].items(),key=lambda pair:int(pair[0]))]
for part in parts:
 if part['key'] not in fixed:continue
 slot=fixed[part['key']];x,y,w,h=slot['rect']
 assert [w,h]==list(part['image'].size),(part['key'],'established source dimensions changed; explicit art-layout migration required')
 part.update({'page':slot['page'],'x':x,'y':y})
# Height-sorted shelves for new parts only; no resizing or rotations.
for part in sorted((part for part in parts if part['key'] not in fixed),key=lambda p:(-p['image'].height,-p['image'].width,p['key'])):
 w=part['image'].width+PADDING*2;h=part['image'].height+PADDING*2;placed=False
 for page in pages:
  if page.get('locked'):continue
  for shelf in page['shelves']:
   if h<=shelf['h'] and shelf['x']+w<=MAX_PAGE:
    part.update({'page':page['id'],'x':shelf['x']+PADDING,'y':shelf['y']+PADDING});shelf['x']+=w;placed=True;break
  if placed:break
  if page['height']+h<=MAX_PAGE:
   shelf={'x':w,'y':page['height'],'h':h};page['shelves'].append(shelf);part.update({'page':page['id'],'x':PADDING,'y':page['height']+PADDING});page['height']+=h;placed=True;break
 if not placed:
  page={'id':len(pages),'height':h,'shelves':[{'x':w,'y':0,'h':h}]};pages.append(page);part.update({'page':page['id'],'x':PADDING,'y':PADDING})
manifest={'schema':1,'projection':'2:1 dimetric image assembly','provenance':'All components are new image_gen source pixels; no rejected old architecture reused. Mechanical extraction and packing only.','generation_record':'godot/art/components/sources/generation-record.json','layout_mode':layout.get('layout_mode','stable_pages'),'layout_migration':layout.get('migration'),'complete':not missing,'expected_parts':sum(map(len,GROUPS.values())),'missing_parts':missing,'padding':PADDING,'coordinate_contract':{'rect':'atlas pixels x,y,width,height excluding padding','pivot':'normalized point relative to rect, u,v','plane_bounds':'normalized left,top,right,bottom relative to rect','emission_rect':'normalized x,y,width,height relative to rect'},'atlases':{},'parts':{}}
for page in pages:
 height=int(math.ceil(page['height']/256)*256);width=page.get('width',MAX_PAGE);atlas=Image.new('RGBA',(width,height))
 for part in parts:
  if part['page']!=page['id']:continue
  atlas.alpha_composite(part['image'],(part['x'],part['y']))
 raw=np.array(atlas);raw[raw[:,:,3]==0,:3]=0;atlas=Image.fromarray(raw)
 filename=f'components-{page["id"]}.webp';path=OUTPUT/filename
 import_path=OUTPUT/(filename+'.import')
 if not import_path.exists():
  preset='[remap]\nimporter="texture"\ntype="CompressedTexture2D"\n\n[params]\nmipmaps/generate=true\nprocess/fix_alpha_border=true\n'
 else:
  preset=import_path.read_text().replace('mipmaps/generate=false','mipmaps/generate=true').replace('process/fix_alpha_border=false','process/fix_alpha_border=true')
 preset_temp=import_path.with_name(import_path.name+'.tmp');preset_temp.write_text(preset);os.replace(preset_temp,import_path)
 unchanged=path.exists() and np.array_equal(np.array(Image.open(path).convert('RGBA')),raw)
 if not unchanged:
  temporary=OUTPUT/(filename+'.tmp')
  atlas.save(temporary,format='WEBP',lossless=True,exact=True,method=6)
  decoded=np.array(Image.open(temporary).convert('RGBA'));assert not decoded[:,:,:3][decoded[:,:,3]==0].any(),filename
  os.replace(temporary,path)
 manifest['atlases'][str(page['id'])]={'path':'res://art/components/'+filename,'size':list(atlas.size),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'mipmaps':True,'fix_alpha_border':True}
for part in parts:
 entry=part['entry'];entry.update({'atlas':manifest['atlases'][str(part['page'])]['path'],'rect':[part['x'],part['y'],part['image'].width,part['image'].height]});manifest['parts'][part['key']]=entry
def atomic_json(path,value):
 temporary=path.with_name(path.name+'.tmp')
 temporary.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
 os.replace(temporary,path)
atomic_json(SOURCE/'generation-record.json',{'tool':'image_gen.imagegen','generatedOn':'2026-10-20','rights':'Original generated assets, subject to image generation service terms. No Sim Empire artwork imported.','processing':'Alpha component crop and atlas packing only; no source pixel resizing or painting; pixels with alpha<=5/255 cleared to RGBA zero, 16px padding, transparent RGB cleared, exact lossless WebP. Original PNGs remain unchanged.','alpha_clear_threshold':ALPHA_FLOOR,'layout_mode':layout.get('layout_mode','stable_pages'),'layout_migration':layout.get('migration'),'sheets':records})
atomic_json(layout_path,{'schema':1,'padding':PADDING,'layout_mode':layout.get('layout_mode','stable_pages'),'migration':layout.get('migration'),'page_sizes':{index:item['size']for index,item in manifest['atlases'].items()},'placements':{part['key']:{'page':part['page'],'rect':[part['x'],part['y'],part['image'].width,part['image'].height]}for part in parts},'note':layout.get('note','Stable production placements; append new source groups on new pages, never repack established keys.')})
atomic_json(OUTPUT/'manifest.json',manifest)
active={Path(item['path']).name for item in manifest['atlases'].values()}
for stale in OUTPUT.glob('components-*.webp'):
 if stale.name not in active:
  stale.unlink()
  stale.with_name(stale.name+'.import').unlink(missing_ok=True)
print('Packed',len(parts),'parts into',len(pages),'atlases; missing',len(missing))
