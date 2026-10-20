extends RefCounted
## Image-only recipes: every emitted dictionary is one freshly painted leaf image.
## Plan units are tiles (128×64); elevation units are 64 screen pixels.
## ground is the actual footprint centre, never raised for an upper-storey image.
## extent = [plan width, plan depth, physical height]. No complete room/roof sprites.
## Stable IDs identify installed pieces across upgrades; phase does not set draw depth.

const SIZES:Dictionary={"house":1,"villa":2,"well":1,"watch":1,"police":1,"clinic":1,"repair":1,"temple":1,"school":1,"theater":1,"grainShop":1,"vegShop":1,"fruitShop":1,"fishShop":1,"meatShop":1,"farmland":2,"vegFarm":2,"orchard":2,"fishing":1,"pasture":2,"lumber":2,"quarry":2,"clayPit":2,"kiln":2,"pottery":2,"mill":2,"weaver":2,"winery":2,"granary":2,"warehouse":2,"treeDeco":1,"garden":2,"monument":1,"barracks":2,"university":2,"bath":2,"observatory":2,"harbor":2,"market":2,"copperMine":2,"pagoda":2,"wonder":3}
const MAX_LEVELS:Dictionary={"house":10,"villa":6}
const MATERIAL_KEYS:Array[String]=["stone_block","stone_step","post_wood","post_red","beam_wood","beam_painted","wall_earth","wall_plaster","wall_timber","wall_brick","brace_wood","dougong","door_wood","door_red","window_lattice","window_paper","railing","lantern","tiles_gray","tiles_green","tiles_glazed","thatch_course","eave_gray","eave_gold","ridge_gray","ridge_gold","ridge_beast","rafter","fabric_canvas","fabric_awning","sack","crate","barrel","timber_stack","bucket","wheel","kiln_masonry_nw","kiln_masonry_ne","kiln_masonry_sw","kiln_masonry_se","furnace_mouth","chimney_course","pottery_vessel","loom_frame","workbench","rice_seedling","rice_ripe","vegetable_patch","fruit_branch","well_stone_nw","well_stone_ne","well_stone_sw","well_stone_se","water_surface","gong","drum","banner","lion","incense_burner","rope","cattle","sheep","fish","meat","vegetable_basket","fruit_basket","millstone","armillary_ring_vertical","armillary_ring_horizontal","tree_trunk"]
const MODULE_KINDS:Array[String]=["leaf"]
const STAGE_NAMES:Array[String]=["基础砌块","柱梁承重","墙段门窗","屋面椽条","瓦排与屋脊","设备与陈设"]

static func size_of(building_type:String) -> int:
	return int(SIZES.get(building_type,0))

static func create(building_type:String,requested_level:int=1) -> Array[Dictionary]:
	var out:Array[Dictionary]=[]
	if not SIZES.has(building_type):return out
	var level:=clampi(requested_level,1,int(MAX_LEVELS.get(building_type,1)))
	match building_type:
		"house":_house(out,level)
		"villa":_villa(out,level)
		_:_civic(out,building_type)
	var per_phase:Array[int]=[0,0,0,0,0,0]
	for leaf:Dictionary in out:
		var phase:int=int(leaf.phase)
		leaf["build_order"]=phase*10000+per_phase[phase]
		leaf["phase_order"]=per_phase[phase]
		leaf["stage_name"]=STAGE_NAMES[phase]
		leaf["building_type"]=building_type
		leaf["building_level"]=level
		per_phase[phase]+=1
	return out

static func _leaf(out:Array[Dictionary],id:String,asset:String,x:float,y:float,w:float,d:float,z:float,h:float,face:String,phase:int,role:String="",layer:int=0) -> Dictionary:
	var leaf:Dictionary={"kind":"leaf","id":id,"asset":asset,"ground":[x+w*.5,y+d*.5],"extent":[w,d,h],"elevation":z,"face":face,"phase":phase,"role":role if not role.is_empty() else asset,"layer":layer,"stand_elevation":0.0}
	out.append(leaf)
	return leaf

static func _block_course(out:Array[Dictionary],id:String,r:Rect2,z:float,height:float=.065) -> void:
	var nx:=maxi(1,ceili(r.size.x/.28))
	var ny:=maxi(1,ceili(r.size.y/.28))
	for iy in range(ny):
		for ix in range(nx):
			_leaf(out,"%s/block/%d/%d"%[id,iy,ix],"stone_block",r.position.x+r.size.x*ix/nx,r.position.y+r.size.y*iy/ny,r.size.x/nx,r.size.y/ny,z,height,"prop",0,"stone",0)

static func _stairs(out:Array[Dictionary],id:String,r:Rect2,height:float) -> void:
	var steps:=maxi(1,ceili(height/.07))
	var cols:=maxi(1,ceili(r.size.x/.28))
	for row in range(steps):
		for col in range(cols):
			_leaf(out,"%s/step/%d/%d"%[id,row,col],"stone_step",r.position.x+r.size.x*col/cols,r.position.y+r.size.y*row/steps,r.size.x/cols,r.size.y/steps,.01,height*(steps-row)/steps,"prop",0,"stone")

static func _post(out:Array[Dictionary],id:String,x:float,y:float,z:float,h:float,painted:bool=false,width:float=.045) -> void:
	_leaf(out,id,"post_red" if painted else "post_wood",x-width*.5,y-width*.5,width,width,z,h,"prop",1,"timber",2)

static func _beam(out:Array[Dictionary],id:String,x:float,y:float,w:float,d:float,z:float,painted:bool=false) -> void:
	_leaf(out,id,"beam_painted" if painted else "beam_wood",x,y,w,d,z,.045,"x" if w>=d else "y",1,"timber",3)

static func _wall_line(out:Array[Dictionary],id:String,x:float,y:float,length:float,h:float,z:float,axis:String,asset:String,open_door:bool=false,windows:bool=true) -> void:
	var count:=maxi(1,ceili(length/.29))
	var step:=length/count
	for i in range(count):
		var xx:=x+(step*i if axis=="x" else 0.)
		var yy:=y+(step*i if axis=="y" else 0.)
		var w:=step if axis=="x" else .035
		var d:=.035 if axis=="x" else step
		var entry:=open_door and i==count/2
		if entry:
			_leaf(out,id+"/door","door_red" if asset=="wall_brick" else "door_wood",xx,yy,w,d,z,h*.91,axis,2,"door",3)
		else:
			_leaf(out,"%s/bay/%d"%[id,i],asset,xx,yy,w,d,z,h,axis,2,"wall",1)
			if windows and (count<=2 or i%2==0):
				var margin:=step*.18
				# Place the thin fitting beyond the wall's outer face, not inside its
				# 0.035-tile physical thickness. This also gives depth sorting real bounds.
				var wx:=xx+margin if axis=="x" else xx+.037
				var wy:=yy+margin if axis=="y" else yy+.037
				_leaf(out,"%s/window/%d"%[id,i],"window_paper" if asset=="wall_earth" else "window_lattice",wx,wy,step*.64 if axis=="x" else .006,.006 if axis=="x" else step*.64,z+h*.38,h*.38,axis,2,"window",4)

