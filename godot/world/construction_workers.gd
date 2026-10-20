extends Node2D
class_name CityConstructionWorkers
const Motion = preload("res://world/actor_animation.gd")

## Rendering only: every crew and clock comes from constructionSites. No jobs,
## resources, construction progress or economic effects are created here.
class Worker extends Node2D:
	var sprite: Sprite2D
	var job: Dictionary = {}
	var site: Dictionary = {}
	var target: Dictionary = {}
	var cycle := -1
	var point := Vector3.ZERO
	var ladder := Vector3.ZERO
	var route: Array[Vector3] = []
	var route_length := 0.0
	var distance := 0.0
	var start_progress := 0.0
	var authority_progress := 0.0
	var snapshot_age := 0.0
	var duration := 1.0
	var phase := ""
	var layout := ""
	var clock := 0.0
	var stride := 0.0
	var facing := 3
	var frame := ""
	var walking := false
	var travelled := 0.0
	var pivot := Vector2.ZERO
	var sprite_scale := .085
	var loaded := false
	var material_kind := "brick"
	var arrived := true
	var action := ""
	var frame_changes := 0
	var climbing := false
	var operation := "install"
	var retargeting := false
	var retarget_seconds := 0.0

const ATLAS_DATA := "res://art/workers/workers-atlas.json"
const COMPONENT_DATA := "res://art/components/manifest.json"
const PHASE_SECONDS := {"loading":4.0,"carrying":10.0,"installing":12.0,"returning":10.0,"leaving":12.0}
var _actors: Dictionary = {}
var _scaffolds: Dictionary = {}
var _workstages: Dictionary = {}
var _lamps: Dictionary = {}
var _glow_texture: GradientTexture2D
var _glow_material: CanvasItemMaterial
var _atlas: Texture2D
var _sprites: Dictionary = {}
var _animations: Dictionary = {}
var _directions := 4
var _reduced_motion := false
var _components: Dictionary = {}
var _component_textures: Dictionary = {}
var _city_identity := ""
var _last_city_time := -1.0
var _speed := 1.0
var _paused := false
var _night := 0.0
var _site_count := 0
var _buildings: Node2D

func _init(load_art: bool=true) -> void:
	y_sort_enabled = true
	var gradient := Gradient.new()
	gradient.offsets = PackedFloat32Array([0.0,.25,1.0])
	gradient.colors = PackedColorArray([Color(1,.68,.29,.80),Color(1,.60,.20,.26),Color(1,.52,.12,0)])
	_glow_texture = GradientTexture2D.new()
	_glow_texture.gradient = gradient
	_glow_texture.width = 64
	_glow_texture.height = 64
	_glow_texture.fill = GradientTexture2D.FILL_RADIAL
	_glow_texture.fill_from = Vector2(.5,.5)
	_glow_texture.fill_to = Vector2(1,.5)
	_glow_material = CanvasItemMaterial.new()
	_glow_material.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
	_glow_material.light_mode = CanvasItemMaterial.LIGHT_MODE_UNSHADED
	if load_art and FileAccess.file_exists(ATLAS_DATA):
		var data: Variant = JSON.parse_string(FileAccess.get_file_as_string(ATLAS_DATA))
		if data is Dictionary:
			_sprites = data.get("sprites",{})
			_animations = data.get("animations",{})
			_directions = Motion.direction_count(data)
			var path: String = str(data.get("atlas",""))
			if ResourceLoader.exists(path):_atlas = load(path) as Texture2D
	if load_art and FileAccess.file_exists(COMPONENT_DATA):
		var data: Variant = JSON.parse_string(FileAccess.get_file_as_string(COMPONENT_DATA))
		if data is Dictionary:_components = data.get("parts",{})

static func _iso(point: Vector2) -> Vector2:
	return Vector2((point.x-point.y)*64.0,(point.x+point.y)*32.0)

