extends Node2D
class_name CityBuildings
## Medium-scale original painted architecture, assembled in a shared Y-sort space.
## The logical owner of a building is independent of its sortable visual modules.

const Recipes = preload("res://world/building_parts.gd")
const ART := "res://art/architecture/"
const NIGHT_SHADER := """
shader_type canvas_item;
render_mode unshaded;
uniform float night = 0.0;
uniform float reveal = 1.0;
uniform float reveal_axis = 0.0;
uniform bool furnace = false;
uniform bool operating = false;
uniform float clock = 0.0;
void fragment() {
 vec4 c = COLOR;
 if(c.a < 0.012) discard;
 vec2 local_uv = (UV - REGION_RECT.xy) / max(REGION_RECT.zw,vec2(0.00001));
 float edge = reveal_axis > 0.5 ? local_uv.x : 1.0-local_uv.y;
 if(edge > reveal) discard;
 c.rgb *= vec3(1.0-.26918*night,1.0-.19882*night,1.0-.10859*night);
 if(furnace && distance(local_uv,vec2(.455,.78)) < .19 && c.r>c.g*1.35 && c.g>c.b*1.3) {
  if(operating) c.rgb *= 1.06+.09*sin(clock*5.0+local_uv.x*7.0);
  else c.rgb = vec3(dot(c.rgb,vec3(.3,.5,.2))*.23);
 }
 COLOR=c;
}
"""