static func _frame(out:Array[Dictionary],id:String,r:Rect2,z:float,h:float,wall:String="wall_plaster",open:bool=false,painted:bool=false,foundation:bool=true,entry:bool=true) -> void:
	var first_leaf:=out.size()
	if foundation:_block_course(out,id+"/foundation",r,maxf(0.,z-.065),minf(.065,maxf(z,.025)))
	var nx:=maxi(1,ceili(r.size.x/.30))
	var ny:=maxi(1,ceili(r.size.y/.32))
	for iy in range(ny+1):
		for ix in range(nx+1):
			if ix not in [0,nx] and iy not in [0,ny]:continue
			var x:=r.position.x+r.size.x*ix/nx
			var y:=r.position.y+r.size.y*iy/ny
			_post(out,"%s/post/%d/%d"%[id,iy,ix],x,y,z,h,painted)
			if ix<nx and iy in [0,ny]:_beam(out,"%s/beam-x/%d/%d"%[id,iy,ix],x,y-.02,r.size.x/nx,.04,z+h,painted)
			if iy<ny and ix in [0,nx]:_beam(out,"%s/beam-y/%d/%d"%[id,iy,ix],x-.02,y,.04,r.size.y/ny,z+h,painted)
			if painted and ix in [0,nx] and iy in [0,ny]:
				_leaf(out,"%s/bracket/%d/%d"%[id,iy,ix],"dougong",x-.055,y-.055,.11,.11,z+h-.045,.095,"prop",1,"timber",4)
	if not open:
		_wall_line(out,id+"/wall/back",r.position.x,r.position.y,r.size.x,h,z,"x",wall,false,false)
		_wall_line(out,id+"/wall/west",r.position.x,r.position.y,r.size.y,h,z,"y",wall,false,false)
		_wall_line(out,id+"/wall/front",r.position.x,r.end.y-.035,r.size.x,h,z,"x",wall,entry,true)
		_wall_line(out,id+"/wall/east",r.end.x-.035,r.position.y,r.size.y,h,z,"y",wall,false,true)

	for i in range(first_leaf,out.size()):out[i]["stand_elevation"]=z

static func _subtract_rect(r:Rect2,opening:Rect2) -> Array[Rect2]:
	if not opening.has_area() or not r.intersects(opening):return [r]
	var cut:=r.intersection(opening)
	var pieces:Array[Rect2]=[]
	if cut.position.y>r.position.y+.0001:pieces.append(Rect2(r.position.x,r.position.y,r.size.x,cut.position.y-r.position.y))
	if cut.end.y<r.end.y-.0001:pieces.append(Rect2(r.position.x,cut.end.y,r.size.x,r.end.y-cut.end.y))
	if cut.position.x>r.position.x+.0001:pieces.append(Rect2(r.position.x,cut.position.y,cut.position.x-r.position.x,cut.size.y))
	if cut.end.x<r.end.x-.0001:pieces.append(Rect2(cut.end.x,cut.position.y,r.end.x-cut.end.x,cut.size.y))
	return pieces

static func _roof_piece(out:Array[Dictionary],id:String,asset:String,r:Rect2,z:float,rise:float,side:int,phase:int,role:String,layer:int,opening:Rect2) -> void:
	var pieces:=_subtract_rect(r,opening)
	for i in range(pieces.size()):
		var piece:Rect2=pieces[i]
		var clipped:=piece!=r
		var low_z:=z+rise*((piece.position.y-r.position.y)/r.size.y if side==0 else (r.end.y-piece.end.y)/r.size.y)
		var leaf:=_leaf(out,id+"/cut/%d"%i if clipped else id,asset,piece.position.x,piece.position.y,piece.size.x,piece.size.y,low_z,rise*piece.size.y/r.size.y,"roof_north" if side==0 else "roof_south",phase,role,layer)
		if clipped:
			var crop:Array=[(piece.position.x-r.position.x)/r.size.x,(r.end.y-piece.end.y)/r.size.y if side==0 else (piece.position.y-r.position.y)/r.size.y,piece.size.x/r.size.x,piece.size.y/r.size.y]
			leaf["uv_crop"]=[1.-float(crop[1])-float(crop[3]),crop[0],crop[3],crop[2]] if asset=="rafter" else crop
		if asset=="rafter":leaf["uv_turns"]=1
		if asset in ["eave_gray","eave_gold"]:leaf["face"]="x"

static func _roof(out:Array[Dictionary],id:String,r:Rect2,z:float,rise:float,material:String="tiles_gray",opening:Rect2=Rect2(),standing:float=-1.) -> void:
	var first_leaf:=out.size()
	var cols:=maxi(1,ceili(r.size.x/.25))
	var rows:=maxi(1,ceili(r.size.y*.5/.15))
	var dx:=r.size.x/cols
	var dy:=r.size.y*.5/rows
	var gold:=material=="tiles_glazed"
	for side in range(2):
		for row in range(rows):
			var yy:=r.position.y+row*dy if side==0 else r.end.y-(row+1)*dy
			var low_z:=z+rise*row/rows
			for col in range(cols):
				var xx:=r.position.x+col*dx
				var key:="%s/%s/%d/%d"%[id,"back" if side==0 else "front",row,col]
				_roof_piece(out,key+"/rafter","rafter",Rect2(xx+dx*.45,yy,dx*.10,dy),low_z-.025,rise/rows,side,3,"timber",4,opening)
				_roof_piece(out,key+"/course",material,Rect2(xx,yy,dx,dy),low_z,rise/rows,side,4,"thatch" if material=="thatch_course" else "tile",5,opening)
				if row==0 and material!="thatch_course" and not material.begins_with("fabric"):
					_roof_piece(out,key+"/eave","eave_gold" if gold else "eave_gray",Rect2(xx,yy if side==0 else yy+dy-.055,dx,.055),z-.015,.045,side,4,"tile",6,opening)
	for col in range(cols):
		var xx:=r.position.x+col*dx
		if opening.has_area() and opening.intersects(Rect2(xx,r.get_center().y-.025,dx,.05),true):continue
		if material.begins_with("fabric") or material=="thatch_course":
			_leaf(out,"%s/ridge-tie/%d"%[id,col],"rope",xx,r.get_center().y-.018,dx,.036,z+rise,.025,"x",4,"rope",7)
		else:
			_leaf(out,"%s/ridge/%d"%[id,col],"ridge_gold" if gold else "ridge_gray",xx,r.get_center().y-.025,dx,.05,z+rise,.065,"x",4,"tile",7)
	if gold and not opening.has_area():
		for end in range(2):_leaf(out,"%s/beast/%d"%[id,end],"ridge_beast",r.position.x-.02 if end==0 else r.end.x-.08,r.get_center().y-.04,.10,.08,z+rise,.10,"prop",5,"ornament",8)
	for i in range(first_leaf,out.size()):out[i]["stand_elevation"]=standing if standing>=0. else maxf(0.,z-.4)

static func _room(out:Array[Dictionary],id:String,r:Rect2,z:float,h:float,wall:String="wall_plaster",roof:String="tiles_gray",open:bool=false,painted:bool=false,opening:Rect2=Rect2(),foundation:bool=true,entry:bool=true) -> void:
	_frame(out,id,r,z,h,wall,open,painted,foundation,entry)
	if not roof.is_empty():
		var rise:=minf(.25,r.size.y*.23)
		if not open and not opening.has_area():_gables(out,id+"/gable",r,z+h+.04,rise,wall,z)
		_roof(out,id+"/roof",r.grow(.035),z+h+.04,rise,roof,opening,z)

