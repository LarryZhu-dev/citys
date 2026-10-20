class_name CityHUD
extends CanvasLayer

## The HUD owns presentation only. Every simulation mutation crosses action.
signal action(name: String, payload: Dictionary)

const INK := Color("302a20")
const MUTED := Color("75684e")
const GOLD := Color("b9914f")
const PAPER := Color("efe3c4")
const WOOD := Color("342c22")
const CATEGORIES: Array = [
	["recommended", "起步"], ["house", "住宅"], ["road", "道路"],
	["municipal", "市政"], ["commerce", "商铺"], ["agri", "农业"],
	["industry", "工业"], ["storage", "仓储"], ["culture", "文化"],
	["decor", "园林"], ["military", "城防"], ["wonder", "奇观"]
]
const RESOURCE_ORDER: Array = ["grain", "veg", "fruit", "fish", "meat", "wood", "stone", "clay", "copper", "brick", "pottery", "cloth", "bread", "wine", "gold", "pop"]
const ACTION_ORDER: Array = ["build", "road", "world", "view", "menu", "inventory", "task", "save", "load", "center", "zoom-in", "zoom-out", "day", "night", "demolish", "cancel"]
const ART_ALIASES: Dictionary = {
	"resume": "play", "help": "task", "settings": "menu", "overview": "inventory",
	"export": "save", "import": "load", "backup": "load", "new_city": "new-city",
	"log": "task", "minimap": "view", "auto": "day", "close": "cancel", "move": "center",
	"upgrade": "build", "confirm": "build", "trade": "world", "zoom_in": "zoom-in", "zoom_out": "zoom-out",
	"buy": "inventory", "sell": "world", "speed": "play", "search": "view", "blueprint": "build"
}

var city: Dictionary = {}
var root_control: Control
var top_bar: PanelContainer
var top_row: HBoxContainer
var city_plaque: Button
var core_labels: Dictionary = {}
var pause_button: TextureButton
var task_button: Button
var dock: PanelContainer
var placement: PanelContainer
var placement_name: Label
var panel: PanelContainer
var panel_body: VBoxContainer
var panel_scroll: ScrollContainer
var panel_title: Label
var modal_scrim: ColorRect
var toast_label: Label
var toast_timer: Timer
var active_panel: String = ""
var selected_category: String = "recommended"
var search_query: String = ""
var catalog_grid: GridContainer
var catalog_search: LineEdit
var catalog_status: Label
var atlas_manifest: Dictionary = {}
var texture_cache: Dictionary = {}
var base_font: Font
var css_size := Vector2(1280, 800)
var safe := Vector4.ZERO
var last_selection_key: String = ""
var last_panel_signature: String = ""
var initial_decision_done: bool = false
var initialized: bool = false
var first_city_required: bool = false
var city_name_input: LineEdit
var seed_input: LineEdit
var setup_mode: String = "campaign"
var trade_resource: String = "grain"
var trade_quantity: LineEdit
var trade_quote: Label
var trade_option: OptionButton
var art_poll: float = 0.0
var confirmation_open: bool = false
var cached_tiles: Array = []
var setup_compact: bool = false
var setup_reflow_pending: bool = false
var compact_catalog: bool = false

func _ready() -> void:
	setup()

func setup() -> void:
	if initialized:
		return
	initialized = true
	layer = 20
	_load_art()
	if ResourceLoader.exists("res://art/fonts/chinese.otf"):
		base_font = load("res://art/fonts/chinese.otf") as Font
	elif ResourceLoader.exists("res://art/fonts/chinese.ttf"):
		base_font = load("res://art/fonts/chinese.ttf") as Font
	root_control = Control.new()
	root_control.name = "CityHUDRoot"
	root_control.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(root_control)
	var ui_theme := Theme.new()
	if base_font != null:
		ui_theme.default_font = base_font
	ui_theme.default_font_size = 14
	ui_theme.set_color("font_color", "Label", INK)
	ui_theme.set_color("font_color", "Button", INK)
	ui_theme.set_color("font_hover_color", "Button", INK)
	ui_theme.set_color("font_pressed_color", "Button", INK)
	ui_theme.set_color("font_disabled_color", "Button", MUTED)
	ui_theme.set_color("font_color", "LineEdit", INK)
	ui_theme.set_color("font_placeholder_color", "LineEdit", MUTED)
	ui_theme.set_color("caret_color", "LineEdit", INK)
	ui_theme.set_color("selection_color", "LineEdit", Color("c0a569"))
	ui_theme.set_stylebox("normal", "Button", _paper_style(false))
	ui_theme.set_stylebox("hover", "Button", _paper_style(true))
	ui_theme.set_stylebox("pressed", "Button", _paper_style(true, true))
	ui_theme.set_stylebox("disabled", "Button", _paper_style(false, true))
	ui_theme.set_stylebox("focus", "Button", _focus_style())
	ui_theme.set_stylebox("normal", "LineEdit", _paper_style(false))
	ui_theme.set_stylebox("focus", "LineEdit", _paper_style(true))
	ui_theme.set_constant("outline_size", "Label", 0)
	root_control.theme = ui_theme
	_make_top_bar()
	_make_dock()
	_make_placement()
	_make_panel()
	_make_toast()
	get_viewport().size_changed.connect(_layout)
	_layout()

func _process(delta: float) -> void:
	art_poll += delta
	if art_poll >= 1.0:
		art_poll = 0.0
		var measured: Vector2 = _css_dimensions()
		if measured.distance_to(css_size) > 1.0:
			_layout()

func _load_art() -> void:
	if FileAccess.file_exists("res://art/ui/manifest.json"):
		var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string("res://art/ui/manifest.json"))
		if parsed is Dictionary:
			atlas_manifest = parsed as Dictionary

func _art(group: String, key: String) -> Texture2D:
	var cache_key: String = group + "/" + key
	if texture_cache.has(cache_key):
		return texture_cache[cache_key] as Texture2D
	var resolved: String = str(ART_ALIASES.get(key, key)) if group == "actions" else key
	var group_data: Variant = atlas_manifest.get(group, {})
	var entry: Variant = null
	var atlas_path: String = "res://art/ui/" + group + ".png"
	var all_regions: Dictionary = atlas_manifest.get("regions", {}) as Dictionary
	var all_atlases: Dictionary = atlas_manifest.get("atlases", {}) as Dictionary
	if all_regions.has(key):
		resolved = key
	if all_regions.has(resolved):
		entry = all_regions[resolved]
		group_data = all_atlases.get(str((entry as Dictionary).get("atlas", group)), {})
	if group_data is Dictionary:
		var gd: Dictionary = group_data as Dictionary
		atlas_path = str(gd.get("path", gd.get("image", gd.get("file", atlas_path))))
		var items: Variant = gd.get("items", gd.get("regions", gd.get("icons", gd)))
		if items is Dictionary and entry == null:
			entry = (items as Dictionary).get(resolved)
		elif items is Array and entry == null:
			for candidate: Variant in items as Array:
				if candidate is Dictionary and str((candidate as Dictionary).get("id", "")) == resolved:
					entry = candidate
	if not atlas_path.begins_with("res://"):
		atlas_path = "res://art/ui/" + atlas_path.get_file()
	if entry is Dictionary:
		var ed: Dictionary = entry as Dictionary
		var individual: String = str(ed.get("path", ""))
		if not individual.is_empty() and ResourceLoader.exists(individual):
			var direct: Texture2D = load(individual) as Texture2D
			texture_cache[cache_key] = direct
			return direct
	if not ResourceLoader.exists(atlas_path):
		return null
	var source: Texture2D = load(atlas_path) as Texture2D
	var cols: int = 4
	var rows: int = 4
	if group_data is Dictionary:
		cols = int((group_data as Dictionary).get("columns", (group_data as Dictionary).get("cols", 4)))
		rows = int((group_data as Dictionary).get("rows", 4))
	var cell := Vector2(source.get_width() / float(cols), source.get_height() / float(rows))
	var order: Array = RESOURCE_ORDER if group == "resources" else ACTION_ORDER
	var index: int = order.find(resolved)
	var region := Rect2()
	if entry is Array and (entry as Array).size() >= 4:
		var ea: Array = entry as Array
		region = Rect2(float(ea[0]), float(ea[1]), float(ea[2]), float(ea[3]))
	elif entry is int or entry is float:
		index = int(entry)
	elif entry is Dictionary:
		var ed: Dictionary = entry as Dictionary
		index = int(ed.get("index", index))
		var r: Variant = ed.get("rect", ed.get("region"))
		if r is Array and (r as Array).size() >= 4:
			var ra: Array = r as Array
			region = Rect2(float(ra[0]), float(ra[1]), float(ra[2]), float(ra[3]))
		elif ed.has("x"):
			region = Rect2(float(ed.x), float(ed.y), float(ed.get("w", ed.get("width", cell.x))), float(ed.get("h", ed.get("height", cell.y))))
		elif ed.has("col"):
			index = int(ed.get("row", 0)) * cols + int(ed.col)
	if region.size == Vector2.ZERO:
		if index < 0:
			return null
		region = Rect2(Vector2(index % cols, index / cols) * cell, cell)
	var result := AtlasTexture.new()
	result.atlas = source
	result.region = region
	result.filter_clip = true
	texture_cache[cache_key] = result
	return result

