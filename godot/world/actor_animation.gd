extends RefCounted
class_name CityActorAnimation

## A frame sequence names real painted poses. Movement selects poses by distance
## travelled; stationary work selects poses by elapsed action time. Neither
## random texture changes nor bobbing a still image counts as a walk cycle.
static func sequence(animations: Dictionary, action: String, facing: int) -> Dictionary:
	var value: Variant = animations.get("%s/%d" % [action, facing], {})
	return value if value is Dictionary else {}

static func direction_count(metadata: Dictionary) -> int:
	var value: Variant = metadata.get("directions",4)
	var count: int = value.size() if value is Array else int(value)
	return 8 if count==8 else 4

static func sample(animations: Dictionary, action: String, facing: int, distance: float, seconds: float, moving: bool) -> Dictionary:
	var entry := sequence(animations, action, facing)
	var frames: Array = entry.get("frames", [])
	if frames.is_empty():
		return {"key":"", "index":0, "count":0, "action":action}
	var cursor: float = maxf(0.0, distance) * maxf(.1, float(entry.get("cycles_per_tile", 3.5))) * frames.size() if moving else maxf(0.0, seconds) * maxf(.1, float(entry.get("fps", 6.0)))
	var index := posmod(floori(cursor), frames.size()) if bool(entry.get("loop", true)) else mini(floori(cursor), frames.size()-1)
	return {"key":str(frames[index]), "index":index, "count":frames.size(), "action":action}

static func facing_from_motion(motion: Vector2, directions: int = 4, fallback: int = 3) -> int:
	if motion.length_squared() < .00000001:
		return fallback
	# Four road directions preserve the established atlas convention:
	# 0 NW (-x), 1 NE (-y), 2 SW (+y), 3 SE (+x).
	if directions < 8:
		return (3 if motion.x > 0 else 0) if absf(motion.x) > absf(motion.y) else (2 if motion.y > 0 else 1)
	# Eight directions append N, E, S, W to the same four diagonal views.
	var projected := Vector2(motion.x-motion.y, (motion.x+motion.y)*.5)
	var sector := posmod(roundi(projected.angle()/(PI/4.0)), 8)
	return [5,3,6,2,7,0,4,1][sector]

static func simulation_paused(city: Dictionary) -> bool:
	# Reduced decorative motion is not a simulation pause. Keep goods, feet and
	# installation tools in motion while the underlying city is still running.
	return float(city.get("speed", 1)) <= 0.0 or bool(city.get("onlineOpen", false)) or bool(city.get("visiting", false))
