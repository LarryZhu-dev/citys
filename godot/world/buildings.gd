extends Node2D
class_name CityBuildings
## Every visible architectural object is an individual, newly painted image part.
## The same atlas quad is installed during construction and remains after completion.
## Logical ownership never flattens the independently sortable ground anchors.

class LeafPrimitive extends Node2D:
	## GLES3 batches TYPE_PRIMITIVE across canvas items; TYPE_POLYGON explicitly
	## starts a draw call for every item. Keep each leaf's own depth and identity.
	var _commands: Array = []
	var _submitted_primitives: Array = []
	var _commands_dirty := true
	var draw_revision := 0
	var polygon := PackedVector2Array():
		set(value):polygon=value;_invalidate()
	var uv := PackedVector2Array():
		set(value):uv=value;_invalidate()
	var vertex_colors := PackedColorArray():
		set(value):vertex_colors=value;_invalidate()
	var polygons: Array[PackedInt32Array] = []:
		set(value):polygons=value;_invalidate()
	var texture: Texture2D:
		set(value):texture=value;_invalidate()
	func _invalidate()->void:
		_commands_dirty=true
		queue_redraw()
	func get_draw_primitives()->Array:
		return _submitted_primitives if is_visible_in_tree() else []
	func _build_draw_primitives()->Array:
		if not _commands_dirty:return _commands
		_commands.clear()
		if not texture or polygon.is_empty() or uv.size()!=polygon.size() or vertex_colors.size()!=polygon.size():return _commands
		var faces:Array[PackedInt32Array]=polygons
		if faces.is_empty():
			var indices:=PackedInt32Array()
			for index in range(polygon.size()):indices.append(index)
			faces=[indices]
		var dimensions:=texture.get_size()
		for indices:PackedInt32Array in faces:
			assert(indices.size() in [3,4],"A painted leaf face must be a triangle or quad")
			var triangles:Array[PackedInt32Array]=[PackedInt32Array([indices[0],indices[1],indices[2]])]
			if indices.size()==4:triangles.append(PackedInt32Array([indices[0],indices[2],indices[3]]))
			for triangle:PackedInt32Array in triangles:
				var points:=PackedVector2Array()
				var colors:=PackedColorArray()
				var coords:=PackedVector2Array()
				for index:int in triangle:
					points.append(polygon[index])
					colors.append(vertex_colors[index])
					coords.append(uv[index]/dimensions)
				_commands.append({"points":points,"colors":colors,"uv":coords,"texture":texture})
		_commands_dirty=false
		return _commands
	func _draw()->void:
		_submitted_primitives=[]
		for command:Dictionary in _build_draw_primitives():
			draw_primitive(command.points,command.colors,command.uv,command.texture)
			_submitted_primitives.append(command)
		draw_revision+=1

const Recipes = preload("res://world/building_parts.gd")
const ConstructionSchedule = preload("res://world/construction_schedule.gd")
const MANIFEST := "res://art/components/manifest.json"
const PHASE_LIMITS = ConstructionSchedule.PHASE_LIMITS
const PART_SHADER := """
shader_type canvas_item;
render_mode unshaded;
uniform float night = 0.0;
uniform float clock = 0.0;
uniform vec4 lattice_rect=vec4(.1,.1,.8,.8);
uniform float lattice_dark_inset=0.0;
uniform sampler2D lattice_emission_mask : filter_linear_mipmap, repeat_disable;
uniform float lattice_mask_ready=0.0;
uniform vec4 paper_rect=vec4(.1,.1,.8,.8);
uniform vec4 lantern_rect=vec4(.15,.2,.7,.6);
uniform vec4 furnace_rect=vec4(.15,.15,.7,.7);
varying float emission;
varying vec2 part_uv;
void vertex() {
 part_uv=COLOR.gb;
 emission=COLOR.a*8.0;
 COLOR=vec4(1.0);
}
void fragment() {
 vec4 c=COLOR;
 vec3 daylight=c.rgb;
 c.rgb*=vec3(1.0-.26918*night,1.0-.19882*night,1.0-.10859*night);
 if(emission>.5) {
  vec4 aperture=emission<1.5 ? lattice_rect : emission<2.5 ? paper_rect : emission<3.5 ? lantern_rect : furnace_rect;
  float inside=step(aperture.x,part_uv.x)*step(part_uv.x,aperture.x+aperture.z)*step(aperture.y,part_uv.y)*step(part_uv.y,aperture.y+aperture.w);
  float luminance=dot(daylight,vec3(.30,.59,.11));
  float transmissive=0.0;
  if(emission>1.5 && emission<2.5) transmissive=smoothstep(.42,.72,luminance);
  if(emission>2.5 && emission<3.5) transmissive=smoothstep(.16,.65,luminance);
  if(emission>3.5) transmissive=smoothstep(.06,.28,daylight.r-daylight.b)*(1.0+.07*sin(clock*4.0));
  if(emission>4.5) c.rgb=mix(c.rgb,vec3(luminance*.25),inside*transmissive);
  else if(emission<1.5) {
   // New painted window inserts have opaque dark recesses. Their brighter
   // wooden bars stay unlit; transparent source holes still use alpha light.
   float recess=lattice_mask_ready>.5 ? texture(lattice_emission_mask,part_uv).r : (1.0-smoothstep(.09,.16,luminance))*lattice_dark_inset;
   c.rgb+=vec3(1.0,.58,.20)*recess*inside*night*.72;
   float pane=(1.0-c.a)*inside*night*.78;
   vec3 premultiplied=c.rgb*c.a+vec3(1.0,.58,.20)*pane;
   c.a+=pane;
   c.rgb=premultiplied/max(c.a,.00001);
  }
  else c.rgb+=vec3(1.0,.58,.20)*transmissive*inside*night*.75;
 }
 if(c.a<.003) discard;
 COLOR=c;
}
"""

