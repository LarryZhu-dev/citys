extends RefCounted
## Original Godot architecture recipes. One plan unit equals one map tile.
## x/y is the rear-left corner of a rectangular footprint, not a sprite centre.
## z is the base elevation; h is structural height excluding the roof rise.
## phase: 0 foundation, 1 supports, 2 enclosure, 3 framing, 4 roof/equipment, 5 fittings.
## phase never determines draw order. Project and sort the modules in world space.
## style and roof_style use the proposed generated art keys; variant is functional detail.
## A lower storey has roof=false when another storey occupies its roof.
## Upgrades replace dictionaries with matching ids: roof flags/materials may change.

const SIZES: Dictionary = {
	"house": 1, "villa": 2, "well": 1, "watch": 1, "police": 1,
	"clinic": 1, "repair": 1, "temple": 1, "school": 1, "theater": 1,
	"grainShop": 1, "vegShop": 1, "fruitShop": 1, "fishShop": 1, "meatShop": 1,
	"farmland": 2, "vegFarm": 2, "orchard": 2, "fishing": 1, "pasture": 2,
	"lumber": 2, "quarry": 2, "clayPit": 2, "kiln": 2, "pottery": 2,
	"mill": 2, "weaver": 2, "winery": 2, "granary": 2, "warehouse": 2,
	"treeDeco": 1, "garden": 2, "monument": 1, "barracks": 2, "university": 2,
	"bath": 2, "observatory": 2, "harbor": 2, "market": 2, "copperMine": 2,
	"pagoda": 2, "wonder": 3,
}
const MAX_LEVELS: Dictionary = {"house": 10, "villa": 6}
const MATERIAL_KEYS: Array[String] = [
	"gray_roof", "red_roof", "awning_roof", "pagoda_roof", "plaster_wing",
	"red_wing", "shop_wing", "workshop_wing", "gate", "kiln", "warehouse", "courtwall",
	"colonnade", "eave_ring", "stone_terrace", "market_counter",
]
const MODULE_KINDS: Array[String] = [
	"wing", "gate", "wall", "tree", "pond", "crop", "pen", "kiln", "chimney",
	"stock", "boat", "crane", "well", "tower", "monument", "pavilion", "workbench", "loom", "mill",
]

static func size_of(building_type: String) -> int:
	return int(SIZES.get(building_type, 0))