class Detail extends Node2D:
	var module: Dictionary = {}
	var base := Vector2.ZERO
	var kind := ""
	var variant := ""
	var night := 0.0
	var progress := 1.0
	var production := 0.0
	var operating := false
	var clock := 0.0
	var tint := Color.WHITE
	var _mesh: ArrayMesh
	var _vertices := PackedVector2Array()
	var _colors := PackedColorArray()
	var _indices := PackedInt32Array()

	func invalidate() -> void:
		_mesh = null
		queue_redraw()

	func _polygon(points: PackedVector2Array,color: Color) -> void:
		if points.size()<3:
			return
		var start_index := _vertices.size()
		for point: Vector2 in points:
			_vertices.append(point)
			_colors.append(color)
		var triangles := Geometry2D.triangulate_polygon(points)
		for index: int in triangles:
			_indices.append(start_index+index)

	func _line(a: Vector2,b: Vector2,color: Color,width: float = 1.0,_antialias: bool = false) -> void:
		var normal := (b-a).orthogonal().normalized()*width*.5
		_polygon(PackedVector2Array([a+normal,b+normal,b-normal,a-normal]),color)

	func _polyline(points: PackedVector2Array,color: Color,width: float = 1.0,antialias: bool = false) -> void:
		for i in range(points.size()-1):
			_line(points[i],points[i+1],color,width,antialias)

	func _circle(at: Vector2,radius: float,color: Color) -> void:
		var points := PackedVector2Array()
		for i in range(20):
			var angle := TAU*float(i)/20.0
			points.append(at+Vector2(cos(angle),sin(angle))*radius)
		_polygon(points,color)

	func _glow(at: Vector2,radius: float,color: Color) -> void:
		# A continuous alpha gradient avoids the visible rims of stacked circles.
		# The dedicated additive material adds emitted light without dimming stone.
		var origin := _vertices.size()
		_vertices.append(at)
		_colors.append(color)
		for ring in range(2):
			var distance := radius*(.36 if ring==0 else 1.0)
			var alpha := color.a*(.40 if ring==0 else 0.0)
			for i in range(24):
				var angle := TAU*float(i)/24.0
				_vertices.append(at+Vector2(cos(angle),sin(angle))*distance)
				_colors.append(Color(color.r,color.g,color.b,alpha))
		for i in range(24):
			var next := (i+1)%24
			_indices.append_array(PackedInt32Array([origin,origin+1+i,origin+1+next]))
			_indices.append_array(PackedInt32Array([origin+1+i,origin+25+i,origin+25+next,origin+1+i,origin+25+next,origin+1+next]))

	func _finish_mesh() -> void:
		if _indices.is_empty():
			return
		var arrays := []
		arrays.resize(Mesh.ARRAY_MAX)
		arrays[Mesh.ARRAY_VERTEX] = _vertices
		arrays[Mesh.ARRAY_COLOR] = _colors
		arrays[Mesh.ARRAY_INDEX] = _indices
		_mesh = ArrayMesh.new()
		_mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES,arrays,[],{},Mesh.ARRAY_FLAG_USE_2D_VERTICES)
		_vertices = PackedVector2Array()
		_colors = PackedColorArray()
		_indices = PackedInt32Array()
		draw_mesh(_mesh,null)

	func _p(x: float,y: float,z: float = 0.0) -> Vector2:
		var at := base+Vector2(x,y)
		return Vector2((at.x-at.y)*64.0,(at.x+at.y)*32.0)-position-Vector2(0,(float(module.get("z",0))+z)*64.0)

	func _c(c: Color) -> Color:
		return c

	func _quad(x: float,y: float,z: float,w: float,d: float,c: Color) -> void:
		_polygon(PackedVector2Array([_p(x,y,z),_p(x+w,y,z),_p(x+w,y+d,z),_p(x,y+d,z)]),_c(c))

	func _box(x: float,y: float,z: float,w: float,d: float,h: float,c: Color) -> void:
		var top := PackedVector2Array([_p(x,y,z+h),_p(x+w,y,z+h),_p(x+w,y+d,z+h),_p(x,y+d,z+h)])
		_polygon(PackedVector2Array([top[3],top[2],_p(x+w,y+d,z),_p(x,y+d,z)]),_c(c))
		_polygon(PackedVector2Array([top[1],top[2],_p(x+w,y+d,z),_p(x+w,y,z)]),_c(c.darkened(.24)))
		_polygon(top,_c(c.lightened(.12)))

	func _rod(a: Vector3,b: Vector3,c: Color,width: float = 1.4) -> void:
		_line(_p(a.x,a.y,a.z),_p(b.x,b.y,b.z),_c(c),width,true)

	func _oval(at: Vector2,radius: Vector2,c: Color) -> void:
		var pts := PackedVector2Array()
		for i in range(24):
			var a := TAU*float(i)/24.0
			pts.append(at+Vector2(cos(a)*radius.x,sin(a)*radius.y))
		_polygon(pts,_c(c))

	func _draw() -> void:
		if _mesh:
			draw_mesh(_mesh,null)
			return
		var w: float = module.get("w",.5)
		var d: float = module.get("d",.5)
		var h: float = module.get("h",.3)
		var center := _p(w*.5,d*.5)
		var wood := Color("816244")
		var stone := Color("a4a08b")
		var ink := Color("465044")
		match kind:
			"foundation":
				_box(0,0,-.015,w,d,.025,Color("a09c80"))
				for i in range(4):
					_rod(Vector3(w*i/4.0,0,.014),Vector3(w*i/4.0,d,.014),Color("7c816b"),.6)
			"frame":
				var count := maxi(2,ceili(w*3.0))
				for row in [0.04,d-.04]:
					for col in range(count+1):
						var x: float = w*float(col)/count
						_box(x-.018,row-.018,0,.036,.036,h*progress,wood)
					if progress>.75:
						_rod(Vector3(0,row,h),Vector3(w,row,h),wood.lightened(.1),3)
				if progress>.9:
					for col in range(count+1):
						var x: float = w*float(col)/count
						_rod(Vector3(x,0,h),Vector3(x,d,h),wood,2)
			"steps":
				for i in range(3):
					_box(0,d*float(i)/3.0,0,w,d/3.0,h*(3-i)/3.0,stone)
			"fence":
				var along_x := w>d
				var n := maxi(2,ceili(maxf(w,d)/.13))
				for i in range(n+1):
					var x := w*i/n if along_x else w*.5
					var y := d*.5 if along_x else d*i/n
					_box(x-.012,y-.012,0,.024,.024,h,wood)
				for z in [.08,h*.86]:
					_rod(Vector3(0,0,z),Vector3(w,d,z),wood,1.6)
			"crop":
				_quad(0,0,0,w,d,Color("8d7750"))
				var stage: float = clampf(production,0.0,1.0)
				for row in range(3):
					_rod(Vector3(.02,d*(row+.2)/3,0),Vector3(w-.02,d*(row+.2)/3,0),Color("665c42"),1.5)
					for col in range(maxi(4,ceili(w*14))):
						var x := (col+.45)*w/maxi(4,ceili(w*14))
						var y: float = d*(row+.45)/3.0
						var z: float = (.04+stage*h)*progress
						var c := Color("c9b66c") if stage>.65 and variant=="grain" else Color("70914d")
						_rod(Vector3(x,y,0),Vector3(x+.012,y,z),c,1.0)
						_rod(Vector3(x,y,z*.4),Vector3(x-.025,y,z*.8),c.darkened(.1),1.0)
						if variant=="grain" and stage>.5:
							_oval(_p(x+.012,y,z),Vector2(1.2,2.3),c.lightened(.13))
						elif variant!="grain":
							_oval(_p(x,y,z*.4),Vector2(2.6+stage,1.4+stage),c)
			"pond":
				var pit := variant.ends_with("_pit")
				_quad(0,0,0,w,d,Color("81785b") if pit else Color("a1a18b"))
				_quad(.035,.035,.004,w-.07,d-.07,Color("695f46") if pit else Color("477f80"))
				if pit:
					for i in range(5):
						var x := w*(.18+float(i%3)*.24)
						var y := d*(.2+float(i/3)*.4)
						_box(x,y,.01,w*.14,d*.16,.08,Color("aa8a64") if "clay" in variant else Color("8c9b86"))
				else:
					for i in range(5):
						var p := _p(w*(.2+.14*i),d*(.35+.18*sin(float(i)*2.3)),.012)
						_oval(p,Vector2(4,2.1),Color("819c68"))
			"well":
				_oval(center,Vector2(w*38,d*20),stone.darkened(.15))
				_oval(center-Vector2(0,h*64),Vector2(w*38,d*20),stone)
				_oval(center-Vector2(0,h*64),Vector2(w*27,d*14),Color("395c59"))
				for i in range(8):
					var a := float(i)*TAU/8
					_line(center-Vector2(0,h*64)+Vector2(cos(a)*w*28,sin(a)*d*14),center-Vector2(0,h*64)+Vector2(cos(a)*w*38,sin(a)*d*20),_c(Color("c8c6aa")),1,true)
			"stock":
				if "log" in variant or "timber" in variant or "firewood" in variant:
					for row in range(2):
						for i in range(4-row):
							var y := d*(i+.5)/(4-row)
							_rod(Vector3(.04,y,.06+row*.08),Vector3(w-.04,y,.06+row*.08),wood.darkened(.12),6)
							_oval(_p(w-.04,y,.06+row*.08),Vector2(3.1,2.7),Color("c7ac78"))
				elif "jar" in variant or "vat" in variant or "barrel" in variant:
					for i in range(maxi(1,ceili(w/.22))):
						var q := _p((i+.5)*w/maxi(1,ceili(w/.22)),d*.5,.1)
						_oval(q,Vector2(5,7),Color("a37a51"))
						_oval(q-Vector2(0,6),Vector2(3.6,1.7),Color("4f4534"))
				elif "sack" in variant or variant in ["grain","hay","fruit","vegetables"]:
					for i in range(maxi(3,ceili(w*7))):
						var q := _p(w*(.12+float(i%4)*.23),d*(.25+float(i/4)*.4),.08)
						_oval(q,Vector2(5,3.5),Color("c4b482") if variant in ["grain","hay"] or "sack" in variant else Color("8c9a53"))
				else:
					for i in range(6):
						_box(w*float(i%3)/3,d*float(i/3)/2,0,w*.29,d*.4,h*(.65+.35*float(i%2)),Color("a18d6d") if "stone" not in variant else stone)
			"workbench", "loom", "mill":
				if kind=="mill":
					_oval(center,Vector2(w*36,d*18),stone.darkened(.18))
					_oval(center-Vector2(0,h*64),Vector2(w*36,d*18),stone)
					var a := clock*1.7 if operating else .4
					var q := center-Vector2(0,h*64)
					_line(q,q+Vector2(cos(a)*w*28,sin(a)*d*14),_c(wood),2.5,true)
				else:
					for x in [.03,w-.05]:
						for y in [.03,d-.05]:
							_box(x,y,0,.025,.025,h*.8,wood)
					_box(0,0,h*.8,w,d,.035,wood.lightened(.1))
					if kind=="loom" or "cloth" in variant:
						for x in [.03,w-.05]:
							_rod(Vector3(x,0,h*.7),Vector3(x,0,h*1.5),wood,2)
						for i in range(9):
							_rod(Vector3(w*i/9,0,h*1.4),Vector3(w*i/9,d,h*.9),Color("cbc29e"),.8)
					elif "press" in variant:
						_rod(Vector3(w*.5,d*.5,h),Vector3(w*.5,d*.5,h*1.8),wood,3)
					else:
						for i in range(4):
							_oval(_p(w*(i+.5)/4,d*.5,h+.04),Vector2(2.8,2),Color("bda575"))
			"crane":
				_rod(Vector3(0,0,0),Vector3(w*.5,d*.5,h),wood,4)
				_rod(Vector3(w,d,0),Vector3(w*.5,d*.5,h),wood,4)
				_rod(Vector3(0,d*.5,h*.8),Vector3(w,d*.5,h*1.12),wood,4)
				_rod(Vector3(w*.9,d*.5,h*1.08),Vector3(w*.9,d*.5,.12),Color("bca477"),1)
			"boat":
				var shape := PackedVector2Array([_p(0,d*.5,.1),_p(w*.18,0,0),_p(w*.83,0,0),_p(w,d*.5,.1),_p(w*.83,d,0),_p(w*.18,d,0)])
				_polygon(shape,_c(wood))
				for i in range(5):
					_rod(Vector3(w*(i+.5)/5,.04,.03),Vector3(w*(i+.5)/5,d-.04,.03),Color("baa176"),1.7)
				_rod(Vector3(w*.5,d*.5,0),Vector3(w*.5,d*.5,h),wood,2)
				if h>.4:
					_polygon(PackedVector2Array([_p(w*.5,d*.5,h),_p(w*.86,d*.5,h*.8),_p(w*.86,d*.5,h*.3),_p(w*.5,d*.5,h*.2)]),_c(Color("c9bd93")))
			"pen":
				for i in range(3):
					var x := w*(.22+.28*i)
					var y := d*(.33+.2*float(i%2))
					var q := _p(x,y,.2)
					_oval(q,Vector2(10,6),Color("b6aa8a"))
					_oval(q+Vector2(9,-3),Vector2(4,3),Color("8f7a58"))
					for offset in [-6,6]:
						_line(q+Vector2(offset,3),q+Vector2(offset,10),_c(wood),1.6,true)
			"monument":
				if variant in ["platform","plinth","observatory_platform"]:
					_box(0,0,0,w,d,h,stone)
				elif variant=="spire":
					_rod(Vector3(w*.5,d*.5,0),Vector3(w*.5,d*.5,h),Color("c6aa64"),2.6)
					for i in range(5):
						_oval(_p(w*.5,d*.5,h*i/5),Vector2(5-i*.7,1.9-i*.2),Color("bfa15c"))
				elif "armillary" in variant:
					_box(0,0,0,w,d,.15,stone)
					var q := _p(w*.5,d*.5,h*.7)
					for angle in [0.0,1.0,2.0]:
						var points := PackedVector2Array()
						for i in range(25):
							var a := i*TAU/24
							points.append(q+Vector2(cos(a)*w*28,sin(a)*w*15).rotated(angle))
						_polyline(points,_c(Color("bda56e")),1.7,true)
				elif "banner" in variant:
					_rod(Vector3(0,0,0),Vector3(0,0,h),wood,2)
					_polygon(PackedVector2Array([_p(0,0,h),_p(w,0,h),_p(w,0,h*.4),_p(0,0,h*.5)]),_c(Color("a06746")))
				else:
					_box(0,0,0,w,d,.06,stone)
					_oval(center-Vector2(0,h*35),Vector2(w*25,h*33),stone if "lion" in variant else Color("a59365"))
			"chimney":
				_box(0,0,0,w,d,h,Color("9b805f"))
				for i in range(ceili(h/.08)):
					_rod(Vector3(0,d,float(i)*.08),Vector3(w,d,float(i)*.08),Color("6f624c"),.6)
			"eave_skirt":
				# An actual open ring: no solid roof can intersect the next storey.
				var band: float = module.get("skirt_depth",.07)
				for rect in [Rect2(-band,-band,w+band*2,band),Rect2(-band,d,w+band*2,band),Rect2(-band,0,band,d),Rect2(w,0,band,d)]:
					_box(rect.position.x,rect.position.y,h-.025,rect.size.x,rect.size.y,.035,Color("52685f"))
			"light":
				if night>.05:
					var q := _p(w*.38,d-.025,h*.43)
					_glow(q,12.0,Color(1.0,.60,.21,night*.24))
					_polygon(PackedVector2Array([q+Vector2(-3,-4),q+Vector2(3,-1),q+Vector2(3,4),q+Vector2(-3,1)]),Color(1.0,.76,.36,night*.38))

		_finish_mesh()