var _manifest: Dictionary = {}
var _textures: Dictionary = {}
var _recipes: Dictionary = {}
var _entries: Dictionary = {}
var _material: ShaderMaterial
var _glow_material: ShaderMaterial
var _glow_texture: GradientTexture2D
var _night := 0.0
var _time := 0.0
var _animation_enabled := true
var _missing: Dictionary = {}
var _sort_dirty := false
var _animated_parts: Array = []
var _sort_cycles := 0
var _last_sort_ms := 0.0
var _last_sorted_parts := 0
var _dirty_owners: Dictionary = {}
var _owner_bounds: Dictionary = {}
var _removed_bounds: Array[Rect2] = []

func _init() -> void:
	y_sort_enabled = true
	set_process(false)
	var shader := Shader.new()
	shader.code = PART_SHADER
	_material = ShaderMaterial.new()
	_material.shader = shader
	var glow_shader:=Shader.new()
	glow_shader.code="shader_type canvas_item; render_mode unshaded, blend_add; uniform float night=0.0; void fragment(){COLOR.a*=night;}"
	_glow_material=ShaderMaterial.new()
	_glow_material.shader=glow_shader
	var gradient := Gradient.new()
	gradient.offsets = PackedFloat32Array([0.0,.30,1.0])
	gradient.colors = PackedColorArray([Color(1,.58,.20,.24),Color(1,.58,.20,.095),Color(1,.58,.20,0)])
	_glow_texture = GradientTexture2D.new()
	_glow_texture.gradient = gradient
	_glow_texture.width = 64
	_glow_texture.height = 64
	_glow_texture.fill = GradientTexture2D.FILL_RADIAL
	_glow_texture.fill_from = Vector2(.5,.5)
	_glow_texture.fill_to = Vector2(1,.5)
	if FileAccess.file_exists(MANIFEST):
		var data: Variant = JSON.parse_string(FileAccess.get_file_as_string(MANIFEST))
		if data is Dictionary:
			_manifest = data.get("parts",{})
	for key: String in {"window_lattice":"lattice_rect","window_paper":"paper_rect","lantern":"lantern_rect","furnace_mouth":"furnace_rect"}:
		if _manifest.has(key) and _manifest[key].has("emission_rect"):
			var r: Array=_manifest[key].emission_rect
			var uniforms:Dictionary={"window_lattice":"lattice_rect","window_paper":"paper_rect","lantern":"lantern_rect","furnace_mouth":"furnace_rect"}
			_material.set_shader_parameter(uniforms[key],Vector4(r[0],r[1],r[2],r[3]))
	if str(_manifest.get("window_lattice",{}).get("emission_mode",""))=="dark_inset":
		_material.set_shader_parameter("lattice_dark_inset",1.0)
	var lattice_mask_path:=str(_manifest.get("window_lattice",{}).get("emission_mask",""))
	if not lattice_mask_path.is_empty() and ResourceLoader.exists(lattice_mask_path):
		var lattice_mask:=load(lattice_mask_path) as Texture2D
		if lattice_mask:
			_material.set_shader_parameter("lattice_emission_mask",lattice_mask)
			_material.set_shader_parameter("lattice_mask_ready",1.0)

func setup(_world: Node2D) -> void:
	y_sort_enabled = true

static func iso(x: float,y: float) -> Vector2:
	return Vector2((x-y)*64.0,(x+y)*32.0)

static func _extent(leaf: Dictionary) -> Vector3:
	var value: Array = leaf.get("extent",[.25,.25,.25])
	return Vector3(maxf(.001,float(value[0])),maxf(.001,float(value[1])),maxf(.001,float(value[2])))

static func _ground(leaf: Dictionary,b: Dictionary) -> Vector2:
	var point: Array = leaf.get("ground",[0.0,0.0])
	return Vector2(float(b.get("x",0))+float(point[0]),float(b.get("y",0))+float(point[1]))

static func _progress(b: Dictionary) -> float:
	var c: Variant = b.get("construction")
	if c is Dictionary and float(c.get("remaining",0))>0:
		return clampf(1.0-float(c.remaining)/maxf(1.0,float(c.get("total",1))),0.0,1.0)
	return 1.0

static func _phase(progress: float) -> int:
	for index in range(6):
		if progress<float(PHASE_LIMITS[index+1]):
			return index
	return 5

static func _operating(b: Dictionary) -> bool:
	return bool(b.get("staffed",false)) and not bool(b.get("idle",false)) and not bool(b.get("damage",false)) and _progress(b)>=1.0

static func _fingerprint(leaf: Dictionary) -> String:
	# Installation order and stage can change without replacing an unchanged object.
	if leaf.has("_visual_fingerprint"):return str(leaf._visual_fingerprint)
	return JSON.stringify([leaf.get("asset"),leaf.get("ground"),leaf.get("extent"),leaf.get("elevation",0),leaf.get("face","prop"),leaf.get("width"),leaf.get("height"),leaf.get("flip",false),leaf.get("rotation",0),leaf.get("layer",0),leaf.get("uv_crop"),leaf.get("uv_turns",0),leaf.get("surface_triangle"),leaf.get("surface_vertices"),leaf.get("image_line"),leaf.get("image_ground"),leaf.get("image_extent")])

static func _physical_key(leaf: Dictionary) -> String:
	return str(leaf.id)+"@"+str(_fingerprint(leaf).hash())

static func _schedule(recipe: Array) -> Dictionary:
	return ConstructionSchedule.create(recipe).schedule

static func _index_plan(plan: Dictionary) -> Dictionary:
	plan["actions"]={}
	for job: Dictionary in plan.jobs:
		job["action_id"]=str(job.operation)+":"+_physical_key(job.leaf)
		plan.actions[job.action_id]=job
	return plan