static func create(building_type: String, requested_level: int = 1) -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	if not SIZES.has(building_type):
		return out
	var level: int = clampi(requested_level, 1, int(MAX_LEVELS.get(building_type, 1)))
	match building_type:
		"house":
			_house(out, level)
		"villa":
			_villa(out, level)
		"well":
			_prop(out, "well", "well-rim", .25, .28, .50, .46, .04, .20, "courtwall", "water_well", 0)
			_hall(out, "well-canopy", .16, .17, .68, .66, .06, .48, "red_wing", "gray_roof", true, "pavilion")
			_prop(out, "workbench", "windlass", .32, .32, .36, .10, .30, .13, "workshop_wing", "windlass", 4)
			_prop(out, "stock", "water-buckets", .69, .77, .19, .17, .03, .17, "workshop_wing", "water_buckets")
		"watch":
			_hall(out, "tower-base", .16, .16, .68, .68, .05, .85, "plaster_wing", "gray_roof", false, "tower")
			_hall(out, "watch-deck", .12, .12, .76, .76, .90, .38, "red_wing", "red_roof", true, "pavilion")
			_prop(out, "monument", "signal-bell", .40, .69, .20, .14, .99, .24, "red_wing", "signal_bell")
		"police":
			_compound(out, "precinct", 1.0, .32)
			_hall(out, "constable-office", .09, .09, .82, .56, .06, .46, "red_wing")
			_prop(out, "stock", "weapon-rack", .10, .72, .29, .16, .03, .30, "workshop_wing", "weapons")
			_prop(out, "monument", "alarm-drum", .67, .73, .22, .18, .03, .25, "red_wing", "alarm_drum")
		"clinic":
			_hall(out, "dispensary", .06, .07, .88, .55, .05, .45, "shop_wing")
			_hall(out, "consultation-porch", .08, .65, .43, .25, .04, .28, "plaster_wing", "awning_roof", true, "pavilion")
			_prop(out, "crop", "medicinal-herbs", .58, .67, .31, .26, .025, .17, "", "herbs", 4)
			_prop(out, "workbench", "medicine-mortar", .15, .77, .25, .12, .04, .16, "workshop_wing", "mortar")
		"repair":
			_hall(out, "carpenter-shed", .07, .06, .86, .53, .05, .47, "workshop_wing")
			_prop(out, "workbench", "joinery-bench", .12, .68, .44, .22, .03, .24, "workshop_wing", "joinery", 4)
			_prop(out, "stock", "repair-timber", .64, .66, .28, .25, .03, .22, "workshop_wing", "timber")
		"temple":
			_hall(out, "sanctuary", .06, .07, .88, .67, .16, .61, "red_wing", "red_roof")
			_steps(out, "temple-steps", .30, .75, .40, .18, .15)
			_prop(out, "monument", "incense-vessel", .40, .80, .20, .15, .05, .23, "red_wing", "censer")
			_prop(out, "monument", "left-lion", .08, .79, .16, .17, .02, .22, "courtwall", "lion")
			_prop(out, "monument", "right-lion", .76, .79, .16, .17, .02, .22, "courtwall", "lion")
		"school":
			_hall(out, "schoolroom", .06, .06, .88, .58, .05, .46, "plaster_wing")
			_hall(out, "reading-veranda", .08, .65, .55, .25, .04, .31, "red_wing", "gray_roof", true, "pavilion")
			_prop(out, "workbench", "scholar-desks", .16, .72, .36, .15, .05, .19, "workshop_wing", "desks")
			_prop(out, "tree", "school-bamboo", .75, .72, .18, .20, .02, .65, "", "bamboo")
		"theater":
			_hall(out, "stage", .05, .09, .90, .66, .17, .63, "red_wing", "red_roof", true, "pavilion")
			_prop(out, "wall", "stage-backdrop", .12, .14, .76, .025, .20, .51, "red_wing", "theater_backdrop", 3)
			_steps(out, "stage-steps", .34, .76, .32, .18, .16)
			_prop(out, "monument", "stage-drum", .12, .57, .17, .16, .19, .25, "red_wing", "drum")
		"grainShop", "vegShop", "fruitShop", "fishShop", "meatShop":
			_shop(out, building_type)
		"market":
			_hall(out, "market-hall", .10, .08, 1.80, .53, .05, .55, "shop_wing", "red_roof")
			var goods: Array[String] = ["vegetables", "grain", "fruit", "fish"]
			for row in range(2):
				for col in range(2):
					var px: float = .12 + col * 1.06
					var py: float = .79 + row * .56
					var sid: String = "stall-%d-%d" % [row, col]
					_hall(out, sid, px, py, .68, .39, .04, .35, "shop_wing", "awning_roof", true, "pavilion")
					_prop(out, "stock", sid + "-goods", px + .06, py + .26, .54, .12, .05, .20, "shop_wing", goods[row * 2 + col])
			_prop(out, "monument", "market-sign", .92, 1.61, .16, .24, .04, .70, "shop_wing", "banner")
		"farmland", "vegFarm":
			_compound(out, "field-fence", 2.0, .42, .13, "wood_fence")
			_hall(out, "tool-hut", .10, .10, .55, .35, .035, .29, "workshop_wing")
			_prop(out, "well", "irrigation-well", 1.48, .14, .30, .28, .02, .16, "courtwall", "irrigation", 0)
			for row in range(5):
				for col in range(3):
					_prop(out, "crop", "crop-%d-%d" % [row, col], .13 + col * .59, .54 + row * .275, .53, .20, .015, .27 if building_type == "farmland" else .16, "", "grain" if building_type == "farmland" else "vegetables", 4)
		"orchard":
			_compound(out, "orchard-fence", 2.0, .42, .13, "wood_fence")
			_hall(out, "fruit-shed", .09, .09, .60, .36, .035, .28, "workshop_wing")
			for row in range(3):
				for col in range(3):
					_prop(out, "tree", "fruit-tree-%d-%d" % [row, col], .14 + col * .60, .56 + row * .44, .46, .34, .02, .72, "", "fruit_tree", 4)
			_prop(out, "stock", "fruit-baskets", 1.42, .15, .39, .24, .03, .18, "workshop_wing", "fruit")
		"pasture":
			_compound(out, "pasture-fence", 2.0, .45, .20, "wood_fence")
			_hall(out, "cattle-barn", .10, .09, 1.10, .54, .04, .43, "workshop_wing")
			_prop(out, "pen", "grazing-cattle", .18, .81, 1.56, .90, .015, .44, "", "cattle", 4)
			_prop(out, "stock", "hay-stack", 1.35, .15, .44, .40, .03, .41, "workshop_wing", "hay")
			_prop(out, "pond", "water-trough", .28, 1.74, .90, .13, .02, .12, "courtwall", "trough", 0)
		"fishing", "harbor":
			_dock(out, building_type == "harbor")
		"lumber":
			_hall(out, "saw-shed", .08, .10, 1.05, .60, .04, .48, "workshop_wing")
			_prop(out, "workbench", "saw-pit", .15, .86, .80, .46, .025, .28, "workshop_wing", "saw", 4)
			_prop(out, "stock", "timber-yard", .21, 1.49, 1.04, .34, .025, .27, "workshop_wing", "logs")
			_prop(out, "tree", "standing-pine", 1.28, .15, .55, .55, .02, 1.05, "", "pine", 1)
			_prop(out, "stock", "cut-stumps", 1.37, 1.02, .40, .49, .02, .18, "workshop_wing", "stumps")
		"quarry", "clayPit", "copperMine":
			_mine(out, building_type)
		"kiln":
			_hall(out, "brick-drying-shed", .08, .09, .78, .61, .04, .43, "workshop_wing")
			_prop(out, "kiln", "brick-kiln", 1.02, .18, .76, .77, .04, .75, "kiln", "brick_kiln", 2)
			_prop(out, "chimney", "kiln-chimney", 1.57, .15, .20, .23, .04, 1.08, "kiln", "brick_chimney", 3)
			_prop(out, "stock", "green-bricks", .13, .92, .68, .34, .02, .23, "workshop_wing", "green_bricks")
			_prop(out, "stock", "fired-bricks", .13, 1.48, .79, .33, .02, .32, "workshop_wing", "bricks")
			_prop(out, "stock", "fuel-stack", 1.16, 1.36, .61, .39, .02, .23, "workshop_wing", "firewood")
		"pottery":
			_hall(out, "potter-workshop", .08, .09, 1.13, .67, .05, .50, "workshop_wing")
			_prop(out, "kiln", "pottery-kiln", 1.36, .16, .49, .64, .04, .66, "kiln", "pottery_kiln", 2)
			_prop(out, "mill", "potters-wheel", .24, .91, .40, .38, .04, .26, "workshop_wing", "potters_wheel", 4)
			_prop(out, "workbench", "forming-table", .83, .96, .61, .29, .04, .30, "workshop_wing", "pottery_forming")
			_prop(out, "stock", "drying-pots", .20, 1.49, 1.41, .32, .03, .25, "workshop_wing", "ceramic_jars")
		"mill":
			_hall(out, "mill-house", .08, .09, 1.21, .78, .06, .60, "workshop_wing")
			_prop(out, "mill", "grindstone", 1.36, .35, .49, .49, .04, .34, "courtwall", "grain_mill", 4)
			_prop(out, "stock", "grain-sacks", .15, 1.09, .67, .37, .03, .27, "warehouse", "grain_sacks")
			_prop(out, "stock", "flour-sacks", .99, 1.15, .69, .44, .03, .25, "warehouse", "flour_sacks")
			_prop(out, "workbench", "sifting-table", .25, 1.68, .81, .21, .03, .24, "workshop_wing", "flour_sieve")
		"weaver":
			_hall(out, "weaving-room", .08, .09, 1.78, .61, .05, .51, "workshop_wing")
			_hall(out, "loom-porch", .09, .81, .88, .68, .04, .46, "workshop_wing", "awning_roof", true, "pavilion")
			_prop(out, "loom", "working-loom", .23, .95, .58, .42, .05, .39, "workshop_wing", "loom", 4)
			_prop(out, "workbench", "cloth-drying-rack", 1.12, .94, .69, .35, .03, .63, "workshop_wing", "cloth_rack", 4)
			_prop(out, "stock", "dyed-cloth", .31, 1.66, .65, .19, .03, .18, "warehouse", "cloth")
		"winery":
			_hall(out, "wine-house", .08, .09, 1.70, .65, .05, .52, "workshop_wing")
			_prop(out, "workbench", "grape-press", 1.17, .94, .62, .50, .04, .69, "workshop_wing", "grape_press", 4)
			for row in range(2):
				for col in range(3):
					_prop(out, "stock", "wine-vat-%d-%d" % [row, col], .14 + col * .29, .96 + row * .52, .23, .30, .025, .35, "workshop_wing", "wine_vat")
			_prop(out, "crop", "grape-vines", 1.23, 1.61, .55, .22, .03, .24, "", "grapes", 4)
		"granary":
			for col in range(2):
				var bin_x: float = .11 + col * .97
				_hall(out, "grain-bin-%d" % col, bin_x, .12, .80, 1.37, .24, .60, "warehouse")
				_prop(out, "wall", "grain-bin-%d-stilts" % col, bin_x + .07, .22, .66, 1.14, .03, .21, "courtwall", "open_stilts", 1)
			_prop(out, "stock", "loading-grain", .24, 1.64, .65, .22, .03, .25, "warehouse", "grain_sacks")
			_steps(out, "granary-steps", 1.20, 1.50, .47, .32, .23)
		"warehouse":
			_hall(out, "warehouse-main", .08, .09, 1.84, .91, .06, .64, "warehouse")
			_hall(out, "loading-awning", .12, 1.05, 1.18, .43, .05, .38, "workshop_wing", "awning_roof", true, "pavilion")
			_prop(out, "stock", "packed-crates", .15, 1.58, .75, .28, .03, .32, "warehouse", "crates")
			_prop(out, "stock", "barrels", 1.43, 1.16, .40, .40, .03, .34, "warehouse", "barrels")
			_prop(out, "workbench", "handcart", 1.15, 1.69, .64, .19, .03, .24, "workshop_wing", "handcart")
		"treeDeco":
			_prop(out, "tree", "ornamental-tree", .12, .12, .76, .76, .025, 1.22, "", "pine", 4)
		"garden":
			_compound(out, "garden", 2.0, .44, .24)
			_hall(out, "garden-pavilion", .18, .17, .73, .65, .06, .55, "red_wing", "gray_roof", true, "pavilion")
			_prop(out, "pond", "garden-pond", .89, .94, .88, .65, .01, .025, "", "lily_pond", 0)
			_prop(out, "tree", "garden-pine", 1.32, .18, .47, .49, .02, .99, "", "pine")
			_prop(out, "tree", "garden-bamboo", .15, 1.08, .31, .42, .02, .80, "", "bamboo")
			_prop(out, "workbench", "garden-bridge", .76, 1.14, .31, .54, .07, .08, "workshop_wing", "footbridge", 4)
			_prop(out, "monument", "scholar-rock", .45, 1.61, .25, .25, .025, .32, "courtwall", "scholar_rock")
		"monument":
			_prop(out, "monument", "stele-base", .15, .18, .70, .61, .03, .13, "courtwall", "plinth", 0)
			_prop(out, "monument", "inscribed-stele", .37, .34, .26, .25, .16, .78, "courtwall", "inscribed_stele", 2)
			_steps(out, "stele-steps", .28, .80, .44, .14, .12)
		"barracks":
			_compound(out, "garrison", 2.0, .50, .30)
			_hall(out, "command-hall", .14, .12, 1.70, .61, .06, .56, "red_wing", "red_roof")
			_hall(out, "soldiers-bunks", .14, .87, .49, .90, .05, .43, "plaster_wing")
			_prop(out, "workbench", "weapons-rack", 1.47, .97, .30, .53, .03, .51, "workshop_wing", "weapons", 4)
			_prop(out, "monument", "training-dummy", .88, 1.06, .29, .26, .025, .48, "workshop_wing", "training_dummy")
			_prop(out, "monument", "garrison-banner", 1.57, 1.64, .19, .20, .03, .91, "red_wing", "banner")
		"university":
			_compound(out, "academy", 2.0, .48, .26)
			_hall(out, "lecture-hall", .13, .11, 1.74, .62, .07, .63, "red_wing", "red_roof")
			_hall(out, "west-library", .12, .82, .42, .91, .06, .48, "plaster_wing")
			_hall(out, "east-library", 1.46, .82, .42, .91, .06, .48, "plaster_wing")
			_hall(out, "academy-gate", .68, 1.66, .64, .25, .045, .43, "gate", "gray_roof", true, "gate")
			_prop(out, "tree", "scholar-pine", .70, 1.00, .32, .35, .02, .72, "", "pine")
			_prop(out, "monument", "academy-tablet", 1.16, 1.28, .17, .22, .025, .38, "courtwall", "inscribed_stele")
		"bath":
			_compound(out, "bathhouse", 2.0, .46, .29)
			_hall(out, "heated-bath-hall", .12, .11, 1.75, .74, .06, .53, "plaster_wing")
			_hall(out, "changing-room", .12, .98, .46, .77, .045, .40, "plaster_wing")
			_prop(out, "pond", "warm-pool", .77, 1.06, .93, .61, .025, .13, "courtwall", "steaming_pool", 4)
			_prop(out, "chimney", "bath-furnace-flue", 1.68, .22, .14, .17, .06, .82, "kiln", "bath_furnace", 3)
		"observatory":
			_prop(out, "monument", "observatory-platform", .29, .30, 1.43, 1.36, .04, .58, "courtwall", "platform", 0)
			_steps(out, "observatory-stairs", .79, 1.67, .43, .26, .57)
			_prop(out, "monument", "armillary-sphere", .73, .69, .56, .55, .62, .80, "red_wing", "armillary", 4)
			_hall(out, "astronomer-study", .08, .10, .52, .43, .04, .36, "plaster_wing")
			_wall(out, "platform-front-balustrade-left", .32, 1.59, .40, .035, .22, .62)
			_wall(out, "platform-front-balustrade-right", 1.29, 1.59, .40, .035, .22, .62)
		"pagoda":
			_pagoda(out)
		"wonder":
			_palace(out)
	return out

