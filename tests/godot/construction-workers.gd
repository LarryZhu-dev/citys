extends SceneTree
var checks := 0
var failures: Array = []
var worlds: Array = []
func check(ok: bool,label: String) -> void:
	checks+=1
	if not ok:failures.append(label)
func _initialize() -> void:call_deferred("run")
func site_at(elapsed: float,active: bool=true,level: int=3) -> Dictionary:
	var site: Dictionary = {"id":"construction:77:0:"+str(level)+":360","buildingId":77,"type":"house","origin":[4,4],"size":1,"elapsed":elapsed,"total":360,"entry":[4,5],"materialPoint":[4,5.5],"layoutKey":"south","workerCount":2,"active":active,"finished":false,"installationPoints":[[4.3,4.4],[4.7,4.7]],"workers":[]}
	for index in range(2):
		var local: float = maxf(0,elapsed-index*3)
		var time := fmod(local,36)
		var phase := "loading" if time<4 else "carrying" if time<14 else "installing" if time<26 else "returning"
		var duration := 4.0 if phase=="loading" else 12.0 if phase=="installing" else 10.0
		var offset := 0.0 if phase=="loading" else 4.0 if phase=="carrying" else 14.0 if phase=="installing" else 26.0
		site.workers.append({"id":site.id+":worker:"+str(index),"index":index,"phase":phase,"phaseProgress":(time-offset)/duration,"cycleIndex":floori(local/36),"targetIndex":floori(local/36)*2+index,"carriedMaterial":"timber","active":active and elapsed>=index*3})
	return site
func city_at(site: Dictionary,time: float=1) -> Dictionary:
	return {"seedHash":42,"civilization":"china","cityName":"WorkerTest","speed":1,"clock":{"elapsedSeconds":time},"constructionSites":[site]}