func _recipe(type: String,level: int) -> Dictionary:
	var key := type+":"+str(level)
	if not _recipes.has(key):
		var leaves: Array = Recipes.create(type,level)
		for leaf: Dictionary in leaves:leaf["_visual_fingerprint"]=_fingerprint(leaf)
		var plan := _index_plan(ConstructionSchedule.create(leaves))
		_recipes[key]={"leaves":leaves,"schedule":plan.schedule,"plan":plan}
	return _recipes[key]

func _texture(meta: Dictionary) -> Texture2D:
	var path := str(meta.get("atlas",""))
	if not path.begins_with("res://"):path="res://art/components/"+path
	if not _textures.has(path):
		_textures[path] = load(path) if ResourceLoader.exists(path) else null
	return _textures[path]

static func _surface_corners(leaf: Dictionary) -> PackedVector2Array:
	# A short tile course, diagonal wall bay or curved-eave segment remains one
	# painted image. These four plan/elevation anchors only place that image in
	# the 2D scene; no filled mesh or complete architectural model is generated.
	if leaf.has("surface_vertices"):
		var projected:=PackedVector2Array()
		for point:Array in leaf.surface_vertices:
			projected.append(iso(float(point[0]),float(point[1]))-Vector2(0,float(point[2])*64.))
		return projected
	var e := _extent(leaf)
	var z := float(leaf.get("elevation",0))*64.0
	var corners := PackedVector2Array()
	match str(leaf.get("face","x")):
		"y":
			var left := iso(0,e.y*.5)-Vector2(0,z)
			var right := iso(0,-e.y*.5)-Vector2(0,z)
			corners=PackedVector2Array([left-Vector2(0,e.z*64),right-Vector2(0,e.z*64),right,left])
		"ground", "top":
			corners=PackedVector2Array([iso(-e.x*.5,-e.y*.5),iso(e.x*.5,-e.y*.5),iso(e.x*.5,e.y*.5),iso(-e.x*.5,e.y*.5)])
			for i in range(4):corners[i]-=Vector2(0,z)
		"roof_south", "roof_north":
			var sign_y := -1.0 if str(leaf.face)=="roof_south" else 1.0
			corners=PackedVector2Array([iso(-e.x*.5,sign_y*e.y*.5)-Vector2(0,z+e.z*64),iso(e.x*.5,sign_y*e.y*.5)-Vector2(0,z+e.z*64),iso(e.x*.5,-sign_y*e.y*.5)-Vector2(0,z),iso(-e.x*.5,-sign_y*e.y*.5)-Vector2(0,z)])
		_:
			var left := iso(-e.x*.5,0)-Vector2(0,z)
			var right := iso(e.x*.5,0)-Vector2(0,z)
			corners=PackedVector2Array([left-Vector2(0,e.z*64),right-Vector2(0,e.z*64),right,left])
	return corners

static func _quad(leaf: Dictionary,meta: Dictionary) -> PackedVector2Array:
	if leaf.has("image_line") and meta.has("image_axis"):
		# This source already depicts a dimensional ridge segment. Align its
		# painted long axis by rotation and UNIFORM scale, without projecting its
		# existing perspective a second time.
		var line:Array=leaf.image_line
		var a:=iso(line[0][0],line[0][1])-Vector2(0,float(line[0][2])*64.)
		var b:=iso(line[1][0],line[1][1])-Vector2(0,float(line[1][2])*64.)
		var native:=Vector2(float(meta.rect[2]),float(meta.rect[3]))
		var axis:Array=meta.image_axis
		var sa:=Vector2(axis[0][0],axis[0][1])*native
		var sb:=Vector2(axis[1][0],axis[1][1])*native
		var factor:=a.distance_to(b)/maxf(.001,sa.distance_to(sb))
		var angle:=(b-a).angle()-(sb-sa).angle()
		var aligned:=PackedVector2Array()
		for corner:Vector2 in [Vector2.ZERO,Vector2(native.x,0),native,Vector2(0,native.y)]:
			aligned.append(a+(corner-sa).rotated(angle)*factor)
		return aligned
	if str(meta.get("kind","prop"))=="surface":
		var points := _surface_corners(leaf)
		if leaf.has("uv_crop"):return points
		var bounds: Array = meta.get("plane_bounds",[0.0,0.0,1.0,1.0])
		var width:=maxf(.001,float(bounds[2])-float(bounds[0]))
		var height:=maxf(.001,float(bounds[3])-float(bounds[1]))
		var expanded:=PackedVector2Array()
		# Bilinear extension preserves tapered tile courses. The old affine
		# extension discarded their fourth corner and turned hips into gaps.
		for corner:Vector2 in [Vector2.ZERO,Vector2(1,0),Vector2.ONE,Vector2(0,1)]:
			var u:float=(corner.x-float(bounds[0]))/width
			var v:float=(corner.y-float(bounds[1]))/height
			expanded.append(points[0].lerp(points[1],u).lerp(points[3].lerp(points[2],u),v))
		return expanded
	var e := _extent(leaf)
	var image_offset:=Vector2.ZERO
	if leaf.has("image_extent"):
		var value:Array=leaf.image_extent
		e=Vector3(value[0],value[1],value[2])
	if leaf.has("image_ground"):
		image_offset=iso(float(leaf.image_ground[0])-float(leaf.ground[0]),float(leaf.image_ground[1])-float(leaf.ground[1]))
	if meta.has("reference_size"):
		var reference:Array=meta.reference_size
		var native:Array=meta.get("native_size",[meta.rect[2],meta.rect[3]])
		var pivot:Array=meta.get("pivot",[.5,1.0])
		var circular:=str(meta.get("reference_projection","circle"))=="circle"
		var target_size:=Vector2((e.x+e.y)*64.0,(e.x+e.y)*32.0+e.z*64.0)
		if circular:target_size=Vector2(64.0*sqrt(2.0)*e.x,32.0*sqrt(2.0)*e.y+e.z*64.0)
		var scale_factor:=target_size.x/float(reference[0])
		if str(meta.get("reference_axis","width"))=="height":
			scale_factor=e.z*64./maxf(.001,float(reference[1]))
		if leaf.has("height"):
			scale_factor=float(leaf.height)/maxf(.001,float(reference[1]))
		elif leaf.has("width"):
			scale_factor=float(leaf.width)/maxf(.001,float(reference[0]))
		var scale:=Vector2.ONE*scale_factor
		var size:=Vector2(native[0],native[1])*scale
		var origin:=image_offset-Vector2(pivot[0],pivot[1])*size-Vector2(0,float(leaf.get("elevation",0))*64)
		var points:=PackedVector2Array([origin,origin+Vector2(size.x,0),origin+size,origin+Vector2(0,size.y)])
		if bool(leaf.get("flip",false)):
			for i in range(points.size()):points[i].x=2.*image_offset.x-points[i].x
		return points
	var width := float(leaf.get("width",(e.x+e.y)*64.0))
	var height := float(leaf.get("height",e.z*64.0+(e.x+e.y)*32.0))
	var pivot: Array = meta.get("pivot",[.5,1.0])
	var origin := -Vector2(width*float(pivot[0]),height*float(pivot[1]))-Vector2(0,float(leaf.get("elevation",0))*64.0)
	var points := PackedVector2Array([origin,origin+Vector2(width,0),origin+Vector2(width,height),origin+Vector2(0,height)])
	if bool(leaf.get("flip",false)):
		for i in range(points.size()):points[i].x=-points[i].x
	return points