static func _point(value: Variant, centre_index: bool = false) -> Vector3:
	if value is Array and value.size()>=2:
		var shift := .5 if centre_index else 0.0
		return Vector3(float(value[0])+shift,float(value[1])+shift,0)
	return Vector3.ZERO

func _clear() -> void:
	for child: Node in get_children():
		remove_child(child)
		child.queue_free()
	_actors.clear()
	_scaffolds.clear()
	_workstages.clear()
	_lamps.clear()

func _front_depth(site: Dictionary) -> float:
	var origin := _point(site.get("origin",[0,0]))
	var size := float(site.get("size",1))
	return _iso(Vector2(origin.x+size,origin.y+size)).y+.05

func _remove_workstage(id: String) -> void:
	if not _workstages.has(id):return
	var node: Node = _workstages[id]
	remove_child(node)
	node.queue_free()
	_workstages.erase(id)

func _workstage(actor: Worker,job: Dictionary) -> void:
	var id: String = str(job.get("id",""))
	_remove_workstage(id)
	var point := _target_point(actor)
	if point.z<=.08:return
	var root := Node2D.new()
	root.name = "WorkPlatform_"+id.validate_node_name()
	var ground_screen := _iso(Vector2(point.x,point.y))
	root.position = ground_screen
	root.position.y = float(actor.target.get("sort_y",ground_screen.y))+.01
	root.modulate = _tint()
	add_child(root)
	var offset := ground_screen.y-root.position.y-point.z*64.0
	# A visible temporary plank and brace support the installation footpoint.
	# One platform per worker is replaced at the next work target, never accumulated.
	_part(root,"brace_wood",Vector2(-9,offset+1),Vector2(18,7))
	_part(root,"beam_wood",Vector2(-13,offset-1),Vector2(26,3.5))
	_workstages[id] = root

func _light_sprite(parent: Node2D,offset: Vector2,extent: Vector2) -> Sprite2D:
	var sprite := Sprite2D.new()
	sprite.texture = _glow_texture
	sprite.material = _glow_material
	sprite.position = offset
	sprite.scale = extent/64.0
	parent.add_child(sprite)
	return sprite

func _sync_lamp(site: Dictionary) -> void:
	var key: String = str(site.get("id",""))
	if not _lamps.has(key):
		if site.get("workers",[]).is_empty():return
		var root := Node2D.new()
		root.name = "ConstructionLamp_"+key.validate_node_name()
		add_child(root)
		var art := Node2D.new()
		root.add_child(art)
		_part(art,"post_wood",Vector2(-2,-36),Vector2(2.8,36))
		_part(art,"beam_wood",Vector2(0,-35),Vector2(10,2.3))
		_part(art,"lantern",Vector2(1,-35),Vector2(12,16))
		var emission: Array = _components.get("lantern",{}).get("emission_rect",[0,0,1,1])
		var bulb_uv := Vector2(float(emission[0])+float(emission[2])*.5,float(emission[1])+float(emission[3])*.5)
		var bulb := Vector2(1,-35)+bulb_uv*Vector2(12,16)
		var pool := _light_sprite(root,Vector2(bulb.x,0),Vector2(108,42))
		pool.z_index = -1
		var halo := _light_sprite(root,bulb,Vector2(30,30))
		_lamps[key] = {"root":root,"art":art,"pool":pool,"halo":halo,"ground":Vector3.ZERO,"clock":0.0,"active":false}
	var lamp: Dictionary = _lamps[key]
	var ground := _point(site.get("materialPoint",[0,0]),true)+Vector3(.14,.04,0)
	lamp.ground = ground
	lamp.root.position = _iso(Vector2(ground.x,ground.y))
	lamp.active = bool(site.get("active",false))
	_light_display(lamp)

func _light_display(lamp: Dictionary) -> void:
	lamp.art.modulate = _tint()
	var intensity := _night*(.96+.04*sin(float(lamp.clock)*4.3))
	lamp.halo.modulate = Color(1,1,1,intensity*.90)
	lamp.pool.modulate = Color(1,1,1,intensity*.75)
	lamp.halo.visible = _night>.005
	lamp.pool.visible = _night>.005