func run() -> void:
	var B: Script = load("res://world/buildings.gd")
	var W: Script = load("res://world/construction_workers.gd")
	var layer := Node2D.new();layer.y_sort_enabled=true;root.add_child(layer)
	var buildings: Node2D = B.new();layer.add_child(buildings)
	var workers: Node2D = W.new();layer.add_child(workers)
	buildings.sync_buildings([{"id":77,"x":4,"y":4,"type":"house","lvl":3,"construction":{"total":360,"remaining":280}}],{})
	workers.sync_city(city_at(site_at(8)),buildings)
	var data: Dictionary = workers.diagnostics()
	check(data.workers==2,"L3 uses authoritative two-person crew")
	check(data.lamps==1,"one temporary construction lantern per observed site")
	workers.set_night(1)
	check(workers.diagnostics().litLamps==1,"night construction enables the anchored lantern glow and ground pool")
	var lamp: Dictionary = workers._lamps.values()[0]
	check(lamp.art.get_child_count()==3,"lantern uses separate new post, beam and lantern image components")
	check(lamp.halo.material==lamp.pool.material,"all construction illumination shares one additive material")
	var emission: Array = workers._components.lantern.get("emission_rect",[0,0,1,1])
	var expected_bulb := Vector2(1,-35)+Vector2(float(emission[0])+float(emission[2])*.5,float(emission[1])+float(emission[3])*.5)*Vector2(12,16)
	check(lamp.halo.position.distance_to(expected_bulb)<.001,"halo is registered to the painted lantern emission area")
	check(workers._actors.values()[0].sprite.modulate.r>workers._tint().r,"nearby crew receives local warm lantern illumination")
	workers.set_night(0)
	check(data.atlasReady and data.atlasFrames>=56,"new generated atlas loads four gait frames per action/direction and hammer frames")
	var atlas_image: Image = workers._atlas.get_image() if workers._atlas else null
	for action: String in ["walk","timber","brick"]:
		for direction in range(4):
			var hashes: Dictionary = {}
			for gait in range(4):
				var key: String = "%s/%d/%d"%[action,direction,gait]
				check(workers._sprites.has(key),"real gait frame "+key)
				if not workers._sprites.has(key) or atlas_image==null:continue
				var rect: Array = workers._sprites[key].rect
				var crop := atlas_image.get_region(Rect2i(rect[0],rect[1],rect[2],rect[3]))
				var hash := HashingContext.new();hash.start(HashingContext.HASH_SHA256);hash.update(crop.get_data())
				hashes[hash.finish().hex_encode()]=true
			check(hashes.size()==4,"four distinct painted gait images for %s/%d"%[action,direction])
	check(data.actors.all(func(a: Dictionary):return not str(a.leaf).is_empty()),"all L3 targets are actual architectural leaves")
	var original: Array = data.actors[0].position
	for i in range(10):workers.animate(.1)
	check(workers.diagnostics().actors[0].position!=original,"carrying crew moves toward real L3 installation leaf")
	workers.set_paused(true)
	var frozen: String = JSON.stringify(workers.diagnostics().actors)
	for i in range(30):workers.animate(.1)
	check(JSON.stringify(workers.diagnostics().actors)==frozen,"pause freezes position, pose and distance")
	var lamp_clock: float = lamp.clock
	for i in range(10):workers.animate(.1)
	check(float(lamp.clock)==lamp_clock,"pause freezes the explicit temporary-light flicker clock")
	workers.set_paused(false)
	workers.sync_city(city_at(site_at(8,false),2),buildings)
	frozen=JSON.stringify(workers.diagnostics().actors)
	for i in range(30):workers.animate(.1)
	check(JSON.stringify(workers.diagnostics().actors)==frozen,"road disconnection freezes worker movement and hammer clock")
	workers.sync_city(city_at(site_at(8,true),3),buildings)
	for i in range(10):workers.animate(.1)
	check(JSON.stringify(workers.diagnostics().actors)!=frozen,"reconnection resumes existing actors")
	var actor: Variant = workers._actors.values()[0]
	var before: Vector3 = actor.point
	var rerouted := site_at(9);rerouted.layoutKey="east";rerouted.entry=[5,4];rerouted.materialPoint=[5.5,4]
	workers.sync_city(city_at(rerouted,4),buildings)
	check(actor.point==before,"changed roadside layout preserves current physical position")
	# Walk an actual upper-floor target from the ground. The renderer must travel
	# every intermediate elevation and retain ground-based sorting throughout.
	buildings.sync_buildings([{"id":77,"x":4,"y":4,"type":"house","lvl":10,"construction":{"total":360,"remaining":170}}],{})
	var high := site_at(4,true,10)
	workers.sync_city(city_at(high,5),buildings)
	# Default targets now expose only the currently active installation. This
	# route/climb fixture deliberately asks the explicit future phase catalogue
	# for an upper-floor stand point; it is not the production target selector.
	var upper_targets: Array = []
	for phase in range(6):
		upper_targets.append_array(buildings.construction_targets(77,phase,64))
	var elevated: Array = upper_targets.filter(func(t: Dictionary):return float(t.worker_elevation)>.08)
	check(not elevated.is_empty(),"L10 backend exposes real upper-floor stand elevations")
	if not elevated.is_empty():
		actor=workers._actors.values()[0]
		actor.target=elevated[0]
		actor.ladder=workers._ensure_scaffold(high,float(actor.target.worker_elevation))
		actor.point=Vector3(4.5,6,0)
		workers._begin_phase(actor,high,high.workers[0],false)
		var has_vertical := false
		for i in range(1,actor.route.size()):
			if actor.route[i].z>actor.route[i-1].z+.05 and Vector2(actor.route[i].x,actor.route[i].y).distance_to(Vector2(actor.route[i-1].x,actor.route[i-1].y))<.001:has_vertical=true
		check(has_vertical,"upper-floor route contains vertical climb along visible ladder")
		check(workers.diagnostics().scaffolds>0,"upper floor has newly painted rails/rungs/landing")
		actor.authority_progress=1
		var intermediate := false
		for i in range(150):
			workers.animate(.1)
			if actor.point.z>.02 and actor.point.z<float(actor.target.worker_elevation)-.02:intermediate=true
			var projected_foot: float = actor.position.y+actor.sprite.position.y+actor.pivot.y*actor.sprite_scale+actor.point.z*64.0
			check(absf(projected_foot-(actor.point.x+actor.point.y)*32)<.4,"worker sort compensation preserves physical projected footpoint, allowing only subpixel gait bob")
		check(intermediate,"worker visibly crosses intermediate heights without teleporting")
		var leave := high.duplicate(true)
		leave.finished=true
		for j: Dictionary in leave.workers:j.phase="leaving";j.phaseProgress=0.0
		before=actor.point
		workers.sync_city(city_at(leave,6),buildings)
		check(actor.point==before,"completion departure begins at rendered upper-floor position")
		check(actor.route.any(func(p: Vector3):return p.z<.01),"departure route descends before leaving")
		actor.authority_progress=1
		for i in range(130):workers.animate(.1)
		check(actor.point.distance_to(Vector3(4.5,6,0))<.01,"completed crew reaches material point on the ground before removal")
	var restored: Node2D = W.new();layer.add_child(restored)
	restored.sync_city(city_at(site_at(32,true,10),6),buildings)
	check(restored.diagnostics().actors.all(func(a: Dictionary):return float(a.position[0])>=4.0 and float(a.position[1])>=4.0),"restoring a returning crew starts on its real worksite route, never at world origin")
	restored.queue_free()
	# Stable actor identity across snapshots, city replacement clears all previous actors.
	var ids: Array = workers._actors.values().map(func(a: Node):return a.get_instance_id())
	workers.sync_city(city_at(high,7),buildings)
	check(ids==workers._actors.values().map(func(a: Node):return a.get_instance_id()),"same worker ids reuse persistent nodes")
	check(workers.diagnostics().lamps==1,"repeated snapshots reuse one temporary lantern node per site")
	var switched := city_at(high,8);switched.cityName="OtherCity";switched.constructionSites=[]
	workers.sync_city(switched,buildings)
	check(workers.diagnostics().workers==0 and workers.diagnostics().scaffolds==0 and workers.diagnostics().lamps==0,"city switch clears crew, scaffolds and temporary lamps")
	# One smoke fixture for each supported type verifies the universal integration.
	var R: Script=load("res://world/building_parts.gd")
	for type: String in R.SIZES:
		buildings.sync_buildings([{"id":77,"x":4,"y":4,"type":type,"lvl":1,"construction":{"total":360,"remaining":250}}],{})
		var all_site := site_at(17);all_site.type=type;all_site.size=R.SIZES[type]
		all_site.id="type-test:"+type
		for job: Dictionary in all_site.workers:job.id=all_site.id+":"+str(job.index)
		workers.sync_city(city_at(all_site,9),buildings)
		check(workers.diagnostics().workers==2,"universal crew "+type)
		check(workers.diagnostics().actors.all(func(a: Dictionary):return not str(a.leaf).is_empty()),"actual leaf target "+type)
		var allowed_leaves: Array = buildings.construction_targets(77,-1,64).map(func(t: Dictionary):return str(t.leaf_id))
		if allowed_leaves.is_empty():
			for phase in range(6):
				allowed_leaves=buildings.construction_targets(77,phase,64).map(func(t: Dictionary):return str(t.leaf_id))
				if not allowed_leaves.is_empty():break
		check(workers.diagnostics().actors.all(func(a: Dictionary):return allowed_leaves.has(str(a.leaf))),"targets belong to current recipe "+type)
	check(workers.diagnostics().lamps==1,"successive project replacements leave no accumulated temporary lanterns")
	check(workers.diagnostics().workPlatforms<=workers.diagnostics().workers,"temporary installation platforms are bounded by the active crew size")
	var report := {"checks":checks,"failures":failures,"supportedTypes":R.SIZES.size(),"atlasFrames":workers._sprites.size()}
	print("CONSTRUCTION_WORKERS ",JSON.stringify(report))
	quit(0 if failures.is_empty() else 1)
