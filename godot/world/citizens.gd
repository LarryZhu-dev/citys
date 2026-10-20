extends Node2D
class_name CityCitizens

class Walker extends Node2D:
	var world_point := Vector2.ZERO
	var home := ""
	var cell := Vector2i.ZERO
	var route: Array[Vector2i] = []
	var progress := 0.0
	var phase := 0.0
	var wait := 0.0
	var trip := 0
	var going_home := false
	var walking := false
	var frozen := false
	var retiring := false
	var night := 0.0
	var role := 0
	var frames: Array = []
	var facing := 3
	func _draw() -> void:
		var warm := Color(1,1,1).lerp(Color(.59,.73,.90),night)
		draw_set_transform(Vector2.ZERO,0,Vector2(1,.42))
		draw_circle(Vector2.ZERO,5.7,Color(0,0,0,.16))
		draw_set_transform(Vector2.ZERO)
		if not frames.is_empty():
			var frame_index := int(phase/TAU*4.0)%4 if walking else 1
			var texture: Texture2D = frames[facing*4+frame_index]
			draw_texture_rect(texture,Rect2(-9.43,-28.28,18.86,30.0),false,warm)

var _roads: Dictionary = {}
var _homes: Dictionary = {}
var _jobs: Array = []
var _actors: Dictionary = {}
var _road_signature := ""
var _night := 0.0
var _paused := false
var population_limit := 80
var _textures: Dictionary = {}

func _init() -> void:
	y_sort_enabled = true
	_textures["frames"] = []
	var atlas: Texture2D = load("res://art/citizens/artisan-atlas.webp")
	for direction in range(4):
		for frame in range(4):
			var texture := AtlasTexture.new()
			texture.atlas = atlas
			texture.region = Rect2(frame*176,direction*280,176,280)
			texture.filter_clip = true
			_textures.frames.append(texture)

func _iso(p: Vector2) -> Vector2:
	return Vector2((p.x-p.y)*64,(p.x+p.y)*32)

func _doors(b: Dictionary) -> Array[Vector2i]:
	var result: Array[Vector2i] = []
	var x: int = int(b.get("x",0))
	var y: int = int(b.get("y",0))
	var size: int = int(b.get("size",1))
	for i in range(size):
		for p in [Vector2i(x+i,y-1),Vector2i(x+i,y+size),Vector2i(x-1,y+i),Vector2i(x+size,y+i)]:
			if _roads.has(p) and not result.has(p):
				result.append(p)
	return result

func sync_city(buildings: Array) -> void:
	var roads: Dictionary = {}
	for b: Dictionary in buildings:
		if str(b.get("type",""))=="road":
			roads[Vector2i(int(b.get("x",0)),int(b.get("y",0)))] = true
	_roads = roads
	_homes.clear()
	_jobs.clear()
	var wanted: Dictionary = {}
	for b: Dictionary in buildings:
		var kind: String = str(b.get("type",""))
		if kind == "road":
			continue
		var doors := _doors(b)
		if doors.is_empty():
			continue
		var id: String = str(b.get("id","%s,%s" % [b.get("x",0),b.get("y",0)]))
		if kind in ["house","villa"]:
			_homes[id] = doors
			var population: int = int(b.get("pop",0))
			var construction: Variant = b.get("construction",{})
			if population<=0 or (construction is Dictionary and not construction.is_empty() and not construction.has("fromLevel")):
				continue
			for i in range(mini(2,maxi(1,int(ceil(population/8.0))))):
				if wanted.size()>=population_limit:
					break
				var key := id+":"+str(i)
				wanted[key] = true
				if _actors.has(key):
					_actors[key].retiring = false
					continue
				var actor := Walker.new()
				actor.home = id
				actor.cell = doors[i%doors.size()]
				actor.world_point = Vector2(actor.cell)+Vector2(.5,.5)
				actor.position = _iso(actor.world_point)
				actor.wait = .5+float(posmod(hash(key),40))*.1
				actor.phase = float(posmod(hash(key),60))*.1
				actor.role = posmod(hash(key),4)
				actor.night = _night
				actor.frames = _textures.frames
				actor.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
				add_child(actor)
				_actors[key] = actor
		elif not bool(b.get("idle",false)) and not bool(b.get("damage",false)):
			_jobs.append(doors)
	for key: String in _actors.keys():
		if not wanted.has(key):
			_actors[key].retiring = true

func _route(start: Vector2i, goals: Array) -> Array[Vector2i]:
	var result: Array[Vector2i] = []
	if not _roads.has(start) or goals.is_empty():
		return result
	var queue: Array[Vector2i] = [start]
	var prior: Dictionary = {start:start}
	var head_index := 0
	while head_index<queue.size():
		var at := queue[head_index]
		head_index+=1
		if goals.has(at):
			while at!=start:
				result.push_front(at)
				at = prior[at]
			return result
		for d in [Vector2i.LEFT,Vector2i.RIGHT,Vector2i.UP,Vector2i.DOWN]:
			var next: Vector2i = at+d
			if _roads.has(next) and not prior.has(next):
				prior[next] = at
				queue.append(next)
	return result

func animate(delta: float) -> void:
	if _paused:
		return
	for key: String in _actors.keys():
		var actor: Walker = _actors[key]
		if actor.retiring:
			actor.modulate.a = maxf(0.0,actor.modulate.a-delta*.8)
			if actor.modulate.a<=0:
				actor.queue_free()
				_actors.erase(key)
			continue
		actor.modulate.a = minf(1.0,actor.modulate.a+delta)
		if actor.walking:
			actor.queue_redraw()
		actor.walking = false
		if not _roads.has(actor.cell):
			# Demolition never teleports a citizen across the city.
			actor.frozen = true
			continue
		actor.frozen = false
		if not actor.route.is_empty():
			var next: Vector2i = actor.route[0]
			if not _roads.has(next):
				actor.frozen = true
				continue
			actor.walking = true
			var direction: Vector2i = next-actor.cell
			actor.facing = (3 if direction.x>0 else 0) if direction.x!=0 else (2 if direction.y>0 else 1)
			actor.progress += delta*.48
			actor.phase += delta*7.0
			if actor.progress>=1:
				actor.cell = next
				actor.route.pop_front()
				actor.progress-=1.0
				if actor.route.is_empty():
					actor.wait = 2.0+float(actor.trip%5)
			var goal: Vector2 = Vector2(actor.route[0] if not actor.route.is_empty() else actor.cell)
			actor.world_point = Vector2(actor.cell).lerp(goal,actor.progress)+Vector2(.5,.5)
			actor.position = _iso(actor.world_point)
			actor.queue_redraw()
		else:
			actor.wait-=delta
			if actor.wait<=0:
				var target: Array = []
				if actor.going_home:
					target = _homes.get(actor.home,[])
				elif not _jobs.is_empty():
					target = _jobs[posmod(actor.role+actor.trip,_jobs.size())]
				actor.route = _route(actor.cell,target)
				actor.progress = 0.0
				actor.going_home = not actor.going_home
				actor.trip+=1
				actor.wait = 2.0

func set_night(amount: float) -> void:
	if absf(amount-_night)<.001:
		return
	_night = amount
	for actor: Walker in _actors.values():
		actor.night = amount
		actor.queue_redraw()

func set_paused(value: bool) -> void:
	_paused = value