func _paper_style(highlight: bool = false, pressed: bool = false) -> StyleBox:
	return _surface_style("card", highlight, pressed)

func _surface_style(kind: String = "paper", highlight: bool = false, pressed: bool = false) -> StyleBox:
	for path: String in ["res://art/ui/" + kind + ".png"]:
		if ResourceLoader.exists(path):
			var textured := StyleBoxTexture.new()
			textured.texture = load(path) as Texture2D
			var border: int = 32 if kind == "paper" else 20 if kind == "red" else 16
			textured.texture_margin_left = border
			textured.texture_margin_right = border
			textured.texture_margin_top = border
			textured.texture_margin_bottom = border
			textured.content_margin_left = 18 if kind == "paper" else 10
			textured.content_margin_right = 18 if kind == "paper" else 10
			textured.content_margin_top = 14 if kind == "paper" else 6
			textured.content_margin_bottom = 14 if kind == "paper" else 6
			textured.modulate_color = Color(0.88, 0.81, 0.65) if pressed else Color(1.06, 1.03, 0.92) if highlight else Color.WHITE
			return textured
	var box := StyleBoxFlat.new()
	box.bg_color = Color("d6bf8b") if pressed else Color("f2e8ce") if highlight else PAPER
	box.border_color = GOLD if highlight else Color("9d814f")
	box.set_border_width_all(1)
	box.set_corner_radius_all(3)
	box.content_margin_left = 10
	box.content_margin_right = 10
	box.content_margin_top = 6
	box.content_margin_bottom = 6
	return box

func _wood_style() -> StyleBox:
	if ResourceLoader.exists("res://art/ui/wood.png"):
		var box := StyleBoxTexture.new()
		box.texture = load("res://art/ui/wood.png") as Texture2D
		box.texture_margin_left = 24
		box.texture_margin_right = 24
		box.texture_margin_top = 24
		box.texture_margin_bottom = 24
		box.content_margin_left = 4
		box.content_margin_right = 4
		box.content_margin_top = 2
		box.content_margin_bottom = 2
		return box
	var box := StyleBoxFlat.new()
	box.bg_color = WOOD
	box.border_color = GOLD
	box.set_border_width_all(1)
	box.set_corner_radius_all(3)
	box.content_margin_left = 4
	box.content_margin_right = 4
	box.content_margin_top = 2
	box.content_margin_bottom = 2
	return box

func _focus_style() -> StyleBoxFlat:
	var box := StyleBoxFlat.new()
	box.bg_color = Color.TRANSPARENT
	box.border_color = Color("dfbe69")
	box.set_border_width_all(2)
	return box

func _label(text_value: String, font_size: int = 14, color: Color = INK) -> Label:
	var label := Label.new()
	label.text = text_value
	label.add_theme_font_size_override("font_size", font_size)
	label.add_theme_color_override("font_color", color)
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return label

func _text(text_value: String, font_size: int = 14, color: Color = INK) -> Label:
	var label: Label = _label(text_value, font_size, color)
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return label

func _button(id: String, caption: String, callback: Callable, minimum: Vector2 = Vector2(0, 44)) -> Button:
	var button := Button.new()
	button.name = id.to_pascal_case() + "Button"
	button.text = caption
	var caption_width: float = 0.0
	for line: String in caption.split("\n"):
		caption_width = maxf(caption_width, base_font.get_string_size(line, HORIZONTAL_ALIGNMENT_LEFT, -1, 14).x if base_font != null else float(line.length()) * 14.0)
	button.custom_minimum_size = Vector2(maxf(maxf(minimum.x, 44), caption_width + 52), maxf(minimum.y, 44))
	button.icon = _art("actions", id)
	button.expand_icon = true
	button.add_theme_constant_override("icon_max_width", 27)
	button.add_theme_constant_override("h_separation", 5)
	button.pressed.connect(callback)
	button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	button.tooltip_text = caption
	return button

func _icon_button(id: String, caption: String, callback: Callable) -> TextureButton:
	var button := TextureButton.new()
	button.name = id.to_pascal_case() + "Button"
	button.custom_minimum_size = Vector2(44, 44)
	button.ignore_texture_size = true
	button.stretch_mode = TextureButton.STRETCH_KEEP_ASPECT_CENTERED
	button.texture_normal = _art("actions", id)
	button.texture_hover = button.texture_normal
	button.texture_pressed = button.texture_normal
	button.tooltip_text = caption
	button.pressed.connect(callback)
	button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	button.mouse_entered.connect(func() -> void: button.self_modulate = Color(1.2, 1.15, 1.0))
	button.mouse_exited.connect(func() -> void: button.self_modulate = Color.WHITE)
	if button.texture_normal == null:
		var fallback: Label = _label(caption, 12, PAPER)
		fallback.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		fallback.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		fallback.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		button.add_child(fallback)
	return button

func _make_top_bar() -> void:
	top_bar = PanelContainer.new()
	top_bar.add_theme_stylebox_override("panel", _wood_style())
	root_control.add_child(top_bar)
	top_row = HBoxContainer.new()
	top_row.add_theme_constant_override("separation", 2)
	top_bar.add_child(top_row)
	for key: String in ["gold", "pop", "grain"]:
		var resource := Button.new()
		resource.name = key.to_pascal_case() + "Resource"
		resource.custom_minimum_size = Vector2(80, 44)
		resource.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		resource.icon = _art("resources", key)
		resource.expand_icon = true
		resource.add_theme_constant_override("icon_max_width", 28)
		resource.add_theme_stylebox_override("normal", StyleBoxEmpty.new())
		resource.add_theme_stylebox_override("hover", _wood_style())
		resource.add_theme_stylebox_override("pressed", _wood_style())
		resource.add_theme_color_override("font_color", PAPER)
		resource.add_theme_color_override("font_hover_color", Color.WHITE)
		resource.add_theme_color_override("font_pressed_color", PAPER)
		resource.tooltip_text = {"gold": "金币 · 点击查看仓储", "pop": "人口 · 点击查看仓储", "grain": "粮食 · 点击查看仓储"}[key]
		resource.pressed.connect(func() -> void: show_panel("inventory"))
		top_row.add_child(resource)
		core_labels[key] = resource
	pause_button = _icon_button("pause", "暂停", func() -> void: _emit("pause"))
	top_row.add_child(pause_button)
	city_plaque = _button("overview", "长乐", func() -> void: show_panel("overview"), Vector2(110, 44))
	city_plaque.add_theme_font_size_override("font_size", 12)
	root_control.add_child(city_plaque)
	task_button = _button("task", "城志", func() -> void: show_panel("tasks"), Vector2(68, 44))
	root_control.add_child(task_button)

func _make_dock() -> void:
	dock = PanelContainer.new()
	dock.add_theme_stylebox_override("panel", _wood_style())
	root_control.add_child(dock)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 3)
	dock.add_child(row)
	var options: Array = [["build", "营造", "catalog"], ["road", "修路", "road"], ["world", "世界", "online"], ["view", "视野", "view"], ["menu", "城务", "menu"]]
	for data: Array in options:
		var id: String = str(data[0])
		var target: String = str(data[2])
		var button: Button = _button(id, str(data[1]), func() -> void:
			if target == "road":
				_select_tool("road")
			elif target == "online":
				_close_panel()
				_emit("online", {"tab": "cloud"})
			else:
				show_panel(target)
		, Vector2(63, 50))
		button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		button.text = ""
		button.icon = null
		button.custom_minimum_size = Vector2(62, 62)
		button.add_theme_stylebox_override("normal", StyleBoxEmpty.new())
		button.add_theme_stylebox_override("hover", _wood_style())
		button.add_theme_stylebox_override("pressed", _wood_style())
		var contents := VBoxContainer.new()
		contents.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		contents.mouse_filter = Control.MOUSE_FILTER_IGNORE
		contents.add_theme_constant_override("separation", 0)
		button.add_child(contents)
		var illustration := TextureRect.new()
		illustration.texture = _art("actions", id)
		illustration.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		illustration.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
		illustration.custom_minimum_size.y = 44
		illustration.mouse_filter = Control.MOUSE_FILTER_IGNORE
		contents.add_child(illustration)
		var caption: Label = _label(str(data[1]), 12, PAPER)
		caption.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		contents.add_child(caption)
		row.add_child(button)

func _make_placement() -> void:
	placement = PanelContainer.new()
	placement.add_theme_stylebox_override("panel", _wood_style())
	root_control.add_child(placement)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 5)
	placement.add_child(row)
	var info: TextureButton = _icon_button("build", "查看蓝图", func() -> void: show_panel("blueprint"))
	row.add_child(info)
	placement_name = _label("选择地块营造", 13, PAPER)
	placement_name.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	placement_name.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	row.add_child(placement_name)
	row.add_child(_icon_button("cancel", "取消营造", func() -> void:
		_emit("cancel")
		_close_panel()
	))
	placement.hide()

