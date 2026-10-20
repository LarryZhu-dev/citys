shader_type canvas_item;
render_mode unshaded;
uniform sampler2D terrain_map : filter_linear, repeat_disable;
uniform sampler2D noise_map : filter_linear, repeat_enable;
uniform sampler2D overlay_map : filter_nearest, repeat_disable;
uniform bool show_overlay = false;
uniform bool low_detail = false;
uniform vec2 map_size = vec2(64.0);
uniform float world_seed = 42.0;
uniform float clock = 0.0;
uniform float night : hint_range(0.0, 1.0) = 0.0;
void fragment(){
 vec2 world=UV*map_size;
 // Broad natural colour fields are encoded once in the compact terrain map.
 vec4 field=texture(terrain_map,UV);
 float region=field.a;
 float detail=field.b;
 float grain=detail;
 if(!low_detail)grain=texture(noise_map,world*83.0/128.0).r;
 vec3 lush=mix(vec3(.30,.44,.18),vec3(.48,.58,.28),detail*.72+grain*.28);
 float soil=smoothstep(.66,.80,region+detail*.035);
 vec3 ground=mix(lush,vec3(.54,.47,.31)*(.89+grain*.18),soil);
 float coast=field.r+(grain-.5)*.035;
 if(coast>.24){
  float shore=smoothstep(.24,.37,coast);
  float wet=smoothstep(.36,.46,coast);
  float water=smoothstep(.46,.49,coast);
  ground=mix(ground,mix(vec3(.59,.52,.34),vec3(.36,.36,.24),wet),shore);
  float depth=smoothstep(.48,.91,coast);
  vec3 water_color=mix(vec3(.20,.52,.48),vec3(.10,.32,.38),depth);
  float ripple=max(0.0,sin(world.x*19.0+world.y*10.0+clock*1.1+detail*5.0));
  float glint=ripple*ripple*ripple*ripple*ripple*ripple*ripple*ripple*(.015+.035*(1.0-depth));
  water_color+=vec3(glint*.7,glint,glint)+vec3(.06,.08,.05)*(1.0-smoothstep(.49,.54,coast));
  ground=mix(ground,water_color,water);
 }
 ground*=mix(vec3(1.0),vec3(.43,.61,.77),night);
 if(show_overlay){vec4 overlay=texture(overlay_map,UV);ground=mix(ground,overlay.rgb,overlay.a*.48);}
 COLOR=vec4(ground,1.0);
}
