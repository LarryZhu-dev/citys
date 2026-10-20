extends SceneTree
## Pure coordinate checks: no rendering device, imported texture or screenshot.
const Recipes=preload("res://world/building_parts.gd")
const Buildings=preload("res://world/buildings.gd")
var failures:Array[String]=[]
var checks:=0

func verify(value:bool,message:String)->void:
	checks+=1
	if not value:failures.append(message)

func _initialize()->void:
	var metadata:Dictionary=JSON.parse_string(FileAccess.get_file_as_string("res://art/components/manifest.json")).parts
	var total:=0
	var peak:=0
	var counts:Dictionary={}
	var sloped:=0
	var max_tile_edge:=0.
	var max_tile_area:=0.
	for type:String in Recipes.SIZES:
		for level in range(1,int(Recipes.MAX_LEVELS.get(type,1))+1):
			var parts:=Recipes.create(type,level)
			var label:="%s:%d"%[type,level]
			counts[label]=parts.size()
			total+=parts.size();peak=maxi(peak,parts.size())
			var identities:Dictionary={}
			for leaf:Dictionary in parts:
				verify(not identities.has(leaf.id),label+" duplicate "+str(leaf.id));identities[leaf.id]=true
				verify(Recipes.MATERIAL_KEYS.has(leaf.asset),label+" undeclared image "+str(leaf.asset))
				verify(float(leaf.get("stand_elevation",0))<=float(leaf.elevation)+float(leaf.extent[2])+.001,label+" worker stands above "+str(leaf.id))
				if leaf.has("roof_group") and (str(leaf.asset).begins_with("tiles_") or str(leaf.asset).begins_with("fabric_") or leaf.asset=="thatch_course"):
					verify(leaf.has("uv_crop"),label+" roof material expands outside its mounted course "+str(leaf.id))
					var roof_quad:=Buildings._quad(leaf,metadata[leaf.asset])
					var mounted:=Buildings._surface_corners(leaf)
					for index in range(4):
						verify(roof_quad[index].distance_to(mounted[index])<.00001,label+" calibrated image margins enlarge the roof "+str(leaf.id))
				if leaf.has("image_line"):
					verify(not leaf.has("surface_vertices") and metadata[leaf.asset].kind=="prop",label+" mounted prop falsely declares a flat surface")
					var prop_quad:=Buildings._quad(leaf,metadata[leaf.asset])
					var prop_area:=0.
					for i in range(4):
						verify(prop_quad[i].is_finite(),label+" nonfinite mounted prop")
						prop_area+=prop_quad[i].cross(prop_quad[(i+1)%4])
					verify(absf(prop_area)>.000001,label+" flattened mounted ridge")
					var changed_line:=leaf.duplicate(true)
					changed_line.image_line[0][2]=float(changed_line.image_line[0][2])+.01
					verify(Buildings._fingerprint(leaf)!=Buildings._fingerprint(changed_line),label+" ignores changed mounted prop endpoints")
				if not leaf.has("surface_vertices"):continue
				sloped+=1
				verify(leaf.surface_vertices.size()==4,label+" image needs four mounting corners")
				var points:=Buildings._quad(leaf,metadata[leaf.asset]) if leaf.has("image_line") else Buildings._surface_corners(leaf)
				for point:Vector2 in points:verify(point.is_finite(),label+" nonfinite projection")
				var area:=0.
				for i in range(4):area+=points[i].cross(points[(i+1)%4])
				verify(absf(area)>.000001,label+" flattened image "+str(leaf.id))
				var changed:=leaf.duplicate(true)
				changed.surface_vertices[0][2]=float(changed.surface_vertices[0][2])+.01
				verify(Buildings._fingerprint(leaf)!=Buildings._fingerprint(changed),label+" ignores changed mounting corner")
				if str(leaf.asset).begins_with("tiles_"):
					var vertices:Array=leaf.surface_vertices
					var plan_area:=0.
					for i in range(4):
						var a:=Vector3(vertices[i][0],vertices[i][1],vertices[i][2])
						var b:=Vector3(vertices[(i+1)%4][0],vertices[(i+1)%4][1],vertices[(i+1)%4][2])
						max_tile_edge=maxf(max_tile_edge,a.distance_to(b))
						plan_area+=Vector2(a.x,a.y).cross(Vector2(b.x,b.y))
						verify(a.distance_to(b)<=.32,label+" one tile band became a roof-size image "+str(leaf.id))
					max_tile_area=maxf(max_tile_area,absf(plan_area)*.5)
					verify(absf(plan_area)*.5<=.06,label+" one tile image covers excessive roof area")
					verify(leaf.get("uv_crop",[])==[0.,0.,1.,1.],label+" repeats framed tile sheet outside its calibrated field")
	var tower:=Recipes.create("pagoda")
	for tier in range(7):
		var post_count:=0
		var sectors:Dictionary={}
		for leaf:Dictionary in tower:
			var id:=str(leaf.id)
			if id.begins_with("tier/%d/post/"%tier):post_count+=1
			if id.begins_with("tier/%d/roof/sector/"%tier):
				sectors[id.get_slice("/",4)]=true
		verify(post_count==8,"pagoda tier %d needs eight true support posts"%tier)
		verify(sectors.size()==8,"pagoda tier %d needs eight independent roof slopes"%tier)
	verify(tower.size()<=1100,"pagoda exceeded independent-piece budget")
	verify(peak<=1250,"catalogue exceeded per-building independent-piece budget")
	print("ROOF_RECIPES "+JSON.stringify({"checks":checks,"failures":failures,"total":total,"peak":peak,"counts":counts,"projectedParts":sloped,"maxTileEdge":max_tile_edge,"maxTilePlanArea":max_tile_area}))
	quit(1 if not failures.is_empty() else 0)
