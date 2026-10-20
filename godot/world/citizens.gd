extends Node2D
class_name CityCitizens

## Every actor belongs to one authoritative logistics job. This renderer never
## chooses destinations, delivers goods, or creates population-based walkers.
class Courier extends Node2D:
	var job: Dictionary = {}
	var world_point := Vector2.ZERO
	var route: Array[Vector2] = []
	var route_position := 0.0
	var authorized_position := 0.0
	var pending_route: Array[Vector2] = []
	var pending_position := 0.0
	var last_signature := ""
	var snapshot_age := 0.0
	var phase_clock := 0.0
	var stride := 0.0
	var facing := 3
	var walking := false
	var night := 0.0
	var role := "artisan"
	var vehicle := ""
	var atlas: Texture2D
	var sprites: Dictionary = {}
	var retire := false
	var edge_seconds := 3.0
	var distance_walked := 0.0

	func _sprite(key: String, offset: Vector2 = Vector2.ZERO, bob: float = 0.0, lean: float = 0.0) -> void:
		if atlas == null or not sprites.has(key):
			return
		var info: Dictionary = sprites[key]
		var rect: Array = info.rect
		var anchor: Array = info.pivot
		var scale_factor: float = float(info.get("world_scale", .1))
		draw_set_transform(offset, lean)
		var location := Vector2(0, bob) - Vector2(anchor[0], anchor[1]) * scale_factor
		var tint := Color.WHITE.lerp(Color(.59, .73, .90), night)
		draw_texture_rect_region(atlas, Rect2(location, Vector2(rect[2], rect[3]) * scale_factor), Rect2(rect[0], rect[1], rect[2], rect[3]), tint)
		if role == "water" and bool(job.get("isLoaded", false)):
			for point: Array in info.get("buckets", []):
				var center := location + Vector2(point[0], point[1]) * scale_factor
				draw_set_transform(offset + center.rotated(lean), lean, Vector2(1, .34))
				draw_circle(Vector2.ZERO, 2.0, Color(.21, .63, .75).lerp(Color(.12, .33, .47), night))
				draw_set_transform(offset, lean)
		if walking and info.has("wheel"):
			var wheel: Array = info.wheel
			var center := location + Vector2(wheel[0], wheel[1]) * scale_factor
			var radius := Vector2(wheel[2], wheel[3]) * scale_factor
			for spoke in range(3):
				var angle := stride * 2.0 + float(spoke) * PI / 3.0
				var rim := Vector2(cos(angle) * radius.x, sin(angle) * radius.y)
				draw_line(center - rim, center + rim, Color(.48, .35, .22, .45).lerp(Color(.27, .25, .22, .45), night), .55, true)
		draw_set_transform(Vector2.ZERO)

	func _draw() -> void:
		var pose := int(floor(stride / PI)) % 2 if walking else 0
		var phase: String = str(job.get("phase", "waiting"))
		var working := phase in ["loading", "unloading"] and not walking
		var bob: float = sin(stride * 2.0) * .28 if walking else sin(phase_clock * 4.0) * .4 if working else 0.0
		var lean := sin(phase_clock * 3.0) * .08 if working else 0.0
		if vehicle.is_empty():
			_sprite("%s/%d/%d" % [role, facing, pose], Vector2.ZERO, bob, lean)
			return
		var direction: Vector2 = [Vector2(-.8944, -.4472), Vector2(.8944, -.4472), Vector2(-.8944, .4472), Vector2(.8944, .4472)][facing]
		var loaded := 1 if bool(job.get("isLoaded", false)) else 0
		_sprite("%s/%d/%d" % [vehicle, facing, loaded], Vector2.ZERO, bob * .35)
		var driver_offset := Vector2(-direction.y, direction.x) * 11.0 + direction * 4.0 if vehicle == "horse" else direction * 17.0
		var driver_frame := int(floor(stride / (PI * .5))) % 4 if role == "artisan" and walking else pose
		_sprite("%s/%d/%d" % [role, facing, driver_frame], driver_offset, bob, lean * signf(direction.x))

var _actors: Dictionary = {}
var _roads: Dictionary = {}
var _night := 0.0
var _paused := false
var _speed := 1.0
var _city_identity := ""
var _last_city_time := -1.0
var _atlas: Texture2D
var _sprites: Dictionary = {}
var population_limit := 80
var _job_count := 0

func _init() -> void:
	y_sort_enabled = true
	var path := "res://art/citizens/logistics-atlas.json"
	if FileAccess.file_exists(path):
		var metadata: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
		if metadata is Dictionary:
			_sprites = metadata.get("sprites", {})
			var atlas_path: String = str(metadata.get("atlas", ""))
			if ResourceLoader.exists(atlas_path):
				_atlas = load(atlas_path) as Texture2D

func _iso(point: Vector2) -> Vector2:
	return Vector2((point.x - point.y) * 64, (point.x + point.y) * 32)

func _clear_actors() -> void:
	for actor: Courier in _actors.values():
		remove_child(actor)
		actor.queue_free()
	_actors.clear()

