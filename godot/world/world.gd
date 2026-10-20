extends Node2D
class_name CityWorld

signal tile_action(x: int, y: int, drag: bool)
signal selection_changed(x: int, y: int)
signal road_stroke(points: Array)

const TILE_W := 128.0
const TILE_H := 64.0
const NatureScript = preload("res://world/nature.gd")
const CitizensScript = preload("res://world/citizens.gd")
const ConstructionWorkersScript = preload("res://world/construction_workers.gd")

class SelectionOverlay extends Node2D:
	var cell := Vector2i(-1,-1)
	var size := 1
	var permitted := true
	var selected := false
	func _draw() -> void:
		if cell.x<0:
			return
		var p := Vector2((cell.x-cell.y)*64.0,(cell.x+cell.y)*32.0)
		var polygon := PackedVector2Array([p,p+Vector2(64,32)*size,p+Vector2(0,64)*size,p+Vector2(-64,32)*size])
		var c := Color(.89,.76,.40,.90) if selected else (Color(.38,.87,.65,.9) if permitted else Color(.95,.39,.28,.9))
		draw_colored_polygon(polygon,Color(c,.13))
		polygon.append(polygon[0])
		draw_polyline(polygon,c,2.0,true)

var camera: Camera2D
var object_root: Node2D
var buildings: Node2D
var nature: CityNature
var citizens: CityCitizens
var construction_workers: CityConstructionWorkers
var _terrain: Polygon2D
var _terrain_material: ShaderMaterial
var _road_mesh: MeshInstance2D
var _road_material: ShaderMaterial
var _overlay: SelectionOverlay
var _city: Dictionary = {}
var _tiles: Array = []
var _all_buildings: Array = []
var _map_size := Vector2i(64,64)
var _occupied: Dictionary = {}
var _build_signature := ""
var _road_signature := ""
var _road_style_signature := ""
var _road_info: Dictionary = {}
var _road_tiers := {"dirt":0,"gravel":0,"slab":0}
var _road_rebuilds := 0
var _depot: Node2D
var _depot_signature := ""
var _depot_cell := Vector2i(-1,-1)
var _night := 0.0
var _clock := 0.0
var _paused := false
var _tool := ""
var _tool_size := 1
var _started := false
var _dragging := false
var _drag_distance := 0.0
var _pointer_start := Vector2.ZERO
var _pointer_last := Vector2.ZERO
var _touches: Dictionary = {}
var _last_road := Vector2i(-999,-999)
var _selected := Vector2i(-1,-1)
var _stroke_anchor := Vector2i(-999,-999)
var _stroke_last := Vector2i(-999,-999)
var _stroke_sent: Dictionary = {}
var _gesture_pinched := false
var _css_scale := 1.0
var _noise_seed := -1
var _overlay_signature := ""
var _quality := "high"
var _field_seed := -1
var _grass_noise: FastNoiseLite
var _soil_noise: FastNoiseLite

func _ready() -> void:
	_terrain = Polygon2D.new()
	_terrain_material = ShaderMaterial.new()
	_terrain_material.shader = preload("res://world/terrain.gdshader")
	_terrain.material = _terrain_material
	add_child(_terrain)
	_road_mesh = MeshInstance2D.new()
	_road_material = ShaderMaterial.new()
	_road_material.shader = preload("res://world/roads.gdshader")
	_road_mesh.material = _road_material
	add_child(_road_mesh)
	object_root = Node2D.new()
	object_root.name = "SortedWorld"
	object_root.y_sort_enabled = true
	add_child(object_root)
	nature = NatureScript.new()
	object_root.add_child(nature)
	var building_script: Script = load("res://world/buildings.gd")
	if building_script:
		buildings = building_script.new()
		object_root.add_child(buildings)
	citizens = CitizensScript.new()
	object_root.add_child(citizens)
	construction_workers = ConstructionWorkersScript.new()
	object_root.add_child(construction_workers)
	_overlay = SelectionOverlay.new()
	_overlay.z_index = 100
	add_child(_overlay)
	camera = Camera2D.new()
	camera.position_smoothing_enabled = false
	camera.zoom = Vector2.ONE*.85
	add_child(camera)
	camera.make_current()
	_css_scale = _css_factor()
	get_viewport().size_changed.connect(_resize_view)
	if not _city.is_empty():
		sync_state(_city,true)