var _manifest: Dictionary = {}
var _textures: Dictionary = {}
var _atlas: Texture2D
var _nature_atlas: Texture2D
var _nature_regions: Dictionary = {}
var _materials: Dictionary = {}
var _entries: Dictionary = {}
var _details: Array = []
var _night := 0.0
var _time := 0.0
var _enabled := false
var _shader: Shader
var _light_material: CanvasItemMaterial

func _init() -> void:
	y_sort_enabled = true
	position = Vector2.ZERO
	_shader = Shader.new()
	_shader.code = NIGHT_SHADER
	_light_material = CanvasItemMaterial.new()
	_light_material.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
	_light_material.light_mode = CanvasItemMaterial.LIGHT_MODE_UNSHADED
	if FileAccess.file_exists(ART+"manifest.json"):
		var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(ART+"manifest.json"))
		if parsed is Dictionary:
			_manifest = parsed.get("parts",{})

func setup(_world: Node2D) -> void:
	y_sort_enabled = true

static func iso(x: float,y: float) -> Vector2:
	return Vector2((x-y)*64.0,(x+y)*32.0)

func _texture(key: String) -> Texture2D:
	if _manifest.has(key) and _manifest[key].has("atlas_rect"):
		if not _atlas:
			_atlas = load(ART+"architecture-atlas.webp")
		return _atlas
	if not _textures.has(key):
		var path: String = ART+key+".webp"
		if ResourceLoader.exists(path):
			_textures[key] = load(path)
		else:
			return null
	return _textures[key]