func _worker_tint(actor: Worker) -> Color:
	var tint := _tint()
	var key: String = str(actor.site.get("id",""))
	if _night<=.005 or not _lamps.has(key):return tint
	var lamp: Dictionary = _lamps[key]
	var lamp_screen: Vector2 = lamp.root.position+lamp.halo.position
	var body_screen := _iso(Vector2(actor.point.x,actor.point.y))-Vector2(0,actor.point.z*64.0+12.0)
	var strength := clampf(1.0-body_screen.distance_to(lamp_screen)/100.0,0,1)
	return tint.lerp(Color(1.14,.96,.69),strength*strength*_night*.84)

func _part(parent: Node2D,key: String,offset: Vector2,size: Vector2,angle: float = 0.0) -> void:
	if not _components.has(key):return
	var data: Dictionary = _components[key]
	var path: String = str(data.get("atlas",""))
	if not _component_textures.has(path):
		_component_textures[path] = load(path) if ResourceLoader.exists(path) else null
	var texture: Texture2D = _component_textures[path]
	if texture==null:return
	var rect: Array = data.rect
	var sprite := Sprite2D.new()
	sprite.texture = texture
	sprite.region_enabled = true
	sprite.region_rect = Rect2(rect[0],rect[1],rect[2],rect[3])
	sprite.region_filter_clip_enabled = true
	sprite.centered = false
	sprite.position = offset
	sprite.rotation = angle
	sprite.scale = size/Vector2(rect[2],rect[3])
	sprite.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
	parent.add_child(sprite)

func _ensure_scaffold(site: Dictionary,height: float) -> Vector3:
	var origin := _point(site.get("origin",[0,0]))
	var size := float(site.get("size",1))
	var base := Vector3(origin.x+size*.5,origin.y+size+.055,0)
	var key: String = str(site.get("id",""))+"/"+str(snappedf(height,.01))
	if _scaffolds.has(key):return base+Vector3(0,.025,0)
	var root := Node2D.new()
	root.name = "ConstructionLadder_"+key.validate_node_name()
	root.position = _iso(Vector2(base.x,base.y))
	root.modulate = _tint()
	add_child(root)
	var pixels := maxf(10.0,(height+.12)*64.0)
	# Actual newly painted wood parts form rails, rungs and the landing beam.
	_part(root,"post_wood",Vector2(-6,-pixels),Vector2(2.8,pixels))
	_part(root,"post_wood",Vector2(5,-pixels),Vector2(2.8,pixels))
	var steps := maxi(2,ceili(height/.10))
	for step in range(steps+1):
		_part(root,"beam_wood",Vector2(-5,-float(step)*height*64.0/steps-1),Vector2(12,2.3))
	_part(root,"beam_wood",Vector2(-10,-height*64.0-1),Vector2(22,3.3))
	_part(root,"brace_wood",Vector2(5,-height*64.0+2),Vector2(9,minf(15,pixels*.4)))
	# The architectural renderer resolves overlaps with compensated sort anchors.
	# Keep this outside ladder in front of its own footprint, while preserving its
	# physical projection and normal depth relative to other city objects.
	var ground_y := root.position.y
	root.position.y = maxf(ground_y,_front_depth(site))
	for part: Node2D in root.get_children():part.position.y += ground_y-root.position.y
	_scaffolds[key] = {"root":root,"site":str(site.get("id","")),"height":height}
	return base+Vector3(0,.025,0)

