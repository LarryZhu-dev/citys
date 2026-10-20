extends Node2D
class_name ResourceDeposit
## Connected geological bodies. Geometry is rebuilt on terrain/occupancy changes only.
## Every mesh strip sorts by its real ground depth with buildings and walkers.
const STEP := .25
const SORT_STEP := .5
const EDGE := .43
var body_count := 0
var triangle_count := 0
var strip_count := 0
var rebuilds := 0
var _signature := ""
var _material: ShaderMaterial
var _noise := FastNoiseLite.new()
var _occupied: Dictionary = {}
var _cells: Dictionary = {}
var _kind := "stone"

func _init() -> void:
	y_sort_enabled = true
	var shader := Shader.new()
	shader.code = """shader_type canvas_item;
render_mode unshaded;
uniform sampler2D geology : filter_linear_mipmap, repeat_disable;
uniform float night=0.;
void fragment(){
 vec4 light=COLOR;
 float panel=floor(light.b*2.+.1);
 vec2 p=1.-abs(mod(UV*.165,2.)-1.);
 vec2 st=vec2((panel+.006+p.x*.988)/3.,.006+p.y*.988);
 vec3 albedo=texture(geology,st).rgb;
 // Geological texture follows world coordinates continuously across all strips.
 vec3 tint=mix(vec3(.80,.82,.78),vec3(.98,.96,.89),light.g);
 vec3 c=albedo*tint*light.r;
 c*=mix(vec3(1.),vec3(.48,.65,.83),night);
 COLOR=vec4(c,light.a);
}"""
	_material=ShaderMaterial.new()
	_material.shader=shader
	_material.set_shader_parameter("geology",load("res://art/nature/geology-materials.png"))
	_noise.noise_type=FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	_noise.frequency=.78
	_noise.fractal_type=FastNoiseLite.FRACTAL_FBM
	_noise.fractal_octaves=3

func set_night(amount:float) -> void:
	_material.set_shader_parameter("night",amount)

func sync_deposits(tiles:Array,occupied:Dictionary,seed_value:int) -> void:
	var cells:Dictionary={}
	var signature:=str(seed_value)+";"
	for y in range(tiles.size()):
		for x in range(tiles[y].size()):
			var kind:String=str(tiles[y][x].get("t",""))
			if kind in ["stone","copper","clay"]:
				var cell:=Vector2i(x,y)
				cells[cell]=kind
				signature+="%d,%d:%s:%d;"%[x,y,kind,int(occupied.has(cell))]
	# Adjacent foundations can also excavate the outer edge.
	for p:Vector2i in occupied:
		if cells.has(p) or cells.has(p+Vector2i.LEFT) or cells.has(p+Vector2i.RIGHT) or cells.has(p+Vector2i.UP) or cells.has(p+Vector2i.DOWN):
			signature+="b%d,%d;"%[p.x,p.y]
	if signature==_signature:return
	_signature=signature
	rebuilds+=1
	for child in get_children():
		remove_child(child)
		child.queue_free()
	body_count=0
	triangle_count=0
	strip_count=0
	_occupied=occupied
	_noise.seed=seed_value%65535
	var visited:Dictionary={}
	var groups:Dictionary={}
	for origin:Vector2i in cells:
		if visited.has(origin):continue
		_kind=str(cells[origin])
		_cells={origin:true}
		var frontier:Array[Vector2i]=[origin]
		visited[origin]=true
		var cursor:=0
		while cursor<frontier.size():
			var p:Vector2i=frontier[cursor]
			cursor+=1
			for d:Vector2i in [Vector2i.LEFT,Vector2i.RIGHT,Vector2i.UP,Vector2i.DOWN]:
				var q:=p+d
				if not visited.has(q) and str(cells.get(q,""))==_kind:
					visited[q]=true
					_cells[q]=true
					frontier.append(q)
		body_count+=1
		_build_body(frontier,groups)
	for key:String in groups:
		var group:Dictionary=groups[key]
		var anchor:=Vector2(0,float(group.depth)*32.)
		var arrays:Array=[]
		arrays.resize(Mesh.ARRAY_MAX)
		arrays[Mesh.ARRAY_VERTEX]=group.vertices
		arrays[Mesh.ARRAY_TEX_UV]=group.uv
		arrays[Mesh.ARRAY_COLOR]=group.colors
		var mesh:=ArrayMesh.new()
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES,arrays)
		var node:=MeshInstance2D.new()
		node.mesh=mesh
		node.material=_material
		node.position=anchor
		node.name="DepositDepth"+key.replace(":","_")
		add_child(node)
		strip_count+=1

func _membership(p:Vector2) -> float:
	var q:=p-Vector2.ONE*.5
	var base:=Vector2i(floori(q.x),floori(q.y))
	var f:=q-Vector2(base)
	var a:=float(_cells.has(base))
	var b:=float(_cells.has(base+Vector2i.RIGHT))
	var c:=float(_cells.has(base+Vector2i.DOWN))
	var d:=float(_cells.has(base+Vector2i.ONE))
	return lerpf(lerpf(a,b,f.x),lerpf(c,d,f.x),f.y)

