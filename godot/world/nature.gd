extends Node2D
class_name CityNature

var _items: Dictionary = {}
var _night := 0.0
var _seed := 0
var _quality := "high"
var _textures: Dictionary = {}
var _mat: ShaderMaterial

func _init() -> void:
	y_sort_enabled = true
	var shader := Shader.new()
	shader.code = "shader_type canvas_item; render_mode unshaded; uniform float night=0.0; void fragment(){vec4 c=COLOR; c.rgb*=mix(vec3(1.),vec3(.48,.65,.83),night); COLOR=c;}"
	_mat = ShaderMaterial.new()
	_mat.shader = shader
	var atlas: Texture2D = load("res://art/nature/nature-atlas.webp")
	var regions: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://art/nature/nature-atlas.json"))
	for kind: String in regions:
		var region: Array = regions[kind]
		var texture := AtlasTexture.new()
		texture.atlas = atlas
		texture.region = Rect2(float(region[0]),float(region[1]),float(region[2]),float(region[3]))
		texture.filter_clip = true
		_textures[kind] = texture

func _hash(x: int, y: int, salt: int = 0) -> float:
	var n: int = (x * 73856093) ^ (y * 19349663) ^ (_seed * 83492791) ^ (salt * 15485863)
	n = ((n ^ (n >> 13)) * 1274126177) & 0x7fffffff
	return float(n % 65536) / 65536.0

func _iso(p: Vector2) -> Vector2:
	return Vector2((p.x-p.y)*64.0,(p.x+p.y)*32.0)

func sync_nature(tiles: Array, buildings: Array, seed_value: int) -> void:
	_seed = seed_value
	var occupied: Dictionary = {}
	for b: Dictionary in buildings:
		var size: int = int(b.get("size",1))
		for yy in range(size):
			for xx in range(size):
				occupied[Vector2i(int(b.get("x",0))+xx,int(b.get("y",0))+yy)] = true
	var keep: Dictionary = {}
	for y in range(tiles.size()):
		var row: Array = tiles[y]
		for x in range(row.size()):
			var t: Dictionary = row[x]
			var kind: String = str(t.get("t","grass"))
			if kind not in ["tree","stone","copper","clay","water"] or occupied.has(Vector2i(x,y)):
				continue
			if kind == "water" and (_hash(x,y,44)<.92 or not _near_land(tiles,x,y)):
				continue
			var key := "%d,%d" % [x,y]
			keep[key] = true
			if _items.has(key):
				continue
			var cluster := Node2D.new()
			cluster.y_sort_enabled = true
			add_child(cluster)
			_items[key] = cluster
			if kind == "tree":
				var count := 1 + (int(_hash(x,y,2)>.69) if _quality!="low" else 0)
				for i in range(count):
					var p := Vector2(x+.5+(_hash(x,y,10+i)-.5)*.82,y+.5+(_hash(x,y,20+i)-.5)*.82)
					var grove := _hash(x/5,y/5,4)
					var species := "oak" if grove<.60 else ("cypress" if grove<.84 else "bamboo")
					if _near_water(tiles,x,y):
						species = "willow"
					_sprite(cluster,species,p,98.0+_hash(x,y,3+i)*50.0,_hash(x,y,90+i)>.5)
			elif kind == "water":
				_sprite(cluster,"reeds",Vector2(x+.4,y+.55),43+_hash(x,y,8)*16,false)
			else:
				# Several different scales/anchors replace the old one-identical-pile-per-cell grid.
				var count := 2+(int(_hash(x,y,7)*3) if _quality!="low" else 0)
				for i in range(count):
					var p := Vector2(x+.5+(_hash(x,y,31+i)-.5)*1.15,y+.5+(_hash(x,y,51+i)-.5)*1.15)
					if kind == "clay":
						_clay(cluster,p,x,y,i)
					else:
						_sprite(cluster,kind,p,29.0+_hash(x,y,71+i)*52.0,_hash(x,y,91+i)>.5)
	for key: String in _items.keys():
		if not keep.has(key):
			_items[key].queue_free()
			_items.erase(key)

func _near_land(tiles: Array,x: int,y: int) -> bool:
	for d in [Vector2i.LEFT,Vector2i.RIGHT,Vector2i.UP,Vector2i.DOWN]:
		var p: Vector2i = Vector2i(x,y)+d
		if p.y>=0 and p.y<tiles.size() and p.x>=0 and p.x<tiles[p.y].size() and str(tiles[p.y][p.x].get("t",""))!="water":
			return true
	return false

func _sprite(parent: Node2D,kind: String,p: Vector2,width: float,flip: bool) -> void:
	var sprite := Sprite2D.new()
	sprite.texture = _textures[kind]
	sprite.position = _iso(p)
	sprite.centered = false
	var anchors: Dictionary = {"oak":.535,"cypress":.465,"willow":.385,"bamboo":.38}
	var anchor_x: float = anchors.get(kind,.5)
	if flip:
		anchor_x = 1.0-anchor_x
	sprite.offset = Vector2(-sprite.texture.get_width()*anchor_x,-sprite.texture.get_height()+4)
	sprite.scale = Vector2.ONE * width / sprite.texture.get_width()
	sprite.flip_h = flip
	sprite.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
	sprite.material = _mat
	parent.add_child(sprite)

func _clay(parent: Node2D,p: Vector2,x: int,y: int,index: int) -> void:
	var node := Node2D.new()
	node.position = _iso(p)
	node.material = _mat
	parent.add_child(node)
	var w := 12.0+_hash(x,y,index+120)*18.0
	var poly := Polygon2D.new()
	poly.polygon = PackedVector2Array([Vector2(-w,0),Vector2(-w*.6,-w*.34),Vector2(-w*.16,-w*.4),Vector2(w*.24,-w*.6),Vector2(w*.8,-w*.29),Vector2(w,0),Vector2(w*.4,w*.19),Vector2(-w*.54,w*.15)])
	poly.color = Color(.49,.35,.23).lightened(_hash(x,y,index+130)*.12)
	poly.use_parent_material = true
	node.add_child(poly)

func set_night(amount: float) -> void:
	if absf(amount-_night)<.001:
		return
	_night = amount
	_mat.set_shader_parameter("night",amount)

func _near_water(tiles: Array,x: int,y: int) -> bool:
	for d in [Vector2i.LEFT,Vector2i.RIGHT,Vector2i.UP,Vector2i.DOWN]:
		var p: Vector2i = Vector2i(x,y)+d
		if p.y>=0 and p.y<tiles.size() and p.x>=0 and p.x<tiles[p.y].size() and str(tiles[p.y][p.x].get("t",""))=="water":
			return true
	return false

func set_quality(value: String) -> bool:
	if value==_quality:
		return false
	_quality = value
	for node: Node2D in _items.values():
		node.queue_free()
	_items.clear()
	return true
