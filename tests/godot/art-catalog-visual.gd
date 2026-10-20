extends SceneTree
## Review captures use the real component renderer, not composited mockups.
## These deliberately arranged examples never enter a player's saved city.
var renderers: Array[Node2D] = []
var output_dir := ""
var font: Font

func _initialize() -> void:
	call_deferred("_run")

func caption(value: String, at: Vector2, size: Vector2) -> void:
	var label := Label.new()
	label.text = value
	label.position = at
	label.size = size
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	label.add_theme_color_override("font_color", Color("#eee7d6"))
	label.add_theme_font_size_override("font_size", 18)
	if font: label.add_theme_font_override("font", font)
	root.add_child(label)

func capture(name: String) -> void:
	for frame in range(5): await process_frame
	await RenderingServer.frame_post_draw
	var error := root.get_texture().get_image().save_png(output_dir.path_join(name + ".png"))
	if error != OK: push_error("Could not save " + name)

func _run() -> void:
	var args := OS.get_cmdline_user_args()
	output_dir = args[0] if not args.is_empty() else ProjectSettings.globalize_path("res://../work/art-v4/visual")
	DirAccess.make_dir_recursive_absolute(output_dir)
	root.size = Vector2i(1440, 1440)
	root.content_scale_size = root.size
	RenderingServer.set_default_clear_color(Color("#293c37"))
	font = load("res://art/fonts/chinese.otf")
	var production: Script = load("res://world/buildings.gd")
	var factory: Node2D = production.new()
	var cases := [
		["house",1,"民居一级"],["house",4,"民居四级"],["house",7,"民居七级"],["house",10,"民居十级"],
		["villa",3,"宅邸三级"],["villa",6,"宅邸六级"],["well",1,"水井"],["watch",1,"望楼"],
		["temple",1,"祠庙"],["garden",1,"园林"],["pagoda",1,"宝塔"],["wonder",1,"宫苑"],
		["grainShop",1,"粮铺"],["fishShop",1,"鱼肆"],["market",1,"集市"],["granary",1,"粮仓"],
		["kiln",1,"砖窑"],["weaver",1,"织坊"],["lumber",1,"伐木场"],["orchard",1,"果园"]
	]
	var seen: Dictionary = {}
	for item: Array in cases: seen[str(item[0])+":"+str(item[1])] = true
	var names := {"police":"衙署","clinic":"医馆","repair":"修缮坊","school":"学塾","theater":"戏台","vegShop":"菜铺","fruitShop":"果铺","meatShop":"肉铺","farmland":"稻田","vegFarm":"菜圃","fishing":"渔场","pasture":"牧场","quarry":"采石场","clayPit":"黏土场","pottery":"陶坊","mill":"磨坊","winery":"酒坊","warehouse":"货栈","treeDeco":"庭树","monument":"碑亭","barracks":"营房","university":"书院","bath":"浴坊","observatory":"观象台","harbor":"港口","copperMine":"铜矿"}
	var recipes: Script = load("res://world/building_parts.gd")
	for type: String in recipes.SIZES:
		var max_level: int = recipes.MAX_LEVELS.get(type,1)
		for level in range(1,max_level+1):
			if seen.has(type+":"+str(level)): continue
			cases.append([type,level,("民居"+str(level)+"级") if type=="house" else (("宅邸"+str(level)+"级") if type=="villa" else names.get(type,type))])
	var evidence: Array = []
	for page in range(ceili(cases.size()/20.)):
		for index in range(mini(20,cases.size()-page*20)):
			var item: Array = cases[page*20+index]
			var preview: Node2D = factory.create_preview(item[0], item[1])
			var bounds: Rect2 = preview.get_meta("preview_bounds")
			var cell := Rect2((index%4)*360, (index/4)*288, 360, 288)
			var scale_factor := minf(1.75, minf(320./bounds.size.x, 238./bounds.size.y))
			preview.scale = Vector2.ONE * scale_factor
			preview.position = cell.position + Vector2(180, 128) - bounds.get_center()*scale_factor
			root.add_child(preview)
			renderers.append(preview)
			caption(item[2],cell.position+Vector2(0,254),Vector2(360,30))
			evidence.append({"type":item[0],"level":item[1],"page":page,"scale":scale_factor,"bounds":[bounds.position.x,bounds.position.y,bounds.size.x,bounds.size.y],"parts":preview.get_child_count()})
		var suffix := "" if page==0 else "-"+str(page+1)
		await capture("catalog-day"+suffix)
		for renderer in renderers: renderer.set_night(1.0)
		await capture("catalog-night"+suffix)
		for renderer in renderers: renderer.queue_free()
		renderers.clear()
		for child in root.get_children():
			if child is Label: child.queue_free()
		await process_frame
	root.size = Vector2i(1440, 800)
	root.content_scale_size = root.size
	var types := ["house","pagoda"]
	var levels := [7,1]
	for row in range(2):
		var reference: Node2D = factory.create_preview(types[row],levels[row])
		var bounds: Rect2 = reference.get_meta("preview_bounds")
		var factor := minf(1.6,minf(218./bounds.size.x,330./bounds.size.y))
		reference.free()
		for col in range(6):
			var progress: float = [.10,.28,.52,.68,.88,1.0][col]
			var renderer: Node2D = production.new()
			renderer.sync_buildings([{"id":1,"type":types[row],"x":0,"y":0,"lvl":levels[row],"staffed":true,"construction":{"total":3600,"remaining":3600*(1.-progress)}}],{})
			renderer.scale = Vector2.ONE*factor
			renderer.position = Vector2(col*240+120,row*400+178)-bounds.get_center()*factor
			root.add_child(renderer)
			renderers.append(renderer)
			caption(str(int(progress*100))+"%",Vector2(col*240,row*400+364),Vector2(240,30))
	await capture("construction")
	var file := FileAccess.open(output_dir.path_join("catalog.json"),FileAccess.WRITE)
	file.store_string(JSON.stringify({"fixture":true,"visual_acceptance":false,"catalog":evidence},"  "))
	factory.free()
	print("ART_CATALOG_CAPTURED " + output_dir)
	quit()