func _make_panel() -> void:
	modal_scrim = ColorRect.new()
	modal_scrim.color = Color(0.08, 0.07, 0.04, 0.48)
	modal_scrim.mouse_filter = Control.MOUSE_FILTER_STOP
	modal_scrim.hide()
	root_control.add_child(modal_scrim)
	panel = PanelContainer.new()
	panel.name = "HudPanel"
	panel.add_theme_stylebox_override("panel", _surface_style("paper"))
	root_control.add_child(panel)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 4)
	panel.add_child(column)
	var heading := HBoxContainer.new()
	column.add_child(heading)
	panel_title = _label("城务", 18)
	panel_title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	heading.add_child(panel_title)
	var close: Button = _button("close", "收起", func() -> void:
		if first_city_required and active_panel == "newcity":
			show_toast("请先为你的新城命名。")
			return
		if active_panel == "detail":
			_emit("cancel")
		_close_panel()
	, Vector2(68, 44))
	close.name = "ClosePanelButton"
	heading.add_child(close)
	panel_scroll = ScrollContainer.new()
	panel_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	panel_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	panel_scroll.follow_focus = true
	column.add_child(panel_scroll)
	panel_body = VBoxContainer.new()
	panel_body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	panel_body.add_theme_constant_override("separation", 8)
	panel_scroll.add_child(panel_body)
	panel.hide()

func _make_toast() -> void:
	toast_label = _text("", 14, PAPER)
	toast_label.name = "HudToast"
	toast_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	toast_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	toast_label.add_theme_stylebox_override("normal", _wood_style())
	root_control.add_child(toast_label)
	toast_label.hide()
	toast_timer = Timer.new()
	toast_timer.one_shot = true
	toast_timer.wait_time = 4.2
	toast_timer.timeout.connect(func() -> void: toast_label.hide())
	add_child(toast_timer)

func _css_dimensions() -> Vector2:
	if OS.has_feature("web"):
		var browser: JavaScriptObject = JavaScriptBridge.get_interface("window")
		if browser != null:
			return Vector2(float(browser.innerWidth), float(browser.innerHeight))
	var window_size := Vector2(DisplayServer.window_get_size())
	if window_size.x > 0 and window_size.y > 0:
		return window_size
	return get_viewport().get_visible_rect().size

func _layout() -> void:
	if not initialized or root_control == null:
		return
	css_size = _css_dimensions()
	var viewport_size: Vector2 = get_viewport().get_visible_rect().size
	var factor: float = viewport_size.x / maxf(css_size.x, 1.0)
	root_control.scale = Vector2(factor, factor)
	root_control.size = css_size
	var safe_data: Dictionary = city.get("safeArea", {}) as Dictionary
	safe = Vector4(float(safe_data.get("left", 0)), float(safe_data.get("top", 0)), float(safe_data.get("right", 0)), float(safe_data.get("bottom", 0)))
	var usable_width: float = css_size.x - safe.x - safe.z
	var narrow: bool = usable_width < 820
	var bar_width: float = minf(usable_width - 16, 430)
	top_bar.position = Vector2(safe.x + (usable_width - bar_width) * 0.5, safe.y + 8)
	top_bar.size = Vector2(bar_width, 48)
	city_plaque.position = Vector2(safe.x + 8, safe.y + (62 if narrow else 10))
	city_plaque.size = Vector2(126 if narrow else 176, 44)
	task_button.position = Vector2(css_size.x - safe.z - 88, safe.y + (62 if narrow else 10))
	task_button.size = Vector2(80, 44)
	var dock_width: float = minf(usable_width - 16, 380)
	dock.position = Vector2(safe.x + (usable_width - dock_width) * 0.5, css_size.y - safe.w - 74)
	dock.size = Vector2(dock_width, 66)
	placement.position = Vector2(safe.x + (usable_width - minf(usable_width - 16, 440)) * 0.5, css_size.y - safe.w - 56)
	placement.size = Vector2(minf(usable_width - 16, 440), 48)
	var is_setup: bool = active_panel == "newcity"
	if is_setup and setup_compact != (css_size.x > 650 and css_size.y < 600) and not setup_reflow_pending:
		setup_reflow_pending = true
		_reflow_newcity.call_deferred()
	modal_scrim.position = Vector2.ZERO
	modal_scrim.size = css_size
	modal_scrim.visible = is_setup
	top_bar.visible = not is_setup
	task_button.visible = not is_setup
	if is_setup:
		city_plaque.hide()
		dock.hide()
		placement.hide()
	else:
		dock.visible = str(city.get("tool", "")).is_empty()
		placement.visible = not dock.visible
	var max_width: float = 830 if active_panel == "catalog" else (760 if css_size.y < 600 else 600) if is_setup else 520
	var panel_width: float = minf(usable_width - 16, max_width)
	var panel_height: float = minf(css_size.y - safe.y - safe.w - 24, 600) if is_setup else minf(css_size.y * 0.40, 330)
	var panel_bottom: float = css_size.y - safe.w - (74 if str(city.get("tool", "")).is_empty() else 56) - 7
	panel.position = Vector2(safe.x + (usable_width - panel_width) * 0.5, (css_size.y - panel_height) * 0.5 if is_setup else panel_bottom - panel_height)
	panel.size = Vector2(panel_width, panel_height)
	if catalog_grid != null and is_instance_valid(catalog_grid):
		catalog_grid.columns = 128 if compact_catalog else maxi(2, int((panel_width - 28) / 112))
	var toast_text_width: float = base_font.get_string_size(toast_label.text, HORIZONTAL_ALIGNMENT_LEFT, -1, 14).x + 32 if base_font != null else 440.0
	var toast_width: float = minf(usable_width - 24, minf(440, maxf(160, toast_text_width)))
	toast_label.position = Vector2(safe.x + (usable_width - toast_width) * 0.5, safe.y + (112 if narrow else 70))
	toast_label.size = Vector2(toast_width, 48)
	if is_setup or (narrow and css_size.y < 500):
		city_plaque.hide()
		if not is_setup:
			task_button.position.y = safe.y + 62
	else:
		city_plaque.show()

func sync_state(value: Dictionary) -> void:
	setup()
	city = value
	if city.get("tiles") is Array:
		cached_tiles = city.tiles as Array
	var goods: Dictionary = city.get("goods", {}) as Dictionary
	for key: String in ["gold", "pop", "grain"]:
		var number: float = float(goods.get(key, 0)) if key == "grain" else float(city.get(key, 0))
		var button: Button = core_labels[key] as Button
		button.text = _number(number)
	city_plaque.text = str(city.get("cityName", "万城纪"))
	city_plaque.tooltip_text = city_plaque.text + " · 城市总览"
	var paused: bool = int(city.get("speed", 1)) == 0
	pause_button.texture_normal = _art("actions", "play" if paused else "pause")
	pause_button.texture_hover = pause_button.texture_normal
	pause_button.texture_pressed = pause_button.texture_normal
	pause_button.tooltip_text = "继续" if paused else "暂停"
	var tool: String = str(city.get("tool", ""))
	var has_tool: bool = not tool.is_empty() and tool != "null"
	dock.visible = not has_tool
	placement.visible = has_tool
	if has_tool:
		var definition: Dictionary = _definition(tool)
		placement_name.text = str(definition.get("name", tool)) + "  ·  " + _cost_text(definition.get("cost", {}) as Dictionary)
	var tasks: Array = city.get("tasks", []) as Array
	var complete: int = 0
	for task: Variant in tasks:
		if task is Dictionary and bool((task as Dictionary).get("done", (task as Dictionary).get("complete", false))):
			complete += 1
	task_button.text = "城志" if tasks.is_empty() else "%d/%d" % [complete, tasks.size()]
	var selection: Dictionary = _selection()
	var selection_key: String = "%s:%s:%s" % [selection.get("x", ""), selection.get("y", ""), selection.get("type", "")] if not selection.is_empty() else ""
	if selection_key != last_selection_key:
		last_selection_key = selection_key
		if not selection_key.is_empty() and not has_tool:
			show_panel("detail")
		elif active_panel == "detail":
			_close_panel()
	if not initial_decision_done and city.has("hasSave"):
		initial_decision_done = true
		first_city_required = not bool(city.get("hasSave", false))
		if first_city_required:
			show_panel("newcity")
	if not confirmation_open and active_panel in ["detail", "inventory", "overview", "tasks", "log", "saves"]:
		var signature: String = _panel_signature()
		if signature != last_panel_signature:
			last_panel_signature = signature
			var old_scroll: int = panel_scroll.scroll_vertical
			_render_panel()
			panel_scroll.set_deferred("scroll_vertical", old_scroll)
	if active_panel == "caravan" and is_instance_valid(trade_option):
		for item_index: int in trade_option.item_count:
			var good_id: String = str(trade_option.get_item_metadata(item_index))
			trade_option.set_item_text(item_index, _good_name(good_id) + " · 库存 " + _number(float(goods.get(good_id, 0))))
		_update_trade_quote()
	_layout()