static func _house(out: Array[Dictionary], level: int) -> void:
	# Dense street frontage: 0.80 x 0.80 principal body, entry in the final 0.15 tile.
	var main: Dictionary = _hall(out, "main", .10, .045, .80, .80, .055, .40, "plaster_wing", "gray_roof", level < 6)
	main["eave_skirt"] = level >= 6
	_steps(out, "street-steps", .33, .85, .34, .13, .055)
	if level >= 2:
		_hall(out, "entry-porch", .30, .85, .40, .12, .035, .29 if level >= 8 else .20, "gate" if level >= 8 else "plaster_wing", "red_roof" if level >= 8 else "awning_roof", true, "gate")
	if level >= 3:
		_prop(out, "chimney", "kitchen-flue", .08, .12, .09, .12, .055, .64, "kiln", "domestic_flue", 3)
	if level >= 4:
		_wall(out, "street-wall-left", .025, .945, .23, .03, .16)
		_wall(out, "street-wall-right", .745, .945, .23, .03, .16)
		_wall(out, "side-wall", .025, .12, .025, .72, .17)
	if level >= 5:
		_prop(out, "stock", "courtyard-planter", .77, .86, .16, .07, .03, .17, "courtwall", "flower_planter")
		_prop(out, "monument", "door-lantern", .27, .89, .045, .045, .24, .11, "red_wing", "lantern")
	if level >= 6:
		var upper: Dictionary = _hall(out, "upper-main", .18, .11, .64, .56, .455, .35, "red_wing", "gray_roof", level < 10)
		upper["eave_skirt"] = level >= 10
	if level >= 7:
		_hall(out, "upper-balcony", .20, .69, .60, .16, .455, .16, "red_wing", "gray_roof", false, "pavilion")
	if level >= 9:
		_hall(out, "east-upper-study", .83, .22, .14, .46, .455, .30, "red_wing", "gray_roof")
	if level >= 10:
		_hall(out, "roof-pavilion", .33, .22, .34, .30, .805, .27, "red_wing", "pagoda_roof", true, "pavilion")

