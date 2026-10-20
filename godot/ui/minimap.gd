extends Control
## Small on-demand map. It draws topology from the actual saved city, not a mock.
signal tile_selected(x: int, y: int)
var tiles: Array = []
var buildings: Array = []
var map_width: int = 64
var map_height: int = 64
const COLORS: Dictionary = {
	"grass": Color("687956"), "water": Color("456c6f"), "tree": Color("344f3d"),
	"stone": Color("a4a58c"), "clay": Color("a98b62"), "copper": Color("8c7961"), "sand": Color("b5a577")
}
func _ready() -> void:
	custom_minimum_size = Vector2(180, maxf(44, custom_minimum_size.y))
	mouse_filter = Control.MOUSE_FILTER_STOP
	mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	tooltip_text = "轻触小地图，前往对应街区"
func configure(terrain: Array, structures: Array, width: int, height: int) -> void:
	tiles = terrain
	buildings = structures
	map_width = maxi(1, width)
	map_height = maxi(1, height)
	queue_redraw()
func _map_rect() -> Rect2:
	var scale_value: float = minf(size.x / float(map_width), size.y / float(map_height))
	var extent := Vector2(map_width, map_height) * scale_value
	return Rect2((size - extent) * 0.5, extent)
func _draw() -> void:
	var bounds: Rect2 = _map_rect()
	var cell := Vector2(bounds.size.x / map_width, bounds.size.y / map_height)
	draw_rect(bounds, Color("687956"))
	for y: int in mini(tiles.size(), map_height):
		var row: Variant = tiles[y]
		if not row is Array:
			continue
		for x: int in mini((row as Array).size(), map_width):
			var item: Variant = row[x]
			var kind: String = str((item as Dictionary).get("t", "grass")) if item is Dictionary else str(item)
			draw_rect(Rect2(bounds.position + Vector2(x, y) * cell, cell + Vector2(0.2, 0.2)), COLORS.get(kind, COLORS.grass))
	for value: Variant in buildings:
		if not value is Dictionary:
			continue
		var building: Dictionary = value as Dictionary
		var extent: int = int(building.get("size", 1))
		var color: Color = Color("cfbd83") if str(building.get("type", "")) == "road" else Color("ddd0ae")
		draw_rect(Rect2(bounds.position + Vector2(float(building.get("x", 0)), float(building.get("y", 0))) * cell, cell * extent), color)
	draw_rect(bounds, Color("aa8c52"), false, 1.0)
func _gui_input(event: InputEvent) -> void:
	if event is InputEventMouse and event.device == InputEvent.DEVICE_ID_EMULATION:
		return
	var location := Vector2.ZERO
	var activate: bool = false
	if event is InputEventMouseButton:
		var mouse: InputEventMouseButton = event as InputEventMouseButton
		activate = mouse.pressed and mouse.button_index == MOUSE_BUTTON_LEFT
		location = mouse.position
	elif event is InputEventScreenTouch:
		var touch: InputEventScreenTouch = event as InputEventScreenTouch
		activate = touch.pressed
		location = touch.position
	if activate:
		var bounds: Rect2 = _map_rect()
		if bounds.has_point(location):
			var point: Vector2 = (location - bounds.position) / bounds.size
			tile_selected.emit(clampi(int(point.x * map_width), 0, map_width - 1), clampi(int(point.y * map_height), 0, map_height - 1))
		accept_event()
