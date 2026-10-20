"""Mechanical QA preview only: translate four independently generated quarters.
No resizing, rotation, mirroring, alpha change, color correction, or pixel painting.
The source remains an unchanged image_gen output; cropped QA pieces are not packed.
"""
from pathlib import Path
from PIL import Image
import json
root=Path(__file__).resolve().parents[4]
(root/'work').mkdir(exist_ok=True)
for name in ['W1','K1']:
    layout=json.loads((root/'godot/art/components/sources'/f'{name}-layout.json').read_text())
    source=Image.open(root/layout['source']).convert('RGBA')
    canvas=Image.new('RGBA',(1100,800))
    for part in layout['parts']:
        x,y,w,h=part['source_rect']
        px,py=part['pivot_source']
        piece=source.crop((x,y,x+w,y+h))
        canvas.alpha_composite(piece,(550+x-px,430+y-py))
    canvas.save(root/f'work/{name}-accepted-ring-preview.png')
