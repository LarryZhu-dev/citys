extends SceneTree
## Native integration fixture using the production world, HUD and building art.
## Deliberate test construction snapshots are never written to a player's save.
var world: Node2D
var hud: CanvasLayer
var city: Dictionary
var evidence: Dictionary={}
var output_dir: String

func _initialize() -> void:
	call_deferred("_run")

func _capture(name: String) -> void:
	for frame in range(4):
		await process_frame
	await RenderingServer.frame_post_draw
	evidence[name]=world.construction_labels.diagnostics()
	evidence[name]["hud"]=hud.diagnostics()
	var path:=output_dir.path_join(name+".png")
	var error:=root.get_texture().get_image().save_png(path)
	if error!=OK:
		push_error("Could not save "+path)

func _run() -> void:
	var args:=OS.get_cmdline_user_args()
	output_dir=args[0] if not args.is_empty() else ProjectSettings.globalize_path("res://../work/construction-labels")
	DirAccess.make_dir_recursive_absolute(output_dir)
	root.size=Vector2i(1280,800)
	root.content_scale_size=root.size
	world=load("res://world/world.gd").new()
	root.add_child(world)
	hud=load("res://ui/hud.gd").new()
	root.add_child(hud)
	var tiles: Array=[]
	for y in range(24):
		var row: Array=[]
		for x in range(24):
			row.append({"t":"grass"})
		tiles.append(row)
	var construction:= [
		{"id":1,"type":"house","x":10,"y":10,"size":1,"lvl":3,"pop":6,"staffed":true,"construction":{"total":1800,"remaining":754}},
		{"id":2,"type":"villa","x":12,"y":10,"size":2,"lvl":2,"pop":4,"staffed":true,"construction":{"total":7200,"remaining":4800,"fromLevel":2,"toLevel":3}},
		{"id":3,"type":"house","x":8,"y":10,"size":1,"lvl":3,"pop":0,"staffed":true,"construction":{"total":1800,"remaining":351}}
	]
	var sites: Array=[]
	for b: Dictionary in construction:
		sites.append({"id":"proof:"+str(b.id),"buildingId":b.id,"type":b.type,"origin":[b.x,b.y],"size":b.size,"total":b.construction.total,"elapsed":b.construction.total-b.construction.remaining,"progress":1.0-float(b.construction.remaining)/b.construction.total,"workerCount":0,"workers":[],"entry":[b.x,b.y+1],"materialPoint":[b.x,b.y+1],"active":b.id!=3,"paused":false,"finished":false,"blockedReason":"道路未连接主路" if b.id==3 else ""})
	var buildings: Array=construction.duplicate(true)
	for x in range(9,16):
		buildings.append({"id":100+x,"type":"road","x":x,"y":12,"size":1})
	buildings.append({"id":20,"type":"well","x":9,"y":13,"size":1,"lvl":1,"staffed":true})
	city={"cityName":"施工时间功能验收","civilization":"china","seedHash":42,"seed":"labels-native","start":{"x":11,"y":11},"mapW":24,"mapH":24,"speed":1,"hasSave":true,"settings":{"quality":"low","reducedMotion":true},"selection":{},"gold":350,"pop":10,"goods":{"grain":80},"tasks":[],"tiles":tiles,"buildings":buildings,"constructionSites":sites,"logistics":{}}
	world.sync_state(city,true)
	hud.sync_state(city)
	world.camera.position=world.iso(11.1,11.1)-Vector2(0,30)
	world.camera.zoom=Vector2.ONE*1.35
	world.camera.force_update_scroll()
	await _capture("desktop")
	root.size=Vector2i(390,844)
	root.content_scale_size=root.size
	world.camera.position=world.iso(11.1,11.1)-Vector2(0,30)
	world.camera.zoom=Vector2.ONE*.75
	world.camera.force_update_scroll()
	hud._layout()
	await _capture("mobile")
	root.size=Vector2i(1280,800)
	root.content_scale_size=root.size
	world.camera.zoom=Vector2.ONE*.4
	world.camera.force_update_scroll()
	hud._layout()
	await _capture("far")
	var file:=FileAccess.open(output_dir.path_join("native.json"),FileAccess.WRITE)
	file.store_string(JSON.stringify(evidence,"  "))
	print("CONSTRUCTION_LABELS_NATIVE "+JSON.stringify({"images":evidence.keys(),"desktop":evidence.desktop.labels.size(),"mobile":evidence.mobile.labels.size(),"far":evidence.far.labels.size()}))
	quit()
