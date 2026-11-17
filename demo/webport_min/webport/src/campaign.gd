const WebportRuntime := preload("res://addons/webport/runtime/webport_runtime.gd")

# Сгенерировано WebPort (addons/webport) из src/campaign.mjs.
# Правьте JS-исходник и пересобирайте: ручные правки здесь потеряются.
extends RefCounted

const SEASONS := ["spring", "summer", "autumn", "winter"]
static func createCampaign(input = {}):
	var gold := (input.gold if is_finite(WebportRuntime.num(input.gold)) else 100)
	return {
		"day": 1,
		"season": 0,
		"gold": gold,
		"army": (input.army.slice() if WebportRuntime.is_array(input.army) else []),
		"log": [],
		"finished": false
	}
static func addGold(state, amount):
	return WebportRuntime.merge({}, state, {"gold": state.gold + amount})
static func endDay(state):
	var next := WebportRuntime.merge({}, state, {"day": state.day + 1})
	if next.day % 30 == 0:
		next.season = (next.season + 1) % SEASONS.size()
	var upkeep := next.army.size() * 4
	next.gold = max(0, next.gold - upkeep)
	next.log = (next.log + [("День " + str(next.day) + ": содержание " + str(upkeep) + ", казна " + str(next.gold))]).slice(-6)
	if next.gold <= 0 and next.army.size() > 0:
		next.log.append("Казна пуста — отряды разбегаются")
		next.army = []
	return next
static func armyStrength(state):
	var weights := {"swords": 10, "archers": 7, "cavalry": 14}
	return WebportRuntime.reduce(state.army, func(total, unit): return total + (weights[unit] if weights[unit] != null else 5), 0)