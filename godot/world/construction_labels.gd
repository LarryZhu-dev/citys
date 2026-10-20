class_name CityConstructionLabels
extends CanvasLayer
## Passive, screen-sized labels driven only by the authoritative construction
## snapshot. They never run a second countdown or change the engineering clock.

const FONT_SIZE := 13
const INK := Color("302a20")
const MUTED := Color("75684e")
const WARNING := Color("985c32")
const MAX_LABELS := 16
const MAX_MOBILE_LABELS := 8

class LabelCanvas extends Node2D:
	var items: Array = []
	var label_font: Font
	var panel_style: StyleBox
	var draw_count := 0
	var last_drawn: Array = []
	func _draw() -> void:
		last_drawn=[]
		if label_font==null or panel_style==null:
			return
		for item: Dictionary in items:
			var rect: Rect2=item.rect
			if item.get("leader",false):
				var edge: float=rect.end.y if rect.get_center().y<item.anchor.y else rect.position.y
				draw_line(item.anchor,Vector2(rect.get_center().x,edge),Color(.64,.50,.28,.75),1.0,true)
			draw_style_box(panel_style,rect)
			draw_string(label_font,rect.position+Vector2(8,4+label_font.get_ascent(FONT_SIZE)),item.text,HORIZONTAL_ALIGNMENT_LEFT,-1,FONT_SIZE,item.color)
			last_drawn.append({"key":item.key,"text":item.text,"rect":rect,"count":item.count})
		draw_count+=1

var _canvas: LabelCanvas
var _camera: Camera2D
var _buildings: Node2D
var _ui_host: Node
var _hud: Node
var _entries: Array = []
var _city: Dictionary = {}
var _signature := ""
var _dirty := true
var _css_scale := 1.0
var _last_transform := Transform2D()
var _last_viewport := Vector2.ZERO
var _last_exclusions: Array = []
var _last_hidden := false
var _far := false
var _visible_sites := 0
var _omitted_sites := 0
var _layout_count := 0
var _label_font: Font

func _ready() -> void:
	layer=12 # World labels remain below the HUD and its modal scrim.
	_canvas=LabelCanvas.new()
	add_child(_canvas)
	for path: String in ["res://art/fonts/chinese.otf","res://art/fonts/chinese.ttf"]:
		if ResourceLoader.exists(path):
			_label_font=load(path) as Font
			break
	if _label_font==null:
		_label_font=ThemeDB.fallback_font
	_canvas.label_font=_label_font
	var style:=StyleBoxTexture.new()
	if ResourceLoader.exists("res://art/ui/card.png"):
		style.texture=load("res://art/ui/card.png") as Texture2D
		for side in [SIDE_LEFT,SIDE_TOP,SIDE_RIGHT,SIDE_BOTTOM]:
			style.set_texture_margin(side,8)
		_canvas.panel_style=style
	else:
		var fallback:=StyleBoxFlat.new()
		fallback.bg_color=Color("efe3c4")
		fallback.border_color=Color("b9914f")
		fallback.set_border_width_all(1)
		_canvas.panel_style=fallback

func configure(camera: Camera2D,building_renderer: Node2D,ui_host: Node) -> void:
	_camera=camera
	_buildings=building_renderer
	_ui_host=ui_host
	_dirty=true

func set_css_scale(value: float) -> void:
	var next:=maxf(.1,value)
	if not is_equal_approx(next,_css_scale):
		_css_scale=next
		_dirty=true

static func format_remaining(value: float) -> String:
	var seconds:=maxi(1,ceili(value))
	if seconds>=3600:
		var minutes:=ceili(float(seconds)/60.0)
		return "%d时%02d分"%[minutes/60,minutes%60]
	if seconds>=60:
		return "%d分%02d秒"%[seconds/60,seconds%60]
	return "%d秒"%seconds

static func _iso(x: float,y: float) -> Vector2:
	return Vector2((x-y)*64.0,(x+y)*32.0)