static func _gables(out:Array[Dictionary],id:String,r:Rect2,z:float,rise:float,wall:String,standing:float) -> void:
	# Two image triangles close each gable. The roof's overhang lifts its intersection
	# with the wall slightly above the eave; an image frieze fills that exact band.
	var overhang:=.035
	var heel:=rise*overhang/(r.size.y*.5+overhang)
	var cap_height:=rise-heel
	for side in range(2):
		var xx:=r.position.x if side==0 else r.end.x-.035
		var frieze:=_leaf(out,"%s/frieze/%d"%[id,side],wall,xx,r.position.y,.035,r.size.y,z,maxf(.001,heel),"y",2,"wall",2)
		frieze["stand_elevation"]=standing
		for half in range(2):
			var leaf:=_leaf(out,"%s/triangle/%d/%d"%[id,side,half],wall,xx,r.position.y+half*r.size.y*.5,.035,r.size.y*.5,z+heel,cap_height,"y",2,"wall",2)
			leaf["surface_triangle"]=[0,2,3] if half==0 else [1,2,3]
			leaf["stand_elevation"]=standing

static func _house(out:Array[Dictionary],level:int) -> void:
	var r:=Rect2(.08,.12,.84,.64)
	if level>=2:_block_course(out,"plot-foundation",r,0.,.065)
	match level:
		1:
			# Four poles, separate half-canvas panels, door flap and tether ropes.
			for x in [r.position.x,r.end.x]:
				_post(out,"camp/ridge-post/"+str(x),x,.44,.01,.51,false,.03)
				for y in [r.position.y,r.end.y]:
					_post(out,"camp/peg/%s/%s"%[x,y],x,y,0.,.12,false,.025)
					var tether:=_leaf(out,"camp/tether/%s/%s"%[x,y],"rope",x-.015,minf(y,.44),.03,absf(y-.44),.02,.50,"y",1,"rope")
					if y<.44:tether["uv_turns"]=1
			_beam(out,"camp/ridge-beam",r.position.x,.42,r.size.x,.04,.52)
			_roof(out,"camp/canvas",r,.12,.42,"fabric_canvas")
			# Each end is an independent rectangular skirt plus two triangular cloth
			# panels. Only the near end has a lower opening with a narrow rolled flap.
			for side in range(2):
				var xx:=r.position.x+.008 if side==0 else r.end.x-.02
				for half in range(2):
					var panel:=_leaf(out,"camp/end/%d/triangle/%d"%[side,half],"fabric_canvas",xx,r.position.y+half*r.size.y*.5,.02,r.size.y*.5,.12,.42,"y",2,"fabric",2)
					panel["surface_triangle"]=[0,2,3] if half==0 else [1,2,3]
				if side==0:
					_leaf(out,"camp/end/0/skirt","fabric_canvas",xx,r.position.y,.02,r.size.y,.01,.11,"y",2,"fabric")
				else:
					for half in range(2):
						_leaf(out,"camp/end/1/skirt/%d"%half,"fabric_canvas",xx,r.position.y+half*.42,.02,.22,.01,.11,"y",2,"fabric")
					_leaf(out,"camp/door-flap","fabric_canvas",xx+.003,.41,.02,.06,.12,.26,"y",2,"fabric",3)
			_stock(out,"camp/provisions","sack",Rect2(.68,.82,.22,.13),2)
		2:
			_frame(out,"main",r,.065,.24,"wall_timber",true)
			_wall_line(out,"main/windbreak",r.position.x,r.position.y,r.size.x,.22,.065,"x","wall_timber",false,false)
			_roof(out,"main/roof",r.grow(.045),.35,.34,"thatch_course")
			_stairs(out,"entry",Rect2(.37,.78,.26,.15),.065)
		3:
			_room(out,"main",r,.065,.37,"wall_earth","thatch_course")
			_stairs(out,"entry",Rect2(.37,.78,.26,.15),.065)
			_chimney(out,"cooking-flue",Vector2(.12,.18),.065,.65,.10)
			_leaf(out,"water-pot","pottery_vessel",.78,.81,.13,.12,.02,.18,"prop",5,"vessel")
		4:
			_room(out,"main",r,.065,.42,"wall_timber","tiles_gray")
			_deck(out,"front-deck",Rect2(.10,.79,.80,.13),.10)
			_stairs(out,"entry",Rect2(.37,.92,.26,.07),.10)
			_stock(out,"fuel","timber_stack",Rect2(.12,.79,.20,.11),1)
		5:
			_room(out,"main",r,.065,.42,"wall_plaster","tiles_gray")
			_room(out,"entry-canopy",Rect2(.35,.80,.30,.14),.04,.28,"wall_timber","tiles_gray",true)
			_stairs(out,"entry",Rect2(.38,.95,.24,.04),.065)
			_leaf(out,"water-pot","pottery_vessel",.78,.81,.13,.12,.02,.18,"prop",5,"vessel")
		6:
			_room(out,"main",r,.065,.47,"wall_brick","tiles_green")
			_room(out,"street-arcade",Rect2(.10,.79,.80,.13),.04,.30,"wall_timber","fabric_awning",true)
			_leaf(out,"street-counter","workbench",.27,.84,.46,.12,.04,.18,"prop",5,"equipment")
			_stock(out,"shop-goods","sack",Rect2(.30,.83,.38,.11),3,.22,.09)
		7:
			var upper:=Rect2(.20,.18,.60,.48)
			_room(out,"main",r,.065,.43,"wall_plaster","tiles_gray",false,false,upper.grow(.025))
			_room(out,"upper",upper,.56,.34,"wall_timber","tiles_gray",false,false,Rect2(),false,false)
			_deck(out,"front-deck",Rect2(.10,.79,.80,.13),.10)
			_stairs(out,"entry",Rect2(.37,.92,.26,.07),.10)
		8:
			var rear:=Rect2(.08,.10,.84,.36)
			var upper:=Rect2(.25,.14,.50,.26)
			_room(out,"main",rear,.065,.44,"wall_plaster","tiles_gray",false,false,upper.grow(.02))
			_room(out,"upper",upper,.57,.32,"wall_brick","tiles_green",false,true,Rect2(),false,false)
			_room(out,"west",Rect2(.08,.52,.20,.32),.065,.30,"wall_plaster","tiles_gray")
			_room(out,"east",Rect2(.72,.52,.20,.32),.065,.30,"wall_plaster","tiles_gray")
			_room(out,"entry-canopy",Rect2(.35,.86,.30,.10),.04,.25,"wall_timber","tiles_gray",true)
			_tree(out,"court-tree",Vector2(.42,.65),.30)
			_fence(out,"front-wall",Rect2(.07,.93,.86,.03),.16,"wall_plaster",.30)
		9:
			var upper:=Rect2(.13,.16,.58,.40)
			_room(out,"main",Rect2(.08,.10,.84,.50),.065,.45,"wall_plaster","tiles_gray",false,false,upper.grow(.025))
			_room(out,"upper",upper,.58,.38,"wall_brick","tiles_glazed",false,true,Rect2(),false,false)
			_room(out,"east-study",Rect2(.76,.24,.17,.34),.58,.26,"wall_timber","tiles_gray",false,false,Rect2(),false,false)
			_room(out,"front-gallery",Rect2(.10,.70,.80,.17),.065,.28,"wall_timber","tiles_gray",true,true)
			_stairs(out,"entry",Rect2(.37,.90,.26,.08),.065)
			_lantern(out,"entry-lantern",Vector2(.83,.87),.30)
		10:
			var upper:=Rect2(.15,.17,.70,.48)
			_room(out,"main",Rect2(.05,.09,.90,.64),.11,.48,"wall_brick","tiles_glazed",false,true,upper.grow(.025))
			_room(out,"upper",upper,.64,.39,"wall_brick","tiles_glazed",false,true,Rect2(),false,false)
			_room(out,"entry-canopy",Rect2(.35,.80,.30,.14),.06,.33,"wall_timber","tiles_glazed",true,true)
			_stairs(out,"entry",Rect2(.38,.95,.24,.04),.11)
			for side in range(2):_leaf(out,"guardian/%d"%side,"lion",.12+side*.64,.82,.12,.12,.03,.20,"prop",5,"ornament")

	if level>=2:
		for index in range(out.size()-1,-1,-1):
			if str(out[index].id).begins_with("main/foundation/"):
				if level==10:
					out[index]["elevation"]=.065
					out[index]["extent"][2]=.045
				else:out.remove_at(index)