static func _uv_rect(leaf: Dictionary,meta: Dictionary) -> Rect2:
	var r:Array=meta.rect
	var result:=Rect2(float(r[0]),float(r[1]),float(r[2]),float(r[3]))
	if leaf.has("uv_crop") and str(meta.get("kind","prop"))=="surface":
		var bounds:Array=meta.get("plane_bounds",[0.,0.,1.,1.])
		var crop:Array=leaf.uv_crop
		var size:=Vector2(float(bounds[2])-float(bounds[0]),float(bounds[3])-float(bounds[1]))
		var offset:=Vector2(float(bounds[0]),float(bounds[1]))+size*Vector2(crop[0],crop[1])
		result=Rect2(result.position+result.size*offset,result.size*size*Vector2(crop[2],crop[3]))
	return result

static func _uv_points(rect:Rect2)->PackedVector2Array:
	return PackedVector2Array([rect.position,rect.position+Vector2(rect.size.x,0),rect.end,rect.position+Vector2(0,rect.size.y)])

static func _leaf_uv(leaf:Dictionary,meta:Dictionary)->PackedVector2Array:
	var uv:=_uv_points(_uv_rect(leaf,meta))
	var turns:=posmod(int(leaf.get("uv_turns",0)),4)
	var result:=PackedVector2Array()
	for index in range(4):result.append(uv[(index+turns)%4])
	if leaf.has("surface_triangle"):
		var triangle:=PackedVector2Array()
		for index:int in leaf.surface_triangle:triangle.append(result[index])
		return triangle
	return result

static func _geometry(leaf:Dictionary,meta:Dictionary)->Dictionary:
	var points:=PackedVector2Array()
	var uv:=PackedVector2Array()
	var local:=PackedVector2Array()
	var faces:Array[PackedInt32Array]=[]
	if meta.has("source_planes"):
		var e:=_extent(leaf)
		var z:=float(leaf.get("elevation",0))*64.0
		var bottom:=PackedVector2Array([iso(-e.x*.5,-e.y*.5)-Vector2(0,z),iso(e.x*.5,-e.y*.5)-Vector2(0,z),iso(e.x*.5,e.y*.5)-Vector2(0,z),iso(-e.x*.5,e.y*.5)-Vector2(0,z)])
		var top:=PackedVector2Array()
		for point:Vector2 in bottom:top.append(point-Vector2(0,e.z*64))
		var targets:Dictionary={"top":top,"side_x":PackedVector2Array([top[1],top[2],bottom[2],bottom[1]]),"side_y":PackedVector2Array([top[2],top[3],bottom[3],bottom[2]])}
		var rect:Array=meta.rect
		for key:String in ["top","side_x","side_y"]:
			if not meta.source_planes.has(key):continue
			var start:=points.size()
			var source:Array=meta.source_planes[key]
			for index in range(4):
				points.append(targets[key][index])
				var value:=Vector2(source[index][0],source[index][1])
				local.append(value)
				uv.append(Vector2(rect[0],rect[1])+value*Vector2(rect[2],rect[3]))
			faces.append(PackedInt32Array([start,start+1,start+2,start+3]))
	else:
		points=_quad(leaf,meta)
		uv=_leaf_uv(leaf,meta)
		local=PackedVector2Array([Vector2.ZERO,Vector2(1,0),Vector2.ONE,Vector2(0,1)])
		if leaf.has("surface_triangle"):
			var triangle:=PackedVector2Array()
			var selected:=PackedVector2Array()
			for index:int in leaf.surface_triangle:triangle.append(points[index]);selected.append(local[index])
			points=triangle;local=selected
	return {"points":points,"uv":uv,"local":local,"faces":faces}