static func _state(site: Dictionary,city: Dictionary) -> String:
	if bool(site.get("paused",false)) or float(city.get("speed",1))==0.0 or bool(city.get("visiting",false)) or bool(city.get("onlineOpen",false)):
		return "paused"
	if not str(site.get("blockedReason","")).is_empty():
		return "road" if "道路" in str(site.blockedReason) or "主路" in str(site.blockedReason) else "waiting"
	if site.has("active") and not bool(site.active):
		return "waiting"
	return "active"

static func _prefix(state: String) -> String:
	return {"paused":"暂停 · ","road":"断路 · ","waiting":"待工 · "}.get(state,"")

func sync_city(city: Dictionary) -> void:
	_city=city
	var sites: Dictionary={}
	for value: Variant in city.get("constructionSites",[]):
		if value is Dictionary and not bool(value.get("finished",false)):
			sites[str(value.get("buildingId",""))]=value
	var entries: Array=[]
	var signature: Array=[city.get("seed"),city.get("cityName"),city.get("visiting",false),city.get("onlineOpen",false)]
	for value: Variant in city.get("buildings",[]):
		if not value is Dictionary:
			continue
		var construction: Variant=value.get("construction")
		if not construction is Dictionary:
			continue
		var remaining:=float(construction.get("remaining",0))
		if not is_finite(remaining) or remaining<=0:
			continue
		var id:=str(value.get("id",""))
		var state:=_state(sites.get(id,{}),city)
		var action: String="升级" if int(construction.get("fromLevel",0))>0 else "建造"
		var x:=float(value.get("x",0))
		var y:=float(value.get("y",0))
		var size:=maxf(1,float(value.get("size",1)))
		var entry: Dictionary={"key":id,"id":id,"x":x,"y":y,"size":size,"remaining":remaining,"state":state,"action":action,"count":1}
		entry.text=_prefix(state)+action+" "+format_remaining(remaining)
		entries.append(entry)
		signature.append([id,x,y,size,ceili(remaining),state,action])
	var next:=JSON.stringify(signature)
	_entries=entries
	if next!=_signature:
		_signature=next
		_dirty=true
	# Remove a completed/demolished site immediately, including while paused and
	# while its separate crew exit animation still exists in constructionSites.
	if _entries.is_empty() and is_instance_valid(_canvas) and not _canvas.items.is_empty():
		_canvas.items=[]
		_canvas.queue_redraw()
		_visible_sites=0
		_omitted_sites=0

func _find_hud() -> Node:
	if is_instance_valid(_hud):
		return _hud
	if is_instance_valid(_ui_host):
		for child: Node in _ui_host.get_children():
			if child.has_method("viewport_insets") and child.has_method("blocks_map"):
				_hud=child
				return child
	return null

func _hud_exclusions() -> Array:
	var result: Array=[]
	var hud:=_find_hud()
	if hud==null:
		return result
	# These are the actual current rectangles, not guessed HUD heights. In
	# particular the mobile city/task buttons sit below the top resource bar.
	for field: String in ["top_bar","city_plaque","task_button","dock","placement","panel","toast_label"]:
		var control: Variant=hud.get(field)
		if control is Control and control.is_visible_in_tree():
			var rect: Rect2=control.get_global_rect()
			result.append(Rect2(rect.position/_css_scale,rect.size/_css_scale).grow(5))
	return result

func _process(_delta: float) -> void:
	if not is_instance_valid(_canvas):
		return
	var transform:=get_viewport().get_canvas_transform()
	var viewport:=get_viewport().get_visible_rect().size/_css_scale
	var exclusions:=_hud_exclusions()
	var hud:=_find_hud()
	var hidden:=bool(_city.get("onlineOpen",false)) or (hud!=null and bool(hud.blocks_map()))
	if transform!=_last_transform or viewport!=_last_viewport or exclusions!=_last_exclusions or hidden!=_last_hidden:
		_dirty=true
	if not _dirty:
		return
	_last_transform=transform
	_last_viewport=viewport
	_last_exclusions=exclusions
	_last_hidden=hidden
	_canvas.scale=Vector2.ONE*_css_scale
	_layout(transform,viewport,exclusions,hidden)
	_dirty=false