static func _villa(out:Array[Dictionary],level:int) -> void:
	_compound(out,"boundary",2.,.52,.25)
	var upper:=Rect2(.30,.16,1.40,.48)
	_room(out,"main",Rect2(.16,.10,1.68,.61),.08,.53,"wall_brick","tiles_gray",false,true,upper.grow(.025) if level>=4 else Rect2())
	var west:=Rect2(.14,.81,.36,.74)
	var east:=Rect2(1.50,.81,.36,.74)
	_room(out,"west",Rect2(.12,.78,.40,.80),.08,.41,"wall_plaster","tiles_gray",false,false,west if level>=5 else Rect2())
	_room(out,"east",Rect2(1.48,.78,.40,.80),.08,.41,"wall_plaster","tiles_gray",false,false,east if level>=5 else Rect2())
	_room(out,"entrance",Rect2(.61,1.69,.78,.20),.05,.35,"wall_timber","tiles_gray",true,true)
	_stairs(out,"main-stairs",Rect2(.79,.72,.42,.15),.08)
	if level>=2:
		_pool(out,"lotus-pool",Rect2(1.09,1.04,.30,.30),.04)
		_tree(out,"court-tree",Vector2(.76,1.05),.64)
	if level>=3:
		_room(out,"front-gallery",Rect2(.62,1.40,.76,.16),.06,.28,"wall_timber","tiles_gray",true,true)
		_lantern(out,"court-lantern",Vector2(1.38,.89),.35)
	if level>=4:
		var top:=Rect2(.66,.25,.68,.30)
		_room(out,"upper",upper,.66,.40,"wall_brick","tiles_glazed",false,true,top.grow(.02) if level>=6 else Rect2(),false,false)
	if level>=5:
		_room(out,"west-upper",west,.54,.33,"wall_timber","tiles_green",false,true,Rect2(),false,false)
		_room(out,"east-upper",east,.54,.33,"wall_timber","tiles_green",false,true,Rect2(),false,false)
	if level>=6:
		_room(out,"belvedere",Rect2(.66,.25,.68,.30),1.10,.31,"wall_timber","tiles_glazed",true,true,Rect2(),false,false)