func _panel_signature() -> String:
	match active_panel:
		"detail": return JSON.stringify(_selection())
		"inventory": return JSON.stringify([city.get("goods"), city.get("lastDelta"), city.get("caps")])
		"tasks": return JSON.stringify(city.get("tasks"))
		"log": return JSON.stringify(city.get("log"))
		"saves": return JSON.stringify(city.get("slots"))
		_: return JSON.stringify([city.get("pop"), city.get("gold"), city.get("prestige"), city.get("workersAssigned")])

func show_panel(name: String) -> void:
	setup()
	if active_panel == name and panel.visible:
		if not (name == "newcity" and first_city_required):
			_close_panel()
		return
	if active_panel == "detail" and name != "detail":
		_emit("cancel")
	active_panel = name
	confirmation_open = false
	last_panel_signature = ""
	_render_panel()
	panel.show()
	_layout()

func _close_panel() -> void:
	active_panel = ""
	confirmation_open = false
	panel.hide()
	catalog_grid = null
	catalog_search = null
	_layout()

func close_transient_panels() -> void:
	if active_panel != "newcity":
		if active_panel == "detail":
			_emit("cancel")
		_close_panel()

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouse and event.device == InputEvent.DEVICE_ID_EMULATION:
		return
	if bool(city.get("onlineOpen", false)):
		return
	if event is InputEventKey:
		var key: InputEventKey = event as InputEventKey
		if not key.pressed or key.echo:
			return
		var focused: Control = get_viewport().gui_get_focus_owner()
		if (focused is LineEdit or focused is TextEdit) and key.keycode != KEY_ESCAPE:
			return
		if active_panel == "newcity":
			if key.keycode == KEY_ESCAPE and not first_city_required:
				_close_panel()
			get_viewport().set_input_as_handled()
			return
		match key.keycode:
			KEY_ESCAPE:
				_close_panel()
				_emit("cancel")
			KEY_SPACE: _emit("pause")
			KEY_1: _emit("speed", {"value": 1})
			KEY_4:
				if str(city.get("mode", "campaign")) == "sandbox":
					_emit("speed", {"value": 4})
			KEY_B: show_panel("catalog")
			KEY_I: show_panel("inventory")
			KEY_N:
				var current: String = str(city.get("nightMode", "auto"))
				_emit("night", {"mode": "day" if current == "auto" else "night" if current == "day" else "auto"})
			KEY_H: _emit("center")
			KEY_EQUAL, KEY_PLUS, KEY_KP_ADD: _emit("zoom", {"factor": 1.18})
			KEY_MINUS, KEY_KP_SUBTRACT: _emit("zoom", {"factor": 0.85})
			KEY_F1: show_panel("help")
			KEY_S:
				if key.ctrl_pressed or key.meta_pressed:
					_emit("save")
				else:
					return
			_: return
		get_viewport().set_input_as_handled()
	elif (event is InputEventMouseButton and (event as InputEventMouseButton).pressed and (event as InputEventMouseButton).button_index == MOUSE_BUTTON_LEFT) or (event is InputEventScreenTouch and (event as InputEventScreenTouch).pressed):
		close_transient_panels()

func blocks_map() -> bool:
	return active_panel == "newcity"

func viewport_insets() -> Dictionary:
	return {"top": safe.y + 58, "bottom": safe.w + (74 if dock.visible else 56), "left": safe.x, "right": safe.z}

## Read-only geometry for browser acceptance checks. Coordinates are CSS pixels.
func diagnostics() -> Dictionary:
	var controls: Array = []
	if root_control != null:
		_collect_controls(root_control, controls)
	return {"active_panel": active_panel, "css_size": [css_size.x, css_size.y],
		"panel_rect": _css_rect(panel) if panel != null and panel.visible else [],
		"dock_rect": _css_rect(dock) if dock != null and dock.visible else [],
		"top_rect": _css_rect(top_bar) if top_bar != null and top_bar.visible else [],
		"placement_rect": _css_rect(placement) if placement != null and placement.visible else [],
		"controls": controls, "art_regions": (atlas_manifest.get("regions", {}) as Dictionary).size()}

func _css_rect(control: Control) -> Array:
	var scale_factor: float = maxf(root_control.scale.x, 0.0001)
	var rect: Rect2 = control.get_global_rect()
	return [rect.position.x / scale_factor, rect.position.y / scale_factor, rect.size.x / scale_factor, rect.size.y / scale_factor]

func _collect_controls(node: Node, output: Array) -> void:
	if node is Control and not (node as Control).is_visible_in_tree():
		return
	if node is BaseButton or node is LineEdit:
		var control: Control = node as Control
		var rect: Array = _css_rect(control)
		var full_rect: Array = rect.duplicate()
		var partially_clipped: bool = false
		var clipped: bool = false
		var ancestor: Node = node.get_parent()
		while ancestor != null and ancestor != root_control:
			if ancestor is Control and (ancestor as Control).clip_contents:
				var parent_rect: Array = _css_rect(ancestor as Control)
				var intersection: Rect2 = Rect2(float(rect[0]), float(rect[1]), float(rect[2]), float(rect[3])).intersection(Rect2(float(parent_rect[0]), float(parent_rect[1]), float(parent_rect[2]), float(parent_rect[3])))
				if not intersection.has_area():
					clipped = true
					break
				var visible_rect: Array = [intersection.position.x, intersection.position.y, intersection.size.x, intersection.size.y]
				partially_clipped = partially_clipped or intersection.size.x < float(rect[2]) - 0.1 or intersection.size.y < float(rect[3]) - 0.1
				rect = visible_rect
			ancestor = ancestor.get_parent()
		if not clipped:
			var text_value: String = str((node as Button).text) if node is Button else str((node as LineEdit).text) if node is LineEdit else ""
			output.append({"name": str(node.name), "text": text_value, "tooltip": control.tooltip_text, "rect": rect, "full_rect": full_rect, "clipped": partially_clipped,
				"disabled": (node as BaseButton).disabled if node is BaseButton else not (node as LineEdit).editable})
	for child: Node in node.get_children():
		_collect_controls(child, output)

func _clear_body() -> void:
	for child: Node in panel_body.get_children():
		panel_body.remove_child(child)
		child.queue_free()
	catalog_grid = null
	catalog_search = null

func _render_panel() -> void:
	confirmation_open = false
	_clear_body()
	var surface: StyleBox = _surface_style("paper")
	if active_panel == "catalog" and css_size.y < 500:
		surface.content_margin_top = 6
		surface.content_margin_bottom = 6
	panel.add_theme_stylebox_override("panel", surface)
	var titles: Dictionary = {"catalog": "营造图录", "catalog_filters": "图录分类与搜索", "inventory": "城市仓储", "tasks": "城志与征程", "view": "山河视野", "minimap": "疆域舆图", "menu": "城务", "detail": "建筑档案", "blueprint": "营造蓝图", "help": "营造指南", "overview": "城市总览", "newcity": "择一方水土，建一座新城", "settings": "偏好设置", "saves": "城市档案", "log": "城中纪事", "caravan": "往来商队"}
	panel_title.text = str(titles.get(active_panel, "城务"))
	match active_panel:
		"catalog": _catalog_panel()
		"catalog_filters": _catalog_filters_panel()
		"inventory": _inventory_panel()
		"tasks": _tasks_panel()
		"view": _view_panel()
		"minimap": _minimap_panel()
		"menu": _menu_panel()
		"detail": _detail_panel()
		"blueprint": _blueprint_panel()
		"help": _help_panel()
		"overview": _overview_panel()
		"newcity": _newcity_panel()
		"settings": _settings_panel()
		"saves": _saves_panel()
		"log": _log_panel()
		"caravan": _caravan_panel()
	_layout()