func _building_bounds(transform: Transform2D) -> Dictionary:
	var output: Dictionary={}
	if not is_instance_valid(_buildings):
		return output
	var bounds: Variant=_buildings.get("_owner_bounds")
	if not bounds is Dictionary:
		return output
	for id: Variant in bounds:
		var rect: Rect2=bounds[id]
		output[str(id)]=Rect2((transform*rect.position)/_css_scale,rect.size*transform.get_scale()/_css_scale)
	return output

func _label_size(text: String) -> Vector2:
	return Vector2(ceilf(_label_font.get_string_size(text,HORIZONTAL_ALIGNMENT_LEFT,-1,FONT_SIZE).x)+16,ceilf(_label_font.get_height(FONT_SIZE))+8)

func _fits(rect: Rect2,viewport: Rect2,exclusions: Array,placed: Array,building_bounds: Dictionary) -> bool:
	if not viewport.encloses(rect):
		return false
	for other: Rect2 in exclusions:
		if rect.intersects(other):
			return false
	for item: Dictionary in placed:
		if rect.grow(3).intersects(item.rect):
			return false
	for other: Rect2 in building_bounds.values():
		if rect.intersects(other.grow(2)):
			return false
	return true

func _layout(transform: Transform2D,viewport: Vector2,exclusions: Array,hidden: bool) -> void:
	_layout_count+=1
	var items: Array=[]
	_visible_sites=0
	_omitted_sites=0
	if hidden or _entries.is_empty() or viewport.x<100 or viewport.y<100:
		_canvas.items=items
		_canvas.queue_redraw()
		return
	var zoom:=_camera.zoom.x/_css_scale if is_instance_valid(_camera) else transform.get_scale().x/_css_scale
	# Hysteresis keeps tiny pinch changes from repeatedly regrouping labels.
	if zoom<.50:
		_far=true
	elif zoom>.60:
		_far=false
	var bounds:=_building_bounds(transform)
	var safe: Dictionary=_city.get("safeArea",{})
	var usable:=Rect2(Vector2(8+float(safe.get("left",0)),8+float(safe.get("top",0))),viewport-Vector2(16+float(safe.get("left",0))+float(safe.get("right",0)),16+float(safe.get("top",0))+float(safe.get("bottom",0))))
	var candidates: Array=[]
	var groups: Dictionary={}
	var omitted_states: Dictionary={"active":0,"paused":0,"road":0,"waiting":0}
	for entry: Dictionary in _entries:
		var world_anchor:=_iso(entry.x+entry.size,entry.y+entry.size)
		var anchor: Vector2=(transform*world_anchor)/_css_scale
		if not Rect2(Vector2.ZERO,viewport).grow(32).has_point(anchor):
			continue
		if bounds.has(entry.id):
			anchor.y=maxf(anchor.y,bounds[entry.id].end.y)
		if not Rect2(Vector2.ZERO,viewport).grow(32).has_point(anchor):
			continue
		_visible_sites+=1
		var candidate:=entry.duplicate()
		candidate.anchor=anchor
		if bounds.has(entry.id):
			candidate.top_anchor=Vector2(anchor.x,bounds[entry.id].position.y)
		if _far:
			var cell:=Vector2i(floori(entry.x/5.0),floori(entry.y/5.0))
			# Blocked and paused jobs never turn into a misleading active ETA.
			var key: String="%d:%d:%s"%[cell.x,cell.y,entry.state]
			if groups.has(key):
				var group: Dictionary=groups[key]
				group.anchor=(group.anchor*group.count+anchor)/(group.count+1)
				group.count+=1
				group.remaining=minf(group.remaining,entry.remaining)
				if group.has("top_anchor") and candidate.has("top_anchor"):
					group.top_anchor=Vector2(group.anchor.x,minf(group.top_anchor.y,candidate.top_anchor.y))
			else:
				candidate.key="group:"+key
				groups[key]=candidate
		else:
			candidates.append(candidate)
	if _far:
		candidates=groups.values()
		for candidate: Dictionary in candidates:
			if candidate.count>1:
				candidate.text=_prefix(candidate.state)+"%d项 · 最短%s"%[candidate.count,format_remaining(candidate.remaining)]
	candidates.sort_custom(func(a: Dictionary,b: Dictionary)->bool:
		var da: float=a.anchor.distance_squared_to(viewport*.5)
		var db: float=b.anchor.distance_squared_to(viewport*.5)
		return str(a.key)<str(b.key) if is_equal_approx(da,db) else da<db)
	var limit:=MAX_MOBILE_LABELS if viewport.x<650 else MAX_LABELS
	if _far:
		limit=mini(limit,6)
	for candidate: Dictionary in candidates:
		if items.size()>=limit-1:
			_omitted_sites+=candidate.count
			omitted_states[candidate.state]+=candidate.count
			continue
		var size:=_label_size(candidate.text)
		var found:=false
		var placements: Array=[]
		for offset: Vector2 in [Vector2(0,5),Vector2(size.x*.55,5),Vector2(-size.x*.55,5),Vector2(0,34),Vector2(size.x*.55,34),Vector2(-size.x*.55,34)]:
			placements.append({"anchor":candidate.anchor,"position":candidate.anchor+offset-Vector2(size.x*.5,0)})
		# Crowded streets may have no free space below the footprint. A second
		# anchor above the real painted roof keeps the text outside all buildings.
		if candidate.has("top_anchor"):
			for dx: float in [0.0,size.x*.55,-size.x*.55]:
				placements.append({"anchor":candidate.top_anchor,"position":candidate.top_anchor+Vector2(dx-size.x*.5,-size.y-5)})
		for placement: Dictionary in placements:
			var rect:=Rect2(placement.position,size)
			if not _fits(rect,usable,exclusions,items,bounds):
				continue
			items.append({"key":candidate.key,"text":candidate.text,"rect":rect,"anchor":placement.anchor,"leader":rect.position.distance_to(placement.anchor)<size.x+40,"color":INK if candidate.state=="active" else WARNING if candidate.state=="road" else MUTED,"count":candidate.count,"state":candidate.state,"remaining":candidate.remaining})
			found=true
			break
		if not found:
			_omitted_sites+=candidate.count
			omitted_states[candidate.state]+=candidate.count
	if _omitted_sites>0:
		var text: String="另%d处施工 · 放大查看"%_omitted_sites
		if omitted_states.road==_omitted_sites:
			text="另%d处断路 · 放大查看"%_omitted_sites
		elif omitted_states.paused==_omitted_sites:
			text="另%d处暂停 · 放大查看"%_omitted_sites
		elif omitted_states.road>0 or omitted_states.paused>0 or omitted_states.waiting>0:
			text="另%d处施工"%_omitted_sites
			for pair: Array in [["paused","暂停"],["road","断路"],["waiting","待工"]]:
				if omitted_states[pair[0]]>0:
					text+=" · %s%d"%[pair[1],omitted_states[pair[0]]]
		var size:=_label_size(text)
		for position: Vector2 in [Vector2(usable.position.x,usable.end.y-90-size.y),Vector2(usable.end.x-size.x,usable.end.y-90-size.y),Vector2(usable.position.x,usable.position.y+112)]:
			var rect:=Rect2(position,size)
			# A count badge is screen-level information and may sit over ground,
			# but still never overlaps a building, another label, or HUD controls.
			if _fits(rect,usable,exclusions,items,bounds):
				items.append({"key":"summary","text":text,"rect":rect,"anchor":Vector2.ZERO,"leader":false,"color":MUTED,"count":0,"state":"summary","remaining":0})
				break
	_canvas.items=items
	_canvas.queue_redraw()

func diagnostics() -> Dictionary:
	var labels: Array=[]
	if is_instance_valid(_canvas):
		for item: Dictionary in _canvas.items:
			labels.append({"key":item.key,"text":item.text,"rect":[item.rect.position.x,item.rect.position.y,item.rect.size.x,item.rect.size.y],"anchor":[item.anchor.x,item.anchor.y],"count":item.count,"state":item.state,"remaining":item.remaining})
	return {"sites":_entries.size(),"visible_sites":_visible_sites,"omitted_sites":_omitted_sites,"labels":labels,"far":_far,"layout_count":_layout_count,"draw_count":_canvas.draw_count if is_instance_valid(_canvas) else 0,"last_drawn":_canvas.last_drawn.size() if is_instance_valid(_canvas) else 0,"passive":true}