func _create_part(leaf: Dictionary,b: Dictionary) -> Dictionary:
	var asset := str(leaf.get("asset",""))
	if not _manifest.has(asset):
		_missing[asset]=true
		return {}
	var meta: Dictionary = _manifest[asset]
	var texture := _texture(meta)
	if not texture:
		_missing[asset]=true
		return {}
	var node := Node2D.new()
	node.name = "Part_"+str(b.get("id","preview"))+"_"+str(leaf.id)
	node.position = iso(_ground(leaf,b).x,_ground(leaf,b).y)
	node.set_meta("leaf",leaf)
	node.set_meta("building_id",str(b.get("id","preview")))
	var polygon := LeafPrimitive.new()
	polygon.name = asset
	polygon.texture = texture
	polygon.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
	polygon.material = _material
	var geometry:=_geometry(leaf,meta)
	polygon.polygon=geometry.points
	polygon.uv=geometry.uv
	polygon.polygons=geometry.faces
	node.add_child(polygon)
	add_child(node)
	var glow: Sprite2D
	if asset in ["window_lattice","window_paper","lantern","furnace_mouth"]:
		glow=Sprite2D.new()
		glow.name="LocalEmission"
		glow.texture=_glow_texture
		glow.material=_glow_material
		var points := polygon.polygon
		var uv: Array = meta.get("light_anchor",[.5,.5])
		if meta.has("emission_rect"):
			var r:Array=meta.emission_rect
			uv=[float(r[0])+float(r[2])*.5,float(r[1])+float(r[3])*.5]
		glow.position=points[0]+(points[1]-points[0])*float(uv[0])+(points[3]-points[0])*float(uv[1])
		var radius := clampf((points[1]-points[0]).length()*.75,3.5,15.0)
		glow.scale=Vector2.ONE*(radius/32.0)
		glow.visible=false
		node.add_child(glow)
	var part := {"node":node,"quad":polygon,"glow":glow,"leaf":leaf,"fingerprint":_fingerprint(leaf),"installed":-1.0,"light":-1.0,"asset":asset,"operating":false,"angle":0.0,"ground":node.position,"sort_y":node.position.y,"offset":0.0,"local_uv":geometry.local}
	if str(leaf.get("animate",""))=="wheel":
		var center:Vector2=(polygon.polygon[0]+polygon.polygon[2])*.5
		var points:=polygon.polygon
		for index in range(points.size()):points[index]-=center
		polygon.polygon=points
		polygon.position=center
		_animated_parts.append(part)
	_sort_dirty=true
	_dirty_owners[str(b.get("id","preview"))]=true
	return part

func _update_part(part: Dictionary,b: Dictionary,amount: float) -> void:
	var node: Node2D = part.node
	var ground := _ground(part.leaf,b)
	var position_now := iso(ground.x,ground.y)
	if part.ground!=position_now:
		part.ground=position_now
		_set_sort_y(part,position_now.y)
		_sort_dirty=true
		_dirty_owners[str(b.get("id","preview"))]=true
	var installed := 1.0 if amount>=1.0 else 0.0
	part.operating=_operating(b) and installed>=.999
	var asset:=str(part.leaf.asset)
	if part.leaf.has("growth_assets") and installed>=.999:
		var production:Dictionary=b.get("production",{}) if b.get("production") is Dictionary else {}
		var batch_progress:=clampf(float(production.get("progress",0)),0,1)
		var variants:Array=part.leaf.growth_assets
		if not variants.is_empty():asset=str(variants[mini(variants.size()-1,int(batch_progress*variants.size()))])
	if asset!=part.asset:
		if _manifest.has(asset):
			var meta:Dictionary=_manifest[asset]
			part.quad.texture=_texture(meta)
			part.quad.uv=_leaf_uv(part.leaf,meta)
			part.asset=asset
		else:_missing[asset]=true
	var light := 5.0 if asset=="furnace_mouth" else 0.0
	if installed>=.999 and _progress(b)>=1.0:
		var active := _operating(b) or (str(b.get("type")) in ["house","villa"] and int(b.get("pop",0))>0)
		if active:
			if asset=="window_lattice":light=1.0
			elif asset=="window_paper":light=2.0
			elif asset=="lantern":light=3.0
			elif asset=="furnace_mouth":light=4.0
	if not is_equal_approx(part.installed,installed) or part.light!=light:
		var colors:=PackedColorArray()
		for value:Vector2 in part.local_uv:colors.append(Color(installed,value.x,value.y,light/8))
		part.quad.vertex_colors=colors
		part.quad.visible=installed>.0001
		part.installed=installed
		part.light=light
	if part.glow:
		part.glow.visible=light>.5 and light<4.5 and _night>.01
		part.glow.modulate=Color.WHITE