static func iso(x: float,y: float) -> Vector2:
	return Vector2((x-y)*64.0,(x+y)*32.0)

static func world_to_tile(p: Vector2) -> Vector2:
	return Vector2((p.x/64.0+p.y/32.0)*.5,(p.y/32.0-p.x/64.0)*.5)

func screen_to_tile(screen: Vector2) -> Vector2i:
	var p: Vector2 = get_viewport().get_canvas_transform().affine_inverse()*screen
	var t := world_to_tile(p)
	return Vector2i(floori(t.x),floori(t.y))

func sync_state(city: Dictionary,full: bool = false) -> void:
	_city = city
	if not is_node_ready():
		return
	_map_size = Vector2i(int(city.get("mapW",64)),int(city.get("mapH",64)))
	if city.has("tiles") and not city.tiles.is_empty():
		_tiles = city.tiles
		full = true
	var requested_quality: String = str(city.get("settings",{}).get("quality","auto"))
	var quality: String = requested_quality
	if quality=="auto":
		quality = "low" if get_viewport_rect().size.x/_css_factor()<600 else "high"
	if quality!=_quality:
		_quality = quality
		nature.set_quality(quality)
		citizens.population_limit = 24 if quality=="low" else 80
		_terrain_material.set_shader_parameter("low_detail",quality=="low")
		_road_material.set_shader_parameter("low_detail",quality=="low")
		_build_signature = ""
	_all_buildings = city.get("buildings",[])
	var signature := ""
	var roads := ""
	var residences := ""
	_occupied.clear()
	for b: Dictionary in _all_buildings:
		var x: int = int(b.get("x",0))
		var y: int = int(b.get("y",0))
		var size: int = int(b.get("size",1))
		var kind: String = str(b.get("type",""))
		signature += "%s/%d/%d/%s;" % [str(b.get("id","")),x,y,kind]
		if kind=="road":
			roads += "%d,%d;" % [x,y]
		elif kind in ["house","villa"]:
			residences += "%s/%d/%d/%d/%d/%s;" % [kind,x,y,size,_completed_level(b),str(b.get("beauty",0))]
		for yy in range(size):
			for xx in range(size):
				_occupied[Vector2i(x+xx,y+yy)] = b
	if full or roads!=_road_signature:
		_update_terrain()
		_road_signature = roads
	var road_style: String = roads+"|"+residences
	if road_style!=_road_style_signature:
		_road_style_signature = road_style
		_update_roads()
	if full or signature!=_build_signature:
		nature.sync_nature(_tiles,_all_buildings,int(city.get("seedHash",42)))
		_build_signature = signature
	if buildings and buildings.has_method("sync_buildings"):
		buildings.sync_buildings(_all_buildings,city)
	citizens.sync_city(_all_buildings,city)
	construction_workers.sync_city(city,buildings)
	_sync_depot()
	_update_coverage()
	if not _started:
		_started = true
		center_city()
	var selection: Dictionary = city.get("selection",{})
	if selection.has("x") and selection.has("y"):
		_selected = Vector2i(int(selection.x),int(selection.y))
	else:
		_selected = Vector2i(-1,-1)
	_refresh_preview(_selected if _tool.is_empty() else _overlay.cell)