func _material(progress: float,axis: float,furnace: bool = false,operating: bool = false) -> ShaderMaterial:
	var quantized := floorf(clampf(progress,0,1)*64.0)/64.0
	var key := "%d:%d:%s:%s" % [int(quantized*64),int(axis),str(furnace),str(operating)]
	if not _materials.has(key):
		var material := ShaderMaterial.new()
		material.shader = _shader
		material.set_shader_parameter("night",_night)
		material.set_shader_parameter("reveal",quantized)
		material.set_shader_parameter("reveal_axis",axis)
		material.set_shader_parameter("furnace",furnace)
		material.set_shader_parameter("operating",operating)
		material.set_shader_parameter("clock",_time)
		_materials[key] = material
	return _materials[key]

func _asset(node: Node2D,key: String,target_width: float,elevation: float,progress: float = 1.0,axis: float = 0.0,flip: bool = false,operating: bool = false,stage: int = -1) -> Sprite2D:
	var texture := _texture(key)
	if not texture:
		return null
	var meta: Dictionary = _manifest.get(key,{})
	var pivot: Array = meta.get("pivot_px",[texture.get_width()*.65,texture.get_height()])
	var sprite := Sprite2D.new()
	sprite.name = key
	sprite.set_meta("stage",stage)
	sprite.set_meta("axis",axis)
	sprite.set_meta("furnace",key=="kiln")
	sprite.set_meta("operating",operating)
	sprite.texture = texture
	if meta.has("atlas_rect"):
		var rect: Array = meta.atlas_rect
		sprite.region_enabled = true
		sprite.region_rect = Rect2(float(rect[0]),float(rect[1]),float(rect[2]),float(rect[3]))
		sprite.region_filter_clip_enabled = true
	sprite.centered = false
	var scale_value := target_width/float(meta.get("width",texture.get_width()))
	sprite.scale = Vector2(scale_value,scale_value)
	if flip:
		sprite.scale.x = -scale_value
		sprite.position = Vector2(float(pivot[0])*scale_value,-float(pivot[1])*scale_value-elevation*64)
	else:
		sprite.position = -Vector2(float(pivot[0]),float(pivot[1]))*scale_value-Vector2(0,elevation*64)
	sprite.material = _material(progress,axis,key=="kiln",operating)
	sprite.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
	node.add_child(sprite)
	return sprite

