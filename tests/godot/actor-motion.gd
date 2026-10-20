extends SceneTree
## Logic-only regression. V4 art uses newly painted articulated parts. This
## test does not certify silhouettes, opposing limb poses, or a visual walk cycle.
const Motion = preload("res://world/actor_animation.gd")
const Citizens = preload("res://world/citizens.gd")
const Workers = preload("res://world/construction_workers.gd")
var checks := 0
var failures: Array = []

class TargetFixture extends Node2D:
	var valid := true
	var current_action := "remove:roof"
	func construction_targets(_building_id: Variant,_phase: int=-1,_limit: int=64) -> Array:
		return [{"action_id":current_action,"leaf_id":"roof-1","asset":"beam_wood","operation":"remove" if current_action=="remove:roof" else "install","work_ground":[2.5,2.5],"ground":[2.5,2.5],"worker_elevation":0.0,"sort_y":160.0}]
	func construction_target_valid(_building_id: Variant,action_id: String) -> bool:
		return valid and action_id==current_action

func check(ok: bool,label: String) -> void:
	checks+=1
	if not ok:failures.append(label)

func _initialize() -> void:call_deferred("run")

func courier_city() -> Dictionary:
	return {"seedHash":1,"civilization":"china","cityName":"ActorMotion","speed":1,"clock":{"elapsedSeconds":0},"settings":{"reducedMotion":true},"logistics":{"jobs":[{"id":"grain-1","kind":"delivery","cargo":{"grain":20},"vehicle":"horse","phase":"travel","leg":"outbound","moving":true,"isLoaded":true,"route":[[1,1],[2,1],[3,1]],"segment":0,"segmentProgress":0.0,"edgeSeconds":3.0,"position":[1,1]}]}}

func worker_city(phase: String="installing",cycle: int=0) -> Dictionary:
	return {"seedHash":1,"civilization":"china","cityName":"ActorMotion","speed":1,"clock":{"elapsedSeconds":0},"settings":{"reducedMotion":true},"constructionSites":[{"id":"site-1","buildingId":1,"type":"house","origin":[2,2],"size":1,"entry":[2,3],"materialPoint":[2,3.5],"layoutKey":"south","active":true,"finished":false,"workers":[{"id":"crew-1","index":0,"phase":phase,"phaseProgress":0.0,"cycleIndex":cycle,"targetIndex":0,"active":true,"carriedMaterial":"timber"}]}]}

func run() -> void:
	var with_art := "--with-art" in OS.get_cmdline_user_args()
	check(not Motion.simulation_paused({"speed":1,"settings":{"reducedMotion":true}}),"reduced-motion preference must not pause the simulation")
	check(Motion.simulation_paused({"speed":0}),"actual pause stops actors")
	check(Motion.simulation_paused({"speed":1,"onlineOpen":true}),"online transaction pauses actors")
	check(Motion.simulation_paused({"speed":1,"visiting":true}),"read-only visit does not animate economic jobs")
	var sequences := {"walk/3":{"frames":["contact-left","pass-left","contact-right","pass-right"],"cycles_per_tile":1.0,"fps":4.0}}
	for index in range(4):
		check(Motion.sample(sequences,"walk",3,float(index)/4.0,0.0,true).index==index,"walking frame follows travelled distance "+str(index))
		check(Motion.sample(sequences,"walk",3,0.0,float(index)/4.0,false).index==index,"stationary work frame follows action time "+str(index))
	check(Motion.sample(sequences,"missing",3,0,0,true).key=="","missing new action does not silently sample unrelated art")
	check(Motion.facing_from_motion(Vector2(1,0))==3 and Motion.facing_from_motion(Vector2(0,-1))==1,"road-facing atlas convention is stable")
	check(Motion.facing_from_motion(Vector2(1,-1),8)==5 and Motion.facing_from_motion(Vector2(-1,-1),8)==4,"optional eight-view atlas uses cardinal views for diagonal world motion")
	check(Motion.direction_count({"directions":["NW","NE","SW","SE"]})==4,"legacy direction-name array remains readable")
	check(Motion.direction_count({"directions":8})==8,"numeric eight-direction metadata is supported")

	var citizens: Node2D = Citizens.new(with_art)
	root.add_child(citizens)
	if with_art:
		check(citizens._atlas!=null,"new citizen shared atlas loads")
		check(citizens._animations.size()==28,"all citizen and horse directional sequences load")
	var roads: Array = [{"type":"road","x":1,"y":1},{"type":"road","x":2,"y":1},{"type":"road","x":3,"y":1}]
	citizens.sync_city(roads,courier_city())
	var actor: Variant = citizens._actors["grain-1"]
	citizens.animate(.5)
	check(actor.distance_walked>.15,"half-second low-FPS update advances half a second, not a tenth")
	check(actor.reduced_motion and actor.distance_walked>0,"reduced decorative motion keeps real transport moving")
	check(actor.wheel_angle>0,"travel advances wheel rotation")
	var stationary: Vector2 = actor.world_point
	var wheel_angle: float = actor.wheel_angle
	citizens.set_paused(true)
	citizens.animate(.5)
	check(actor.world_point==stationary and actor.wheel_angle==wheel_angle,"pause preserves feet and wheel angles")
	citizens.set_paused(false)
	citizens.sync_city([roads[0]],courier_city())
	stationary=actor.world_point
	citizens.animate(.5)
	check(actor.world_point==stationary,"a deleted road is never extrapolated through")
	citizens.queue_free()

	var targets := TargetFixture.new()
	root.add_child(targets)
	var workers: Node2D = Workers.new(with_art)
	root.add_child(workers)
	if with_art:
		check(workers._atlas!=null,"new worker shared atlas loads")
		check(workers._animations.size()==24,"all six construction operations have four views")
	workers.sync_city(worker_city(),targets)
	var worker: Variant = workers._actors["crew-1"]
	check(worker.operation=="remove" and not worker.loaded,"dismantling begins empty-handed at the actual old leaf")
	workers.animate(.5)
	check(worker.clock>=.49,"stationary tool action receives real low-FPS elapsed time")
	check(worker.action=="hammer","installation/dismantling selects a real work sequence")
	var worker_point: Vector3 = worker.point
	targets.valid=false
	workers.sync_city(worker_city(),targets)
	check(worker.retargeting and worker.phase=="returning","completed leaf stops tool work and starts a return")
	check(worker.point==worker_point,"retarget does not teleport the worker")
	check(worker.loaded,"dismantling return carries reclaimed material")
	for index in range(22):workers.animate(.5)
	check(worker.arrived,"invalid-target return reaches the material point continuously")
	var returned: Vector3 = worker.point
	targets.valid=true
	targets.current_action="install:new-beam"
	workers.sync_city(worker_city("carrying",1),targets)
	check(not worker.retargeting and worker.operation=="install","next authoritative cycle acquires a new valid install action")
	check(worker.point==returned,"new action starts from the returned physical point")
	check(worker.loaded,"new install outbound journey carries new material")
	workers.animate(.5)
	check(worker.point!=returned,"next job resumes movement")
	workers.set_paused(true)
	var frozen := JSON.stringify(workers.diagnostics().actors)
	workers.animate(.5)
	check(JSON.stringify(workers.diagnostics().actors)==frozen,"pause freezes worker pose and action state")
	workers.queue_free()
	targets.queue_free()
	print("ACTOR_MOTION ",JSON.stringify({"checks":checks,"failures":failures,"visualAcceptance":false,"art":"original articulated V4 shared atlases" if with_art else "disabled; logic only, no art imports"}))
	quit(0 if failures.is_empty() else 1)
