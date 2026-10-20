extends RefCounted
## Pure visual work scheduling. Fractions refer to the simulation's existing
## total construction time; this module never changes costs or elapsed time.
## A job occupies a work interval. Its whole image changes visibility at the end.

const PHASE_LIMITS := [0.0,.12,.30,.53,.66,.91,1.0]
const PHASE_NAMES := ["基础砌筑","柱梁承重","墙体门窗","屋面椽架","瓦檐屋脊","设备陈设"]

static func tier(leaf: Dictionary) -> int:
	var asset := str(leaf.get("asset",""))
	match int(leaf.get("phase",4)):
		1:
			if asset.begins_with("post_"):return 0
			return 2 if asset=="dougong" else 1
		2:
			if asset.begins_with("window_"):return 2
			if asset.begins_with("door_") or asset=="furnace_mouth":return 1
		4:
			if asset.begins_with("ridge_") or asset=="rope":return 2
			if asset.begins_with("eave_"):return 1
	return 0

static func work_weight(leaf: Dictionary) -> float:
	# Relative labour, not a new resource cost. Long structural members and large
	# wall panels take longer than a tile course or a small finishing prop.
	if leaf.has("work_weight"):
		return clampf(float(leaf.work_weight),.05,100.0)
	var asset := str(leaf.get("asset",""))
	var extent: Array = leaf.get("extent",[.25,.25,.25])
	var w := maxf(.001,float(extent[0]))
	var d := maxf(.001,float(extent[1]))
	var h := maxf(.001,float(extent[2]))
	var base := .55
	var size_factor := 1.0
	if asset in ["stone_block","stone_step"] or asset.begins_with("well_stone") or asset.begins_with("kiln_masonry"):
		base=1.5;size_factor=sqrt(w*d/.065)
	elif asset.begins_with("post_"):
		base=2.2;size_factor=h/.4
	elif asset.begins_with("beam_"):
		base=1.8;size_factor=maxf(w,d)/.3
	elif asset=="brace_wood":
		base=1.1;size_factor=maxf(maxf(w,d),h)/.3
	elif asset=="dougong":
		base=1.8
	elif asset.begins_with("wall_"):
		base=2.4;size_factor=sqrt(maxf(w,d)*h/.12)
	elif asset.begins_with("door_"):
		base=1.7;size_factor=sqrt(maxf(w,d)*h/.10)
	elif asset.begins_with("window_"):
		base=1.15;size_factor=sqrt(maxf(w,d)*h/.035)
	elif asset=="rafter":
		base=.85;size_factor=maxf(w,d)/.16
	elif asset.begins_with("tiles_") or asset=="thatch_course" or asset.begins_with("fabric_"):
		base=.65;size_factor=sqrt(w*d/.035)
	elif asset.begins_with("eave_"):
		base=.85;size_factor=maxf(w,d)/.25
	elif asset.begins_with("ridge_"):
		base=1.3
	elif asset in ["furnace_mouth","loom_frame","workbench","millstone","armillary_ring_vertical","armillary_ring_horizontal"]:
		base=3.0
	elif asset in ["rope","lantern","banner"]:
		base=.3
	elif asset=="chimney_course":
		base=1.25
	return base*clampf(size_factor,.55,2.4)

static func _install_less(a: Dictionary,b: Dictionary) -> bool:
	# Upper-storey columns need the completed lower frame, even though both
	# storeys share the same structural stage of the economic build timer.
	var a_floor := float(a.get("stand_elevation",0))
	var b_floor := float(b.get("stand_elevation",0))
	if not is_equal_approx(a_floor,b_floor):return a_floor<b_floor
	var a_tier := tier(a)
	var b_tier := tier(b)
	if a_tier!=b_tier:return a_tier<b_tier
	var a_order := float(a.get("order",a.get("build_order",0)))
	var b_order := float(b.get("order",b.get("build_order",0)))
	if a_order!=b_order:return a_order<b_order
	return str(a.id)<str(b.id)