func _update_terrain() -> void:
	var w := float(_map_size.x)
	var h := float(_map_size.y)
	_terrain.polygon = PackedVector2Array([iso(0,0),iso(w,0),iso(w,h),iso(0,h)])
	_terrain.uv = PackedVector2Array([Vector2(0,0),Vector2(1,0),Vector2(1,1),Vector2(0,1)])
	# Polygon UVs are pixel units when a texture exists. The shader uses normalized UV;
	# a tiny neutral 1×1 texture establishes that coordinate domain unambiguously.
	if not _terrain.texture:
		var white := Image.create(1,1,false,Image.FORMAT_RGBA8)
		white.fill(Color.WHITE)
		_terrain.texture = ImageTexture.create_from_image(white)
	var seed_value: int = int(_city.get("seedHash",42))%65535
	if _field_seed!=seed_value:
		_field_seed = seed_value
		_grass_noise = FastNoiseLite.new()
		_grass_noise.seed = seed_value
		_grass_noise.frequency = .21
		_grass_noise.fractal_type = FastNoiseLite.FRACTAL_FBM
		_grass_noise.fractal_octaves = 3
		_soil_noise = FastNoiseLite.new()
		_soil_noise.seed = seed_value+307
		_soil_noise.frequency = .037
		_soil_noise.fractal_type = FastNoiseLite.FRACTAL_FBM
		_soil_noise.fractal_octaves = 3
	var data := Image.create(_map_size.x,_map_size.y,false,Image.FORMAT_RGBA8)
	for y in range(_map_size.y):
		for x in range(_map_size.x):
			var kind := "grass"
			if y<_tiles.size() and x<_tiles[y].size():
				kind = str(_tiles[y][x].get("t","grass"))
			var b: Dictionary = _occupied.get(Vector2i(x,y),{})
			var road_code := 0
			if b.get("type","")=="road":
				road_code = 1
				if _occupied.get(Vector2i(x-1,y),{}).get("type","")=="road" or _occupied.get(Vector2i(x+1,y),{}).get("type","")=="road":
					road_code+=2
				if _occupied.get(Vector2i(x,y-1),{}).get("type","")=="road" or _occupied.get(Vector2i(x,y+1),{}).get("type","")=="road":
					road_code+=4
			var grass: float = clampf(.5+_grass_noise.get_noise_2d(x,y)*.5,0,1)
			var soil: float = clampf(.5+_soil_noise.get_noise_2d(x,y)*.6,0,1)
			data.set_pixel(x,y,Color(1.0 if kind=="water" else 0.0,float(road_code)/7.0,grass,soil))
	_terrain_material.set_shader_parameter("terrain_map",ImageTexture.create_from_image(data))
	_terrain_material.set_shader_parameter("map_size",Vector2(_map_size))
	var seed_hash: int = int(_city.get("seedHash",42))%65535
	_terrain_material.set_shader_parameter("world_seed",float(seed_hash))
	if _noise_seed!=seed_hash:
		_noise_seed = seed_hash
		var noise := FastNoiseLite.new()
		noise.seed = seed_hash
		noise.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
		noise.frequency = .12
		noise.fractal_type = FastNoiseLite.FRACTAL_FBM
		noise.fractal_octaves = 3
		# One small native noise texture per seed, never per zoom or frame.
		var noise_texture := ImageTexture.create_from_image(noise.get_seamless_image(128,128))
		_terrain_material.set_shader_parameter("noise_map",noise_texture)
		_road_material.set_shader_parameter("noise_map",noise_texture)
	_terrain_material.set_shader_parameter("night",_night)

static func _completed_level(b: Dictionary) -> int:
	var construction: Variant = b.get("construction",null)
	if construction is Dictionary and float(construction.get("remaining",0))>0:
		return int(construction.get("fromLevel",0))
	return int(b.get("lvl",1))

func road_info(x: int,y: int) -> Dictionary:
	return _road_info.get(Vector2i(x,y),{}).duplicate()

func _update_road_tiers() -> void:
	_road_info.clear()
	_road_tiers = {"dirt":0,"gravel":0,"slab":0}
	for b: Dictionary in _all_buildings:
		if str(b.get("type",""))=="road":
			_road_info[Vector2i(int(b.x),int(b.y))] = {"tier":0,"name":"土路","reason":"附近住宅与美化尚未达到铺装条件"}
	for b: Dictionary in _all_buildings:
		var kind: String = str(b.get("type",""))
		if kind not in ["house","villa"]:continue
		var level := _completed_level(b)
		if level<=0:continue
		var beauty: float = float(b.get("beauty",0))
		var advanced: bool = level >= (7 if kind=="house" else 4)
		var developed: bool = level >= (4 if kind=="house" else 2)
		var tier := 0
		var reason := ""
		if beauty>=6:
			tier=2
			reason="附近美化达到 6"
		elif advanced and beauty>=2:
			tier=2
			reason="附近%s达到 %d 级且美化达到 2" % ["住宅" if kind=="house" else "别墅",level]
		elif beauty>=2 or developed:
			tier=1
			reason="附近美化达到 2" if beauty>=2 else "附近%s达到 %d 级" % ["住宅" if kind=="house" else "别墅",level]
		if tier==0:continue
		var size: int = int(b.get("size",1))
		for y in range(int(b.y)-2,int(b.y)+size+2):
			for x in range(int(b.x)-2,int(b.x)+size+2):
				var cell:=Vector2i(x,y)
				if _road_info.has(cell) and tier>int(_road_info[cell].tier):
					_road_info[cell]={"tier":tier,"name":"石子路" if tier==1 else "石板路","reason":reason}
	for info:Dictionary in _road_info.values():
		_road_tiers[["dirt","gravel","slab"][int(info.tier)]]+=1