func _route_from(value: Variant) -> Array[Vector2]:
	var result: Array[Vector2] = []
	if value is Array:
		for item: Variant in value:
			if item is Array and item.size() >= 2:
				result.append(Vector2(float(item[0]), float(item[1])))
	return result

func _point_on(route: Array[Vector2], progress: float) -> Vector2:
	if route.is_empty():
		return Vector2.ZERO
	var segment := clampi(int(floor(progress)), 0, route.size() - 1)
	if segment >= route.size() - 1:
		return route[-1]
	return route[segment].lerp(route[segment + 1], clampf(progress - segment, 0, 1))

func _project(route: Array[Vector2], point: Vector2) -> Vector2:
	var answer := Vector2(0, INF)
	if route.size() == 1:
		return Vector2(0, point.distance_to(route[0]))
	for index in range(route.size() - 1):
		var start := route[index]
		var edge := route[index + 1] - start
		var ratio := clampf((point - start).dot(edge) / maxf(edge.length_squared(), .0001), 0, 1)
		var error := point.distance_to(start + edge * ratio)
		if error < answer.y:
			answer = Vector2(index + ratio, error)
	return answer

func _signature(job: Dictionary) -> String:
	return "%s|%s|%s|%s|%s|%s|%s" % [str(job.get("phase", "")), str(job.get("leg", "")), str(job.get("segment", 0)), str(job.get("segmentProgress", 0)), str(job.get("isLoaded", false)), str(job.get("route", [])), str(job.get("position", []))]

func _set_role(actor: Courier) -> void:
	var kind: String = str(actor.job.get("kind", ""))
	var cargo: Dictionary = actor.job.get("cargo", {})
	if kind == "water":
		actor.role = "water"
		actor.vehicle = ""
	elif kind == "restock":
		actor.role = "merchant"
		actor.vehicle = "handcart"
	else:
		actor.role = "artisan"
		if actor.job.has("vehicle"):
			actor.vehicle = str(actor.job.vehicle)
		elif not (str(actor.job.get("leg", "")) == "return" and not actor.vehicle.is_empty()):
			actor.vehicle = "horse" if cargo.has("grain") else "handcart"

func sync_city(buildings: Array, city: Dictionary = {}) -> void:
	var identity := "%s|%s|%s" % [str(city.get("seedHash", city.get("seed", ""))), str(city.get("civilization", "")), str(city.get("cityName", ""))]
	var city_time: float = float(city.get("clock", {}).get("elapsedSeconds", 0))
	if identity != _city_identity or city_time + .001 < _last_city_time:
		_clear_actors()
		_city_identity = identity
	_last_city_time = city_time
	_speed = maxf(0.0, float(city.get("speed", 1)))
	_roads.clear()
	for building: Dictionary in buildings:
		if str(building.get("type", "")) == "road":
			_roads[Vector2i(int(building.get("x", 0)), int(building.get("y", 0)))] = true
	var jobs: Array = city.get("logistics", {}).get("jobs", [])
	_job_count = jobs.size()
	var wanted: Dictionary = {}
	for job: Dictionary in jobs:
		if job.get("kind", "") not in ["water", "delivery", "restock"]:
			continue
		var id: String = str(job.get("id", ""))
		if id.is_empty():
			continue
		wanted[id] = true
		var route := _route_from(job.get("route", []))
		var edge_seconds := maxf(.1, float(job.get("edgeSeconds", 3)))
		var progress := float(job.get("segment", 0)) + float(job.get("segmentProgress", 0)) / edge_seconds
		var current := _point_on(route, progress)
		var supplied: Variant = job.get("position", null)
		if supplied is Array and supplied.size() >= 2:
			current = Vector2(float(supplied[0]), float(supplied[1]))
		elif route.is_empty():
			var source: Variant = job.get("source", [0, 0])
			current = Vector2(float(source[0]), float(source[1]))
		var actor: Courier = _actors.get(id)
		if actor == null:
			actor = Courier.new()
			actor.name = "Logistics_" + id.validate_node_name()
			actor.world_point = current
			actor.route = route
			actor.route_position = progress
			actor.position = _iso(current + Vector2(.5, .5))
			actor.atlas = _atlas
			actor.sprites = _sprites
			actor.night = _night
			actor.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
			add_child(actor)
			_actors[id] = actor
		actor.retire = false
		actor.job = job.duplicate(true)
		actor.edge_seconds = edge_seconds
		_set_role(actor)
		if route.size() >= 2 and actor.distance_walked < .001:
			var segment := clampi(int(progress), 0, route.size() - 2)
			var direction := route[segment + 1] - route[segment]
			actor.facing = (3 if direction.x > 0 else 0) if absf(direction.x) > .5 else (2 if direction.y > 0 else 1)
		var signature := _signature(job)
		if signature != actor.last_signature:
			actor.snapshot_age = 0.0
			actor.last_signature = signature
			actor.authorized_position = progress
			if route != actor.route:
				var projection := _project(route, actor.world_point)
				if projection.y < .04:
					actor.route = route
					actor.route_position = projection.x
					actor.pending_route.clear()
				elif not route.is_empty():
					# Complete the old authorized leg before adopting the reverse
					# return route. No snap to a new source or city-wide teleport.
					actor.pending_route = route
					actor.pending_position = progress
			actor.queue_redraw()
	for id: String in _actors.keys():
		if not wanted.has(id):
			_actors[id].retire = true

