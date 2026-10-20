extends SceneTree

const Citizens = preload("res://world/citizens.gd")
var scene: CityCitizens
var roads: Array = []
var checks := 0

func require(value: bool, note: String) -> void:
	if not value:
		push_error(note)
		quit(1)
		assert(value, note)
	checks += 1

func job(id: int, kind: String, route: Array, loaded: bool = false, vehicle: String = "handcart") -> Dictionary:
	return {"id": id, "kind": kind, "source": route[0], "target": route[-1], "route": route, "segment": 0, "segmentProgress": 0, "edgeSeconds": 3, "phase": "travel", "leg": "deliver" if loaded else "pickup", "isLoaded": loaded, "cargo": {"grain": 20} if vehicle == "horse" else {"water": 3} if kind == "water" else {"wood": 10}, "vehicle": vehicle, "moving": true}

func city(jobs: Array, time: float = 0, seed: int = 11) -> Dictionary:
	return {"seedHash": seed, "civilization": "china", "cityName": "Logistics test", "speed": 1, "clock": {"elapsedSeconds": time}, "logistics": {"version": 1, "jobs": jobs}}

func _initialize() -> void:
	call_deferred("run")

func run() -> void:
	for y in range(8):
		for x in range(8):
			roads.append({"type": "road", "x": x, "y": y})
	scene = Citizens.new()
	root.add_child(scene)
	var task := job(1, "water", [[1, 1], [2, 1], [3, 1]], false, "none")
	scene.sync_city(roads, city([task]))
	require(scene._actors.size() == 1, "One job creates exactly one actor")
	var actor = scene._actors["1"]
	var initial_id: int = actor.get_instance_id()
	var before: Vector2 = actor.world_point
	scene.animate(.1)
	require(actor.world_point.distance_to(before) > 0 and actor.world_point.distance_to(before) < .05, "Movement is continuous along authorized edge")
	require(actor.facing == 3, "+x road uses southeast orientation")
	before = actor.world_point
	scene.set_paused(true)
	scene.animate(.5)
	require(actor.world_point == before, "Pause freezes transport")
	scene.set_paused(false)
	task.phase = "waiting"
	task.moving = false
	scene.sync_city(roads, city([task], 1))
	scene.animate(.5)
	require(actor.world_point == before, "Waiting never predicts movement")
	task.phase = "travel"
	task.moving = true
	scene.sync_city(roads.filter(func(b: Dictionary) -> bool: return not (b.x == 2 and b.y == 1)), city([task], 2))
	scene.animate(.5)
	require(actor.world_point == before, "Removed road stops movement before crossing")
	scene.sync_city(roads, city([task], 3))
	scene.animate(.1)
	require(actor.world_point.distance_to(before) > 0, "Repaired road resumes existing actor")
	require(actor.get_instance_id() == initial_id, "Same job preserves actor identity")
	scene.sync_city(roads, city([job(1, "delivery", [[5, 5], [4, 5]], false, "horse")], 0, 99))
	actor = scene._actors["1"]
	require(actor.get_instance_id() != initial_id and actor.world_point == Vector2(5, 5), "City switch discards old interpolation")
	initial_id = actor.get_instance_id()
	scene.sync_city(roads, city([job(1, "delivery", [[5, 5], [4, 5]], false, "horse")], 10, 99))
	scene.sync_city(roads, city([job(1, "delivery", [[5, 5], [4, 5]], false, "horse")], 1, 99))
	require(scene._actors["1"].get_instance_id() != initial_id, "Clock rollback discards reused IDs")
	var returning := job(1, "delivery", [[5, 5], [4, 5]], false, "horse")
	returning.leg = "return"
	returning.cargo = {}
	scene.sync_city(roads, city([returning], 2, 99))
	require(scene._actors["1"].vehicle == "horse", "Empty return preserves persistent horse vehicle")
	scene.sync_city(roads, city([], 3, 99))
	scene.animate(.3)
	require(scene._actors.is_empty(), "No fake population walkers survive zero real jobs")
	var boundary := job(20, "delivery", [[1, 1], [2, 1]], true, "horse")
	boundary.edgeSeconds = 6
	boundary.segmentProgress = 5.4
	scene.sync_city(roads, city([boundary], 20, 101))
	actor = scene._actors["20"]
	before = actor.world_point
	boundary.segment = 1
	boundary.segmentProgress = 0
	boundary.phase = "unloading"
	boundary.moving = false
	scene.sync_city(roads, city([boundary], 21, 101))
	scene.animate(.1)
	require(actor.world_point.x > before.x and actor.world_point.x < 2, "Six-second edge to unloading finishes continuously, without snap")
	for frame in range(12):
		scene.animate(.1)
	require(actor.world_point.distance_to(Vector2(2, 1)) < .0001, "Unloading catches up exactly to authorized door")
	scene.animate(3)
	require(actor.world_point.distance_to(Vector2(2, 1)) < .0001, "Unloading never predicts beyond its endpoint")
	boundary.segment = 0
	boundary.segmentProgress = 5.4
	boundary.phase = "travel"
	scene.sync_city(roads, city([boundary], 1, 102))
	actor = scene._actors["20"]
	before = actor.world_point
	boundary.segment = 1
	boundary.segmentProgress = 0
	boundary.phase = "unloading"
	scene.sync_city(roads.filter(func(b: Dictionary) -> bool: return not (b.x == 2 and b.y == 1)), city([boundary], 2, 102))
	scene.animate(.5)
	require(actor.world_point == before, "Unloading catch-up still cannot cross a removed road")
	print("LOGISTICS_NATIVE_CHECKS: ", checks)
	if DisplayServer.get_name() == "headless":
		quit(0)
		return
	await show_visual()
	quit(0)

func show_visual() -> void:
	root.size = Vector2i(1440, 1000)
	var background := ColorRect.new()
	background.color = Color(.16, .23, .16)
	background.size = Vector2(1440, 1000)
	background.z_index = -10
	root.add_child(background)
	# Native ImageTexture plus generated mipmaps also tests alpha outside the
	# cached importer, using the exact production WebP pixels.
	var image := Image.load_from_file("res://art/citizens/logistics-atlas.webp")
	image.generate_mipmaps()
	scene._atlas = ImageTexture.create_from_image(image)
	scene.scale = Vector2(3.0, 3.0)
	scene.position = Vector2(700, 60)
	var jobs := [job(11, "water", [[0, 0], [1, 0]], false, "none"), job(12, "water", [[2, 0], [1, 0]], true, "none"), job(13, "restock", [[0, 2], [0, 1]], false), job(14, "restock", [[2, 2], [2, 3]], true), job(15, "delivery", [[4, 1], [3, 1]], true, "horse"), job(16, "delivery", [[1, 4], [1, 3]], false, "horse"), job(17, "delivery", [[3, 4], [4, 4]], true)]
	scene.sync_city(roads, city(jobs, 0, 88))
	for frame in range(24):
		scene.animate(1.0 / 60.0)
		await process_frame
	await RenderingServer.frame_post_draw
	root.get_texture().get_image().save_png("/workspace/citys/work/logistics-native-day.png")
	scene.set_night(1)
	for frame in range(16):
		scene.animate(1.0 / 60.0)
		await process_frame
	await RenderingServer.frame_post_draw
	root.get_texture().get_image().save_png("/workspace/citys/work/logistics-native-night.png")
	print("LOGISTICS_VISUAL_DIAGNOSTICS: ", JSON.stringify(scene.diagnostics()))