func _road_vertex_tier(p: Vector2,cell: Vector2i) -> float:
	var own:float=float(_road_info[cell].tier)
	# Only blend in the last quarter tile; shared boundary vertices get equal values.
	var total:=own
	var weight:=1.
	for d:Vector2i in [Vector2i.LEFT,Vector2i.RIGHT,Vector2i.UP,Vector2i.DOWN]:
		var neighbor:=cell+d
		if not _road_info.has(neighbor):continue
		var distance:float=absf(p.x-float(cell.x+(1 if d.x>0 else 0))) if d.x!=0 else absf(p.y-float(cell.y+(1 if d.y>0 else 0)))
		var influence:float=1.-smoothstep(0.,.24,distance)
		total+=float(_road_info[neighbor].tier)*influence
		weight+=influence
	return total/weight*.5

func _update_roads() -> void:
	_update_road_tiers()
	_road_rebuilds+=1
	var vertices := PackedVector2Array()
	var uv := PackedVector2Array()
	var colors := PackedColorArray()
	var indices := PackedInt32Array()
	for cell:Vector2i in _road_info:
		var x:=cell.x
		var y:=cell.y
		var horizontal: bool = _road_info.has(cell+Vector2i.LEFT) or _road_info.has(cell+Vector2i.RIGHT)
		var vertical: bool = _road_info.has(cell+Vector2i.UP) or _road_info.has(cell+Vector2i.DOWN)
		# Non-overlapping .25 subdivisions preserve solid material centers and short joins.
		var xs:Array=[0.,.23,.5,.77,1.] if horizontal else [.23,.5,.77]
		var ys:Array=[0.,.23,.5,.77,1.] if vertical else [.23,.5,.77]
		for iy in range(ys.size()-1):
			for ix in range(xs.size()-1):
				var midpoint:=Vector2((xs[ix]+xs[ix+1])*.5,(ys[iy]+ys[iy+1])*.5)
				if not ((horizontal and midpoint.y>=.23 and midpoint.y<=.77) or (vertical and midpoint.x>=.23 and midpoint.x<=.77) or (not horizontal and not vertical)):continue
				var first:=vertices.size()
				for p:Vector2 in [Vector2(x+xs[ix],y+ys[iy]),Vector2(x+xs[ix+1],y+ys[iy]),Vector2(x+xs[ix+1],y+ys[iy+1]),Vector2(x+xs[ix],y+ys[iy+1])]:
					vertices.append(iso(p.x,p.y))
					uv.append(p)
					colors.append(Color(_road_vertex_tier(p,cell),1,1,1))
				for index in [0,1,2,0,2,3]:indices.append(first+index)
	if vertices.is_empty():
		_road_mesh.mesh = null
		return
	var arrays: Array = []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = vertices
	arrays[Mesh.ARRAY_TEX_UV] = uv
	arrays[Mesh.ARRAY_COLOR] = colors
	arrays[Mesh.ARRAY_INDEX] = indices
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES,arrays)
	_road_mesh.mesh = mesh
	_road_material.set_shader_parameter("map_size",Vector2(_map_size))
	_road_material.set_shader_parameter("night",_night)