func _sync_entry(entry: Dictionary,b: Dictionary) -> void:
	var shape:=JSON.stringify([b.get("type"),b.get("x"),b.get("y"),b.get("lvl"),b.get("construction",{}).get("fromLevel",0) if b.get("construction") is Dictionary else 0,b.get("construction",{}).get("toLevel",0) if b.get("construction") is Dictionary else 0,_progress(b)<1.0])
	var production:Dictionary=b.get("production",{}) if b.get("production") is Dictionary else {}
	var state:=JSON.stringify([b.get("staffed"),b.get("idle"),bool(b.get("damage",false)),int(b.get("pop",0))>0,int(float(production.get("progress",0))*64)])
	var progress_now:=_progress(b)
	if entry.get("shape")==shape:
		entry.building=b
		if entry.get("state")==state and float(entry.get("progress",-1))==progress_now:return
		var updates:Array=entry.parts.values() if progress_now<1.0 else entry.get("live_updates",[])
		for part:Dictionary in updates:
			var amount:=1.0
			var timing:Vector2=part.get("timing",Vector2(0,1))
			match str(part.get("policy","retain")):
				"install", "remove":amount=ConstructionSchedule.installed(progress_now,timing,str(part.policy))
			_update_part(part,b,amount)
		entry.state=state;entry.progress=progress_now
		return
	var c: Dictionary = b.get("construction",{}) if b.get("construction") is Dictionary else {}
	var progress := _progress(b)
	var level := int(c.get("toLevel",b.get("lvl",1))) if progress<1.0 else int(b.get("lvl",1))
	var cached := _recipe(str(b.get("type","house")),level)
	var recipe: Array = cached.leaves
	var old: Array = _recipe(str(b.type),int(c.get("fromLevel",0))).leaves if progress<1.0 and int(c.get("fromLevel",0))>0 else []
	var old_by_id := {}
	for leaf: Dictionary in old:old_by_id[str(leaf.id)]=leaf
	var retained_ids := {}
	for leaf: Dictionary in recipe:
		var id := str(leaf.id)
		if old_by_id.has(id) and _fingerprint(old_by_id[id])==_fingerprint(leaf):retained_ids[id]=true
	var plan: Dictionary=_index_plan(ConstructionSchedule.create(recipe,old,retained_ids)) if not old.is_empty() else cached.plan
	var schedule: Dictionary=plan.schedule
	var desired := {}
	for leaf: Dictionary in recipe:
		if not leaf.has("asset") or not leaf.has("id"):continue
		var id := str(leaf.id)
		var timing: Vector2 = schedule[id]
		var retained := retained_ids.has(id) or progress>=1.0
		var amount := 1.0 if retained else ConstructionSchedule.installed(progress,timing,"install")
		desired[_physical_key(leaf)]={"leaf":leaf,"amount":amount,"timing":timing,"policy":"retain" if retained else "install"}
	for leaf: Dictionary in old:
		var id := str(leaf.id)
		if retained_ids.has(id):continue
		var timing: Vector2 = plan.removals[id]
		var amount := ConstructionSchedule.installed(progress,timing,"remove")
		desired[_physical_key(leaf)]={"leaf":leaf,"amount":amount,"timing":timing,"policy":"remove"}
	for key: String in desired:
		var item: Dictionary=desired[key]
		if not entry.parts.has(key):
			var part := _create_part(item.leaf,b)
			if part.is_empty():continue
			entry.parts[key]=part
		entry.parts[key].timing=item.timing
		entry.parts[key].policy=item.policy
		_update_part(entry.parts[key],b,float(item.amount))
	for key: String in entry.parts.keys():
		if desired.has(key):continue
		var node: Node=entry.parts[key].node
		remove_child(node)
		node.queue_free()
		entry.parts.erase(key)
		_sort_dirty=true
		_dirty_owners[str(b.get("id","preview"))]=true
	entry.building=b
	entry.recipe=recipe
	entry.schedule=schedule
	entry.plan=plan
	entry.shape=shape;entry.state=state;entry.progress=progress_now
	entry.live_updates=[]
	for part:Dictionary in entry.parts.values():
		if part.glow or part.leaf.has("growth_assets") or part.leaf.has("animate"):entry.live_updates.append(part)

func sync_buildings(list: Array,_city: Dictionary) -> void:
	var live := {}
	for value: Variant in list:
		if not value is Dictionary or str(value.get("type","road"))=="road":continue
		var b: Dictionary=value
		var id := str(b.get("id",str(b.get("x",0))+":"+str(b.get("y",0))))
		live[id]=true
		if not _entries.has(id):_entries[id]={"parts":{},"building":{},"recipe":[],"schedule":{}}
		_sync_entry(_entries[id],b)
	for id: String in _entries.keys():
		if live.has(id):continue
		for part: Dictionary in _entries[id].parts.values():
			remove_child(part.node)
			part.node.queue_free()
		if _owner_bounds.has(id):_removed_bounds.append(_owner_bounds[id]);_owner_bounds.erase(id)
		_entries.erase(id)
		_sort_dirty=true
	if _sort_dirty:_sort_visuals()

static func _set_sort_y(part:Dictionary,sort_y:float)->void:
	var offset:=float(part.ground.y)-sort_y
	var delta:=offset-float(part.offset)
	part.node.position=Vector2(part.ground.x,sort_y)
	for child:Node2D in part.node.get_children():child.position.y+=delta
	part.offset=offset
	part.sort_y=sort_y

static func _behind(a:Dictionary,b:Dictionary)->int:
	# Only projected overlapping pictures impose an ordering relationship.
	if not a.bounds.intersects(b.bounds):return 0
	# Only unambiguous physical-height constraints become graph edges. Horizontal
	# near/far order remains the real ground-Y priority; adding contradictory X/Y
	# edges for intersecting diagonal bounding boxes creates artificial cycles.
	if a.zmax<=b.zmin+.0001:return -1
	if b.zmax<=a.zmin+.0001:return 1
	if a.owner==b.owner:
		if not str(a.get("roof_group","")).is_empty() and a.get("roof_group")==b.get("roof_group"):
			# A long structural rafter spans several tile-height intervals. Its
			# single bounding box therefore cannot express "inside this roof".
			# Actual separately installed roof coverings occlude that timber.
			if a.asset=="rafter" and b.get("roof_cover",false):return -1
			if b.asset=="rafter" and a.get("roof_cover",false):return 1
		if str(b.get("attached_to",""))==str(a.get("leaf_id","")):return -1
		if str(a.get("attached_to",""))==str(b.get("leaf_id","")):return 1
		# A fitted window sits on its wall plane. Height dependencies can postpone
		# that wall behind other structural pieces, so its facade attachment must
		# follow it explicitly; a tiny ground offset alone is insufficient.
		if a.face==b.face and a.face in ["x","y"]:
			var normal:=1 if a.face=="x" else 0
			if absf(float(a.plan.get_center()[normal])-float(b.plan.get_center()[normal]))<.05:
				if a.role=="wall" and b.role=="window":return -1
				if b.role=="wall" and a.role=="window":return 1
		if a.phase==0 and b.phase!=0 and a.zmin<=b.zmin:return -1
		if b.phase==0 and a.phase!=0 and b.zmin<=a.zmin:return 1
	return 0

static func _priority_less(a:int,b:int,records:Array)->bool:
	if not is_equal_approx(records[a].ground.y,records[b].ground.y):return records[a].ground.y<records[b].ground.y
	if not is_equal_approx(records[a].zmin,records[b].zmin):return records[a].zmin<records[b].zmin
	return a<b

