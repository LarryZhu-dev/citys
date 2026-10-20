extends SceneTree
## Uses the production renderer and imported image assets. No replacement
## textures, synthetic recipes, or headless screenshots stand in for artwork.

var report: Dictionary = {"errors":[],"assets":{},"recipes":[],"upgrades":[],"primitive_checks":0,"submitted_triangles":0}
var renderer: Node2D
var recipes: Script
var renderer_script: Script
var atlas_images: Dictionary = {}

func _initialize() -> void:
	call_deferred("_run")

func verify(condition: bool,message: String) -> void:
	if not condition:
		report.errors.append(message)

func pixel_hash(data: PackedByteArray) -> String:
	var hash := HashingContext.new()
	hash.start(HashingContext.HASH_SHA256)
	hash.update(data)
	return hash.finish().hex_encode()

func inspect_assets(manifest: Dictionary) -> void:
	for key: String in manifest.get("parts",{}):
		var meta: Dictionary = manifest.parts[key]
		var texture: Texture2D = renderer._texture(meta)
		verify(texture!=null,"Missing imported Texture2D for "+key)
		if texture==null:
			continue
		var source := str(texture.resource_path)
		verify(source.begins_with("res://art/components/"),"Non-component texture for "+key+": "+source)
		if not atlas_images.has(source):
			atlas_images[source]=texture.get_image()
		var image: Image = atlas_images[source]
		var region: Array = meta.get("rect",[])
		verify(region.size()==4,"Invalid atlas region for "+key)
		if region.size()!=4:
			continue
		var rect := Rect2i(int(region[0]),int(region[1]),int(region[2]),int(region[3]))
		verify(rect.position.x>=0 and rect.position.y>=0 and rect.size.x>0 and rect.size.y>0 and rect.end.x<=image.get_width() and rect.end.y<=image.get_height(),"Out-of-bounds source pixels for "+key)
		if not Rect2i(Vector2i.ZERO,image.get_size()).encloses(rect):
			continue
		var crop := image.get_region(rect)
		crop.clear_mipmaps()
		crop.convert(Image.FORMAT_RGBA8)
		var data := crop.get_data()
		var opaque := 0
		var transparent := 0
		for offset in range(3,data.size(),4):
			if data[offset]>0:
				opaque+=1
			else:
				transparent+=1
				# Importers may fill hidden RGB to prevent filtering fringes.
				# Invisible padding cannot make an otherwise identical image unique.
				data[offset-3]=0
				data[offset-2]=0
				data[offset-1]=0
		report.assets[key]={"texture":source,"atlas_width":texture.get_width(),"atlas_height":texture.get_height(),"rect":region,"width":rect.size.x,"height":rect.size.y,"opaque_pixels":opaque,"transparent_pixels":transparent,"pixel_hash":pixel_hash(data),"kind":meta.get("kind",""),"source":meta.get("source","")}

func part_ids(entry: Dictionary) -> Dictionary:
	var ids: Dictionary = {}
	for key: String in entry.parts:
		ids[key]=[entry.parts[key].node.get_instance_id(),entry.parts[key].quad.get_instance_id()]
	return ids

func flush_drawing() -> void:
	# Observe real CanvasItem redraw notifications. Never call _draw or a command
	# builder directly; two bounded scene frames also work with the headless driver.
	await process_frame
	await process_frame