func _detail(nodes: Array,m: Dictionary,b: Dictionary,kind: String,anchor: Vector2,progress: float = 1.0) -> Detail:
	var detail := Detail.new()
	detail.module = m
	detail.base = Vector2(float(b.get("x",0))+float(m.x),float(b.get("y",0))+float(m.y))
	detail.position = anchor
	detail.kind = kind
	detail.variant = str(m.get("variant",""))
	detail.night = _night
	detail.material = _material(1.0,0.0) if kind!="light" else _light_material
	detail.progress = progress
	detail.production = _production_progress(b)
	detail.operating = _operating(b)
	detail.clock = _time
	detail.name = "%s_%s" % [str(b.get("id",0)),str(m.id)+"_"+kind]
	add_child(detail)
	nodes.append(detail)
	_details.append(detail)
	return detail

static func _production_progress(b: Dictionary) -> float:
	var value: Variant = b.get("production",{})
	if value is Dictionary:
		return clampf(float(value.get("progress",float(value.get("elapsed",0))/maxf(1.0,float(value.get("duration",1))))),0.0,1.0)
	return 0.0

static func _operating(b: Dictionary) -> bool:
	var construction: Variant = b.get("construction",null)
	var building_now := construction is Dictionary and float(construction.get("remaining",0))>0
	return bool(b.get("staffed",false)) and not bool(b.get("idle",false)) and not bool(b.get("damage",false)) and not building_now

static func _construction_progress(b: Dictionary) -> float:
	var c: Variant = b.get("construction",null)
	if c is Dictionary and float(c.get("remaining",0))>0:
		return clampf(1.0-float(c.remaining)/maxf(1.0,float(c.get("total",1))),0.0,1.0)
	return 1.0

static func _construction_stage(progress: float) -> int:
	var stage := 0
	for limit: float in [.12,.34,.58,.70,.92,1.0]:
		if progress+0.000001>=limit:
			stage+=1
	return stage