func _sync_depot() -> void:
	var data:Dictionary=_city.get("logistics",{}).get("depot",{})
	var signature:=JSON.stringify(data)
	if signature==_depot_signature:return
	_depot_signature=signature
	_depot_cell=Vector2i(-1,-1)
	if is_instance_valid(_depot):
		_depot.queue_free()
		_depot=null
	if data.is_empty() or not buildings or not buildings.has_method("create_preview"):return
	_depot_cell=Vector2i(int(data.get("x",-1)),int(data.get("y",-1)))
	if not _valid(_depot_cell) or _occupied.has(_depot_cell):return
	_depot=Node2D.new()
	_depot.position=iso(_depot_cell.x+.5,_depot_cell.y+.5)
	object_root.add_child(_depot)
	var preview:Node2D=buildings.create_preview("warehouse",1)
	preview.scale=Vector2.ONE*.38
	preview.position=-iso(1.,1.)*.38
	preview.set_night(_night)
	_depot.add_child(preview)
	var sign_label:=Label.new()
	sign_label.text="城镇货栈"
	sign_label.add_theme_font_override("font",load("res://art/fonts/chinese.otf"))
	sign_label.add_theme_font_size_override("font_size",12)
	sign_label.add_theme_color_override("font_color",Color("f3dba1"))
	sign_label.add_theme_color_override("font_shadow_color",Color("28251d"))
	sign_label.add_theme_constant_override("shadow_offset_x",1)
	sign_label.add_theme_constant_override("shadow_offset_y",1)
	sign_label.position=Vector2(-24,10)
	_depot.add_child(sign_label)

func _update_coverage() -> void:
	var mode: String = str(_city.get("settings",{}).get("overlay","none"))
	var data: Array = _city.get("overlays",[])
	var signature: String = mode+JSON.stringify(data)
	if signature==_overlay_signature:
		return
	_overlay_signature = signature
	_terrain_material.set_shader_parameter("show_overlay",mode!="none")
	_road_material.set_shader_parameter("show_overlay",mode!="none")
	if mode=="none":
		return
	var field := Image.create(_map_size.x,_map_size.y,false,Image.FORMAT_RGBA8)
	field.fill(Color.TRANSPARENT)
	for entry: Dictionary in data:
		if str(entry.get("kind",""))!=mode:
			continue
		var active: bool = bool(entry.get("active",true))
		if mode!="road" and not active:
			continue
		var x: int = int(entry.get("x",0))
		var y: int = int(entry.get("y",0))
		var size: int = int(entry.get("size",1))
		var radius: int = int(entry.get("radius",0))
		var strength: float = float(entry.get("strength",1.0))
		for yy in range(maxi(0,y-radius),mini(_map_size.y,y+size+radius)):
			for xx in range(maxi(0,x-radius),mini(_map_size.x,x+size+radius)):
				var color := Color(.25,.86,.52,1) if active else Color(.92,.30,.22,1)
				if mode=="water":
					color = Color(.20,.68,.95,.85)
				elif mode=="pollution":
					color = Color(.94,.31,.13,minf(1.0,field.get_pixel(xx,yy).a+.25*strength))
				field.set_pixel(xx,yy,color)
	var texture := ImageTexture.create_from_image(field)
	_terrain_material.set_shader_parameter("overlay_map",texture)
	_road_material.set_shader_parameter("overlay_map",texture)

func center_tile(x: int,y: int) -> void:
	if not camera:
		return
	camera.position = iso(x+.5,y+.5)-Vector2(0,55)
	_clamp_camera()
	camera.force_update_scroll()

func set_night(amount: float) -> void:
	if absf(amount-_night)<.001:
		return
	_night = clampf(amount,0.0,1.0)
	if not is_node_ready():
		return
	_terrain_material.set_shader_parameter("night",_night)
	_road_material.set_shader_parameter("night",_night)
	nature.set_night(_night)
	citizens.set_night(_night)
	construction_workers.set_night(_night)
	if is_instance_valid(_depot):
		for child in _depot.get_children():
			if child.has_method("set_night"):child.set_night(_night)
	if buildings and buildings.has_method("set_night"):
		buildings.set_night(_night)