static func _civic(out:Array[Dictionary],type:String) -> void:
	match type:
		"well":
			_well(out,"well",Vector2(.50,.48),.46)
			_room(out,"well-canopy",Rect2(.18,.18,.64,.62),.05,.48,"wall_timber","tiles_gray",true)
			_leaf(out,"windlass","wheel",.42,.43,.16,.07,.29,.16,"x",5,"equipment")
			_leaf(out,"well-rope","rope",.49,.47,.025,.025,.10,.40,"prop",5,"rope")
			_stock(out,"buckets","bucket",Rect2(.69,.78,.21,.13),2)
		"watch":
			_room(out,"lower-tower",Rect2(.20,.20,.60,.60),.09,.80,"wall_brick","",false)
			_room(out,"lookout",Rect2(.13,.13,.74,.74),.93,.32,"wall_timber","tiles_glazed",true,true,Rect2(),false)
			_rails(out,"lookout-rails",Rect2(.13,.13,.74,.74),.93,.18)
			_leaf(out,"watch-gong","gong",.39,.73,.22,.06,1.05,.24,"x",5,"equipment")
		"police":
			_compound(out,"boundary",1.,.34,.22)
			_room(out,"office",Rect2(.10,.09,.80,.52),.07,.45,"wall_brick","tiles_gray")
			_rack(out,"arms-rack",Rect2(.12,.71,.30,.12),.03,.34)
			_leaf(out,"alarm-drum","drum",.67,.74,.20,.18,.04,.25,"prop",5,"equipment")
		"clinic":
			_room(out,"dispensary",Rect2(.08,.08,.84,.52),.065,.43)
			_room(out,"consultation",Rect2(.09,.68,.40,.23),.04,.26,"wall_timber","fabric_awning",true)
			_crop(out,"herb-bed",Rect2(.59,.68,.30,.25),"vegetable_patch",2,2)
			_leaf(out,"mortar","pottery_vessel",.19,.76,.10,.10,.12,.11,"prop",5,"equipment")
		"repair":
			_room(out,"carpenter-shed",Rect2(.09,.08,.82,.52),.065,.44,"wall_timber","tiles_gray")
			_leaf(out,"joinery-bench","workbench",.12,.71,.43,.20,.03,.23,"prop",5,"equipment")
			_stock(out,"repair-timber","timber_stack",Rect2(.66,.67,.23,.25),2)
		"temple":
			_room(out,"sanctuary",Rect2(.08,.09,.84,.62),.15,.58,"wall_brick","tiles_glazed",false,true)
			_stairs(out,"stairs",Rect2(.30,.73,.40,.20),.15)
			_leaf(out,"censer","incense_burner",.42,.83,.16,.14,.04,.22,"prop",5,"ornament")
			for side in range(2):_leaf(out,"guardian/%d"%side,"lion",.10+side*.66,.80,.14,.14,.03,.22,"prop",5,"ornament")
		"school":
			_room(out,"classroom",Rect2(.08,.08,.84,.54),.065,.43)
			_room(out,"reading-porch",Rect2(.10,.68,.54,.23),.04,.28,"wall_timber","tiles_gray",true)
			_leaf(out,"desks","workbench",.17,.75,.37,.12,.04,.18,"prop",5,"equipment")
			_tree(out,"shade-tree",Vector2(.80,.80),.57)
		"theater":
			_room(out,"stage",Rect2(.08,.11,.84,.62),.17,.58,"wall_timber","tiles_glazed",true,true)
			_wall_line(out,"backdrop",.13,.16,.74,.49,.20,"x","wall_brick",false,false)
			_stairs(out,"stage-stairs",Rect2(.34,.76,.32,.18),.17)
			_leaf(out,"stage-drum","drum",.15,.58,.15,.15,.19,.23,"prop",5,"equipment")
			_leaf(out,"curtain-left","fabric_awning",.10,.69,.20,.035,.25,.42,"x",5,"fabric")
		"grainShop","vegShop","fruitShop","fishShop","meatShop":_shop(out,type)
		"market":
			_room(out,"market-office",Rect2(.12,.10,1.76,.47),.065,.50,"wall_timber","tiles_green")
			for row in range(2):
				for col in range(2):
					var sid:="stall/%d/%d"%[row,col]
					var r:=Rect2(.13+col*1.03,.80+row*.57,.69,.37)
					_room(out,sid,r,.04,.34,"wall_timber","fabric_awning",true)
					_leaf(out,sid+"/counter","workbench",r.position.x+.05,r.end.y-.14,.59,.13,.03,.21,"prop",5,"equipment")
					_stock(out,sid+"/goods",["vegetable_basket","sack","fruit_basket","fish"][row*2+col],Rect2(r.position.x+.07,r.end.y-.12,.53,.10),3,.25,.09)
			_sign(out,"market-sign",Vector2(.98,1.72),.68)
		"farmland","vegFarm":
			_compound(out,"field-fence",2.,.48,.14,"railing")
			_room(out,"tool-shed",Rect2(.12,.12,.53,.32),.04,.28,"wall_timber","thatch_course")
			_well(out,"irrigation",Vector2(1.63,.28),.29)
			_crop(out,"crop",Rect2(.16,.58,1.67,1.25),"rice_ripe" if type=="farmland" else "vegetable_patch",4,5)
		"orchard":
			_compound(out,"orchard-fence",2.,.48,.14,"railing")
			_room(out,"fruit-shed",Rect2(.12,.12,.58,.32),.04,.29,"wall_timber","thatch_course")
			for row in range(3):
				for col in range(3):_tree(out,"fruit-tree/%d/%d"%[row,col],Vector2(.38+col*.61,.77+row*.43),.68)
			_stock(out,"harvest","fruit_basket",Rect2(1.17,.14,.58,.25),3)
		"pasture":
			_compound(out,"pasture-fence",2.,.50,.21,"railing")
			_room(out,"barn",Rect2(.12,.12,1.04,.49),.065,.39,"wall_timber","thatch_course")
			_stock(out,"fodder","rice_ripe",Rect2(1.35,.16,.42,.40),3,.02)
			_pool(out,"trough",Rect2(.30,1.72,.86,.15),.12)
			_crop(out,"grazing",Rect2(.30,.90,1.35,.65),"rice_seedling",3,2)
			_leaf(out,"cattle/0","cattle",.40,.91,.45,.24,.02,.36,"prop",5,"animal")
			_leaf(out,"cattle/1","cattle",1.12,1.18,.42,.23,.02,.34,"prop",5,"animal")
			_leaf(out,"sheep/0","sheep",.63,1.42,.27,.18,.02,.24,"prop",5,"animal")
		"fishing","harbor":_dock(out,type=="harbor")
		"lumber":
			_room(out,"saw-shed",Rect2(.12,.12,1.01,.56),.065,.44,"wall_timber","tiles_gray",true)
			_leaf(out,"saw-bench","workbench",.18,.89,.72,.39,.03,.27,"prop",5,"equipment")
			_stock(out,"logs","timber_stack",Rect2(.20,1.47,1.03,.34),4)
			_tree(out,"tree",Vector2(1.60,.43),.95)
			_stock(out,"cut-timber","timber_stack",Rect2(1.36,1.03,.41,.44),2)
		"quarry","clayPit","copperMine":_mine(out,type)
		"kiln":
			_room(out,"drying-shed",Rect2(.11,.12,.72,.56),.065,.40,"wall_timber","tiles_gray",true)
			_kiln(out,"furnace",Rect2(1.03,.22,.70,.66),.04,.65)
			_chimney(out,"chimney",Vector2(1.62,.17),.04,1.02,.17)
			_stock(out,"green-bricks","stone_block",Rect2(.16,.92,.66,.30),4)
			_stock(out,"fired-bricks","stone_block",Rect2(.16,1.47,.74,.30),5,.10)
			_stock(out,"fuel","timber_stack",Rect2(1.18,1.37,.58,.35),3)
		"pottery":
			_room(out,"workshop",Rect2(.12,.12,1.05,.61),.065,.46,"wall_timber","tiles_gray")
			_kiln(out,"kiln",Rect2(1.38,.21,.43,.57),.04,.55)
			_leaf(out,"wheel-base","stone_block",.25,.97,.32,.32,.03,.11,"prop",0,"stone")
			_leaf(out,"potters-wheel","wheel",.25,.97,.32,.32,.15,.06,"ground",5,"equipment")
			_leaf(out,"forming-table","workbench",.84,.99,.58,.25,.04,.28,"prop",5,"equipment")
			_stock(out,"drying-pots","pottery_vessel",Rect2(.23,1.49,1.38,.28),6)
		"mill":
			_room(out,"mill-house",Rect2(.12,.12,1.15,.72),.08,.55,"wall_timber","tiles_gray")
			_block_course(out,"mill-base",Rect2(1.39,.39,.43,.43),.02,.14)
			var millstone:=_leaf(out,"millstone","millstone",1.39,.39,.43,.43,.18,.13,"prop",5,"equipment")
			millstone["width"]=64.*sqrt(2.)*.43
			millstone["height"]=32.*sqrt(2.)*.43+.13*64.
			_beam(out,"turning-handle",1.42,.56,.50,.035,.30)
			_stock(out,"grain","sack",Rect2(.18,1.12,.62,.32),3)
			_stock(out,"flour","sack",Rect2(1.02,1.18,.63,.40),4)
			_leaf(out,"sifting-table","workbench",.28,1.68,.74,.20,.03,.23,"prop",5,"equipment")
		"weaver":
			_room(out,"weaving-room",Rect2(.12,.12,1.70,.55),.065,.47,"wall_timber","tiles_gray")
			_room(out,"loom-porch",Rect2(.12,.84,.82,.62),.05,.43,"wall_timber","fabric_awning",true)
			_loom(out,"loom",Rect2(.25,.97,.54,.39),.06,.38)
			_rack(out,"drying-rack",Rect2(1.14,.97,.62,.28),.03,.58)
			_leaf(out,"drying-fabric","fabric_awning",1.19,1.03,.52,.035,.25,.31,"x",5,"cloth")
			_stock(out,"cloth-bales","crate",Rect2(.35,1.67,.60,.18),3)
		"winery":
			_room(out,"wine-house",Rect2(.12,.12,1.62,.59),.065,.48,"wall_timber","tiles_green")
			_loom(out,"press-frame",Rect2(1.20,.98,.56,.44),.04,.61)
			_leaf(out,"press-wheel","wheel",1.35,1.08,.23,.08,.47,.23,"x",5,"equipment")
			for row in range(2):_stock(out,"vats/%d"%row,"barrel",Rect2(.17,.98+row*.52,.82,.27),3)
			_tree(out,"grape-arbor",Vector2(1.51,1.74),.43)
		"granary":
			for col in range(2):
				var xx:=.13+col*.97
				_room(out,"bin/%d"%col,Rect2(xx,.14,.76,1.30),.27,.55,"wall_timber","tiles_gray")
				for side in range(3):_post(out,"bin/%d/stilt/%d"%[col,side],xx+.12+side*.26,.31,.01,.26,false,.075)
			_stock(out,"grain-loading","sack",Rect2(.27,1.65,.61,.20),3)
			_stairs(out,"loading-stairs",Rect2(1.21,1.48,.45,.34),.27)
		"warehouse":
			_room(out,"store",Rect2(.12,.12,1.76,.85),.08,.59,"wall_timber","tiles_gray")
			_room(out,"loading-canopy",Rect2(.16,1.10,1.10,.36),.05,.34,"wall_timber","fabric_awning",true)
			_stock(out,"crates","crate",Rect2(.19,1.59,.70,.25),4)
			_stock(out,"barrels","barrel",Rect2(1.45,1.18,.35,.35),3)
			_cart(out,"handcart",Rect2(1.15,1.70,.62,.17))
		"treeDeco":_tree(out,"ornamental-tree",Vector2(.50,.50),1.18)
		"garden":
			_compound(out,"boundary",2.,.48,.23)
			_room(out,"pavilion",Rect2(.20,.20,.68,.60),.07,.50,"wall_timber","tiles_green",true,true)
			_pool(out,"pond",Rect2(.91,.98,.82,.57),.045)
			_tree(out,"tree",Vector2(1.55,.43),.89)
			_tree(out,"shrub",Vector2(.31,1.27),.62)
			_deck(out,"footbridge",Rect2(.75,1.14,.27,.52),.10)
			_leaf(out,"scholar-stone","stone_block",.47,1.65,.22,.20,.02,.30,"prop",5,"ornament")
		"monument":
			_block_course(out,"dais",Rect2(.18,.20,.64,.56),.02,.12)
			for row in range(5):_leaf(out,"stele/block/%d"%row,"stone_block",.39,.37,.22,.20,.14+row*.13,.13,"prop",2,"stone")
			_leaf(out,"dedication","banner",.40,.56,.20,.025,.30,.42,"x",5,"ornament")
			_stairs(out,"stairs",Rect2(.29,.78,.42,.14),.12)
		"barracks":
			_compound(out,"boundary",2.,.54,.28)
			_room(out,"command",Rect2(.16,.15,1.64,.55),.08,.52,"wall_brick","tiles_glazed",false,true)
			_room(out,"bunks",Rect2(.16,.91,.43,.83),.065,.39,"wall_timber","tiles_gray")
			_rack(out,"weapons",Rect2(1.49,1.00,.25,.48),.03,.46)
			_post(out,"dummy/post",1.01,1.20,.02,.47,false,.09)
			_beam(out,"dummy/arms",.83,1.18,.36,.04,.34)
			_sign(out,"garrison-banner",Vector2(1.62,1.68),.88)
		"university":
			_compound(out,"boundary",2.,.52,.24)
			_room(out,"lecture",Rect2(.16,.14,1.68,.56),.09,.58,"wall_brick","tiles_glazed",false,true)
			_room(out,"library-west",Rect2(.15,.86,.36,.84),.08,.44,"wall_plaster","tiles_gray")
			_room(out,"library-east",Rect2(1.49,.86,.36,.84),.08,.44,"wall_plaster","tiles_gray")
			_room(out,"gate",Rect2(.70,1.69,.60,.21),.05,.40,"wall_timber","tiles_green",true,true)
			_tree(out,"scholar-tree",Vector2(.87,1.17),.65)
			_leaf(out,"academy-gong","gong",1.22,1.32,.16,.05,.18,.22,"x",5,"equipment")
		"bath":
			_compound(out,"boundary",2.,.50,.27)
			_room(out,"bath-hall",Rect2(.15,.14,1.69,.68),.08,.49,"wall_plaster","tiles_green")
			_room(out,"changing-room",Rect2(.15,1.01,.40,.70),.065,.36,"wall_timber","tiles_gray")
			_pool(out,"warm-pool",Rect2(.80,1.09,.87,.55),.13)
			_chimney(out,"furnace-flue",Vector2(1.70,.25),.08,.76,.13)
		"observatory":
			for tier in range(3):_block_course(out,"platform/%d"%tier,Rect2(.32+tier*.06,.33+tier*.06,1.37-tier*.12,1.30-tier*.12),.03+tier*.17,.17)
			_stairs(out,"stairs",Rect2(.80,1.66,.42,.28),.54)
			_post(out,"instrument-axis",1.01,.97,.55,.55,true,.035)
			_leaf(out,"armillary-x","armillary_ring_vertical",.76,.94,.50,.06,.85,.50,"x",5,"equipment")
			_leaf(out,"armillary-y","armillary_ring_vertical",.98,.73,.06,.50,.85,.50,"y",5,"equipment")
			var equator:=_leaf(out,"armillary-equator","armillary_ring_horizontal",.76,.72,.50,.50,1.10,.005,"prop",5,"equipment")
			equator["width"]=64.*sqrt(2.)*.50
			equator["height"]=32.*sqrt(2.)*.50
			_room(out,"astronomer-study",Rect2(.10,.12,.47,.38),.05,.33,"wall_plaster","tiles_gray")
			_rails(out,"balustrade",Rect2(.35,.36,1.30,1.22),.54,.18)
		"pagoda":_pagoda(out)
		"wonder":_palace(out)