func _catalog_panel() -> void:
	compact_catalog = css_size.y < 500
	if compact_catalog:
		var row: HBoxContainer = _row()
		var filters: Button = _button("search", "分类\n搜索", func() -> void: show_panel("catalog_filters"), Vector2(76, 80))
		filters.name = "CatalogFiltersButton"
		filters.custom_minimum_size = Vector2(76, 80)
		row.add_child(filters)
		var scroll := ScrollContainer.new()
		scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_AUTO
		scroll.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
		scroll.custom_minimum_size.y = 84
		scroll.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(scroll)
		catalog_grid = GridContainer.new()
		catalog_grid.columns = 128
		catalog_grid.add_theme_constant_override("h_separation", 6)
		scroll.add_child(catalog_grid)
		catalog_status = _label("")
		catalog_status.hide()
		panel_body.add_child(catalog_status)
		_populate_catalog()
		return
	catalog_search = LineEdit.new()
	catalog_search.name = "CatalogSearch"
	catalog_search.placeholder_text = "搜索建筑、功能或材料"
	catalog_search.text = search_query
	catalog_search.custom_minimum_size.y = 44
	catalog_search.text_changed.connect(func(value: String) -> void:
		search_query = value.strip_edges()
		_populate_catalog()
	)
	panel_body.add_child(catalog_search)
	var tabs_scroll := ScrollContainer.new()
	tabs_scroll.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	tabs_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_AUTO
	tabs_scroll.custom_minimum_size.y = 48
	panel_body.add_child(tabs_scroll)
	var tabs := HBoxContainer.new()
	tabs.add_theme_constant_override("separation", 4)
	tabs_scroll.add_child(tabs)
	for category: Array in CATEGORIES:
		var id: String = str(category[0])
		var button: Button = _button("build", str(category[1]), func() -> void:
			selected_category = id
			for child: Node in tabs.get_children():
				if child is Button:
					(child as Button).button_pressed = str(child.get_meta("category", "")) == id
			_populate_catalog()
		, Vector2(62, 44))
		button.toggle_mode = true
		button.name = "Category_" + id
		button.button_pressed = selected_category == id
		button.set_meta("category", id)
		button.icon = null
		button.custom_minimum_size = Vector2(62, 44)
		tabs.add_child(button)
	catalog_status = _label("", 12, MUTED)
	panel_body.add_child(catalog_status)
	catalog_grid = GridContainer.new()
	catalog_grid.columns = 3
	catalog_grid.add_theme_constant_override("h_separation", 6)
	catalog_grid.add_theme_constant_override("v_separation", 6)
	panel_body.add_child(catalog_grid)
	_populate_catalog()

func _catalog_filters_panel() -> void:
	var search := LineEdit.new()
	search.name = "CatalogSearch"
	search.placeholder_text = "搜索建筑或功能"
	search.text = search_query
	search.custom_minimum_size.y = 44
	search.text_changed.connect(func(value: String) -> void: search_query = value.strip_edges())
	search.text_submitted.connect(func(_value: String) -> void: show_panel("catalog"))
	panel_body.add_child(search)
	panel_body.add_child(_button("search", "查看搜索结果", func() -> void: show_panel("catalog")))
	var categories := GridContainer.new()
	categories.columns = 3
	categories.add_theme_constant_override("h_separation", 6)
	categories.add_theme_constant_override("v_separation", 6)
	panel_body.add_child(categories)
	for category: Array in CATEGORIES:
		var id: String = str(category[0])
		var button: Button = _button("build", str(category[1]), func() -> void:
			selected_category = id
			show_panel("catalog")
		)
		button.name = "Category_" + id
		button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		categories.add_child(button)

func _populate_catalog() -> void:
	if catalog_grid == null:
		return
	for child: Node in catalog_grid.get_children():
		catalog_grid.remove_child(child)
		child.queue_free()
	var shown: int = 0
	var catalog: Array = city.get("catalog", []) as Array
	for item: Variant in catalog:
		if not item is Dictionary:
			continue
		var entry: Dictionary = item as Dictionary
		var type: String = str(entry.get("type", ""))
		var cat: String = str(entry.get("cat", ""))
		var available: bool = bool(entry.get("unlocked", true))
		if selected_category == "recommended":
			if not type in ["house", "road", "well", "farmland", "lumber", "grainShop", "quarry", "watch"]:
				continue
		elif cat != selected_category:
			continue
		if not search_query.is_empty() and not (str(entry.get("name", "")) + str(entry.get("desc", "")) + _cost_text(entry.get("cost", {}) as Dictionary)).contains(search_query):
			continue
		var button: Button = _button("build", str(entry.get("name", type)), func() -> void:
			if not available:
				show_toast(str(entry.get("lockReason", "完成前序城志后开放。")))
				return
			_select_tool(type)
		, Vector2(104, 112))
		button.name = "Build_" + type
		button.text = ""
		button.icon = null
		button.custom_minimum_size = Vector2(104, 80 if compact_catalog else 112)
		button.tooltip_text = str(entry.get("desc", "")) + "\n" + _cost_text(entry.get("cost", {}) as Dictionary)
		button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var contents := VBoxContainer.new()
		contents.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		contents.offset_left = 5
		contents.offset_right = -5
		contents.offset_top = 3
		contents.offset_bottom = -3
		contents.add_theme_constant_override("separation", 0)
		contents.mouse_filter = Control.MOUSE_FILTER_IGNORE
		button.add_child(contents)
		contents.add_child(_building_thumbnail(type))
		var caption: Label = _label(str(entry.get("name", type)), 12)
		caption.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		caption.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		contents.add_child(caption)
		if available:
			var cost_row := HBoxContainer.new()
			cost_row.alignment = BoxContainer.ALIGNMENT_CENTER
			cost_row.add_theme_constant_override("separation", 3)
			cost_row.mouse_filter = Control.MOUSE_FILTER_IGNORE
			contents.add_child(cost_row)
			var costs: Dictionary = entry.get("cost", {}) as Dictionary
			for good: Variant in costs:
				var picture := TextureRect.new()
				picture.texture = _art("resources", str(good))
				picture.custom_minimum_size = Vector2(14, 16)
				picture.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
				picture.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
				picture.mouse_filter = Control.MOUSE_FILTER_IGNORE
				cost_row.add_child(picture)
				cost_row.add_child(_label(_number(float(costs[good])), 10, MUTED))
		else:
			var lock_label: Label = _label(str(entry.get("lockReason", "尚未开放")), 11, MUTED)
			lock_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			lock_label.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
			contents.add_child(lock_label)
		if not available:
			button.modulate = Color(0.7, 0.66, 0.59)
		catalog_grid.add_child(button)
		shown += 1
	catalog_status.text = "点选蓝图后，在地图上轻触营造。" if shown > 0 else "此分类没有符合搜索的建筑。"
	_layout()

func _building_thumbnail(type: String) -> Control:
	var image := TextureRect.new()
	image.custom_minimum_size = Vector2(80, 40 if compact_catalog else 68)
	image.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	image.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	image.mouse_filter = Control.MOUSE_FILTER_IGNORE
	image.texture = _art("actions", "road" if type == "road" else "build")
	if type == "road" or not ResourceLoader.exists("res://world/buildings.gd"):
		return image
	var provider: Node2D = load("res://world/buildings.gd").new()
	if not provider.has_method("create_preview"):
		provider.free()
		return image
	var preview: Node2D = provider.call("create_preview", type, 1) as Node2D
	provider.free()
	if preview == null:
		return image
	var bounds: Rect2 = preview.get_meta("preview_bounds", Rect2(-64, -120, 128, 180))
	var viewport := SubViewport.new()
	viewport.size = Vector2i(320, 200)
	viewport.transparent_bg = true
	viewport.disable_3d = true
	viewport.world_2d = World2D.new()
	viewport.render_target_update_mode = SubViewport.UPDATE_ONCE
	image.add_child(viewport)
	viewport.add_child(preview)
	var scale_value: float = minf(304.0 / maxf(bounds.size.x, 1), 184.0 / maxf(bounds.size.y, 1))
	preview.scale = Vector2(scale_value, scale_value)
	preview.position = (Vector2(320, 200) - bounds.size * scale_value) * 0.5 - bounds.position * scale_value
	image.texture = viewport.get_texture()
	return image

func _select_tool(type: String) -> void:
	if bool(city.get("visiting", false)):
		show_toast("参观中的城市仅可浏览。")
		return
	_close_panel()
	_emit("select_tool", {"type": type})

func _inventory_panel() -> void:
	panel_body.add_child(_text("库存与上次经营结算的实际净变化（%s）。粮仓和货栈提升储量。" % _duration(float(city.get("lastDeltaSeconds", 60))), 12, MUTED))
	var goods: Dictionary = city.get("goods", {}) as Dictionary
	var delta: Dictionary = city.get("lastDelta", {}) as Dictionary
	var caps: Dictionary = city.get("caps", {}) as Dictionary
	for key: Variant in goods:
		var id: String = str(key)
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 8)
		panel_body.add_child(row)
		var art := TextureRect.new()
		art.texture = _art("resources", id)
		art.custom_minimum_size = Vector2(34, 34)
		art.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		art.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
		art.mouse_filter = Control.MOUSE_FILTER_IGNORE
		row.add_child(art)
		var name_label: Label = _label(_good_name(id))
		name_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(name_label)
		var meta: Dictionary = city.get("goodsMeta", {}) as Dictionary
		var definition: Dictionary = meta.get(id, {}) as Dictionary
		var capacity: float = float(caps.get("food" if str(definition.get("cat", "")) == "food" else "mat", 0))
		row.add_child(_label(_number(float(goods.get(id, 0))) + (" / " + _number(capacity) if capacity > 0 else "")))
		var change: float = float(delta.get(id, 0))
		row.add_child(_label(("+" if change >= 0 else "") + _number(change), 12, Color("536b37") if change >= 0 else Color("a44f3f")))
	if not bool(city.get("visiting", false)):
		panel_body.add_child(_button("trade", "与往来商队交易", func() -> void: show_panel("caravan")))