func _anchor(b: Dictionary,m: Dictionary,all_modules: Array) -> Vector2:
	var front := Vector2(float(b.get("x",0))+float(m.x)+float(m.w),float(b.get("y",0))+float(m.y)+float(m.d))
	# Storeys supported by the same main volume share its true ground contact.
	# Their child image is elevated; their sorting point never jumps up into sky.
	if float(m.get("z",0))>.35 and str(m.kind) in ["wing","tower","pavilion"]:
		var center := Vector2(float(m.x)+float(m.w)*.5,float(m.y)+float(m.d)*.5)
		for lower: Dictionary in all_modules:
			if lower==m or not str(lower.kind) in ["wing","tower","pavilion"]:
				continue
			if float(lower.z)>=float(m.z) or float(lower.z)>.35:
				continue
			var rect := Rect2(float(lower.x),float(lower.y),float(lower.w),float(lower.d))
			if rect.has_point(center):
				front = Vector2(float(b.get("x",0))+float(lower.x)+float(lower.w),float(b.get("y",0))+float(lower.y)+float(lower.d))
				break
	return iso(front.x,front.y)

func _phase_progress(progress: float,stage: int) -> float:
	var spans := [[0.0,.12],[.12,.34],[.34,.58],[.58,.70],[.70,.92],[.92,1.0]]
	return clampf((progress-float(spans[stage][0]))/(float(spans[stage][1])-float(spans[stage][0])),0,1)