func submitted_geometry(quad: Variant,label: String,amount: float) -> Dictionary:
	var result: Dictionary = {"points":[],"uv":[],"faces":[],"commands":0}
	verify(quad.has_method("get_draw_primitives") and not quad is Polygon2D,label+" must draw its image through the production primitive node")
	if not quad.has_method("get_draw_primitives"):
		return result
	var commands: Array = quad.get_draw_primitives()
	if not quad.is_visible_in_tree():
		verify(commands.is_empty(),label+" hidden leaf exposes active draw commands")
		return result
	verify(int(quad.draw_revision)>0,label+" has never received a real _draw notification")
	verify(quad.material is ShaderMaterial and quad.material.shader.code==renderer_script.PART_SHADER,label+" actual drawing node lacks the production installation shader")
	var triangles: Array = []
	var source_faces: Array = quad.polygons
	if source_faces.is_empty():
		var indices := PackedInt32Array()
		for index in range(quad.polygon.size()):
			indices.append(index)
		source_faces=[indices]
	for face: PackedInt32Array in source_faces:
		verify(face.size() in [3,4],label+" source image face is not triangular or quadrilateral")
		if face.size() not in [3,4]:
			continue
		triangles.append([face[0],face[1],face[2]])
		if face.size()==4:
			triangles.append([face[0],face[2],face[3]])
	verify(commands.size()==triangles.size(),label+" actual draw submission omits or duplicates image triangles")
	result.points.resize(quad.polygon.size())
	result.uv.resize(quad.uv.size())
	var dimensions: Vector2 = quad.texture.get_size()
	for command_index in range(mini(commands.size(),triangles.size())):
		var command: Dictionary = commands[command_index]
		var indices: Array = triangles[command_index]
		verify(command.texture==quad.texture,label+" submitted texture differs from the actual leaf atlas")
		verify(command.points.size()==3 and command.colors.size()==3 and command.uv.size()==3,label+" actual primitive is not a complete textured triangle")
		if command.points.size()!=3 or command.colors.size()!=3 or command.uv.size()!=3:
			continue
		for vertex in range(3):
			var index: int = indices[vertex]
			var point: Vector2 = command.points[vertex]
			var uv: Vector2 = command.uv[vertex]
			var color: Color = command.colors[vertex]
			verify(point.is_equal_approx(quad.polygon[index]),label+" submitted image point differs from its independent leaf geometry")
			verify((uv*dimensions).is_equal_approx(quad.uv[index]),label+" submitted normalized UV samples a different source image")
			verify(color.is_equal_approx(quad.vertex_colors[index]) and absf(color.r-amount)<.00001,label+" actual draw has stale installation or lighting data")
			if result.points[index]!=null:
				verify(result.points[index].is_equal_approx(point) and result.uv[index].is_equal_approx(uv),label+" shared image corner disagrees between submitted triangles")
			result.points[index]=point
			result.uv[index]=uv
		result.faces.append(indices)
		result.commands+=1
	verify(not result.points.has(null) and not result.uv.has(null),label+" actual submission leaves source vertices unused")
	report.primitive_checks+=1
	report.submitted_triangles+=result.commands
	return result