static func _villa(out: Array[Dictionary], level: int) -> void:
	# Every level has a genuine four-sided compound, not a lonely hall on a plinth.
	_compound(out, "compound", 2.0, .46, .25)
	var main: Dictionary = _hall(out, "main-hall", .16, .10, 1.68, .61, .07, .53, "red_wing", "gray_roof", level < 4)
	main["eave_skirt"] = level >= 4
	_hall(out, "west-wing", .12, .77, .40, .83, .07, .41, "plaster_wing", "gray_roof", level < 5)
	_hall(out, "east-wing", 1.48, .77, .40, .83, .07, .41, "plaster_wing", "gray_roof", level < 5)
	_hall(out, "entrance-hall", .58, 1.65, .84, .25, .045, .35, "gate", "gray_roof", true, "gate")
	_steps(out, "main-steps", .79, .72, .42, .15, .07)
	if level >= 2:
		_prop(out, "pond", "lotus-pond", 1.11, 1.04, .26, .30, .015, .025, "", "lily_pond", 0)
		_prop(out, "tree", "court-pine", .66, .91, .27, .30, .025, .69, "", "pine")
	if level >= 3:
		_hall(out, "inner-front-gallery", .58, 1.39, .84, .18, .045, .28, "red_wing", "gray_roof", true, "pavilion")
		_prop(out, "monument", "court-lantern", 1.33, .85, .075, .075, .06, .33, "red_wing", "lantern")
	if level >= 4:
		var upper: Dictionary = _hall(out, "upper-residence", .28, .16, 1.44, .49, .60, .42, "red_wing", "red_roof", level < 6)
		upper["eave_skirt"] = level >= 6
	if level >= 5:
		_hall(out, "west-upper-study", .14, .79, .36, .77, .48, .34, "red_wing", "gray_roof")
		_hall(out, "east-upper-library", 1.50, .79, .36, .77, .48, .34, "red_wing", "gray_roof")
	if level >= 6:
		_hall(out, "belvedere", .64, .25, .72, .31, 1.02, .31, "red_wing", "pagoda_roof", true, "pavilion")