static func _chimney(out:Array[Dictionary],id:String,p:Vector2,z:float,height:float,width:float=.14) -> void:
	var count:=maxi(1,ceili(height/.11))
	for row in range(count):
		_leaf(out,"%s/course/%d"%[id,row],"chimney_course",p.x,p.y,width,width,z+height*row/count,height/count,"prop",3,"brick",3+row)

static func _stock(out:Array[Dictionary],id:String,asset:String,r:Rect2,count:int=3,z:float=.025,item_height:float=.16) -> void:
	for i in range(count):
		var w:=minf(.24,r.size.x/count*.88)
		var d:=minf(.23,r.size.y)
		_leaf(out,"%s/item/%d"%[id,i],asset,r.position.x+r.size.x*(i+.5)/count-w*.5,r.position.y,w,d,z,item_height*(1.+(i%2)*.28),"prop",5,"cargo")

static func _crop(out:Array[Dictionary],id:String,r:Rect2,asset:String,nx:int,ny:int) -> void:
	for y in range(ny):
		for x in range(nx):
			var leaf:=_leaf(out,"%s/plant/%d/%d"%[id,y,x],asset,r.position.x+r.size.x*x/nx,r.position.y+r.size.y*y/ny,r.size.x/nx*.84,r.size.y/ny*.84,.015,.23 if asset=="rice_ripe" else .13,"prop",5,"plant")
			if asset in ["rice_seedling","rice_ripe"]:leaf["growth_assets"]=["rice_seedling","rice_ripe"]

static func _deck(out:Array[Dictionary],id:String,r:Rect2,z:float) -> void:
	var count:=maxi(1,ceili(r.size.y/.075))
	for i in range(count):
		_leaf(out,"%s/plank/%d"%[id,i],"beam_wood",r.position.x,r.position.y+r.size.y*i/count,r.size.x,r.size.y/count*.94,z,.025,"ground",0,"timber")
	for corner in [r.position,r.position+Vector2(r.size.x,0),r.end,r.position+Vector2(0,r.size.y)]:
		_post(out,id+"/support/"+str(corner),corner.x,corner.y,0.,maxf(.03,z),false,.055)

static func _rails(out:Array[Dictionary],id:String,r:Rect2,z:float,h:float) -> void:
	for side in range(4):
		var axis:="x" if side in [0,2] else "y"
		var length:=r.size.x if axis=="x" else r.size.y
		var count:=maxi(1,ceili(length/.30))
		for i in range(count):
			var x:=r.position.x+(length*i/count if axis=="x" else (r.size.x if side==1 else 0.))
			var y:=r.position.y+(length*i/count if axis=="y" else (r.size.y if side==2 else 0.))
			_leaf(out,"%s/side/%d/%d"%[id,side,i],"railing",x,y,length/count if axis=="x" else .025,.025 if axis=="x" else length/count,z,h,axis,2,"timber",2)

static func _fence(out:Array[Dictionary],id:String,r:Rect2,h:float,asset:String="wall_plaster",gap:float=0.) -> void:
	var axis:="x" if r.size.x>=r.size.y else "y"
	var length:=maxf(r.size.x,r.size.y)
	var count:=maxi(1,ceili(length/.28))
	for i in range(count):
		var at:=(i+.5)*length/count
		if gap>0. and absf(at-length*.5)<gap*.5:continue
		var x:=r.position.x+(i*length/count if axis=="x" else 0.)
		var y:=r.position.y+(i*length/count if axis=="y" else 0.)
		var w:=length/count if axis=="x" else .035
		var d:=.035 if axis=="x" else length/count
		_leaf(out,"%s/segment/%d"%[id,i],asset,x,y,w,d,.025,h,axis,2,"wall",1)
		if asset!="railing":_leaf(out,"%s/cap/%d"%[id,i],"stone_step",x-.008,y-.008,w+.016,d+.016,.025+h,.025,"prop",5,"stone",2)