func _sample(p:Vector2) -> Vector4:
	var warp:=Vector2(_noise.get_noise_2d(p.x*2.1+19.,p.y*2.1),_noise.get_noise_2d(p.x*2.1,p.y*2.1+37.))*.19
	var density:=_membership(p+warp)
	var crag:float=.5+_noise.get_noise_2d(p.x,p.y)*.5
	var height:float=(25.+crag*65.) if _kind!="clay" else (8.+crag*22.)
	height*=smoothstep(EDGE,.98,density)
	# Foundations create an excavated face, not a hole in the ore ownership mask.
	var free:=1.
	var cell:=Vector2i(floori(p.x),floori(p.y))
	for y in range(-1,2):
		for x in range(-1,2):
			var q:=cell+Vector2i(x,y)
			if _occupied.has(q):
				var nearest:=p.clamp(Vector2(q),Vector2(q)+Vector2.ONE)
				free=minf(free,smoothstep(.02,.52,p.distance_to(nearest)))
	height*=free
	return Vector4(p.x,p.y,height,density)

func _build_body(cells:Array[Vector2i],groups:Dictionary) -> void:
	var lo:=cells[0]
	var hi:=cells[0]+Vector2i.ONE
	for p:Vector2i in cells:
		lo=lo.min(p)
		hi=hi.max(p+Vector2i.ONE)
	var nx:=int((hi.x-lo.x+1)/STEP)+1
	var ny:=int((hi.y-lo.y+1)/STEP)+1
	var start:=Vector2(lo)-Vector2.ONE*.5
	var samples:Array[Vector4]=[]
	samples.resize(nx*ny)
	for y in range(ny):
		for x in range(nx):samples[y*nx+x]=_sample(start+Vector2(x,y)*STEP)
	for y in range(ny-1):
		for x in range(nx-1):
			var a:Vector4=samples[y*nx+x]
			var b:Vector4=samples[y*nx+x+1]
			var c:Vector4=samples[(y+1)*nx+x+1]
			var d:Vector4=samples[(y+1)*nx+x]
			if (x+y)%2==0:
				_clip_triangle([a,b,c],groups)
				_clip_triangle([a,c,d],groups)
			else:
				_clip_triangle([a,b,d],groups)
				_clip_triangle([b,c,d],groups)

func _clip_triangle(points:Array,groups:Dictionary) -> void:
	var clipped:Array[Vector4]=[]
	for i in range(3):
		var a:Vector4=points[i]
		var b:Vector4=points[(i+1)%3]
		if a.w>=EDGE:clipped.append(a)
		if (a.w>=EDGE)!=(b.w>=EDGE):
			var edge:Vector4=a.lerp(b,(EDGE-a.w)/(b.w-a.w))
			edge.z=0.
			clipped.append(edge)
	for i in range(1,clipped.size()-1):_emit_triangle(clipped[0],clipped[i],clipped[i+1],groups)

func _emit_triangle(a:Vector4,b:Vector4,c:Vector4,groups:Dictionary) -> void:
	var depth:float=(floorf((a.x+a.y+b.x+b.y+c.x+c.y)/3./SORT_STEP)+.5)*SORT_STEP
	# A shared depth band combines disconnected components; no per-rock CanvasItem.
	var key:=str(snappedf(depth,.001))
	if not groups.has(key):groups[key]={"depth":depth,"vertices":PackedVector2Array(),"uv":PackedVector2Array(),"colors":PackedColorArray()}
	var group:Dictionary=groups[key]
	var av:=Vector3(a.x*64.,a.y*64.,a.z)
	var bv:=Vector3(b.x*64.,b.y*64.,b.z)
	var cv:=Vector3(c.x*64.,c.y*64.,c.z)
	var normal:Vector3=(bv-av).cross(cv-av).normalized()
	if normal.z<0.:normal=-normal
	var illumination:=clampf(.72+normal.dot(Vector3(-.42,-.62,.66).normalized())*.45,.47,1.18)
	var panel:float={"stone":0.,"copper":.5,"clay":1.}.get(_kind,0.)
	for p:Vector4 in [a,b,c]:
		group.vertices.append(Vector2((p.x-p.y)*64.,(p.x+p.y-depth)*32.-p.z))
		group.uv.append(Vector2(p.x,p.y))
		group.colors.append(Color(illumination,.5+_noise.get_noise_2d(p.x*3.,p.y*3.)*.3,panel,1.))
	triangle_count+=1

func diagnostics() -> Dictionary:
	return {"bodies":body_count,"triangles":triangle_count,"depth_strips":strip_count,"rebuilds":rebuilds}