func _lock_target(actor: Worker,site: Dictionary,job: Dictionary) -> void:
	var candidates: Array = []
	if _buildings and _buildings.has_method("construction_targets"):
		candidates = _buildings.construction_targets(site.get("buildingId"),-1,64)
		# Wells, extraction sites and decorations omit some architectural phases.
		# Their crews still prepare an actual future component instead of a dummy
		# point at the building centre. Completed leaves are excluded by the API.
		if candidates.is_empty():
			for phase in range(6):
				candidates = _buildings.construction_targets(site.get("buildingId"),phase,64)
				if not candidates.is_empty():break
	actor.target = {}
	if not candidates.is_empty():
		actor.target = candidates[posmod(int(job.get("targetIndex",0)),candidates.size())].duplicate()
	else:
		var points: Array = site.get("installationPoints",[])
		var fallback := _point(points[posmod(int(job.get("index",0)),points.size())],true) if not points.is_empty() else _point(site.get("entry",[0,0]),true)
		actor.target = {"work_ground":[fallback.x,fallback.y],"worker_elevation":0.0,"leaf_id":"","asset":""}
	var height: float = maxf(0.0,float(actor.target.get("worker_elevation",0)))
	actor.ladder = _ensure_scaffold(site,height) if height>.08 else Vector3.ZERO
	var asset: String = str(actor.target.get("asset",""))
	actor.material_kind = str(job.get("carriedMaterial","brick"))
	if "tile" in asset or "eave" in asset or "ridge" in asset:actor.material_kind = "tile"
	elif "wood" in asset or "beam" in asset or "rafter" in asset or "post" in asset:actor.material_kind = "timber"
	elif "stone" in asset or "brick" in asset or "earth" in asset:actor.material_kind = "brick"
	actor.cycle = int(job.get("cycleIndex",0))
	actor.operation = str(actor.target.get("operation","install"))
	_workstage(actor,job)

func _target_point(actor: Worker) -> Vector3:
	var point := _point(actor.target.get("work_ground",actor.target.get("ground",[0,0])))
	point.z = maxf(0.0,float(actor.target.get("worker_elevation",0)))
	return point

func _append(route: Array[Vector3],point: Vector3) -> void:
	if route.is_empty() or route[-1].distance_to(point)>.001:route.append(point)

func _route_for(actor: Worker,site: Dictionary,phase: String) -> Array[Vector3]:
	var route: Array[Vector3] = []
	var material := _point(site.get("materialPoint",[0,0]),true)
	var entry := _point(site.get("entry",[0,0]),true)
	var target := _target_point(actor)
	if phase=="loading":return [material]
	if phase in ["carrying","installing"]:
		if phase=="carrying":
			_append(route,material)
			_append(route,entry)
		if target.z>.08:
			_append(route,actor.ladder)
			_append(route,actor.ladder+Vector3(0,0,target.z))
		_append(route,target)
	else:
		_append(route,actor.point)
		# Come back across the floor, descend the visible ladder, then walk out.
		if actor.point.z>.08 and actor.ladder!=Vector3.ZERO:
			_append(route,actor.ladder+Vector3(0,0,actor.point.z))
			_append(route,actor.ladder)
		_append(route,entry)
		_append(route,material)
	return route

func _length(route: Array[Vector3]) -> float:
	var total := 0.0
	for i in range(1,route.size()):total += route[i-1].distance_to(route[i])
	return total

func _at(route: Array[Vector3],distance: float) -> Vector3:
	if route.is_empty():return Vector3.ZERO
	for i in range(1,route.size()):
		var length: float = route[i-1].distance_to(route[i])
		if distance<=length:return route[i-1].lerp(route[i],clampf(distance/maxf(.0001,length),0,1))
		distance-=length
	return route[-1]