func set_paused(value: bool) -> void:
	_paused = value
	set_process(not value)
	if citizens:
		citizens.set_paused(value)
	if construction_workers:
		construction_workers.set_paused(value)
	# Shader clock is explicit: paused scenes do not have a hidden TIME animation.
	OS.low_processor_usage_mode = value

func select_tool(type: String) -> void:
	var changed := _tool!=type
	_tool = type
	_tool_size = 1
	for entry: Dictionary in _city.get("catalog",[]):
		if str(entry.get("type",""))==type:
			_tool_size = int(entry.get("size",1))
			break
	if changed:
		_last_road = Vector2i(-999,-999)
	if _overlay:
		_refresh_preview(_selected if type.is_empty() else _overlay.cell)

func _css_factor() -> float:
	if OS.has_feature("web"):
		var browser := JavaScriptBridge.get_interface("window")
		if browser:
			return get_viewport_rect().size.x/maxf(1.0,float(browser.innerWidth))
	return 1.0

func _resize_view() -> void:
	if not camera:
		return
	var factor := _css_factor()
	camera.zoom *= factor/maxf(.001,_css_scale)
	_css_scale = factor
	camera.force_update_scroll()

func center_city() -> void:
	if not camera:
		return
	var start: Dictionary = _city.get("start",{"x":32,"y":32})
	var target := Vector2(float(start.get("x",32)),float(start.get("y",32)))
	for b: Dictionary in _all_buildings:
		if str(b.get("type",""))=="house":
			target = Vector2(float(b.get("x",32)),float(b.get("y",32)))+Vector2.ONE*float(b.get("size",1))*.5
			break
	camera.position = iso(target.x,target.y)-Vector2(0,70)
	var visible := get_viewport_rect().size / _css_factor()
	_css_scale = _css_factor()
	camera.zoom = Vector2.ONE*_css_scale*(.84 if visible.x<650 else .95)
	camera.force_update_scroll()

func zoom_by(factor: float) -> void:
	_zoom_at(factor,get_viewport_rect().size*.5)

func _zoom_at(factor: float,screen: Vector2) -> void:
	var before: Vector2 = get_viewport().get_canvas_transform().affine_inverse()*screen
	camera.zoom = Vector2.ONE*clampf(camera.zoom.x*factor,.26*_css_scale,2.8*_css_scale)
	camera.force_update_scroll()
	var after: Vector2 = get_viewport().get_canvas_transform().affine_inverse()*screen
	camera.position+=before-after
	_clamp_camera()
	camera.force_update_scroll()

func _clamp_camera() -> void:
	var tile := world_to_tile(camera.position)
	tile.x = clampf(tile.x,-3,float(_map_size.x)+3)
	tile.y = clampf(tile.y,-3,float(_map_size.y)+3)
	camera.position = iso(tile.x,tile.y)

func _process(delta: float) -> void:
	_clock += minf(delta,.1)
	_terrain_material.set_shader_parameter("clock",_clock)
	if buildings and buildings.has_method("set_animation"):
		buildings.set_animation(_clock)
	citizens.animate(minf(delta,.1))
	construction_workers.animate(minf(delta,.1))

func _valid(p: Vector2i) -> bool:
	return p.x>=0 and p.y>=0 and p.x<_map_size.x and p.y<_map_size.y

