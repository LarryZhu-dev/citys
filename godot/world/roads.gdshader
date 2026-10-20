shader_type canvas_item;
render_mode unshaded;
uniform sampler2D noise_map : filter_linear, repeat_enable;
uniform sampler2D overlay_map : filter_nearest, repeat_disable;
uniform vec2 map_size = vec2(64.0);
uniform bool show_overlay = false;
uniform bool low_detail = false;
uniform float night = 0.0;
void fragment(){
 float grain=.5;
 if(!low_detail)grain=texture(noise_map,UV*.649).r;
 vec3 color=mix(vec3(.51,.43,.31),vec3(.65,.59,.43),grain*.75);
 color*=mix(vec3(1.0),vec3(.43,.61,.77),night);
 if(show_overlay){vec4 overlay=texture(overlay_map,UV/map_size);color=mix(color,overlay.rgb,overlay.a*.58);}
 COLOR=vec4(color,1.0);
}
