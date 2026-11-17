# Phase 7 - World map / terrain (Heroes of Might & Magic II style)

**Initial painted map + playable-map integration complete; tile-by-tile art and full map systems remain in progress.**

On 16.11 the user requested a full map in the same art style, with a top-down HoMM2 feel. On 16.11 the first map was generated and connected to the playable prototype: painterly 2D terrain artwork, five tinted kingdoms, cliffs, forests, river, lakes, roads, settlements and castles. A 45×30 terrain/ownership grid supplies passability and build-territory queries; the central ford/bridge is walkable. This is a first map pass, not the final tile/decor library or a complete fog-of-war system.

## Map content

- **5 faction territories**, each filled with its own distinct colour overlay
- **Castles** (one capital + minor keeps per faction)
- **Kingdom towns** and **villages**
- **Fields** (farmland plots), **mines** (gold / iron / stone)
- **Forests**: both deciduous (broadleaf) and coniferous (pine)
- **Rivers** running across the map in both directions
- **Lakes** and **swamps / marshes**
- Terrain surrounded by **impassable cliffs, mountains and rocks**
- **Grass** and rocky ground decor

## Technical layout

- `assets/worldmap/overland_map.png` - generated painted campaign map (1264×848),
  same muted historical-fantasy palette as the units; edge-to-edge landmass.
- `data/worldmap.json` - 45×30 aligned terrain and ownership grids, territory
  polygons, landmark/object coordinates, passability and movement costs.
- `viewer/game.html` - draws the map artwork, overlays the active border/army,
  and uses the JSON grid for movement and building rules.
- `assets/worldmap/objects/castle_level_1.png`, `castle_level_2.png` and
  `castle_sprite.png` provide the level I–III castle visuals. The city uses
  `town_level_1.png`, `town_level_2.png`, `town_level_3.png`; browser runtime
  selects tier art by structure level. All new PNGs have verified alpha transparency.
- `assets/worldmap/tiles/`, `decor/`, `objects/` - follow-up reusable tile/decor
  art remains incomplete; other building types still need level variants.

## Game systems (HoMM2-like)

1. **Adventure map view** - scroll the map, move hero armies tile by tile
2. **Town / build view** - construct buildings inside castles
3. **Battle view** - hex grid, turn-based combat, unit stacks
4. **Resource system** - gold, wood, iron, stone, food
5. **Fog of war** - unexplored / explored / visible

Milestones:
- `M1` terrain concept art: first painterly map generated; reusable tileset/decor still open
- `M2` assembled continent + five coloured territories: first pass DONE (`assets/worldmap/overland_map.png`)
- `M3` JSON data + terrain ownership/passability: first pass DONE (`data/worldmap.json`)
- `M4` playable map view + movement: first pass DONE in `/game` (armies use the existing sprite strips)
- `M5` town building + tactical battle: prototype DONE in `/game`; deepen city management, tactical board and balance next