func _begin_phase(actor: Worker,site: Dictionary,job: Dictionary,is_new: bool) -> void:
	var phase: String = str(job.get("phase","loading"))
	var progress: float = clampf(float(job.get("phaseProgress",0)),0,1)
	if is_new and phase=="returning":actor.point = _target_point(actor)
	var route := _route_for(actor,site,phase)
	if is_new:
		# Restoring a save resumes its authoritative position in the current leg.
		if phase=="installing":route = [_target_point(actor)]
		actor.point = _at(route,_length(route)*progress)
		actor.start_progress = 0.0
		actor.distance = _length(route)*progress
	else:
		# Preserve the last rendered footpoint through phase/layout changes.
		if phase=="installing":
			route = [actor.point]
			var target := _target_point(actor)
			if actor.point.z<target.z-.05 and target.z>.08:
				_append(route,actor.ladder)
				_append(route,actor.ladder+Vector3(0,0,target.z))
			_append(route,target)
		elif phase=="loading":route = [actor.point,_point(site.get("materialPoint",[0,0]),true)]
		else:
			if phase=="carrying" and str(site.get("layoutKey",""))!=actor.layout:
				# A moved road entrance cannot pull somebody diagonally off a floor.
				var retreat := _route_for(actor,actor.site,"returning")
				for point: Vector3 in route:_append(retreat,point)
				route = retreat
			if route.is_empty() or actor.point.distance_to(route[0])>.001:route.push_front(actor.point)
		actor.start_progress = progress
		actor.distance = 0.0
	actor.route = route
	actor.route_length = _length(route)
	actor.duration = float(PHASE_SECONDS.get(phase,12.0))
	actor.phase = phase
	actor.layout = str(site.get("layoutKey",""))
	actor.authority_progress = progress
	actor.snapshot_age = 0.0
	actor.arrived = actor.distance>=actor.route_length-.003
	actor.loaded = phase=="returning" if actor.operation=="remove" else phase=="carrying"

func _target_valid(actor: Worker) -> bool:
	var id: String = str(actor.target.get("action_id",""))
	if id.is_empty() or not _buildings or not _buildings.has_method("construction_target_valid"):
		return true
	return bool(_buildings.construction_target_valid(actor.site.get("buildingId"),id))

func _return_after_target(actor: Worker,site: Dictionary,job: Dictionary) -> void:
	var return_job := job.duplicate()
	return_job.phase = "returning"
	return_job.phaseProgress = 0.0
	_begin_phase(actor,site,return_job,false)
	actor.retargeting = true
	actor.retarget_seconds = 0.0

func sync_city(city: Dictionary,buildings: Node2D) -> void:
	_buildings = buildings
	var identity: String = "%s|%s|%s"%[str(city.get("seedHash",city.get("seed",""))),str(city.get("civilization","")),str(city.get("cityName",""))]
	var city_time: float = float(city.get("clock",{}).get("elapsedSeconds",0))
	if identity!=_city_identity or city_time+.001<_last_city_time:
		_clear()
		_city_identity = identity
	_last_city_time = city_time
	_speed = maxf(0.0,float(city.get("speed",1)))
	_reduced_motion = bool(city.get("settings",{}).get("reducedMotion",false))
	var sites: Array = city.get("constructionSites",[])
	_site_count = sites.size()
	var wanted: Dictionary = {}
	var wanted_sites: Dictionary = {}
	for site: Dictionary in sites:
		wanted_sites[str(site.get("id",""))] = true
		_sync_lamp(site)
		var crew: Array = site.get("workers",[])
		for index in range(mini(4,crew.size())):
			var job: Dictionary = crew[index]
			var id: String = str(job.get("id",""))
			if id.is_empty():continue
			wanted[id] = true
			var actor: Worker = _actors.get(id)
			var is_new := actor==null
			if is_new:
				actor = Worker.new()
				actor.name = "Construction_"+id.validate_node_name()
				actor.sprite = Sprite2D.new()
				actor.sprite.texture = _atlas
				actor.sprite.region_enabled = true
				actor.sprite.region_filter_clip_enabled = true
				actor.sprite.centered = false
				actor.sprite.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
				actor.add_child(actor.sprite)
				add_child(actor)
				_actors[id] = actor
			var cycle: int = int(job.get("cycleIndex",0))
			var cycle_changed := cycle!=actor.cycle and str(job.get("phase",""))!="leaving"
			if not is_new and not actor.retargeting and not bool(site.get("finished",false)) and str(job.get("phase",""))!="leaving" and not _target_valid(actor):
				_return_after_target(actor,site,job)
			if actor.retargeting and str(job.get("phase",""))!="leaving":
				if not actor.arrived or not cycle_changed:
					actor.job=job
					actor.site=site
					continue
				actor.retargeting=false
			elif str(job.get("phase",""))=="leaving":
				actor.retargeting=false
			if is_new or cycle_changed:_lock_target(actor,site,job)
			if is_new or cycle_changed or str(job.get("phase",""))!=actor.phase or str(site.get("layoutKey",""))!=actor.layout:
				_begin_phase(actor,site,job,is_new)
			actor.job = job
			actor.site = site
			actor.authority_progress = clampf(float(job.get("phaseProgress",0)),0,1)
			actor.snapshot_age = 0.0
			if is_new:_display(actor)
	for id: String in _actors.keys():
		if not wanted.has(id):
			var actor: Worker = _actors[id]
			remove_child(actor)
			actor.queue_free()
			_actors.erase(id)
			_remove_workstage(id)
	for key: String in _scaffolds.keys():
		if not wanted_sites.has(str(_scaffolds[key].site)):
			var node: Node = _scaffolds[key].root
			remove_child(node)
			node.queue_free()
			_scaffolds.erase(key)
	for key: String in _lamps.keys():
		if not wanted_sites.has(key):
			var node: Node = _lamps[key].root
			remove_child(node)
			node.queue_free()
			_lamps.erase(key)