func _refresh_preview(p: Vector2i) -> void:
	if not _overlay:
		return
	_overlay.cell = p if _valid(p) else Vector2i(-1,-1)
	_overlay.size = _tool_size
	_overlay.selected = _tool.is_empty() or _tool=="select"
	_overlay.permitted = true
	if not _overlay.selected and _tool not in ["bulldoze","remove","demolish"]:
		var resource: String = {"lumber":"tree","quarry":"stone","clayPit":"clay","copperMine":"copper"}.get(_tool,"")
		var has_resource := resource.is_empty()
		var near_water := false
		for yy in range(-1,_tool_size+1):
			for xx in range(-1,_tool_size+1):
				var q := p+Vector2i(xx,yy)
				var inside := yy>=0 and xx>=0 and yy<_tool_size and xx<_tool_size
				if not _valid(q):
					if inside:
						_overlay.permitted = false
					continue
				var terrain := "grass"
				if q.y<_tiles.size() and q.x<_tiles[q.y].size():
					terrain = str(_tiles[q.y][q.x].get("t","grass"))
				near_water = near_water or terrain=="water"
				if inside:
					if q==_depot_cell:_overlay.permitted=false
					has_resource = has_resource or terrain==resource
					var occupied: Dictionary = _occupied.get(q,{})
					var moving: Variant = _city.get("moving",{})
					var own_origin: bool = moving is Dictionary and not moving.is_empty() and str(occupied.get("id",""))==str(moving.get("id","-"))
					if (not occupied.is_empty() and not own_origin) or (terrain=="water" and _tool!="road"):
						_overlay.permitted = false
		if not has_resource or (_tool in ["fishing","harbor"] and not near_water):
			_overlay.permitted = false
	if _overlay.selected and _occupied.has(p):
		var b: Dictionary = _occupied[p]
		_overlay.cell = Vector2i(int(b.get("x",p.x)),int(b.get("y",p.y)))
		_overlay.size = int(b.get("size",1))
	_overlay.queue_redraw()

func _act(p: Vector2i,drag: bool) -> void:
	if not _valid(p):
		return
	if drag and _tool=="road":
		_paint_road(p)
		return
	_selected = p
	_refresh_preview(p)
	selection_changed.emit(p.x,p.y)
	if drag and p==_last_road:
		return
	_last_road = p
	tile_action.emit(p.x,p.y,drag)

func _begin_stroke(screen: Vector2) -> void:
	_stroke_anchor = screen_to_tile(screen)
	_stroke_last = Vector2i(-999,-999)
	_stroke_sent.clear()
	_gesture_pinched = false

func _road_cells(start: Vector2i,end: Vector2i) -> Array[Vector2i]:
	var result: Array[Vector2i] = [start]
	var delta := end-start
	var dx := absi(delta.x)
	var dy := absi(delta.y)
	var sx := signi(delta.x)
	var sy := signi(delta.y)
	var ix := 0
	var iy := 0
	var p := start
	while ix<dx or iy<dy:
		if ix<dx and (iy>=dy or (float(ix)+.5)/maxi(1,dx)<(float(iy)+.5)/maxi(1,dy)):
			p.x+=sx
			ix+=1
		else:
			p.y+=sy
			iy+=1
		result.append(p)
	return result

func _paint_road(p: Vector2i) -> void:
	var start := _stroke_last if _valid(_stroke_last) else (_stroke_anchor if _valid(_stroke_anchor) else p)
	var points: Array = []
	for cell: Vector2i in _road_cells(start,p):
		if not _valid(cell) or _stroke_sent.has(cell):
			continue
		_stroke_sent[cell] = true
		# Existing roads join the stroke; occupied buildings remain obstacles.
		if _occupied.has(cell) or cell==_depot_cell:
			continue
		points.append({"x":cell.x,"y":cell.y})
	_stroke_last = p
	_last_road = p
	_refresh_preview(p)
	if not points.is_empty():
		road_stroke.emit(points)

func _pan(relative: Vector2) -> void:
	camera.position-=relative/camera.zoom
	_clamp_camera()
	camera.force_update_scroll()

func _input(event: InputEvent) -> void:
	# A release over a GUI panel is consumed before _unhandled_input. Clean only the
	# existing world gesture afterwards; never turn a HUD release into a map action.
	if event is InputEventScreenTouch and not event.pressed:
		call_deferred("_release_touch",event.index)
	elif event is InputEventMouseButton and not event.pressed and event.device!=InputEvent.DEVICE_ID_EMULATION:
		call_deferred("_release_mouse")

func _release_touch(index: int) -> void:
	_touches.erase(index)

func _release_mouse() -> void:
	_dragging = false