func _tasks_panel() -> void:
	panel_body.add_child(_text(str(city.get("chapterName", city.get("chapterTitle", "第 %d 章 · 城市征程" % (int(city.get("chapter", 0)) + 1)))), 16))
	var tasks: Array = city.get("tasks", []) as Array
	for item: Variant in tasks:
		if item is Dictionary:
			var task: Dictionary = item as Dictionary
			var done: bool = bool(task.get("done", task.get("complete", false)))
			panel_body.add_child(_text(("已达成  " if done else "待完成  ") + str(task.get("text", task.get("name", ""))), 14, Color("536b37") if done else INK))
	if tasks.is_empty():
		panel_body.add_child(_text("自由营造，或在文明征程中逐章发展城市。"))

func _view_panel() -> void:
	var day_row: HBoxContainer = _row()
	for entry: Array in [["auto", "自然昼夜"], ["day", "白昼"], ["night", "夜景"]]:
		var mode: String = str(entry[0])
		var button: Button = _button(mode, str(entry[1]), func() -> void: _emit("night", {"mode": mode}))
		button.toggle_mode = true
		button.button_pressed = str(city.get("nightMode", "auto")) == mode
		day_row.add_child(button)
	var row: HBoxContainer = _row()
	row.add_child(_button("center", "归城", func() -> void: _emit("center"); _close_panel()))
	row.add_child(_button("zoom_out", "缩小", func() -> void: _emit("zoom", {"factor": 0.85})))
	row.add_child(_button("zoom_in", "放大", func() -> void: _emit("zoom", {"factor": 1.18})))
	panel_body.add_child(_button("minimap", "打开疆域舆图", func() -> void: show_panel("minimap")))
	panel_body.add_child(_text("覆盖检查", 13, MUTED))
	var overlays: HBoxContainer = _row()
	for entry: Array in [["none", "原貌"], ["road", "道路"], ["water", "供水"], ["pollution", "污染"]]:
		var mode: String = str(entry[0])
		overlays.add_child(_button("view", str(entry[1]), func() -> void: _emit("setting", {"key": "overlay", "value": mode})))
	panel_body.add_child(_text("拖动平移 · 双指缩放 · H 回城 · N 切换昼夜", 12, MUTED))

func _menu_panel() -> void:
	var grid := GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 6)
	grid.add_theme_constant_override("v_separation", 6)
	panel_body.add_child(grid)
	for entry: Array in [["overview", "城市总览"], ["inventory", "城市仓储"], ["saves", "存档与迁移"], ["log", "城中纪事"], ["help", "营造指南"], ["settings", "偏好设置"]]:
		var target: String = str(entry[0])
		var button: Button = _button("save" if target == "saves" else target, str(entry[1]), func() -> void: show_panel(target))
		button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		grid.add_child(button)
	var speeds: HBoxContainer = _row()
	var speed_values: Array = [0, 1, 4, 60] if str(city.get("mode", "campaign")) == "sandbox" else [0, 1]
	for value: int in speed_values:
		var button: Button = _button("pause" if value == 0 else "speed", "暂停" if value == 0 else str(value) + "倍", func() -> void: _emit("speed", {"value": value}))
		button.name = "Speed%dButton" % value
		speeds.add_child(button)
	if str(city.get("mode", "campaign")) != "sandbox":
		panel_body.add_child(_text("文明征程按真实时间经营，离线时继续结算。", 12, MUTED))

func _minimap_panel() -> void:
	panel_body.add_child(_text("轻触地图，前往对应街区。", 12, MUTED))
	var map: Control = load("res://ui/minimap.gd").new()
	map.name = "CityMinimap"
	map.custom_minimum_size.y = minf(210, css_size.y * 0.40 - 95)
	map.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	panel_body.add_child(map)
	map.configure(cached_tiles, city.get("buildings", []) as Array, int(city.get("mapW", 64)), int(city.get("mapH", 64)))
	map.tile_selected.connect(func(x: int, y: int) -> void:
		_emit("center", {"x": x, "y": y})
	)

func _selection() -> Dictionary:
	var selected: Variant = city.get("selection", {})
	return selected as Dictionary if selected is Dictionary else {}

func _detail_panel() -> void:
	var selected: Dictionary = _selection()
	if selected.is_empty():
		panel_body.add_child(_text("轻触一座建筑，查看需求与运作情况。"))
		return
	panel_title.text = str(selected.get("name", _definition(str(selected.get("type", ""))).get("name", "建筑档案")))
	if str(selected.get("type", "")).is_empty():
		panel_body.add_child(_text("选择营造图录中的建筑，在满足地形与道路要求的地块落成。", 13, MUTED))
		return
	panel_body.add_child(_text(str(selected.get("desc", "")), 12, MUTED))
	var level: int = int(selected.get("lvl", 1))
	var summary: String = "等级 %d" % level
	if selected.has("pop"):
		summary += " · 居民 " + _number(float(selected.pop)) + (" / " + _number(float(selected.capacity)) if selected.has("capacity") else "")
	if int(selected.get("workers", 0)) > 0:
		var workers_needed: int = int(selected.get("workersNeeded", selected.get("workers", 0)))
		summary += " · 劳工 %d / %d" % [workers_needed if bool(selected.get("staffed", false)) else 0, workers_needed]
	panel_body.add_child(_text(summary))
	if float(selected.get("damage", 0)) > 0:
		panel_body.add_child(_text("受损修复中 · 剩余 " + _duration(float(selected.damage)), 13, Color("a44f3f")))
	if selected.has("connected") and not bool(selected.connected):
		panel_body.add_child(_text("未接入主路：施工与运营将暂停。", 13, Color("a44f3f")))
	var construction: Variant = selected.get("construction")
	if construction is Dictionary and not (construction as Dictionary).is_empty():
		var progress: Dictionary = construction as Dictionary
		panel_body.add_child(_text("升级施工" if progress.has("toLevel") else "正在营造", 14))
		var bar := ProgressBar.new()
		bar.max_value = maxf(1.0, float(progress.get("total", 1)))
		bar.value = bar.max_value - float(progress.get("remaining", 0))
		bar.custom_minimum_size.y = 18
		panel_body.add_child(bar)
		panel_body.add_child(_text("剩余 " + _duration(float(progress.get("remaining", 0))), 12, MUTED))
	var needs: Array = selected.get("needs", []) as Array
	if not needs.is_empty():
		panel_body.add_child(_text("下一级需求" if int(selected.get("nextLevel", 0)) > 0 else "维持居住的需求", 13, MUTED))
	for item: Variant in needs:
		if item is Dictionary:
			var need: Dictionary = item as Dictionary
			var met: bool = bool(need.get("met", need.get("ok", false)))
			panel_body.add_child(_text(("已满足 · " if met else "尚缺 · ") + str(need.get("name", need.get("id", "需求"))), 13, Color("536b37") if met else Color("a44f3f")))
	if selected.has("clean") and not bool(selected.clean):
		panel_body.add_child(_text("污染阻止升级：迁开污染工业，或用花园改善居住环境。", 13, Color("a44f3f")))
	if selected.has("beauty") and float(selected.beauty) < 0:
		panel_body.add_child(_text("美化不足：增建园林，平衡工业影响。", 13, Color("a44f3f")))
	if selected.has("upgradeRemaining") and float(selected.upgradeRemaining) > 0:
		panel_body.add_child(_text("稳定居住后升级，剩余 " + _duration(float(selected.upgradeRemaining)), 13, MUTED))
	if not str(selected.get("reason", "")).is_empty():
		panel_body.add_child(_text(str(selected.reason), 13, MUTED))
	var production: Variant = selected.get("production")
	if production is Dictionary:
		var cycle: Dictionary = production as Dictionary
		var duration: float = float(cycle.get("duration", 0))
		if duration > 0:
			panel_body.add_child(_text("生产周期 " + _duration(duration) + " · 下一批剩余 " + _duration(maxf(0.0, duration - float(cycle.get("elapsed", 0)))), 13, MUTED))
	for key: String in ["prod", "input"]:
		var amount: Variant = selected.get(key, {})
		if amount is Dictionary and not (amount as Dictionary).is_empty():
			panel_body.add_child(_text(("产出基准 / 分钟  " if key == "prod" else "原料基准 / 分钟  ") + _cost_text(amount as Dictionary), 13))
	var buttons: HBoxContainer = _row()
	buttons.add_child(_button("center", "定位", func() -> void: _emit("center", {"x": selected.get("x"), "y": selected.get("y")})))
	if not bool(city.get("visiting", false)):
		if str(selected.get("type", "")) != "road":
			buttons.add_child(_button("move", "迁移", func() -> void: _emit("move", {"x": selected.get("x"), "y": selected.get("y")}); _close_panel()))
		buttons.add_child(_button("demolish", "拆除", func() -> void: _confirm_demolition(selected)))
		if bool(selected.get("canUpgrade", false)):
			panel_body.add_child(_button("upgrade", "升级建筑", func() -> void: _emit("upgrade", {"x": selected.get("x"), "y": selected.get("y")})))

