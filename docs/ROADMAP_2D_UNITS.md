# 2D Unit Line - Roadmap (75 characters)

Reference likeness: `.cache/celtic_ref_photo.png`
5 factions x 15 classes = 75 characters.

Factions: `01_celtic_briton`, `02_norse_viking`, `03_gaulish_warrior`, `04_slavic`, `05_roman`

Classes: `01_archer`, `02_two_handed_axeman`, `03_sword_and_shield`, `04_two_handed_swordsman`,
`05_mace_and_shield`, `06_spearman_shield`, `07_stone_slinger`, `08_cavalryman`, `09_lord`,
`10_king`, `11_prince`, `12_noble_commander`, `13_centurion`, `14_prefect`, `15_chieftain`

---

## Phase 1 - Armored roster, empty hands (complete)

| Batch | Content | Status |
|---|---|---|
| 1 | `01_celtic_briton` 01-10 | done |
| 2 | `01_celtic_briton` 11-15 + `02_norse_viking` 01-05 | done |
| 3 | `02_norse_viking` 06-15 | done |
| 4 | `03_gaulish_warrior` 01-10 | done |
| 5 | `03_gaulish_warrior` 11-15 + `04_slavic` 01-05 | done |
| 6 | `04_slavic` 06-15 | done |
| 7 | `05_roman` 01-10 | done |
| 8 | `05_roman` 11-15 | done |

**Phase 1 = 75/75 COMPLETE.** Overview sheet: `assets/factions/ALL_75_phase1_overview.jpg`

Output per batch:
- `assets/factions/<faction>/<class>.png` - 256-color PNG on white, full body
- `assets/factions/<faction>_transparent/<class>.png` - RGBA cutout, H=960
- `assets/factions/<faction>_full_15_lineup.jpg` - 3x5 sheet
- lossless originals: `build/factions_fullres/<faction>/`

---

## Phase 2 - "Bare physique" line (loincloth only)

Same 75 characters, same face and build, stripped to a simple loincloth / subligaculum.
Randomized per character (deterministic seed per faction+class so results stay reproducible):
- hairstyle (shaved, topknot, braids, mohawk, long loose, cropped, braided side locks...)
- facial hair (clean, mustache, chin beard, full beard, forked beard, braided beard...)
- body hair (chest, forearms, legs) with per-character density
- tattoos (La Tene spirals, Norse knotwork, Slavic solar symbols, Roman legionary marks)
- war paint (woad blue, red ochre, black soot stripes, hand prints)
- scars, war braids, piercings, arm rings

Output: `assets/factions_bare/<faction>/<class>.png` + `_transparent/`

Progress:
- `01_celtic_briton` 15/15 DONE (`assets/factions_bare/01_celtic_briton_full_15_lineup.jpg`)
- `02_norse_viking` 15/15 DONE (`assets/factions_bare/02_norse_viking_bare_full_15_lineup.jpg`)
- `03_gaulish_warrior` 15/15 DONE (`assets/factions_bare/03_gaulish_bare_full_15_lineup.jpg`)
- `04_slavic` 15/15 DONE (`assets/factions_bare/04_slavic_bare_full_15_lineup.jpg`)
- `05_roman` 15/15 DONE

**Phase 2 = 75/75 COMPLETE.** Overview: `assets/factions_bare/ALL_75_bare_overview.jpg`

## Phase 3 - Equipment & item library (NO characters)

Standalone item assets in the same cel-shaded style, isolated on white,
cut out to RGBA. Categories:

- `melee` - one-handed sword, two-handed sword, one-handed axe, great axe, mace,
  club, war hammer, spear, javelin, dagger
- `ranged` - bows, arrows, quivers, slings, sling stones, throwing stones, darts
- `shields` - round, oval, hexagonal, kite, scutum, buckler (faction-flavored bosses)
- `helmets` - Spangenhelm, conical helm, Montefortino, galea, fur caps, hoods, crowns/circlets
- `armor` - mail shirt, scale coat, lamellar, leather cuirass, segmentata, muscle cuirass
- `clothing` - tunics, cloaks, mantles, trousers, belts, baldrics, bracers, boots, pouches,
  waterskins, bedrolls, torcs, armlets, phalerae
- `props` - craft tools, building tools, anvil, hammer, saw, logs, planks

Layout: `assets/equipment/<category>/<item>.png` (+ `_transparent/`),
atlas sheets `assets/equipment/<category>_atlas.jpg`.

Shared core set first, then faction-flavored variants of signature items
(Celtic round shield, Norse kite shield, Roman scutum, etc).

Progress:
- `melee` 10/10 done -> `assets/equipment/melee/`, `assets/equipment/melee_transparent/`,
  `assets/equipment/melee_atlas.jpg`
- `ranged` 10/10 done -> `assets/equipment/ranged/`, `assets/equipment/ranged_transparent/`,
  `assets/equipment/ranged_atlas.jpg`
- `shields` 10/10 done -> `assets/equipment/shields/`, `assets/equipment/shields_transparent/`,
  `assets/equipment/shields_atlas.jpg`