func _build(b: Dictionary) -> Array:
	var nodes: Array = []
	var construction: Variant = b.get("construction",null)
	var progress := 1.0
	var level: int = int(b.get("lvl",1))
	var old: Dictionary = {}
	if construction is Dictionary and float(construction.get("remaining",0))>0:
		progress = clampf(1.0-float(construction.get("remaining",0))/maxf(1,float(construction.get("total",1))),0,1)
		level = int(construction.get("toLevel",level))
		if int(construction.get("fromLevel",0))>0:
			for item: Dictionary in Recipes.create(str(b.type),int(construction.fromLevel)):
				old[item.id]=item
	var modules: Array = Recipes.create(str(b.get("type","house")),level)
	modules.sort_custom(func(a: Dictionary,c: Dictionary)->bool: return float(a.z)<float(c.z))
	for m: Dictionary in modules:
		var retained := old.has(m.id)
		var part_progress := 1.0 if retained else progress
		var elevated_upgrade := not old.is_empty() and not retained and float(m.get("z",0))>.35
		var frame_stage := 2 if elevated_upgrade else 1
		var wall_stage := 3 if elevated_upgrade else 2
		var visual_stage := _construction_stage(part_progress)
		var anchor := _anchor(b,m,modules)
		var base := iso(float(b.get("x",0))+float(m.x)+float(m.w),float(b.get("y",0))+float(m.y)+float(m.d))
		var kind := str(m.kind)
		var width: float = (float(m.w)+float(m.d))*64.0
		var z: float = m.get("z",0)
		var h: float = m.get("h",.4)
		if kind in ["wing","tower","pavilion"]:
			if part_progress<1:
				if not elevated_upgrade:
					var foundation := _detail(nodes,m,b,"foundation",anchor,_phase_progress(part_progress,0))
					foundation.z_index = -1
					foundation.set_meta("stage",0)
				if visual_stage>=frame_stage and _phase_progress(part_progress,wall_stage)<1:
					_detail(nodes,m,b,"frame",anchor,_phase_progress(part_progress,frame_stage)).set_meta("stage",frame_stage)
			var wall_progress := _phase_progress(part_progress,wall_stage)
			var root := Node2D.new()
			root.name = "B%s_%s" % [str(b.get("id",0)),m.id]
			root.position = anchor
			add_child(root)
			nodes.append(root)
			var body := Node2D.new()
			body.position = base-anchor
			root.add_child(body)
			if visual_stage>=wall_stage:
				if kind=="pavilion":
					_asset(body,"colonnade",width*1.06,z,wall_progress,0.0,false,false,-1 if retained else wall_stage)
				else:
					_asset(body,str(m.get("style","plaster_wing")),width*1.06,z,wall_progress,0.0,false,false,-1 if retained else wall_stage)
			var roof_enabled: bool = m.get("roof",true)
			var roof_progress := _phase_progress(part_progress,4)
			if retained and bool(old[m.id].get("roof",false)) and not roof_enabled and progress<.34:
				roof_enabled = true
				roof_progress = 1.0
			if roof_enabled and (visual_stage>=4 or roof_progress>=1):
				_asset(body,str(m.get("roof_style","gray_roof")),width+15,z+h,roof_progress,1.0,false,false,-1 if retained else 4)
			if bool(m.get("eave_skirt",false)) and visual_stage>=4:
				_asset(body,"eave_ring",width+13,z+h-.02,_phase_progress(part_progress,4),1.0,false,false,-1 if retained else 4)
			if part_progress>=1 and (_operating(b) or str(b.get("type","")) in ["house","villa"] and int(b.get("pop",0))>0):
				_detail(nodes,m,b,"light",anchor)
		elif kind=="monument" and str(m.get("variant","")) in ["platform","plinth","observatory_platform"]:
			var amount := _phase_progress(part_progress,0)
			if visual_stage>=0:
				var platform := Node2D.new()
				platform.position = anchor
				platform.z_index = -1
				add_child(platform)
				nodes.append(platform)
				_asset(platform,"stone_terrace",width*1.06,z,amount,0.0,false,false,-1 if retained else 0)
		elif kind=="stock" and str(m.get("variant","")) in ["grain","vegetables","fruit","fish","meat"]:
			var amount := _phase_progress(part_progress,5)
			if visual_stage>=5:
				var counter := Node2D.new()
				counter.position = anchor
				add_child(counter)
				nodes.append(counter)
				_asset(counter,"market_counter",width*1.12,z,amount,0.0,false,false,-1 if retained else 5)
		elif kind in ["gate","kiln","wall"] and str(m.get("variant","")) not in ["steps","wood_fence","theater_backdrop","open_stilts"]:
			var amount := _phase_progress(part_progress,int(m.get("phase",2)))
			if visual_stage<int(m.get("phase",2)):
				continue
			var root := Node2D.new()
			root.position = anchor
			root.name = "B%s_%s" % [str(b.get("id",0)),m.id]
			add_child(root)
			nodes.append(root)
			var visual := Node2D.new()
			visual.position = base-anchor
			root.add_child(visual)
			_asset(visual,"courtwall" if kind=="wall" else kind,width*(1.18 if kind=="wall" else 1.08),z,amount,0.0,kind=="wall" and float(m.d)>float(m.w),_operating(b),-1 if retained else int(m.get("phase",2)))
		elif kind=="tree":
			if visual_stage<4:
				continue
			var root := Node2D.new()
			var center := iso(float(b.get("x",0))+float(m.x)+float(m.w)*.5,float(b.get("y",0))+float(m.y)+float(m.d)*.5)
			root.position = center
			add_child(root)
			nodes.append(root)
			var tree := Sprite2D.new()
			var tree_kind := "cypress" if str(m.get("variant",""))=="bamboo" else "oak"
			if not _nature_atlas:
				_nature_atlas = load("res://art/nature/nature-atlas.webp")
				_nature_regions = JSON.parse_string(FileAccess.get_file_as_string("res://art/nature/nature-atlas.json"))
			if _nature_atlas and _nature_regions.has(tree_kind):
				var region: Array = _nature_regions[tree_kind]
				tree.texture = _nature_atlas
				tree.region_enabled = true
				tree.region_rect = Rect2(float(region[0]),float(region[1]),float(region[2]),float(region[3]))
				tree.region_filter_clip_enabled = true
				tree.centered = false
				var sw: float = width*(.55 if tree_kind=="cypress" else 1.0)
				var scale_value: float = sw/tree.region_rect.size.x
				tree.scale = Vector2.ONE*scale_value
				tree.position = Vector2(-sw*.5,-tree.region_rect.size.y*scale_value-z*64)
				tree.material = _material(1,0)
				root.add_child(tree)
		else:
			var amount := _phase_progress(part_progress,int(m.get("phase",4)))
			if visual_stage<int(m.get("phase",4)):
				continue
			var detail_kind := kind
			if str(m.get("variant",""))=="steps":
				detail_kind = "steps"
			elif str(m.get("variant",""))=="wood_fence":
				detail_kind = "fence"
			elif str(m.get("variant",""))=="open_stilts":
				detail_kind = "frame"
			elif str(m.get("variant",""))=="theater_backdrop":
				detail_kind = "stock"
			var detail := _detail(nodes,m,b,detail_kind,anchor,amount)
			detail.set_meta("stage",-1 if retained else int(m.get("phase",4)))
			if detail_kind in ["pond","crop"] or str(m.get("variant","")) in ["plinth","platform","observatory_platform"]:
				detail.z_index = -1
	return nodes

func sync_buildings(list: Array,_city: Dictionary) -> void:
	var live := {}
	for value: Variant in list:
		if not value is Dictionary or str(value.get("type","road"))=="road":
			continue
		var b: Dictionary = value
		var id := str(b.get("id",str(b.get("x",0))+":"+str(b.get("y",0))))
		live[id] = true
		var construction: Dictionary = b.get("construction",{}) if b.get("construction") is Dictionary else {}
		var signature := JSON.stringify([b.get("type"),b.get("x"),b.get("y"),b.get("lvl"),construction.get("fromLevel",0),construction.get("toLevel",0),_construction_stage(_construction_progress(b)),b.get("staffed"),b.get("idle"),int(b.get("pop",0))>0,b.get("damage",0)])
		if _entries.has(id) and _entries[id].signature==signature:
			_update_entry(_entries[id].nodes,b)
			continue
		if _entries.has(id):
			for node: Node in _entries[id].nodes:
				remove_child(node)
				node.queue_free()
		_entries[id] = {"signature":signature,"nodes":_build(b)}
	for id: String in _entries.keys():
		if live.has(id):
			continue
		for node: Node in _entries[id].nodes:
			remove_child(node)
			node.queue_free()
		_entries.erase(id)
	_details = _details.filter(func(node: Node)->bool: return is_instance_valid(node) and not node.is_queued_for_deletion())