static func _shop(out: Array[Dictionary], building_type: String) -> void:
	var variants: Dictionary = {"grainShop": "grain", "vegShop": "vegetables", "fruitShop": "fruit", "fishShop": "fish", "meatShop": "meat"}
	var goods: String = String(variants[building_type])
	var wing: Dictionary = _hall(out, "shop-house", .055, .055, .89, .58, .05, .43, "shop_wing")
	wing["variant"] = goods + "_shop"
	_hall(out, "sales-awning", .065, .65, .87, .28, .025, .30, "shop_wing", "awning_roof", true, "pavilion")
	_prop(out, "stock", "goods-counter", .12, .78, .74, .15, .04, .20, "shop_wing", goods)
	if building_type == "fishShop":
		_prop(out, "pond", "live-fish-tub", .72, .68, .17, .15, .025, .17, "courtwall", "fish_tub")
	elif building_type == "meatShop":
		_prop(out, "workbench", "hanging-meat", .15, .68, .23, .10, .06, .39, "workshop_wing", "hanging_meat")

static func _dock(out: Array[Dictionary], large: bool) -> void:
	var s: float = 2.0 if large else 1.0
	_hall(out, "dock-office", .06 * s, .07 * s, .53 * s, .38 * s, .06, .50 if large else .36, "warehouse" if large else "workshop_wing")
	_prop(out, "workbench", "timber-jetty", .11 * s, .50 * s, .68 * s, .13 * s, .03, .07, "workshop_wing", "jetty", 0)
	_prop(out, "boat", "moored-boat", .18 * s, .71 * s, .66 * s, .21 * s, .005, .35 if large else .23, "workshop_wing", "cargo_boat" if large else "fishing_boat", 4)
	_prop(out, "stock", "dock-cargo", .66 * s, .12 * s, .25 * s, .23 * s, .03, .31 if large else .21, "warehouse", "crates" if large else "fish_baskets")
	if large:
		_prop(out, "crane", "harbor-crane", 1.43, .92, .35, .34, .04, 1.04, "workshop_wing", "cargo_crane", 3)
	else:
		_prop(out, "workbench", "drying-nets", .67, .42, .23, .18, .03, .39, "workshop_wing", "fishing_nets", 4)