func inspect_recipe(type: String,level: int,size: int) -> void:
	var label := type+":"+str(level)
	var leaves: Array = recipes.create(type,level)
	var building := {"id":label,"type":type,"lvl":level,"x":7,"y":9,"size":size,"staffed":true,"pop":12,"construction":{"total":100.0,"remaining":100.0}}
	renderer.sync_buildings([building],{})
	var entry: Dictionary = renderer._entries.get(label,{})
	verify(not entry.is_empty(),"No actual renderer entry for "+label)
	if entry.is_empty():
		return
	var ids := part_ids(entry)
	var node_checks: Array = []
	var schedule: Dictionary = {}
	for leaf: Dictionary in leaves:
		var id := str(leaf.id)
		var timing: Vector2 = entry.schedule.get(id,Vector2(-1,-1))
		schedule[id]=[timing.x,timing.y]
	for part: Dictionary in entry.parts.values():
		var quad: Variant = part.quad
		var texture: Texture2D = quad.texture
		var meta: Dictionary = renderer._manifest[str(part.asset)]
		var rect := Rect2(float(meta.rect[0]),float(meta.rect[1]),float(meta.rect[2]),float(meta.rect[3]))
		var finite_quad := true
		for point: Vector2 in quad.polygon:
			finite_quad=finite_quad and is_finite(point.x) and is_finite(point.y)
		var finite_uv := true
		var uv_in_region := true
		for point: Vector2 in quad.uv:
			finite_uv=finite_uv and is_finite(point.x) and is_finite(point.y) and point.x>=0 and point.y>=0 and texture!=null and point.x<=texture.get_width() and point.y<=texture.get_height()
			uv_in_region=uv_in_region and rect.grow(.01).has_point(point)
		node_checks.append({"leaf_id":str(part.leaf.id),"asset":str(part.leaf.asset),"texture":str(texture.resource_path) if texture else "","texture_loaded":texture!=null,"quad_vertices":quad.polygon.size(),"uv_vertices":quad.uv.size(),"color_vertices":quad.vertex_colors.size(),"finite_quad":finite_quad,"finite_uv":finite_uv,"uv_in_region":uv_in_region,"node_id":part.node.get_instance_id(),"draw_node_id":quad.get_instance_id(),"primitive_node":quad.has_method("get_draw_primitives") and not quad is Polygon2D})
	var stable := true
	var monotonic := true
	var previous: Dictionary = {}
	var samples: Array = []
	var target_checks: Array = []
	for progress in [0.0,.06,.12,.24,.30,.45,.53,.60,.66,.80,.91,.97,1.0]:
		if progress<1.0:
			building.construction={"total":100.0,"remaining":100.0*(1.0-progress)}
		else:
			building.erase("construction")
		renderer.sync_buildings([building],{})
		await flush_drawing()
		entry=renderer._entries[label]
		stable=stable and part_ids(entry)==ids
		var minimum := 1.0
		var maximum := 0.0
		var phases: Dictionary = {}
		for key: String in entry.parts:
			var part: Dictionary = entry.parts[key]
			var amount := float(part.installed)
			var phase := str(part.leaf.phase)
			verify(part.quad.visible==(amount>.0001),label+" image visibility does not match installation")
			if amount>.0001:
				verify(part.quad.is_visible_in_tree() and part.node.modulate.a>0 and part.quad.modulate.a>0,label+" installed component is hidden")
			for color: Color in part.quad.vertex_colors:
				verify(absf(color.r-amount)<.00001,label+" shader installation channel disagrees with the actual component")
			submitted_geometry(part.quad,label+"/"+str(part.leaf.id),amount)
			monotonic=monotonic and amount+0.00001>=float(previous.get(key,0))
			previous[key]=amount
			minimum=minf(minimum,amount)
			maximum=maxf(maximum,amount)
			if not phases.has(phase):
				phases[phase]={"minimum":1.0,"maximum":0.0}
			phases[phase].minimum=minf(phases[phase].minimum,amount)
			phases[phase].maximum=maxf(phases[phase].maximum,amount)
		samples.append({"progress":progress,"nodes":entry.parts.size(),"minimum":minimum,"maximum":maximum,"phases":phases})
		if progress<1.0:
			var last_scheduled := -1.0
			for target: Dictionary in renderer.construction_targets(label,-1,64):
				var scheduled := float(target.get("scheduled_at",-1))
				verify(scheduled>=last_scheduled-.00001,label+" crew targets are not in installation order")
				verify(absf(scheduled-float(schedule.get(str(target.leaf_id),[-2,0])[0]))<.00001,label+" crew target time differs from the actual component")
				last_scheduled=scheduled
				var found := false
				for leaf: Dictionary in leaves:
					if str(leaf.id)!=str(target.leaf_id):
						continue
					found=true
					verify(is_equal_approx(float(target.ground[0]),7.0+float(leaf.ground[0])) and is_equal_approx(float(target.ground[1]),9.0+float(leaf.ground[1])),label+" worker target must use the actual leaf ground anchor")
					verify(is_equal_approx(float(target.elevation),float(leaf.elevation)),label+" worker target must use the actual leaf elevation")
					break
				target_checks.append({"leaf_id":target.leaf_id,"real_leaf":found,"phase":target.phase,"progress":target.progress})
		else:
			verify(renderer.construction_targets(label).is_empty(),label+" completed building still exposes installation targets")
	var appearance: Array = []
	for part: Dictionary in entry.parts.values():
		var quad: Variant = part.quad
		var actual := submitted_geometry(quad,label+"/"+str(part.leaf.id),float(part.installed))
		var points: Array = []
		var uvs: Array = []
		var faces: Array = []
		var meta: Dictionary = renderer._manifest[str(part.asset)]
		for point: Variant in actual.points:
			if point==null:
				continue
			var at: Vector2=part.node.transform*(quad.transform*point)
			points.append([at.x,at.y])
		for normalized: Variant in actual.uv:
			if normalized==null:
				continue
			var uv: Vector2=normalized*quad.texture.get_size()
			uvs.append([(uv.x-float(meta.rect[0]))/float(meta.rect[2]),(uv.y-float(meta.rect[1]))/float(meta.rect[3])])
		for indices: Array in actual.faces:
			var face: Array = []
			for index: int in indices:
				face.append(index)
			faces.append(face)
		appearance.append({"leaf_id":str(part.leaf.id),"asset":part.asset,"polygon":points,"uvs":uvs,"faces":faces,"sort_y":float(part.sort_y),"node_y":float(part.node.position.y),"submitted_triangles":actual.commands,"draw_revision":quad.draw_revision})
	var preview: Node2D = renderer.create_preview(type,level)
	root.add_child(preview)
	await flush_drawing()
	var bounds: Rect2 = preview.get_meta("preview_bounds",Rect2())
	var preview_count := preview.get_child_count()
	verify(is_finite(bounds.position.x) and is_finite(bounds.position.y) and is_finite(bounds.size.x) and is_finite(bounds.size.y) and bounds.has_area(),label+" preview has invalid bounds")
	for child: Node2D in preview.get_children():
		var quad: Variant = child.get_child(0)
		var actual := submitted_geometry(quad,label+"/preview",1.0)
		for point: Variant in actual.points:
			if point==null:
				continue
			verify(bounds.grow(.01).has_point(child.transform*(quad.transform*point)),label+" preview clips a real component")
	preview.free()
	report.recipes.append({"type":type,"level":level,"size":size,"leaves":leaves,"schedule":schedule,"nodes":node_checks,"appearance":appearance,"identity_stable":stable,"installation_monotonic":monotonic,"samples":samples,"targets":target_checks,"preview_nodes":preview_count,"sort_cycles":renderer.inspect().sort_cycles})