func _advance(actor: Courier, distance: float) -> float:
	var moved := 0.0
	while distance > .00001 and actor.route.size() >= 2:
		var segment := int(floor(actor.route_position + .000001))
		if segment >= actor.route.size() - 1:
			break
		var start := actor.route[segment]
		var finish := actor.route[segment + 1]
		if not _roads.has(Vector2i(start)) or not _roads.has(Vector2i(finish)) or absf(finish.x - start.x) + absf(finish.y - start.y) > 1.001:
			break
		var step := minf(distance, float(segment + 1) - actor.route_position)
		actor.route_position += step
		actor.world_point = _point_on(actor.route, actor.route_position)
		var direction := finish - start
		actor.facing = (3 if direction.x > 0 else 0) if absf(direction.x) > .5 else (2 if direction.y > 0 else 1)
		moved += step
		distance -= step
	return moved

func animate(delta: float) -> void:
	for id: String in _actors.keys():
		var actor: Courier = _actors[id]
		if actor.retire:
			actor.modulate.a = maxf(0.0, actor.modulate.a - delta * 4)
			if actor.modulate.a <= 0:
				remove_child(actor)
				actor.queue_free()
				_actors.erase(id)
			continue
		if _paused or _speed <= 0:
			continue
		actor.snapshot_age += delta
		actor.phase_clock += delta
		var previously_walking := actor.walking
		actor.walking = false
		var phase: String = str(actor.job.get("phase", "waiting"))
		var in_transit := phase == "travel" and bool(actor.job.get("moving", true))
		# A phase update can arrive while visual interpolation trails the door.
		# Loading/unloading permits only the remaining authoritative distance;
		# waiting never does. _advance still rejects removed or illegal roads.
		var may_move := in_transit or phase in ["loading", "unloading"]
		if may_move and not actor.route.is_empty():
			# Bounded between snapshots, never beyond the authorized road route,
			# loading endpoint, waiting phase, or a removed/non-adjacent road.
			var forecast := minf(actor.snapshot_age, 1.1) * _speed / actor.edge_seconds if in_transit else 0.0
			var target := minf(float(actor.route.size() - 1), actor.authorized_position + forecast)
			if not actor.pending_route.is_empty():
				target = float(actor.route.size() - 1)
			var step := minf(maxf(0, target - actor.route_position), delta * _speed / actor.edge_seconds * 1.15)
			var moved := _advance(actor, step)
			actor.walking = moved > .00001
			actor.distance_walked += moved
			actor.stride += moved * 14.0
			if not actor.pending_route.is_empty() and actor.route_position >= actor.route.size() - 1 - .001:
				var projection := _project(actor.pending_route, actor.world_point)
				if projection.y < .04:
					actor.route = actor.pending_route
					actor.pending_route = []
					actor.route_position = projection.x
					actor.authorized_position = actor.pending_position
			actor.position = _iso(actor.world_point + Vector2(.5, .5))
		if actor.walking or previously_walking or phase in ["loading", "unloading"]:
			actor.queue_redraw()

func set_night(amount: float) -> void:
	if absf(amount - _night) < .001:
		return
	_night = amount
	for actor: Courier in _actors.values():
		actor.night = amount
		actor.queue_redraw()

func set_paused(value: bool) -> void:
	_paused = value

func diagnostics() -> Dictionary:
	var kinds: Dictionary = {}
	var phases: Dictionary = {}
	var samples: Array = []
	var moving := 0
	var loaded := 0
	for id: String in _actors:
		var actor: Courier = _actors[id]
		var kind: String = str(actor.job.get("kind", ""))
		var phase: String = str(actor.job.get("phase", ""))
		kinds[kind] = int(kinds.get(kind, 0)) + 1
		phases[phase] = int(phases.get(phase, 0)) + 1
		moving += 1 if actor.walking else 0
		loaded += 1 if bool(actor.job.get("isLoaded", false)) else 0
		if samples.size() < 12:
			samples.append({"id": id, "role": actor.role, "vehicle": actor.vehicle, "position": [actor.world_point.x, actor.world_point.y], "ground_screen": [actor.position.x, actor.position.y], "phase": phase, "leg": actor.job.get("leg", ""), "loaded": bool(actor.job.get("isLoaded", false)), "facing": actor.facing, "walking": actor.walking})
	return {"actors": _actors.size(), "authoritative_jobs": _job_count, "moving": moving, "loaded": loaded, "kinds": kinds, "phases": phases, "samples": samples, "shared_atlas": _atlas != null, "atlas_sprites": _sprites.size(), "random_walkers": 0, "city_identity": _city_identity}
