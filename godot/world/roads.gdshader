shader_type canvas_item;
render_mode unshaded;
uniform sampler2D noise_map : filter_linear, repeat_enable;
uniform sampler2D overlay_map : filter_nearest, repeat_disable;
uniform vec2 map_size = vec2(64.0);
uniform bool show_overlay = false;
uniform bool low_detail = false;
uniform float night = 0.0;
vec3 cell_random(vec2 p){
 vec3 q=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));
 q+=dot(q,q.yxz+33.33);
 return fract((q.xxy+q.yxx)*q.zyx);
}
void fragment(){
 float tier=COLOR.r*2.;
 float grain=texture(noise_map,UV*.649).r;
 float fine=texture(noise_map,UV*5.7).r;
 vec3 dirt=mix(vec3(.43,.35,.24),vec3(.61,.52,.36),grain*.7+fine*.3);
 float gravel_weight=smoothstep(.12,.88,tier);
 float slab_weight=smoothstep(1.12,1.88,tier);
 vec3 color=dirt;
 // Jittered geological pebbles, not a regular dot lattice. Nine small arithmetic
 // neighbor checks are needed only where gravel contributes to the final color.
 // Both transition weights keep the original continuous blends unchanged.
 if(gravel_weight>0. && slab_weight<1.){
 vec2 gravel_coord=UV*9.;
 vec2 pebble_cell=floor(gravel_coord);
 float nearest=8.;
 float stone_shade=.5;
 float edge_shade=.0;
 for(int yy=-1;yy<=1;yy++){
  for(int xx=-1;xx<=1;xx++){
   vec2 cell=pebble_cell+vec2(float(xx),float(yy));
   vec3 rnd=cell_random(cell);
   vec2 delta=gravel_coord-cell-(vec2(.14)+rnd.xy*.72);
   vec2 ellipse=vec2(.78+rnd.z*.52,1.26-rnd.z*.4);
   float radius=.23+rnd.z*.22;
   float distance=length(delta*ellipse)/radius;
   if(distance<nearest){nearest=distance;stone_shade=rnd.z;edge_shade=delta.x-delta.y;}
  }
 }
 float pebble=1.-smoothstep(.78,1.,nearest+(fine-.5)*.24);
 vec3 gravel=mix(vec3(.35,.33,.27),mix(vec3(.49,.48,.41),vec3(.73,.70,.59),stone_shade),pebble);
 gravel*=.91+fine*.13+edge_shade*.12;
 color=mix(dirt,gravel,gravel_weight);
 }
 // Running-bond rectangular slabs with recessed mortar and restrained worn edges.
 if(slab_weight>0.){
 vec2 paving=UV*vec2(3.25,5.4);
 paving.x+=mod(floor(paving.y),2.)*.5;
 vec2 tile=fract(paving);
 float seam=min(min(tile.x,1.-tile.x),min(tile.y,1.-tile.y));
 float joint=smoothstep(.015,.052,seam);
 float bevel=smoothstep(.04,.105,seam);
 float slab_shade=texture(noise_map,floor(paving)*.173).r;
 vec3 slab=mix(vec3(.34,.36,.34),mix(vec3(.55,.58,.54),vec3(.73,.75,.66),slab_shade),joint);
 slab+=vec3(.035)*(1.-bevel)*joint;
 slab*=.94+fine*.12;
 color=mix(color,slab,slab_weight);
 }
 color*=mix(vec3(1.0),vec3(.43,.61,.77),night);
 if(show_overlay){vec4 overlay=texture(overlay_map,UV/map_size);color=mix(color,overlay.rgb,overlay.a*.58);}
 COLOR=vec4(color,1.0);
}
