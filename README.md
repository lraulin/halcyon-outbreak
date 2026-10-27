# Halcyon Outbreak

A turn-based squad tactics game in Three.js: survival horror in a dead research annex, on a hex grid, with fully simulated ballistics.

```bash
npm install
npm run dev
```

Open http://localhost:5173 (add `#play` to skip the title screen).

## Mission
Lead Lantern Team (4 operatives) to grab the **V-7 sample case** in the north-east lab and carry it to the **extraction pad** in the west yard. Picking up the case trips the alarm and brings reinforcements.

## Controls
| Input | Action |
|---|---|
| LMB | select soldier / move to hex / click enemy to aim |
| WASD / arrows, Q/E, wheel, RMB-drag | pan, rotate 60°, zoom, orbit |
| 1–6 | aim · swap weapon · reload · grenade · medkit · overwatch |
| Tab / Enter | next soldier / end turn |
| Aim mode | the reticle follows the mouse, RMB-drag or WASD turns, wheel zooms, Tab cycles targets, LMB/Space fires, Esc cancels |

## Systems
- **Hex grid**: pointy-top axial coordinates (`src/hex.js`), Dijkstra move ranges and A* enemy pathing (`src/world.js`).
- **AP**: 4 AP per soldier (12 internal points, 1 per hex). Blue hexes leave enough AP to fire; yellow hexes are a dash.
- **Ballistics**: every bullet or pellet is a ray fired inside the weapon's spread cone and traced against prism colliders for cover and capsule hitboxes per body part (`src/collision.js`). The aim panel's hit chance comes from a Monte-Carlo run of the same trace, so cover, friendly fire and body parts are all physical.
- **Body parts**: headshots deal ×1.5; disabled legs halve movement; disabled arms hurt accuracy (soldiers) or attacks (monsters). Armor is per part (the Brute's torso plate).
- **The dead get up**: a Shambler killed without destroying its head may rise again two turns later. Shoot the twitching corpse's head to finish it.
- **Noise and stealth**: monsters start dormant. Gunfire wakes them within a radius that depends on the weapon.
- **Destruction**: crates, desks and sandbags break; fuel barrels explode and chain.