static func _mine(out: Array[Dictionary], building_type: String) -> void:
	var raw: String = "clay" if building_type == "clayPit" else "copper_ore" if building_type == "copperMine" else "stone"
	_hall(out, "mine-shelter", .09, .10, .66, .45, .04, .36, "workshop_wing")
	_prop(out, "pond", "excavation", .85, .13, .99, .84, .005, .015, "", raw + "_pit", 0)
	_prop(out, "crane", "extraction-frame", 1.15, .38, .47, .43, .03, .82 if building_type == "copperMine" else .65, "workshop_wing", "ore_hoist" if building_type == "copperMine" else "quarry_derrick", 3)
	_prop(out, "stock", "raw-stock", .16, .80, .57, .47, .02, .33, "courtwall", raw)
	_prop(out, "stock", "sorted-stock", .22, 1.48, 1.04, .32, .02, .29, "courtwall", raw + "_blocks")
	_prop(out, "workbench", "sorting-bench", 1.42, 1.33, .39, .43, .03, .26, "workshop_wing", "ore_sorting" if building_type == "copperMine" else "stone_cutting" if building_type == "quarry" else "clay_mixing", 4)

static func _pagoda(out: Array[Dictionary]) -> void:
	_prop(out, "monument", "pagoda-dais", .36, .35, 1.28, 1.28, .035, .17, "courtwall", "plinth", 0)
	_steps(out, "pagoda-steps", .78, 1.65, .44, .25, .17)
	# Terraces between the storeys are open skirts. No complete roof beneath a floor.
	for floor_index in range(7):
		var span: float = 1.02 - floor_index * .085
		var base: float = .205 + floor_index * .45
		var tier: Dictionary = _hall(out, "pagoda-tier-%d" % floor_index, 1.0 - span / 2.0, .96 - span / 2.0, span, span, base, .45, "red_wing", "pagoda_roof", floor_index == 6, "tower")
		tier["eave_skirt"] = floor_index < 6
		tier["skirt_opening"] = maxf(.18, span - .085)
		tier["skirt_depth"] = .07
		# Integrator: eave_skirt is a ring split into front/side/back pieces; never a solid cap.
	_prop(out, "monument", "pagoda-spire", .93, .89, .14, .14, 3.5182, .57, "red_wing", "spire")