func inspect_upgrade(type: String,from_level: int) -> void:
	var label := type+":upgrade:"+str(from_level)
	var building := {"id":label,"type":type,"lvl":from_level,"x":7,"y":9,"staffed":true,"pop":12}
	renderer.sync_buildings([building],{})
	await flush_drawing()
	var old_entry: Dictionary = renderer._entries[label]
	for part: Dictionary in old_entry.parts.values():
		submitted_geometry(part.quad,label+"/before/"+str(part.leaf.id),float(part.installed))
	var old_ids := part_ids(old_entry)
	var old_leaves: Dictionary = {}
	for key: String in old_entry.parts:
		old_leaves[key]=old_entry.parts[key].leaf
	building.construction={"total":100.0,"remaining":100.0,"fromLevel":from_level,"toLevel":from_level+1}
	renderer.sync_buildings([building],{})
	await flush_drawing()
	var entry: Dictionary = renderer._entries[label]
	for part: Dictionary in entry.parts.values():
		submitted_geometry(part.quad,label+"/start/"+str(part.leaf.id),float(part.installed))
	var target_keys: Dictionary = {}
	for leaf: Dictionary in recipes.create(type,from_level+1):
		target_keys[renderer_script._physical_key(leaf)]=true
	var retained := 0
	var retained_stable := true
	for key: String in old_ids:
		if target_keys.has(key):
			retained+=1
			retained_stable=retained_stable and entry.parts.has(key) and [entry.parts[key].node.get_instance_id(),entry.parts[key].quad.get_instance_id()]==old_ids[key] and is_equal_approx(float(entry.parts[key].installed),1.0)
	var target_ids: Dictionary = {}
	for key: String in target_keys:
		if entry.parts.has(key):
			target_ids[key]=[entry.parts[key].node.get_instance_id(),entry.parts[key].quad.get_instance_id()]
	var target_stable := target_ids.size()==target_keys.size()
	for progress in [.15,.45,.75,.99,1.0]:
		if progress<1.0:
			building.construction.remaining=100.0*(1.0-progress)
		else:
			building.lvl=from_level+1
			building.erase("construction")
		renderer.sync_buildings([building],{})
		await flush_drawing()
		entry=renderer._entries[label]
		for key: String in target_ids:
			target_stable=target_stable and entry.parts.has(key) and [entry.parts[key].node.get_instance_id(),entry.parts[key].quad.get_instance_id()]==target_ids[key]
		for part: Dictionary in entry.parts.values():
			submitted_geometry(part.quad,label+"/"+str(part.leaf.id),float(part.installed))
	var final_keys := part_ids(entry).keys()
	var expected_keys := target_keys.keys()
	final_keys.sort()
	expected_keys.sort()
	var finished_visible := true
	for part: Dictionary in entry.parts.values():
		finished_visible=finished_visible and float(part.installed)>=.99999 and part.quad.is_visible_in_tree()
	report.upgrades.append({"type":type,"from":from_level,"to":from_level+1,"retained":retained,"retained_stable":retained_stable,"target_stable":target_stable,"finished_matches_target":final_keys==expected_keys,"finished_visible":finished_visible})

func _run() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size()!=2:
		push_error("Expected catalog JSON and report JSON paths")
		quit(2)
		return
	var catalog: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(args[0]))
	renderer_script=load("res://world/buildings.gd")
	recipes=load("res://world/building_parts.gd")
	renderer=renderer_script.new()
	root.add_child(renderer)
	var manifest: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://art/components/manifest.json"))
	report["manifest"]=manifest
	report["material_keys"]=recipes.MATERIAL_KEYS
	report["recipe_sizes"]=recipes.SIZES
	report["phase_limits"]=renderer_script.PHASE_LIMITS
	inspect_assets(manifest)
	for item: Dictionary in catalog.buildings:
		for level in range(1,int(item.levels)+1):
			await inspect_recipe(str(item.type),level,int(item.size))
			await process_frame
	for type: String in ["house","villa"]:
		for level in range(1,int(recipes.MAX_LEVELS[type])):
			await inspect_upgrade(type,level)
			await process_frame
	report["missing_assets"]=renderer.inspect().missing_assets
	report["textures"]=renderer._textures.keys()
	report["image_only"]=renderer.inspect().image_only
	var file := FileAccess.open(args[1],FileAccess.WRITE)
	file.store_string(JSON.stringify(report))
	file.close()
	renderer.free()
	print("COMPONENT_REPORT "+str(report.recipes.size())+" recipes, "+str(report.assets.size())+" real image components")
	quit(0)