func _tint() -> Color:
	return Color.WHITE.lerp(Color(.63,.74,.90),_night)

func _display(actor: Worker) -> void:
	var action := "walk"
	if actor.climbing:
		action = "climb"
	elif actor.phase=="installing" and actor.arrived:
		action = "hammer"
	elif actor.phase=="loading" and actor.arrived:
		action = "load"
	elif actor.loaded:action = "timber" if actor.material_kind=="timber" else "brick"
	actor.action=action
	var moving := action in ["walk","timber","brick","climb"]
	var selected := Motion.sample(_animations,action,actor.facing,actor.travelled,actor.clock if not moving else 0.0,moving)
	var key: String = str(selected.key)
	if key!=actor.frame and _sprites.has(key):
		var data: Dictionary = _sprites[key]
		var rect: Array = data.rect
		actor.sprite.region_rect = Rect2(rect[0],rect[1],rect[2],rect[3])
		actor.pivot = Vector2(data.pivot[0],data.pivot[1])
		actor.sprite_scale = float(data.get("world_scale",.085))
		actor.sprite.scale = Vector2.ONE*actor.sprite_scale
		actor.frame = key
		actor.frame_changes+=1
	var ground_screen := _iso(Vector2(actor.point.x,actor.point.y))
	actor.position = ground_screen
	var target_asset: String = str(actor.target.get("asset",""))
	var overhead := target_asset.begins_with("tiles_") or target_asset.begins_with("eave_") or target_asset.begins_with("ridge_") or target_asset in ["rafter","thatch_course","fabric_canvas","fabric_awning","rope"]
	# A ground-floor carpenter working below a roof stays behind foreground walls.
	# Only workers standing on a real raised platform follow that roof's sort key.
	if actor.phase=="installing" and actor.arrived and actor.target.has("sort_y") and (actor.point.z>.08 or not overhead):
		actor.position.y = float(actor.target.sort_y)+.02
	elif actor.point.z>.08 and actor.ladder!=Vector3.ZERO and Vector2(actor.point.x,actor.point.y).distance_to(Vector2(actor.ladder.x,actor.ladder.y))<.06:
		actor.position.y = maxf(ground_screen.y,_front_depth(actor.site)+.02)
	var bob := sin(actor.stride*2.0)*.38 if actor.walking and not _reduced_motion else 0.0
	actor.sprite.position = -actor.pivot*actor.sprite_scale+Vector2(0,-actor.point.z*64.0+bob+ground_screen.y-actor.position.y)
	actor.sprite.modulate = _worker_tint(actor)
	actor.visible = _atlas!=null and not actor.frame.is_empty()

