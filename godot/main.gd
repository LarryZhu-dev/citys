extends Node

var bridge: JavaScriptObject
var world: Node2D
var hud: CanvasLayer
var elapsed: float = 0.0
var terrain_revision: int = -1
var city: Dictionary = {}
var first_sync: bool = true
var automatic_night: float = 0.0

func _ready() -> void:
	if not OS.has_feature("web"):
		push_error("Run this project through its Web export to connect the persistent simulation.")
		return
	bridge = JavaScriptBridge.get_interface("CityBridge")
	world = load("res://world/world.gd").new()
	add_child(world)
	hud = load("res://ui/hud.gd").new()
	add_child(hud)
	world.tile_action.connect(_tile_action)
	world.road_stroke.connect(_road_stroke)
	hud.action.connect(_action)
	_sync(true)
	bridge.ready()
	if not bool(city.get("hasSave", false)):
		hud.show_panel("newcity")
	if city.get("offlineSummary") != null:
		hud.show_toast("离线期间的工程与经营进度已恢复", "good")

func _process(delta: float) -> void:
	if bridge == null:
		return
	elapsed += delta
	if elapsed >= 0.5:
		elapsed = 0.0
		_sync(false)
		var metrics := {"fps": Engine.get_frames_per_second(), "nodes": Performance.get_monitor(Performance.OBJECT_NODE_COUNT), "engine": Engine.get_version_info().string, "renderer": "Godot Compatibility WebGL2"}
		if world.has_method("diagnostics"):
			metrics["world"] = world.diagnostics()
		if hud.has_method("diagnostics"):
			metrics["hud"] = hud.diagnostics()
		bridge.report(JSON.stringify(metrics))

func _sync(full: bool) -> void:
	var data: Variant = JSON.parse_string(str(bridge.snapshot(full)))
	if not data is Dictionary:
		return
	city = data
	var revision: int = int(city.get("terrainVersion", 0))
	if not full and revision != terrain_revision:
		city = JSON.parse_string(str(bridge.snapshot(true)))
		full = true
	terrain_revision = revision
	world.sync_state(city, full)
	world.select_tool(str(city.get("tool", "")))
	world.set_paused(float(city.get("speed", 1)) == 0.0 or bool(city.get("onlineOpen", false)) or bool(city.get("settings", {}).get("reducedMotion", false)))
	var mode: String = str(city.get("nightMode", "auto"))
	# A long, gentle cycle. Production never follows this visual clock.
	var seconds: float = float(city.get("clock", {}).get("elapsedSeconds", 0.0))
	automatic_night = smoothstep(0.1, 0.7, sin(seconds / 1800.0 * TAU - PI / 2.0))
	world.set_night(1.0 if mode == "night" else (0.0 if mode == "day" else automatic_night))
	hud.sync_state(city)
	var events: Variant = JSON.parse_string(str(bridge.pollEvents()))
	if events is Array:
		for event: Dictionary in events:
			if event.get("type") == "toast":
				hud.show_toast(str(event.get("message", "")), str(event.get("kind", "")))
			elif event.get("type") == "center":
				world.center_city()
	if first_sync:
		world.center_city()
		first_sync = false

func _tile_action(x: int, y: int, drag: bool = false) -> void:
	if bool(city.get("onlineOpen", false)) or hud.blocks_map():
		return
	bridge.dispatch("tile", JSON.stringify({"x": x, "y": y, "drag": drag}))
	_sync(false)

func _road_stroke(points: Array) -> void:
	if bool(city.get("onlineOpen", false)) or hud.blocks_map():
		return
	bridge.dispatch("road_stroke", JSON.stringify({"points": points}))
	_sync(false)

func _action(name: String, payload: Dictionary = {}) -> void:
	if name == "center":
		if payload.has("x") and payload.has("y"):
			world.center_tile(int(payload.x), int(payload.y))
		else:
			world.center_city()
	elif name == "zoom":
		world.zoom_by(float(payload.get("factor", 1.0)))
	else:
		bridge.dispatch(name, JSON.stringify(payload))
		_sync(false)