static func _heap_push(heap:Array,index:int,records:Array)->void:
	heap.append(index)
	var i:=heap.size()-1
	while i>0:
		var parent:=int((i-1)/2)
		if not _priority_less(heap[i],heap[parent],records):break
		var value:int=heap[i];heap[i]=heap[parent];heap[parent]=value;i=parent

static func _heap_pop(heap:Array,records:Array)->int:
	var result:int=heap[0]
	var last:int=heap.pop_back()
	if not heap.is_empty():
		heap[0]=last
		var i:=0
		while i*2+1<heap.size():
			var child:=i*2+1
			if child+1<heap.size() and _priority_less(heap[child+1],heap[child],records):child+=1
			if not _priority_less(heap[child],heap[i],records):break
			var value:int=heap[i];heap[i]=heap[child];heap[child]=value;i=child
	return result

func _sort_visuals()->void:
	var start:=Time.get_ticks_usec()
	var selected:Dictionary=_dirty_owners.duplicate()
	var regions:Array[Rect2]=_removed_bounds.duplicate()
	for owner:String in _dirty_owners:
		if _owner_bounds.has(owner):regions.append(_owner_bounds[owner])
		if _entries.has(owner):
			var bounds:=Rect2();var first:=true
			for part:Dictionary in _entries[owner].parts.values():
				for point:Vector2 in part.quad.polygon:
					var at:Vector2=part.node.position+part.quad.transform*point
					if first:bounds=Rect2(at,Vector2.ZERO);first=false
					else:bounds=bounds.expand(at)
			regions.append(bounds)
	for owner:String in _owner_bounds:
		for bounds:Rect2 in regions:
			if _owner_bounds[owner].intersects(bounds.grow(24)):
				selected[owner]=true;break
	if _owner_bounds.is_empty():
		for owner:String in _entries:selected[owner]=true
	var records:Array=[]
	var bins:Dictionary={}
	for owner:String in selected:
		if not _entries.has(owner):continue
		var entry:Dictionary=_entries[owner]
		var owner_bounds:=Rect2();var owner_first:=true
		for part:Dictionary in entry.parts.values():
			var quad:LeafPrimitive=part.quad
			var bounds:=Rect2()
			var first:=true
			for point:Vector2 in quad.polygon:
				var world_point:Vector2=part.node.position+quad.transform*point
				if first:bounds=Rect2(world_point,Vector2.ZERO);first=false
				else:bounds=bounds.expand(world_point)
			# Canvas transforms round to float32 after Y-sort compensation. Include
			# their subpixel error so two shared tile edges keep a stable order.
			bounds=bounds.grow(.00025)
			owner_bounds=bounds if owner_first else owner_bounds.merge(bounds)
			owner_first=false
			var e:=_extent(part.leaf)
			var ground:=_ground(part.leaf,entry.building)
			var z:=float(part.leaf.get("elevation",0))
			var index:=records.size()
			records.append({"part":part,"owner":owner,"leaf_id":str(part.leaf.id),"asset":str(part.leaf.asset),"roof_group":str(part.leaf.get("roof_group","")),"roof_cover":str(part.leaf.get("role","")) in ["tile","thatch","fabric"],"attached_to":str(part.leaf.get("attached_to","")),"bounds":bounds,"ground":part.ground,"plan":Rect2(ground-Vector2(e.x,e.y)*.5,Vector2(e.x,e.y)),"zmin":z,"zmax":z+e.z,"phase":int(part.leaf.get("phase",4)),"layer":int(part.leaf.get("layer",0)),"face":str(part.leaf.get("face","prop")),"role":str(part.leaf.get("role","")),"edges":[],"incoming":0,"done":false})
			for by in range(floori(bounds.position.y/40),floori(bounds.end.y/40)+1):
				for bx in range(floori(bounds.position.x/40),floori(bounds.end.x/40)+1):
					var bin:=Vector2i(bx,by)
					if not bins.has(bin):bins[bin]=[]
					bins[bin].append(index)
		_owner_bounds[owner]=owner_bounds
	var compared:Dictionary={}
	var count:=records.size()
	_last_sorted_parts=count
	for indices:Array in bins.values():
		for i in range(indices.size()):
			for j in range(i+1,indices.size()):
				var a:int=indices[i];var b:int=indices[j]
				var pair:=mini(a,b)*count+maxi(a,b)
				if compared.has(pair):continue
				compared[pair]=true
				var direction:=_behind(records[a],records[b])
				if direction==0:continue
				var before:int=a if direction<0 else b
				var after:int=b if direction<0 else a
				records[before].edges.append(after)
				records[after].incoming+=1
	var heap:Array=[]
	for index in range(count):
		if records[index].incoming==0:_heap_push(heap,index,records)
	var done:=0
	var last_y:float=-1000000.0
	_sort_cycles=0
	while done<count:
		if heap.is_empty():
			# Intersecting coplanar props may form an ambiguous cycle; keep the
			# deterministic physical-depth order for that local ambiguity only.
			var fallback:=-1
			for index in range(count):
				if not records[index].done and (fallback<0 or _priority_less(index,fallback,records)):fallback=index
			if fallback<0:break
			_heap_push(heap,fallback,records);_sort_cycles+=1
		var index:=_heap_pop(heap,records)
		if records[index].done:continue
		var record:Dictionary=records[index]
		record.done=true;done+=1
		var sort_y:=maxf(float(record.ground.y),last_y+.001)
		_set_sort_y(record.part,sort_y)
		last_y=sort_y
		for after:int in record.edges:
			records[after].incoming-=1
			if records[after].incoming==0 and not records[after].done:_heap_push(heap,after,records)
	_sort_dirty=false
	_dirty_owners.clear();_removed_bounds.clear()
	_last_sort_ms=float(Time.get_ticks_usec()-start)/1000.0