func _unhandled_input(event: InputEvent) -> void:
	if (event is InputEventMouseButton or event is InputEventMouseMotion) and event.device==InputEvent.DEVICE_ID_EMULATION:
		return
	if not _started:
		return
	if event is InputEventMouseButton:
		if event.button_index==MOUSE_BUTTON_WHEEL_UP and event.pressed:
			_zoom_at(1.12,event.position)
			get_viewport().set_input_as_handled()
		elif event.button_index==MOUSE_BUTTON_WHEEL_DOWN and event.pressed:
			_zoom_at(1.0/1.12,event.position)
			get_viewport().set_input_as_handled()
		elif event.button_index in [MOUSE_BUTTON_LEFT,MOUSE_BUTTON_MIDDLE,MOUSE_BUTTON_RIGHT]:
			if event.pressed:
				_dragging = true
				_drag_distance = 0.0
				_pointer_start = event.position
				_pointer_last = event.position
				_last_road = Vector2i(-999,-999)
				_begin_stroke(event.position)
			else:
				if _dragging and _drag_distance<7.0*_css_scale and event.button_index==MOUSE_BUTTON_LEFT:
					_act(screen_to_tile(event.position),false)
				_dragging = false
			get_viewport().set_input_as_handled()
	elif event is InputEventMouseMotion:
		if _dragging:
			_drag_distance += event.relative.length()
			if _tool=="road" and event.button_mask&MOUSE_BUTTON_MASK_LEFT:
				_act(screen_to_tile(event.position),true)
			else:
				_pan(event.relative)
			get_viewport().set_input_as_handled()
		_refresh_preview(screen_to_tile(event.position))
	elif event is InputEventScreenTouch:
		if event.pressed:
			_touches[event.index] = event.position
			if _touches.size()==1:
				_pointer_start = event.position
				_drag_distance = 0.0
				_last_road = Vector2i(-999,-999)
				_begin_stroke(event.position)
			else:
				_gesture_pinched = true
				_drag_distance = 100.0
		else:
			if _touches.size()==1 and _drag_distance<9.0*_css_scale:
				_act(screen_to_tile(event.position),false)
			_touches.erase(event.index)
		get_viewport().set_input_as_handled()
	elif event is InputEventScreenDrag:
		if not _touches.has(event.index):
			return
		if _touches.size()>=2:
			var points: Array = _touches.values()
			var before_mid: Vector2 = (points[0]+points[1])*.5
			var before_distance: float = points[0].distance_to(points[1])
			_touches[event.index] = event.position
			points = _touches.values()
			var after_mid: Vector2 = (points[0]+points[1])*.5
			var after_distance: float = points[0].distance_to(points[1])
			if before_distance>10:
				_zoom_at(after_distance/before_distance,before_mid)
			_pan(after_mid-before_mid)
			_drag_distance = 100.0
		else:
			_touches[event.index] = event.position
			_drag_distance += event.relative.length()
			if _tool=="road" and not _gesture_pinched and _drag_distance>7*_css_scale:
				_act(screen_to_tile(event.position),true)
			elif _drag_distance>7*_css_scale:
				_pan(event.relative)
			_refresh_preview(screen_to_tile(event.position))
		get_viewport().set_input_as_handled()
	elif event is InputEventMagnifyGesture:
		_zoom_at(event.factor,event.position)
		get_viewport().set_input_as_handled()
	elif event is InputEventPanGesture:
		_pan(event.delta*20.0)
		get_viewport().set_input_as_handled()

func diagnostics() -> Dictionary:
	return {"tiles":_map_size.x*_map_size.y,"buildings":_all_buildings.size(),"nature_clusters":nature._items.size() if nature else 0,"citizens":citizens._actors.size() if citizens else 0,"camera_zoom":camera.zoom.x if camera else 0.0,"css_zoom":camera.zoom.x/_css_scale if camera else 0.0,"camera_position":[camera.position.x,camera.position.y] if camera else [0,0],"viewport_size":[get_viewport_rect().size.x,get_viewport_rect().size.y],"css_scale":_css_scale,"selected_road":road_info(_selected.x,_selected.y),"logistics":citizens.diagnostics() if citizens and citizens.has_method("diagnostics") else {},"construction":construction_workers.diagnostics() if construction_workers else {},"road_tiers":_road_tiers.duplicate(),"road_rebuilds":_road_rebuilds,"deposits":nature.deposits.diagnostics() if nature else {},"depot":[_depot_cell.x,_depot_cell.y],"terrain_backend":"GPU world-coordinate shader","quality":_quality,"paused":_paused,"selected":[_selected.x,_selected.y]}