func animate(delta: float) -> void:
	if _paused or _speed<=0:return
	var dt := clampf(delta,0.0,1.0)
	for lamp: Dictionary in _lamps.values():
		if bool(lamp.active) and not _reduced_motion:
			lamp.clock += dt*minf(_speed,4.0)
			# Preserve phase across sunset, while invisible daylight lights
			# avoid trigonometry and canvas property writes for every worker.
			if _night>.005:
				_light_display(lamp)
	for actor: Worker in _actors.values():
		if not bool(actor.job.get("active",false)):continue
		actor.snapshot_age += dt
		actor.clock += dt*minf(_speed,4.0)
		var before := actor.point
		# At most 1.5 seconds of interpolation past an authoritative snapshot.
		# No phase transition is invented; waiting at the endpoint is intentional.
		var forecast := minf(actor.snapshot_age,1.5)*_speed/actor.duration
		var fraction := clampf((actor.authority_progress+forecast-actor.start_progress)/maxf(.001,1.0-actor.start_progress),0,1)
		if actor.retargeting:
			actor.retarget_seconds+=dt*_speed
			fraction=clampf(actor.retarget_seconds/actor.duration,0,1)
		var allowed := actor.route_length*fraction
		var travel_speed := actor.route_length/maxf(.4,actor.duration*(1.0-actor.start_progress))*1.5
		actor.distance = move_toward(actor.distance,maxf(actor.distance,allowed),travel_speed*dt*_speed)
		actor.point = _at(actor.route,actor.distance)
		var movement := actor.point-before
		actor.walking = movement.length()>.00001
		actor.climbing = absf(movement.z)>.00001 and absf(movement.x)+absf(movement.y)<.0001
		actor.arrived = actor.distance>=actor.route_length-.003
		actor.travelled += movement.length()
		actor.stride += movement.length()*28.0
		if absf(movement.x)+absf(movement.y)>.00001:
			actor.facing = Motion.facing_from_motion(Vector2(movement.x,movement.y),_directions,actor.facing)
		elif actor.phase=="installing":actor.facing = 1
		_display(actor)

func set_paused(value: bool) -> void:
	_paused = value

func set_night(value: float) -> void:
	_night = clampf(value,0,1)
	for actor: Worker in _actors.values():actor.sprite.modulate = _worker_tint(actor)
	for scaffold: Dictionary in _scaffolds.values():scaffold.root.modulate = _tint()
	for stage: Node2D in _workstages.values():stage.modulate = _tint()
	for lamp: Dictionary in _lamps.values():_light_display(lamp)

func diagnostics() -> Dictionary:
	var workers: Array = []
	var active := 0
	var elevated := 0
	for actor: Worker in _actors.values():
		if bool(actor.job.get("active",false)) and not _paused and _speed>0:active+=1
		if actor.point.z>.08:elevated+=1
		workers.append({"id":str(actor.job.get("id","")),"buildingId":actor.site.get("buildingId"),"phase":actor.phase,"position":[actor.point.x,actor.point.y,actor.point.z],"groundDepth":actor.position.y,"frame":actor.frame,"frameChanges":actor.frame_changes,"action":actor.action,"operation":actor.operation,"retargeting":actor.retargeting,"leaf":str(actor.target.get("leaf_id","")),"asset":str(actor.target.get("asset","")),"targetElevation":float(actor.target.get("worker_elevation",0)),"distanceWalked":actor.travelled,"arrived":actor.arrived,"active":bool(actor.job.get("active",false)),"cycle":actor.cycle})
	return {"sites":_site_count,"workers":_actors.size(),"active":active,"elevated":elevated,"scaffolds":_scaffolds.size(),"workPlatforms":_workstages.size(),"lamps":_lamps.size(),"litLamps":_lamps.size() if _night>.005 else 0,"atlasReady":_atlas!=null,"atlasFrames":_sprites.size(),"animations":_animations.size(),"legacyArtFixture":_animations.is_empty(),"sharedWorkerTextures":1 if _atlas!=null else 0,"paused":_paused,"actors":workers}