func _update_entry(nodes: Array,b: Dictionary) -> void:
	var progress := _construction_progress(b)
	for node: Node in nodes:
		if node is Detail:
			var detail: Detail = node
			var amount := 1.0 if int(detail.get_meta("stage",-1))<0 else _phase_progress(progress,int(detail.get_meta("stage")))
			var production := _production_progress(b)
			if absf(amount-detail.progress)>.002 or int(production*48)!=int(detail.production*48):
				detail.progress = amount
				detail.production = production
				detail.invalidate()
		else:
			_update_reveal(node,progress)

func _update_reveal(node: Node,progress: float) -> void:
	if node is Sprite2D and int(node.get_meta("stage",-1))>=0:
		var amount := _phase_progress(progress,int(node.get_meta("stage")))
		node.material = _material(amount,float(node.get_meta("axis",0)),bool(node.get_meta("furnace",false)),bool(node.get_meta("operating",false)))
	for child: Node in node.get_children():
		_update_reveal(child,progress)

func create_preview(type: String,level: int = 1) -> Node2D:
	var preview := CityBuildings.new()
	preview.sync_buildings([{"id":"preview","type":type,"x":0,"y":0,"lvl":level,"pop":4,"staffed":true}],{})
	preview.set_process(false)
	var size := float(Recipes.size_of(type))
	var bounds := Rect2(-size*64,-240,size*128,size*64+240)
	var first := true
	for node: Node in preview.get_children():
		var visual_bounds := _node_bounds(node,Transform2D.IDENTITY)
		if visual_bounds.size!=Vector2.ZERO:
			bounds = visual_bounds if first else bounds.merge(visual_bounds)
			first = false
	preview.set_meta("preview_bounds",bounds.grow(7.0))
	return preview

static func _node_bounds(node: Node,parent_transform: Transform2D) -> Rect2:
	var transform: Transform2D = parent_transform*node.transform if node is Node2D else parent_transform
	var bounds := Rect2()
	var first := true
	if node is Sprite2D and node.texture:
		bounds = transform*node.get_rect()
		first = false
	elif node is Detail:
		var m: Dictionary = node.module
		var h: float = float(m.get("h",0))+float(m.get("z",0))
		var a: Vector2 = iso(node.base.x,node.base.y)-Vector2(0,h*64)
		var left: Vector2 = iso(node.base.x,node.base.y+float(m.d))
		var right: Vector2 = iso(node.base.x+float(m.w),node.base.y)
		var bottom: Vector2 = iso(node.base.x+float(m.w),node.base.y+float(m.d))
		bounds = Rect2(Vector2(left.x,a.y),Vector2(right.x-left.x,bottom.y-a.y)).grow(8)
		first = false
	for child: Node in node.get_children():
		var child_bounds := _node_bounds(child,transform)
		if child_bounds.size!=Vector2.ZERO:
			bounds = child_bounds if first else bounds.merge(child_bounds)
			first = false
	return bounds

func set_night(amount: float) -> void:
	if absf(amount-_night)<.001:
		return
	_night = clampf(amount,0,1)
	for material: ShaderMaterial in _materials.values():
		material.set_shader_parameter("night",_night)
	for detail: Detail in _details:
		if is_instance_valid(detail) and detail.kind=="light":
			detail.night = _night
			detail.invalidate()

func set_animation(value: Variant) -> void:
	if value is bool:
		_enabled = value
		set_process(_enabled)
		return
	_time = float(value)
	for key: String in _materials:
		if key.ends_with(":true:true"):
			_materials[key].set_shader_parameter("clock",_time)
	for detail: Detail in _details:
		if is_instance_valid(detail) and detail.operating and detail.kind in ["mill","loom","workbench"]:
			detail.clock = _time
			detail.invalidate()

func _process(delta: float) -> void:
	if _enabled:
		set_animation(_time+delta)

func inspect() -> Dictionary:
	var modules: Array = []
	for child: Node2D in get_children():
		modules.append({"name":child.name,"ground_y":child.position.y,"ground_x":child.position.x,"z_index":child.z_index})
	return {"buildings":_entries.size(),"renderables":get_child_count(),"materials":_materials.size(),"night":_night,"modules":modules}