static func _palace(out: Array[Dictionary]) -> void:
	_compound(out, "palace", 3.0, .78, .34)
	_prop(out, "monument", "palace-platform", .35, .23, 2.30, 1.28, .035, .30, "courtwall", "platform", 0)
	var main: Dictionary = _hall(out, "great-hall", .46, .32, 2.08, 1.03, .335, .75, "red_wing", "red_roof", false)
	main["eave_skirt"] = true
	_hall(out, "upper-great-hall", .64, .43, 1.72, .78, 1.085, .51, "red_wing", "pagoda_roof")
	_hall(out, "west-corridor", .15, 1.59, .45, 1.15, .07, .49, "red_wing", "gray_roof", true, "pavilion")
	_hall(out, "east-corridor", 2.40, 1.59, .45, 1.15, .07, .49, "red_wing", "gray_roof", true, "pavilion")
	_hall(out, "meridian-gate", .95, 2.51, 1.10, .33, .07, .62, "gate", "red_roof", true, "gate")
	_steps(out, "great-hall-stairs", 1.15, 1.52, .70, .41, .30)
	_prop(out, "monument", "palace-censer", 1.33, 2.08, .34, .30, .04, .37, "red_wing", "censer")
	_prop(out, "tree", "palace-pine-west", .72, 1.72, .39, .40, .03, .97, "", "pine")
	_prop(out, "tree", "palace-pine-east", 1.89, 1.72, .39, .40, .03, .97, "", "pine")
	_prop(out, "monument", "palace-lion-west", .70, 2.58, .20, .22, .04, .33, "courtwall", "lion")
	_prop(out, "monument", "palace-lion-east", 2.10, 2.58, .20, .22, .04, .33, "courtwall", "lion")