- `helmets` 10/10 done -> `assets/equipment/helmets/`, `assets/equipment/helmets_transparent/`,
  `assets/equipment/helmets_atlas.jpg`
- `armor` 10/10 done -> `assets/equipment/armor/`, `assets/equipment/armor_transparent/`,
  `assets/equipment/armor_atlas.jpg`
- `clothing` 10/10 done -> `assets/equipment/clothing/`, `assets/equipment/clothing_transparent/`,
  `assets/equipment/clothing_atlas.jpg`
- `props` 10/10 done -> `assets/equipment/props/`, `assets/equipment/props_transparent/`,
  `assets/equipment/props_atlas.jpg`

**Phase 3 = 60 items COMPLETE** (6 categories x 10).

NOTE (user request): in Phase 4 every one of the 75 warriors must wear a head covering -
helmet, hood or crown - and be holding a weapon.

## Phase 4 - Characters WITH weapons in hands (75)

Same 75 warriors fully equipped, weapons actually held: bows drawn, arrows nocked,
slings whirling, javelins cocked, swords/axes/maces/spears gripped, shields on the arm,
helmets on the head, armor worn.

Output: `assets/factions_armed/<faction>/<class>.png` + `_transparent/`

Progress:
- `01_celtic_briton` 15/15 DONE (`assets/factions_armed/01_celtic_briton_armed_full_15_lineup.jpg`)
- `02_norse_viking` 15/15 DONE (`assets/factions_armed/02_norse_viking_armed_full_15_lineup.jpg`)
- `03_gaulish_warrior` 15/15 DONE (`assets/factions_armed/03_gaulish_armed_full_15_lineup.jpg`)
- `04_slavic` 15/15 DONE (`assets/factions_armed/04_slavic_armed_full_15_lineup.jpg`)
- `05_roman` 15/15 DONE

**Phase 4 = 75/75 COMPLETE.**
Overview sheet: `assets/factions_armed/ALL_75_armed_overview.jpg`
- every character wears a helmet / cap / hood / circlet AND holds a weapon or shield

## Phase 5 - Sprite animation sets

**Phase 5 = 75/75 COMPLETE** (armed line). 5 clips x 8 frames per unit = 3 000 frames.

| Clip | Frames | FPS | Loop | Content |
|---|---|---|---|---|
| `walk` | 8 | 12 | yes | march toward camera - alternating knee lift, hip sway, shoulder twist, bob, head counter-nod |
| `combat` | 8 | 14 | yes | wind-up (2 f) -> lunge strike (1 f) -> recovery (5 f), waist snap + lunge of the whole figure |
| `craft` | 8 | 10 | yes | crouched at a bench, hammering a piece, 1 beat = 8 frames |
| `build` | 8 | 9 | yes | heavy two-hand raise -> slam -> recoil, whole body compresses on impact |
| `quest` | 8 | 7 | yes | idle / talk: breathing, weight shift, head looks around |

### Method
Not a cut-out rig (slicing the painted art broke swords, shields and cloaks).
Instead a **smooth free-form displacement field (puppet warp)** driven by anatomical
landmarks measured per sprite:

```
head top 0.00 | neck 0.148 | shoulders 0.21 | hips 0.50 | knees 0.79 | ankles 0.95 | soles 1.00
```
(body height normalised per character, so tall kings and short slingers both work)

Field terms: torso lean / twist about the hips, waist compression, hip shift,
head nod-turn-roll about the neck, per-leg lift with a knee-bunch curve,
knee bend pulse, arm swing, whole-figure bob, vertical squash toward the soles,
horizontal lunge. Weight maps are smoothstep bands, so nothing tears.

Rendering: `cv2.remap` samples the **premultiplied** sprite, then a 3x supersampled
frame is area-downscaled (no light rim from straight-alpha interpolation) and the
strip is stored as a 256-colour palette PNG (identical pixels, ~5x smaller).

### Output
```
assets/animations/<faction>/<class>/<clip>.png     horizontal strip, 8 frames, 256-colour RGBA
assets/animations/<faction>/<class>/<clip>.json    fps, frames, frame_w/h, anchor_x/y, loop
assets/animations/<faction>/<class>/<clip>.gif     animated preview
assets/animations/<faction>/<class>/_contact.jpg   5 clips x 8 frames review sheet
assets/animations/_manifest.json                   75 units, every clip + metadata
assets/animations/<faction>_anim_lineup.jpg        one faction, 15 classes x 5 clips
assets/animations/ALL_75_ANIM_overview.jpg         every unit, 4 key poses
```
Character height in a frame = **200 px** (uniform across all units), so frames can be
blitted at any scale with `anchor_x/anchor_y` as the ground contact point.

### Browser preview
`node server.mjs` -> <http://localhost:3000/animations>

### Tools
- `build/animation_pipeline.py` - the rig + clip baking
  - `--unit <faction>/<class>`  one unit
  - `--all` / `--faction <id>`  batch
  - `--line armed|bare|armored`  source line (bare / armored animatable too)
- `build/anim_overview.py` - manifest + overview sheets
