extends SceneTree

const Labels = preload("res://world/construction_labels.gd")
const HUD = preload("res://ui/hud.gd")
var checks := 0
var failures: Array = []
var labels: CanvasLayer
var hud: CanvasLayer
var camera: Camera2D
var city: Dictionary

func verify(value: bool,message: String) -> void:
	checks+=1
	if not value:
		failures.append(message)

func settle() -> void:
	await process_frame
	await process_frame
	await process_frame

func item(id: String) -> Dictionary:
	for value: Dictionary in labels.diagnostics().labels:
		if value.key==id:
			return value
	return {}

func publish() -> void:
	# Production synchronizes the world before the HUD; labels must use the
	# current HUD layout when their own subsequent scene frame runs.
	labels.sync_city(city)
	hud.sync_state(city)
	await settle()

func isolated_rectangles() -> void:
	var values: Array=labels.diagnostics().labels
	var excluded: Array=labels._hud_exclusions()
	for index in range(values.size()):
		var data: Array=values[index].rect
		var rect:=Rect2(data[0],data[1],data[2],data[3])
		verify(Rect2(Vector2.ZERO,root.size).encloses(rect),"label must remain inside the actual viewport")
		for obstacle: Rect2 in excluded:
			verify(not rect.intersects(obstacle),"label overlaps a visible HUD control")
		for prior in range(index):
			var other: Array=values[prior].rect
			verify(not rect.intersects(Rect2(other[0],other[1],other[2],other[3])),"labels overlap each other")

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	root.content_scale_mode=Window.CONTENT_SCALE_MODE_DISABLED
	root.size=Vector2i(1280,800)
	camera=Camera2D.new()
	root.add_child(camera)
	camera.position=Vector2(0,640)
	camera.make_current()
	hud=HUD.new()
	root.add_child(hud)
	labels=Labels.new()
	root.add_child(labels)
	labels.configure(camera,null,root)
	city={"cityName":"施工标签测试","seed":"labels","speed":1,"settings":{},"hasSave":true,"selection":{},"buildings":[
		{"id":1,"type":"house","x":10,"y":10,"size":1,"construction":{"total":1800,"remaining":754}},
		{"id":2,"type":"villa","x":12,"y":10,"size":2,"construction":{"total":7200,"remaining":4800,"fromLevel":2,"toLevel":3}},
		{"id":3,"type":"garden","x":8,"y":10,"size":1,"construction":{"total":120,"remaining":59}}
	],"constructionSites":[
		{"buildingId":1,"active":true,"paused":false,"finished":false},
		{"buildingId":2,"active":true,"paused":false,"finished":false},
		{"buildingId":3,"active":true,"paused":false,"finished":false,"roadAccess":null}
	]}
	for pair: Array in [[.1,"1秒"],[59,"59秒"],[60,"1分00秒"],[3599,"59分59秒"],[3600,"1时00分"],[3601,"1时01分"],[129600,"36时00分"]]:
		verify(Labels.format_remaining(pair[0])==pair[1],"authoritative time formatting "+str(pair))
	await publish()
	verify(labels.layer<hud.layer,"map labels must remain below the native HUD")
	verify(labels.diagnostics().sites==3,"all unfinished buildings appear without selection")
	verify(item("1").get("text")=="建造 12分34秒","new building shows actual remaining seconds")
	verify(item("2").get("text")=="升级 1时20分","upgrade uses its own construction clock")
	verify(item("3").get("state")=="active","road-free decoration must not be called disconnected")
	verify(labels.diagnostics().last_drawn>=3,"real CanvasItem draw must render the unselected labels")
	verify(labels._canvas.panel_style is StyleBoxTexture,"labels reuse the actual painted HUD card")
	verify(labels._canvas.panel_style.texture.resource_path=="res://art/ui/card.png","labels must not substitute a second HUD style")
	verify(labels._canvas.label_font!=null,"labels load a real font")
	isolated_rectangles()
	var before:=item("1").duplicate()
	var layouts: int=labels.diagnostics().layout_count
	await settle()
	verify(item("1").remaining==754,"native frames must not invent countdown progress")
	verify(labels.diagnostics().layout_count==layouts,"idle frames must not rebuild label layouts")
	camera.position.x+=80
	camera.force_update_scroll()
	await settle()
	verify(absf(float(item("1").anchor[0])-float(before.anchor[0])+80)<.01,"label follows real camera pan in the next frame")
	camera.position.x-=80
	camera.force_update_scroll()
	await settle()
	city.settings.reducedMotion=true
	city.buildings[0].construction.remaining=753
	await publish()
	verify(item("1").get("text")=="建造 12分33秒" and item("1").state=="active","reduced motion cannot pause real engineering")
	city.speed=0
	city.constructionSites[0].paused=true
	await publish()
	verify(item("1").state=="paused" and "暂停" in item("1").text,"paused construction is explicit")
	verify(item("1").remaining==753,"pause retains the authoritative remaining time")
	city.speed=1
	city.constructionSites[0].paused=false
	city.constructionSites[0].active=false
	city.constructionSites[0].blockedReason="道路未连接主路"
	await publish()
	verify(item("1").state=="road" and "断路" in item("1").text,"disconnected construction is explicit")
	city.constructionSites[0].active=true
	city.constructionSites[0].blockedReason=""
	await publish()
	verify(item("1").state=="active","repairing the real road restores the label state")
	city.visiting=true
	await publish()
	verify(item("1").state=="paused","visits show suspended engineering")
	city.visiting=false
	city.onlineOpen=true
	await publish()
	verify(labels.diagnostics().labels.is_empty(),"online modal must not expose labels over its controls")
	city.onlineOpen=false
	await publish()
	hud.show_panel("inventory")
	hud.show_toast("施工提示", "good")
	await settle()
	isolated_rectangles()
	hud.active_panel="newcity"
	hud._layout()
	await settle()
	verify(labels.diagnostics().labels.is_empty(),"new-city modal hides all map labels")
	hud.active_panel=""
	hud.panel.hide()
	hud._layout()
	hud.toast_label.hide()
	await settle()
	city.buildings[0].erase("construction")
	city.constructionSites[0].finished=true
	city.constructionSites[0].exitElapsed=0
	await publish()
	verify(item("1").is_empty() and labels.diagnostics().sites==2,"completion removes the label while crew departure remains")
	city.buildings.remove_at(2)
	await publish()
	verify(item("3").is_empty(),"demolition removes the label")
	var old_anchor: Array=item("2").anchor
	city.buildings[1].x+=1
	await publish()
	verify(item("2").anchor!=old_anchor,"relocation updates the same project anchor")
	var width: float=item("2").rect[2]
	labels.set_css_scale(2)
	root.size=Vector2i(2560,1600)
	camera.zoom=Vector2.ONE*2
	camera.force_update_scroll()
	await settle()
	verify(not item("2").is_empty(),"DPR changes retain the visible project")
	if not item("2").is_empty():
		verify(is_equal_approx(float(item("2").rect[2]),width),"DPR changes preserve the CSS text size")
	verify(labels._canvas.scale==Vector2.ONE*2,"DPR scales the native canvas exactly once")
	labels.set_css_scale(1)
	root.size=Vector2i(1280,800)
	camera.zoom=Vector2.ONE*.4
	camera.position=Vector2(0,640)
	camera.force_update_scroll()
	city.buildings=[]
	city.constructionSites=[]
	for y in range(5,15):
		for x in range(5,15):
			var id:=x+y*100
			city.buildings.append({"id":id,"type":"house","x":x,"y":y,"size":1,"construction":{"total":3600,"remaining":600+id}})
			city.constructionSites.append({"buildingId":id,"active":id%3==0,"paused":id%3==1,"blockedReason":"道路未连接主路" if id%3==2 else ""})
	await publish()
	var dense: Dictionary=labels.diagnostics()
	verify(dense.far and dense.labels.size()<=6,"far view aggregates with a hard six-label cap")
	var represented:=int(dense.omitted_sites)
	for value: Dictionary in dense.labels:
		represented+=int(value.count)
		if value.count>1:
			verify("最短" in value.text,"group ETA must say it is the shortest remaining project")
		if value.state in ["paused","road"]:
			verify("暂停" in value.text or "断路" in value.text,"aggregation must not conceal blocked work")
	verify(represented==dense.visible_sites,"far-view aggregation conserves all visible project counts")
	isolated_rectangles()
	camera.zoom=Vector2.ONE*.55
	camera.force_update_scroll()
	await settle()
	verify(labels.diagnostics().far,"zoom hysteresis prevents label regrouping around the threshold")
	camera.zoom=Vector2.ONE*.65
	camera.force_update_scroll()
	await settle()
	verify(not labels.diagnostics().far and labels.diagnostics().labels.size()<=Labels.MAX_LABELS,"near view restores bounded individual labels")
	isolated_rectangles()
	city={"cityName":"另一座城","seed":"new","buildings":[],"constructionSites":[]}
	labels.sync_city(city)
	verify(labels._canvas.items.is_empty(),"city replacement clears old labels immediately")
	await settle()
	verify(labels.diagnostics().sites==0 and labels.diagnostics().last_drawn==0,"empty or offline-completed city has no ghost labels")
	print("CONSTRUCTION_LABELS "+JSON.stringify({"checks":checks,"failures":failures,"passive":labels.diagnostics().passive}))
	quit(0 if failures.is_empty() else 1)