static func _part(kind: String, id: String, x: float, y: float, w: float, d: float, z: float, h: float, style: String, phase: int) -> Dictionary:
	return {"kind": kind, "id": id, "x": x, "y": y, "w": w, "d": d, "z": z, "h": h, "style": style, "phase": phase, "roof": false}

static func _hall(out: Array[Dictionary], id: String, x: float, y: float, w: float, d: float, z: float, h: float, style: String = "plaster_wing", roof_style: String = "gray_roof", roof: bool = true, kind: String = "wing") -> Dictionary:
	var part: Dictionary = _part(kind, id, x, y, w, d, z, h, style, 2)
	part.merge({"roof": roof, "roof_style": roof_style, "roof_phase": 4, "roof_rise": minf(.28, maxf(.10, d * .32)), "eave": .025, "open": kind == "pavilion" or kind == "gate"}, true)
	out.append(part)
	return part

static func _prop(out: Array[Dictionary], kind: String, id: String, x: float, y: float, w: float, d: float, z: float, h: float, style: String = "", variant: String = "", phase: int = 5) -> Dictionary:
	var part: Dictionary = _part(kind, id, x, y, w, d, z, h, style, phase)
	part["variant"] = variant
	out.append(part)
	return part

static func _steps(out: Array[Dictionary], id: String, x: float, y: float, w: float, d: float, height: float) -> void:
	# A gate-kind entry apron with roof=false and variant=steps; no invented module kind.
	var part: Dictionary = _prop(out, "gate", id, x, y, w, d, .01, height, "courtwall", "steps", 0)
	part["steps"] = 3

static func _wall(out: Array[Dictionary], id: String, x: float, y: float, w: float, d: float, h: float = .23, z: float = .025, variant: String = "compound_wall") -> void:
	# Split long walls so their near end cannot paint over an entire rear pavilion.
	var segments: int = maxi(1, ceili(maxf(w, d) / .38))
	for index in range(segments):
		var along_x: bool = w >= d
		var sw: float = w / segments if along_x else w
		var sd: float = d if along_x else d / segments
		_prop(out, "wall", id + "-%d" % index, x + sw * index if along_x else x, y if along_x else y + sd * index, sw, sd, z, h, "courtwall", variant, 2)

static func _compound(out: Array[Dictionary], id: String, size: float, gate_width: float, height: float = .23, variant: String = "compound_wall") -> void:
	var inset: float = .035
	var thickness: float = .035
	var length: float = size - inset * 2.0
	var half_front: float = (length - gate_width) / 2.0
	_wall(out, id + "-back", inset, inset, length, thickness, height, .025, variant)
	_wall(out, id + "-west", inset, inset + thickness, thickness, length - thickness, height, .025, variant)
	_wall(out, id + "-east", size - inset - thickness, inset + thickness, thickness, length - thickness, height, .025, variant)
	_wall(out, id + "-front-left", inset, size - inset - thickness, half_front, thickness, height, .025, variant)
	_wall(out, id + "-front-right", size / 2.0 + gate_width / 2.0, size - inset - thickness, half_front, thickness, height, .025, variant)