static func _compound(out:Array[Dictionary],id:String,size:float,gap:float,h:float,asset:String="wall_plaster") -> void:
	_fence(out,id+"/back",Rect2(.04,.04,size-.08,.035),h,asset)
	_fence(out,id+"/west",Rect2(.04,.075,.035,size-.15),h,asset)
	_fence(out,id+"/east",Rect2(size-.075,.075,.035,size-.15),h,asset)
	_fence(out,id+"/front",Rect2(.04,size-.075,size-.08,.035),h,asset,gap)

static func _well(out:Array[Dictionary],id:String,p:Vector2,diameter:float) -> void:
	var radius:=diameter*.5
	_leaf(out,id+"/water","water_surface",p.x-radius*.74,p.y-radius*.74,radius*1.48,radius*1.48,.04,.005,"ground",0,"water")
	var directions:Array=[[-1,-1,"nw"],[1,-1,"ne"],[-1,1,"sw"],[1,1,"se"]]
	for direction:Array in directions:
		var x:float=p.x-radius if int(direction[0])<0 else p.x
		var y:float=p.y-radius if int(direction[1])<0 else p.y
		var leaf:=_leaf(out,id+"/rim/"+str(direction[2]),"well_stone_"+str(direction[2]),x,y,radius,radius,.02,diameter*.110,"prop",0,"stone")
		leaf["image_ground"]=[p.x,p.y]
		leaf["image_extent"]=[diameter,diameter,diameter*.110]

static func _pool(out:Array[Dictionary],id:String,r:Rect2,h:float) -> void:
	var nx:=maxi(1,ceili(r.size.x/.30))
	var ny:=maxi(1,ceili(r.size.y/.30))
	for y in range(ny):
		for x in range(nx):_leaf(out,"%s/water/%d/%d"%[id,y,x],"water_surface",r.position.x+r.size.x*x/nx,r.position.y+r.size.y*y/ny,r.size.x/nx,r.size.y/ny,.025,.004,"ground",5,"water")
	for i in range(nx):
		for edge in range(2):_leaf(out,"%s/border-x/%d/%d"%[id,edge,i],"stone_block",r.position.x+r.size.x*i/nx,r.position.y+edge*r.size.y-.04,r.size.x/nx,.08,.02,h,"prop",0,"stone")
	for i in range(ny):
		for edge in range(2):_leaf(out,"%s/border-y/%d/%d"%[id,edge,i],"stone_block",r.position.x+edge*r.size.x-.04,r.position.y+r.size.y*i/ny,.08,r.size.y/ny,.02,h,"prop",0,"stone")

static func _tree(out:Array[Dictionary],id:String,p:Vector2,height:float) -> void:
	var trunk:=_leaf(out,id+"/trunk","tree_trunk",p.x-height*.07,p.y-height*.07,height*.14,height*.14,.02,height*.70,"prop",1,"timber")
	# The pruned natural trunk includes its branching arms. Keep the original
	# source aspect instead of squeezing those arms into the narrow root footprint.
	trunk["height"]=height*.74*64.
	trunk["width"]=height*.74*64.*552./488.
	for i in range(9):
		var angle:=TAU*i/9.
		var span:=height*.25
		var at:=p+Vector2(cos(angle),sin(angle))*height*.16
		var leaf:=_leaf(out,"%s/branch/%d"%[id,i],"fruit_branch",at.x-span*.5,at.y-span*.5,span,span,.02+height*(.37+(i%3)*.14),height*.21,"prop",5,"plant")
		leaf["flip"]=i%2==1

static func _rack(out:Array[Dictionary],id:String,r:Rect2,z:float,h:float) -> void:
	_post(out,id+"/left",r.position.x,r.position.y,z,h)
	_post(out,id+"/right",r.end.x,r.position.y,z,h)
	_beam(out,id+"/top",r.position.x,r.position.y-.02,r.size.x,.04,z+h)
	for i in range(3):_leaf(out,"%s/hanging/%d"%[id,i],"rope",r.position.x+r.size.x*(i+1)/4.,r.position.y,.025,.025,z+h*.23,h*.67,"prop",5,"rope")

static func _loom(out:Array[Dictionary],id:String,r:Rect2,z:float,h:float) -> void:
	for side in range(2):
		_leaf(out,"%s/upright/%d"%[id,side],"loom_frame",r.position.x+side*(r.size.x-.07),r.position.y,.07,r.size.y,z,h,"prop",5,"equipment")
	_beam(out,id+"/top",r.position.x,r.position.y,r.size.x,.04,z+h)
	_beam(out,id+"/warp-beam",r.position.x,r.end.y-.04,r.size.x,.04,z+h*.3)
	for i in range(6):_leaf(out,"%s/thread/%d"%[id,i],"rope",r.position.x+r.size.x*(i+1)/7.,r.position.y+.03,.014,r.size.y-.06,z+h*.3,h*.5,"roof_north",5,"cloth")

static func _lantern(out:Array[Dictionary],id:String,p:Vector2,h:float) -> void:
	_post(out,id+"/post",p.x,p.y,.02,h)
	_leaf(out,id+"/lamp","lantern",p.x-.055,p.y-.055,.11,.11,.02+h-.05,.16,"prop",5,"light",5)

static func _sign(out:Array[Dictionary],id:String,p:Vector2,h:float) -> void:
	_post(out,id+"/post",p.x,p.y,.02,h,false,.035)
	_leaf(out,id+"/flag","banner",p.x,p.y-.015,.22,.03,.02+h*.45,h*.51,"x",5,"ornament")

static func _kiln(out:Array[Dictionary],id:String,r:Rect2,z:float,h:float) -> void:
	_block_course(out,id+"/base",r,z,.06)
	var diameter:=minf(r.size.x,r.size.y)
	# The photograph's complete ring has a calibrated course height of 0.18×D.
	# Stack that actual height, never an unrelated target-step that leaves air gaps.
	var levels:=maxi(2,ceili(h/(diameter*.18*.85)))
	var course_z:=z+.06
	for row in range(levels):
		var shrink:=float(row)/levels*.30
		var span:=Vector2.ONE*diameter*(1.-shrink)
		var origin:=r.get_center()-span*.5
		var course_h:=span.x*.180
		for direction:Array in [[0,0,"nw"],[1,0,"ne"],[0,1,"sw"],[1,1,"se"]]:
			var leaf:=_leaf(out,"%s/masonry/%d/%s"%[id,row,str(direction[2])],"kiln_masonry_"+str(direction[2]),origin.x+float(direction[0])*span.x*.5,origin.y+float(direction[1])*span.y*.5,span.x*.5,span.y*.5,course_z,course_h,"prop",2,"brick",row+1)
			leaf["image_ground"]=[r.get_center().x,r.get_center().y]
			leaf["image_extent"]=[span.x,span.y,course_h]
		course_z+=course_h*.985

	var mouth:=_leaf(out,id+"/fire-mouth","furnace_mouth",r.get_center().x-r.size.x*.16,r.end.y-.035,r.size.x*.32,.035,z+.07,h*.36,"x",5,"furnace",8)
	mouth["animate"]="furnace"

static func _cart(out:Array[Dictionary],id:String,r:Rect2) -> void:
	_deck(out,id+"/bed",r,.13)
	for edge in range(2):
		var wheel:=_leaf(out,"%s/wheel/%d"%[id,edge],"wheel",r.position.x+r.size.x*.37,r.position.y+edge*r.size.y-.025,r.size.x*.22,.05,.025,.20,"x",5,"equipment")
		wheel["animate"]="wheel"
	_beam(out,id+"/handle",r.end.x,r.get_center().y-.02,.20,.04,.12)