func _confirm_demolition(selected: Dictionary) -> void:
	confirmation_open = true
	_clear_body()
	panel_title.text = "拆除建筑"
	panel_body.add_child(_text("确认拆除「%s」？将失去这座建筑及其服务。" % str(selected.get("name", "所选建筑"))))
	var row: HBoxContainer = _row()
	row.add_child(_button("cancel", "保留建筑", func() -> void: _render_panel()))
	row.add_child(_button("demolish", "确认拆除", func() -> void:
		_emit("demolish", {"x": selected.get("x"), "y": selected.get("y")})
		_close_panel()
	))

func _blueprint_panel() -> void:
	var definition: Dictionary = _definition(str(city.get("tool", "")))
	panel_title.text = str(definition.get("name", "营造蓝图"))
	panel_body.add_child(_text(str(definition.get("desc", "选择营造图录中的建筑，再轻触合规地块放置。"))))
	panel_body.add_child(_text("建材  " + _cost_text(definition.get("cost", {}) as Dictionary)))
	panel_body.add_child(_text("占地 %s × %s · 工期 %s" % [definition.get("size", 1), definition.get("size", 1), _duration(float(definition.get("buildTime", 0)))], 13, MUTED))

func _overview_panel() -> void:
	panel_title.text = str(city.get("cityName", "城市总览"))
	var civ_names: Dictionary = {"china": "华夏", "egypt": "尼罗", "greece": "爱琴", "persia": "波斯", "aztec": "雨林"}
	panel_body.add_child(_text(str(civ_names.get(str(city.get("civilization", "china")), "华夏")) + " · " + ("自由营造" if city.get("mode") == "sandbox" else "文明征程"), 13, MUTED))
	for entry: Array in [["定居人口", city.get("pop", 0)], ["金币", city.get("gold", 0)], ["声望", city.get("prestige", 0)], ["已分配劳工", city.get("workersAssigned", 0)], ["所需劳工", city.get("workersNeeded", 0)]]:
		panel_body.add_child(_text(str(entry[0]) + "   " + _number(float(entry[1]))))
	panel_body.add_child(_text("城市依靠道路连接生产、居民与公共服务。查看城志，逐步完善街区。", 12, MUTED))

func _help_panel() -> void:
	for entry: Array in [["连接街区", "建筑必须接入主路，才能获得劳工并运营。住宅需持续满足饮水、食物与公共服务，才会升级。"], ["营造与规划", "点营造选建筑，轻触地块建造；按住道路拖铺。拖动地图不会放下建筑。建筑详情可迁移或拆除。"], ["经营供给", "两座同种商铺隔路相对才提供配送；中央集市无需配对。工坊持续消耗原料，仓储显示实际净变化。"], ["看清城市", "双指或鼠标滚轮缩放。覆盖层检查道路、供水与污染；工业远离住宅，花园缓解污染。"], ["保存与世界", "本地自动保存与三个手动档案独立。世界港口提供账号、云存档、公开参观、排行榜与玩家交易。参观只读。"], ["时间与离线", "文明征程遵循真实工期。离线时城市继续推进；自由营造可在城务中加速。"], ["键盘", "空格 暂停 · B 营造 · I 仓储 · N 昼夜 · H 归城 · Esc 取消 · Ctrl+S 保存"]]:
		panel_body.add_child(_text(str(entry[0]), 15))
		panel_body.add_child(_text(str(entry[1]), 13, MUTED))

func _newcity_panel() -> void:
	setup_compact = css_size.x > 650 and css_size.y < 600
	var intro: VBoxContainer = panel_body
	var form: VBoxContainer = panel_body
	if setup_compact:
		var columns := HBoxContainer.new()
		columns.add_theme_constant_override("separation", 20)
		panel_body.add_child(columns)
		intro = VBoxContainer.new()
		intro.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		intro.add_theme_constant_override("separation", 6)
		columns.add_child(intro)
		form = VBoxContainer.new()
		form.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		form.add_theme_constant_override("separation", 4)
		columns.add_child(form)
	intro.add_child(_text("万城纪", 28))
	intro.add_child(_text("从河岸与阡陌之间，写下你的城市故事。", 13, MUTED))
	var civ_row := GridContainer.new()
	civ_row.columns = 3 if setup_compact else 5
	civ_row.add_theme_constant_override("h_separation", 6)
	civ_row.add_theme_constant_override("v_separation", 6)
	intro.add_child(civ_row)
	for entry: Array in [["china", "华夏\n已开放"], ["egypt", "尼罗\n未开放"], ["greece", "爱琴\n未开放"], ["persia", "波斯\n未开放"], ["aztec", "雨林\n未开放"]]:
		var button: Button = _button("build", str(entry[1]), func() -> void: pass, Vector2(0, 58))
		button.disabled = str(entry[0]) != "china"
		button.icon = null
		button.custom_minimum_size = Vector2(56, 58)
		button.add_theme_font_size_override("font_size", 12)
		civ_row.add_child(button)
	intro.add_child(_text("青瓦、木构与庭院，沿着商路渐次生长。其他地区尚未开放，已有旧城仍可继续载入。", 12, MUTED))
	form.add_child(_label("城市名称", 13))
	city_name_input = LineEdit.new()
	city_name_input.name = "CityNameInput"
	city_name_input.text = "长乐"
	city_name_input.max_length = 24
	city_name_input.custom_minimum_size.y = 44
	form.add_child(city_name_input)
	form.add_child(_label("地图种子 · 留空随机生成", 13))
	seed_input = LineEdit.new()
	seed_input.name = "SeedInput"
	seed_input.placeholder_text = "相同种子生成相同山川"
	seed_input.max_length = 64
	seed_input.custom_minimum_size.y = 44
	form.add_child(seed_input)
	var modes: HBoxContainer = _row(form)
	var group := ButtonGroup.new()
	for entry: Array in [["campaign", "文明征程"], ["sandbox", "自由营造"]]:
		var mode: String = str(entry[0])
		var button: Button = _button("task" if mode == "campaign" else "build", str(entry[1]), func() -> void: setup_mode = mode)
		button.toggle_mode = true
		button.button_group = group
		button.button_pressed = setup_mode == mode
		modes.add_child(button)
	if not setup_compact:
		form.add_child(_text("征程逐章开放城市功能；自由营造提供充足物资，不参与在线交易。", 12, MUTED))
	else:
		intro.add_child(_text("自由营造物资充足，不参与在线交易。", 11, MUTED))
	var found_button: Button = _button("new_city", "落印建城", func() -> void:
		var name_value: String = city_name_input.text.strip_edges()
		if name_value.is_empty():
			show_toast("请写下城市名称。")
			city_name_input.grab_focus()
			return
		if bool(city.get("visiting", false)):
			show_toast("请先返回自己的城市。")
			return
		_emit("new_city", {"cityName": name_value, "seed": seed_input.text.strip_edges(), "mode": setup_mode, "civilization": "china"})
		first_city_required = false
		_close_panel()
	, Vector2(0, 48))
	found_button.add_theme_stylebox_override("normal", _surface_style("red"))
	found_button.add_theme_stylebox_override("hover", _surface_style("red", true))
	found_button.add_theme_stylebox_override("pressed", _surface_style("red", true, true))
	found_button.add_theme_color_override("font_color", PAPER)
	found_button.add_theme_color_override("font_hover_color", Color.WHITE)
	found_button.add_theme_color_override("font_pressed_color", PAPER)
	form.add_child(found_button)

func _reflow_newcity() -> void:
	if active_panel == "newcity":
		var preserved_name: String = city_name_input.text if is_instance_valid(city_name_input) else "长乐"
		var preserved_seed: String = seed_input.text if is_instance_valid(seed_input) else ""
		_render_panel()
		city_name_input.text = preserved_name
		seed_input.text = preserved_seed
	setup_reflow_pending = false

func _settings_panel() -> void:
	var settings: Dictionary = city.get("settings", {}) as Dictionary
	for entry: Array in [["reducedMotion", "减少装饰动画"], ["autosave", "自动保存城市"]]:
		var key: String = str(entry[0])
		var enabled: bool = bool(settings.get(key, key == "autosave"))
		var toggle: Button = _button("checkbox-on" if enabled else "checkbox-off", str(entry[1]) + (" · 开" if enabled else " · 关"), func() -> void: pass)
		toggle.toggle_mode = true
		toggle.button_pressed = enabled
		toggle.toggled.connect(func(value: bool) -> void:
			toggle.icon = _art("actions", "checkbox-on" if value else "checkbox-off")
			toggle.text = str(entry[1]) + (" · 开" if value else " · 关")
			_emit("setting", {"key": key, "value": value})
		)
		panel_body.add_child(toggle)
	panel_body.add_child(_label("画质", 13))
	var quality: HBoxContainer = _row()
	for entry: Array in [["auto", "自动"], ["high", "精细"], ["low", "流畅"]]:
		var value: String = str(entry[0])
		quality.add_child(_button("view", str(entry[1]), func() -> void: _emit("setting", {"key": "quality", "value": value})))
	panel_body.add_child(_button("save", "存档与迁移", func() -> void: show_panel("saves")))
	panel_body.add_child(_button("new_city", "建立另一座城市", func() -> void: _confirm_newcity()))

