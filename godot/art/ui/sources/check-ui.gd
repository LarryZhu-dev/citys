extends SceneTree

func _initialize() -> void:
	var manifest: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://art/ui/manifest.json"))
	var textures: Dictionary = {}
	for group in manifest.atlases:
		var info: Dictionary = manifest.atlases[group]
		var texture: Texture2D = load(info.path) as Texture2D
		assert(texture != null, str(group))
		assert(texture.get_width() == 1536 and texture.get_height() == 1536, str(group))
		textures[group] = texture
	var count := 0
	for key in manifest.regions:
		var info: Dictionary = manifest.regions[key]
		var r: Array = info.rect
		var sprite := AtlasTexture.new()
		sprite.atlas = textures[info.atlas]
		sprite.region = Rect2(r[0], r[1], r[2], r[3])
		assert(sprite.get_width() == 384 and sprite.get_height() == 384, str(key))
		count += 1
	assert(count == 48)
	var panel_count := 0
	for key in manifest.get("panels", {}):
		var info: Dictionary = manifest.panels[key]
		var texture: Texture2D = load(info.path) as Texture2D
		assert(texture != null and texture.get_width() == 512 and texture.get_height() == 512, str(key))
		var style := StyleBoxTexture.new()
		style.texture = texture
		style.texture_margin_left = info.slice_margins[0]
		style.texture_margin_top = info.slice_margins[1]
		style.texture_margin_right = info.slice_margins[2]
		style.texture_margin_bottom = info.slice_margins[3]
		panel_count += 1
	assert(panel_count == 4)
	print("UI_ART_VALIDATED: 3 RGBA atlases, 48 AtlasTexture regions, 4 512x512 nine-patch panels")
	quit(0)