static func _shop(out:Array[Dictionary],type:String) -> void:
	_room(out,"shop",Rect2(.08,.08,.84,.53),.065,.40,"wall_timber","tiles_gray")
	_room(out,"awning",Rect2(.09,.67,.82,.25),.035,.28,"wall_timber","fabric_awning",true)
	_leaf(out,"counter","workbench",.15,.80,.70,.13,.04,.19,"prop",5,"equipment")
	var asset:String={"grainShop":"sack","vegShop":"vegetable_basket","fruitShop":"fruit_basket","fishShop":"fish","meatShop":"meat"}.get(type,"crate")
	_stock(out,"goods",asset,Rect2(.18,.80,.64,.11),4,.25,.09)
	if type=="fishShop":
		_pool(out,"fish-tub",Rect2(.74,.68,.14,.14),.14)
	elif type=="meatShop":
		_rack(out,"meat-rack",Rect2(.18,.72,.24,.10),.04,.36)
		_leaf(out,"hanging-meat","meat",.24,.72,.12,.06,.19,.18,"prop",5,"goods")

static func _dock(out:Array[Dictionary],large:bool) -> void:
	var s:=2. if large else 1.
	_room(out,"office",Rect2(.08*s,.09*s,.49*s,.34*s),.07,.46 if large else .33,"wall_timber","tiles_gray")
	_deck(out,"jetty",Rect2(.13*s,.52*s,.64*s,.12*s),.07)
	var boat:=Rect2(.21*s,.75*s,.60*s,.17*s)
	_deck(out,"boat/planks",boat,.025)
	for side in range(2):
		for i in range(3):_leaf(out,"boat/gunwale/%d/%d"%[side,i],"beam_wood",boat.position.x+boat.size.x*i/3.,boat.position.y+side*boat.size.y,boat.size.x/3.,.035,.035,.075,"x",5,"timber")
	_post(out,"boat/mast",boat.get_center().x,boat.get_center().y,.05,.43 if large else .25,false,.028)
	_leaf(out,"boat/sail","fabric_canvas",boat.get_center().x,boat.get_center().y,.25*s,.025,.17,.28*s,"x",5,"fabric")
	_stock(out,"cargo","crate" if large else "fish",Rect2(.68*s,.14*s,.21*s,.20*s),3 if large else 2)
	if large:_hoist(out,"crane",Rect2(1.45,.94,.31,.30),.04,.95)
	else:_rack(out,"net-rack",Rect2(.69,.45,.20,.15),.04,.34)

static func _hoist(out:Array[Dictionary],id:String,r:Rect2,z:float,h:float) -> void:
	_post(out,id+"/left",r.position.x,r.position.y,z,h,false,.06)
	_post(out,id+"/right",r.end.x,r.position.y,z,h,false,.06)
	_beam(out,id+"/crossbar",r.position.x-.07,r.position.y-.025,r.size.x+.14,.05,z+h)
	for side in range(2):_leaf(out,"%s/brace/%d"%[id,side],"brace_wood",r.position.x+side*r.size.x-.045,r.position.y,.09,r.size.y,z,h*.65,"y",1,"timber")
	var wheel:=_leaf(out,id+"/pulley","wheel",r.get_center().x-.07,r.position.y-.035,.14,.07,z+h-.05,.14,"x",5,"equipment")
	wheel["animate"]="wheel"
	_leaf(out,id+"/rope","rope",r.get_center().x-.012,r.position.y,.024,.024,z+.09,h-.08,"prop",5,"rope")
	_leaf(out,id+"/bucket","bucket",r.get_center().x-.075,r.position.y-.075,.15,.15,z+.03,.16,"prop",5,"equipment")

static func _mine(out:Array[Dictionary],type:String) -> void:
	_room(out,"shelter",Rect2(.12,.13,.60,.40),.055,.33,"wall_timber","tiles_gray",true)
	_hoist(out,"extraction-frame",Rect2(1.18,.42,.42,.38),.03,.77 if type=="copperMine" else .61)
	_stock(out,"raw-stock","stone_block" if type=="quarry" else "crate",Rect2(.19,.83,.51,.41),3)
	_stock(out,"sorted-stock","stone_block" if type=="quarry" else "sack",Rect2(.26,1.50,.96,.28),5)
	_leaf(out,"sorting-table","workbench",1.44,1.36,.35,.36,.03,.24,"prop",5,"equipment")
	if type=="clayPit":_pool(out,"mixing-trough",Rect2(.90,.97,.41,.28),.12)
	elif type=="copperMine":_stock(out,"ore-buckets","bucket",Rect2(1.37,1.82,.43,.12),2)

static func _pagoda(out:Array[Dictionary]) -> void:
	_block_course(out,"dais",Rect2(.38,.37,1.24,1.24),.03,.15)
	_stairs(out,"stairs",Rect2(.79,1.64,.42,.26),.18)
	for tier in range(7):
		var span:=1.02-tier*.085
		var r:=Rect2(1.-span*.5,.96-span*.5,span,span)
		var opening:=r.grow(-.075) if tier<6 else Rect2()
		_room(out,"tier/%d"%tier,r,.20+tier*.46,.40,"wall_brick","tiles_glazed",false,true,opening,false,tier==0)
		if tier>0:_rails(out,"tier/%d/rail"%tier,r.grow(.025),.20+tier*.46,.12)
	for ring in range(4):
		var span:=.15-ring*.025
		_leaf(out,"spire/%d"%ring,"ridge_gold",1.-span*.5,.96-span*.5,span,span,3.55+ring*.09,.09,"prop",5,"ornament",9)
	_leaf(out,"spire/beast","ridge_beast",.95,.91,.10,.10,3.91,.16,"prop",5,"ornament",10)

static func _palace(out:Array[Dictionary]) -> void:
	_compound(out,"boundary",3.,.82,.32)
	for tier in range(2):_block_course(out,"platform/%d"%tier,Rect2(.38+tier*.04,.26+tier*.04,2.24-tier*.08,1.22-tier*.08),.03+tier*.15,.15)
	var upper:=Rect2(.67,.46,1.66,.72)
	_room(out,"great-hall",Rect2(.49,.35,2.02,.97),.35,.70,"wall_brick","tiles_glazed",false,true,upper.grow(.025),false)
	_room(out,"upper-hall",upper,1.10,.47,"wall_brick","tiles_glazed",false,true,Rect2(),false,false)
	_room(out,"west-gallery",Rect2(.18,1.62,.39,1.08),.08,.45,"wall_timber","tiles_green",true,true)
	_room(out,"east-gallery",Rect2(2.43,1.62,.39,1.08),.08,.45,"wall_timber","tiles_green",true,true)
	_room(out,"meridian-gate",Rect2(.98,2.54,1.04,.27),.08,.57,"wall_brick","tiles_glazed",true,true)
	_stairs(out,"stairs",Rect2(1.16,1.52,.68,.40),.33)
	_leaf(out,"great-censer","incense_burner",1.36,2.11,.28,.24,.04,.33,"prop",5,"ornament")
	for side in range(2):
		_tree(out,"court-tree/%d"%side,Vector2(.92+side*1.16,1.92),.88)
		_leaf(out,"guardian/%d"%side,"lion",.73+side*1.40,2.60,.18,.20,.04,.30,"prop",5,"ornament")