static func _remove_less(a: Dictionary,b: Dictionary) -> bool:
	# Dismantle higher pieces first. At the same height, remove fittings before
	# their supports. This also clears an old roof before a new storey goes up.
	var a_top := float(a.get("elevation",0))+float(a.get("extent",[0,0,0])[2])
	var b_top := float(b.get("elevation",0))+float(b.get("extent",[0,0,0])[2])
	if not is_equal_approx(a_top,b_top):return a_top>b_top
	if int(a.get("phase",4))!=int(b.get("phase",4)):return int(a.get("phase",4))>int(b.get("phase",4))
	if tier(a)!=tier(b):return tier(a)>tier(b)
	return str(a.id)<str(b.id)

static func _append_jobs(result: Dictionary,leaves: Array,start: float,end: float,operation: String,phase: int) -> void:
	if leaves.is_empty():return
	var total := 0.0
	for leaf: Dictionary in leaves:total+=work_weight(leaf)
	var cursor := start
	for index in range(leaves.size()):
		var leaf: Dictionary=leaves[index]
		var weight := work_weight(leaf)
		var finish := end if index==leaves.size()-1 else cursor+(end-start)*weight/total
		var timing := Vector2(cursor,finish-cursor)
		# The renderer retains Vector2 timing for compatibility. Publish exactly
		# those values too, so worker completion and visual installation agree.
		var job := {"leaf":leaf,"leaf_id":str(leaf.id),"operation":operation,"phase":phase,"tier":tier(leaf),"start":float(timing.x),"end":float(timing.x)+float(timing.y),"duration":float(timing.y),"weight":weight}
		result.jobs.append(job)
		if operation=="install":result.schedule[str(leaf.id)]=timing
		else:result.removals[str(leaf.id)]=timing
		cursor=finish

static func create(recipe: Array,old: Array = [],retained_ids: Dictionary = {}) -> Dictionary:
	var result := {"schedule":{},"removals":{},"jobs":[],"demolition_end":0.0}
	var phases: Array = [[],[],[],[],[],[]]
	for leaf: Dictionary in recipe:
		if retained_ids.has(str(leaf.id)):
			result.schedule[str(leaf.id)]=Vector2.ZERO
		else:
			phases[clampi(int(leaf.get("phase",4)),0,5)].append(leaf)
	var removed: Array=[]
	for leaf: Dictionary in old:
		if not retained_ids.has(str(leaf.id)):removed.append(leaf)
	if not removed.is_empty():
		removed.sort_custom(_remove_less)
		var removal_work := 0.0
		var foundation_work := 0.0
		for leaf: Dictionary in removed:removal_work+=work_weight(leaf)*.45
		for leaf: Dictionary in phases[0]:foundation_work+=work_weight(leaf)
		# Reserve a bounded part of the existing foundation stage for demolition.
		# New foundation work never overlaps a still-standing changed structure.
		result.demolition_end=clampf(.12*removal_work/maxf(.001,removal_work+foundation_work),.025,.09)
		_append_jobs(result,removed,0.0,float(result.demolition_end),"remove",0)
	for phase in range(6):
		var leaves: Array=phases[phase]
		leaves.sort_custom(_install_less)
		var start := float(result.demolition_end) if phase==0 else float(PHASE_LIMITS[phase])
		_append_jobs(result,leaves,start,float(PHASE_LIMITS[phase+1]),"install",phase)
	return result

static func work_progress(progress: float,timing: Vector2) -> float:
	return clampf((progress-timing.x)/maxf(.000000001,timing.y),0.0,1.0)

static func installed(progress: float,timing: Vector2,operation: String) -> float:
	var finished := progress>=timing.x+timing.y-.000000001
	return (0.0 if finished else 1.0) if operation=="remove" else (1.0 if finished else 0.0)