func construction_schedule(building_id: Variant) -> Array:
	# Public deterministic work intervals. Workers and diagnostics read the same
	# plan that switches image visibility; no independent visual progress clock.
	var result: Array=[]
	var entry: Dictionary=_entries.get(str(building_id),{})
	for job: Dictionary in entry.get("plan",{}).get("jobs",[]):
		result.append({"action_id":job.action_id,"leaf_id":job.leaf_id,"asset":str(job.leaf.asset),"operation":job.operation,"phase":job.phase,"scheduled_at":job.start,"complete_at":job.end,"duration":job.duration,"work_weight":job.weight})
	return result

func construction_target_valid(building_id: Variant,action_id: String) -> bool:
	var entry: Dictionary=_entries.get(str(building_id),{})
	if entry.is_empty():return false
	var progress := _progress(entry.building)
	if progress>=1.0:return false
	var job: Dictionary=entry.get("plan",{}).get("actions",{}).get(action_id,{})
	return not job.is_empty() and progress<float(job.end)-.000000001

func construction_targets(building_id: Variant,phase: int = -1,max_count: int = 4) -> Array:
	var result: Array=[]
	var id := str(building_id)
	if not _entries.has(id):return result
	var entry: Dictionary=_entries[id]
	var b: Dictionary=entry.building
	var progress := _progress(b)
	if progress>=1.0:return result
	var current_phase := _phase(progress) if phase<0 else phase
	for job: Dictionary in entry.get("plan",{}).get("jobs",[]):
		if int(job.phase)!=current_phase or progress>=float(job.end)-.000000001:continue
		# Automatic work selection stays on the operation being performed now.
		# Explicit phase queries can still prepare future materials in an empty
		# stage, which is how the existing crew handles wells and open workshops.
		if phase<0 and progress<float(job.start)-.000000001:continue
		var leaf: Dictionary=job.leaf
		var timing:=Vector2(float(job.start),float(job.duration))
		var ground:=_ground(leaf,b)
		var elevation:=float(leaf.get("elevation",0))
		var work_ground := Vector2(ground.x,ground.y+.025)
		if leaf.has("work_ground"):
			work_ground=Vector2(float(b.get("x",0))+float(leaf.work_ground[0]),float(b.get("y",0))+float(leaf.work_ground[1]))
		result.append({"action_id":job.action_id,"leaf_id":str(leaf.id),"asset":str(leaf.asset),"operation":job.operation,"ground":[ground.x,ground.y],"work_ground":[work_ground.x,work_ground.y],"elevation":elevation,"worker_elevation":float(leaf.get("stand_elevation",0)),"phase":current_phase,"order":float(leaf.get("order",leaf.get("build_order",0))),"progress":ConstructionSchedule.work_progress(progress,timing),"scheduled_at":job.start,"complete_at":job.end,"duration":job.duration,"work_weight":job.weight,"screen":iso(ground.x,ground.y)-Vector2(0,elevation*64.0),"sort_y":float(entry.parts.get(_physical_key(leaf),{}).get("sort_y",iso(ground.x,ground.y).y))})
		if result.size()>=clampi(max_count,1,64):break
	# Plan is already ordered, including any upgrade demolition before installs.
	return result

func create_preview(type: String,level: int = 1) -> Node2D:
	var preview:=CityBuildings.new()
	preview.sync_buildings([{"id":"preview","type":type,"x":0,"y":0,"lvl":level,"pop":4,"staffed":true}],{})
	var bounds:=Rect2()
	var first:=true
	for child: Node2D in preview.get_children():
		var quad: LeafPrimitive=child.get_child(0)
		for point: Vector2 in quad.polygon:
			var at:=child.position+quad.transform*point
			if first:bounds=Rect2(at,Vector2.ZERO);first=false
			else:bounds=bounds.expand(at)
	if first:
		var size:=float(Recipes.size_of(type))
		bounds=Rect2(-size*64,-64,size*128,size*64+64)
	preview.set_meta("preview_bounds",bounds.grow(5.0))
	return preview

func set_night(amount: float) -> void:
	amount=clampf(amount,0,1)
	if is_equal_approx(amount,_night):return
	var visibility_changed:=(_night>.01)!=(amount>.01)
	_night=amount
	_material.set_shader_parameter("night",_night)
	_glow_material.set_shader_parameter("night",_night)
	if visibility_changed:
		for entry: Dictionary in _entries.values():
			for part: Dictionary in entry.get("live_updates",[]):
				if part.glow:part.glow.visible=part.light>.5 and part.light<4.5 and _night>.01

func set_animation(value: Variant) -> void:
	if value is bool:
		_animation_enabled=value
		return
	if not _animation_enabled:return
	var next_time:=float(value)
	var delta:=clampf(next_time-_time,0,.2)
	_time=next_time
	_material.set_shader_parameter("clock",_time)
	_animated_parts=_animated_parts.filter(func(part:Dictionary)->bool:return is_instance_valid(part.node) and not part.node.is_queued_for_deletion())
	for part:Dictionary in _animated_parts:
		if part.operating:
			part.angle=float(part.angle)+delta*.9
			part.quad.rotation=part.angle

func inspect() -> Dictionary:
	var parts: Array=[]
	var assets: Dictionary={}
	for entry: Dictionary in _entries.values():
		for part: Dictionary in entry.parts.values():
			assets[str(part.leaf.asset)]=true
			parts.append({"leaf_id":str(part.leaf.id),"asset":str(part.asset),"ground_y":part.ground.y,"ground_x":part.ground.x,"sort_y":part.sort_y,"elevation":float(part.leaf.get("elevation",0)),"installed":part.installed,"node_id":part.node.get_instance_id()})
	return {"buildings":_entries.size(),"renderables":get_child_count(),"materials":1,"night":_night,"modules":parts,"asset_keys":assets.keys(),"missing_assets":_missing.keys(),"image_only":true,"sort_cycles":_sort_cycles,"sort_ms":_last_sort_ms,"sorted_parts":_last_sorted_parts}