func _confirm_newcity() -> void:
	_clear_body()
	panel_title.text = "另起新城"
	panel_body.add_child(_text("请先将当前城市存入手动档案或导出。新城会替换当前自动存档。"))
	var row: HBoxContainer = _row()
	row.add_child(_button("save", "查看存档", func() -> void: show_panel("saves")))
	row.add_child(_button("new_city", "继续建立新城", func() -> void: show_panel("newcity")))

func _saves_panel() -> void:
	panel_body.add_child(_text("手动档案与自动存档独立。导出可跨设备留存。", 12, MUTED))
	var slots: Array = city.get("slots", []) as Array
	for slot: int in [1, 2, 3]:
		var data: Dictionary = {}
		if slots.size() >= slot and slots[slot - 1] is Dictionary:
			data = slots[slot - 1] as Dictionary
		var row: HBoxContainer = _row()
		var occupied: bool = bool(data.get("occupied", not data.is_empty()))
		var label: Label = _text("档案 %d · %s" % [slot, data.get("cityName", "未命名") if occupied else "空白"], 13)
		row.add_child(label)
		var save_button: Button = _button("save", "保存", func() -> void:
			if not occupied:
				_emit("save", {"slot": slot})
			else:
				_confirm_slot("save", slot)
		, Vector2(64, 44))
		save_button.name = "SaveSlot%dButton" % slot
		row.add_child(save_button)
		var load_button: Button = _button("load", "读取", func() -> void: _confirm_slot("load", slot), Vector2(64, 44))
		load_button.name = "LoadSlot%dButton" % slot
		load_button.disabled = not occupied
		row.add_child(load_button)
	var exports: HBoxContainer = _row()
	exports.add_child(_button("export", "导出", func() -> void: _emit("export")))
	exports.add_child(_button("import", "导入", func() -> void: _emit("import")))
	panel_body.add_child(_button("backup", "恢复上次切城备份", func() -> void: _emit("backup")))
	panel_body.add_child(_button("new_city", "建立另一座城市", func() -> void: _confirm_newcity()))

func _confirm_slot(command: String, slot: int) -> void:
	confirmation_open = true
	_clear_body()
	panel_title.text = "覆盖档案" if command == "save" else "读取档案"
	panel_body.add_child(_text("确认覆盖档案 %d？原内容将被当前城市替换。" % slot if command == "save" else "确认读取档案 %d？当前城市将切换为此档案。" % slot))
	var row: HBoxContainer = _row()
	row.add_child(_button("cancel", "返回", func() -> void: _render_panel()))
	row.add_child(_button("confirm", "确认", func() -> void: _emit(command, {"slot": slot}); _render_panel()))

func _log_panel() -> void:
	var entries: Array = city.get("log", []) as Array
	for index: int in range(entries.size() - 1, -1, -1):
		var entry: Variant = entries[index]
		panel_body.add_child(_text(str((entry as Dictionary).get("message", (entry as Dictionary).get("msg", (entry as Dictionary).get("text", "")))) if entry is Dictionary else str(entry), 13))
	if entries.is_empty():
		panel_body.add_child(_text("城市的故事，将从这里写起。", 13, MUTED))

func _caravan_panel() -> void:
	panel_body.add_child(_text("商队即时收购与供应。价格受港口和文明加成影响。", 12, MUTED))
	trade_option = OptionButton.new()
	trade_option.name = "TradeResource"
	trade_option.custom_minimum_size.y = 44
	var goods: Dictionary = city.get("goods", {}) as Dictionary
	var index: int = 0
	for key: Variant in goods:
		var id: String = str(key)
		trade_option.add_item(_good_name(id) + " · 库存 " + _number(float(goods[key])))
		trade_option.set_item_metadata(index, id)
		if id == trade_resource:
			trade_option.select(index)
		index += 1
	trade_option.item_selected.connect(func(selected: int) -> void:
		trade_resource = str(trade_option.get_item_metadata(selected))
		_update_trade_quote()
	)
	panel_body.add_child(trade_option)
	var quantity_row: HBoxContainer = _row()
	quantity_row.add_child(_button("zoom_out", "减1", func() -> void: trade_quantity.text = str(maxi(1, _trade_quantity_value() - 1)); _update_trade_quote()))
	trade_quantity = LineEdit.new()
	trade_quantity.name = "TradeQuantityInput"
	trade_quantity.virtual_keyboard_type = LineEdit.KEYBOARD_TYPE_NUMBER
	trade_quantity.text = "10"
	trade_quantity.max_length = 6
	trade_quantity.custom_minimum_size.y = 44
	trade_quantity.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	trade_quantity.text_changed.connect(func(_value: String) -> void: _update_trade_quote())
	quantity_row.add_child(trade_quantity)
	quantity_row.add_child(_button("zoom_in", "加1", func() -> void: trade_quantity.text = str(mini(100000, _trade_quantity_value() + 1)); _update_trade_quote()))
	trade_quote = _text("", 13)
	panel_body.add_child(trade_quote)
	var row: HBoxContainer = _row()
	for direction: String in ["buy", "sell"]:
		row.add_child(_button(direction, "购入" if direction == "buy" else "出售", func() -> void:
			if not trade_quantity.text.is_valid_int() or int(trade_quantity.text) < 1 or int(trade_quantity.text) > 100000:
				show_toast("交易数量请填写 1 至 100000 的整数。")
				return
			_emit("trade", {"resource": trade_resource, "quantity": _trade_quantity_value(), "direction": direction})
		))
	_update_trade_quote()

func _trade_quantity_value() -> int:
	return clampi(int(trade_quantity.text), 1, 100000)

func _update_trade_quote() -> void:
	if trade_quote == null or not is_instance_valid(trade_quote):
		return
	var prices: Dictionary = city.get("tradePrices", {}) as Dictionary
	var price: Dictionary = prices.get(trade_resource, {}) as Dictionary
	var quantity: float = float(_trade_quantity_value())
	trade_quote.text = "购入 %s 金币 · 出售可得 %s 金币" % [_number(float(price.get("buy", 0)) * quantity), _number(float(price.get("sell", 0)) * quantity)]

func _row(target: VBoxContainer = null) -> HBoxContainer:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 6)
	row.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	(target if target != null else panel_body).add_child(row)
	return row

func _definition(type: String) -> Dictionary:
	var catalog: Array = city.get("catalog", []) as Array
	for entry: Variant in catalog:
		if entry is Dictionary and str((entry as Dictionary).get("type", "")) == type:
			return entry as Dictionary
	return {}

func _good_name(id: String) -> String:
	var meta: Dictionary = city.get("goodsMeta", {}) as Dictionary
	var item: Variant = meta.get(id, {})
	if item is Dictionary:
		return str((item as Dictionary).get("name", id))
	return str(item) if item != null else id

func _cost_text(cost: Dictionary) -> String:
	var parts: PackedStringArray = []
	for key: Variant in cost:
		parts.append(_good_name(str(key)) + " " + _number(float(cost[key])))
	return " · ".join(parts) if not parts.is_empty() else "无需建材"

func _number(value: float) -> String:
	if absf(value) >= 10000:
		return "%.1f万" % (value / 10000.0)
	if absf(value - roundf(value)) < 0.05:
		return str(int(roundf(value)))
	return "%.1f" % value

func _duration(seconds: float) -> String:
	var total: int = maxi(0, int(ceilf(seconds)))
	if total >= 86400:
		return "%d天 %d小时" % [total / 86400, (total % 86400) / 3600]
	if total >= 3600:
		return "%d小时 %d分" % [total / 3600, (total % 3600) / 60]
	if total >= 60:
		return "%d分 %d秒" % [total / 60, total % 60]
	return "%d秒" % total

func _emit(command: String, payload: Dictionary = {}) -> void:
	if bool(city.get("visiting", false)) and command in ["select_tool", "demolish", "move", "upgrade", "new_city", "save", "load", "import", "backup", "trade", "pause", "speed"]:
		show_toast("参观中的城市仅可浏览，请先返回自己的城市。")
		return
	action.emit(command, payload)

func show_toast(message: String, kind: String = "") -> void:
	setup()
	toast_label.text = message
	toast_label.add_theme_color_override("font_color", Color("ffcfac") if kind in ["bad", "error"] else PAPER)
	toast_label.show()
	toast_timer.start()
	_layout()
