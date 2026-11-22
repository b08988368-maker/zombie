# HOLLOWFIELD — Architecture

## Overview
HOLLOWFIELD is a single-player 3D round-based survival FPS running at a fixed 60 Hz simulation step inside a Three.js WebGL2 renderer with Rapier WASM physics and `three-mesh-bvh` hitscan raycasting.

## Directory Layout
- `src/config/balance.ts` — Single source of truth for all gameplay numbers, formulas, weapon stats, enemy stats, perk costs, and round pacing.
- `src/engine/` — Core runtime:
  - `GameEngine.ts` — Fixed-timestep loop, state orchestration, deterministic bot/test hooks, render interpolation, and software-WebGL pacing guard.
  - `PhysicsWorld.ts` — Rapier3D WASM capsule controller for the player and dynamic bodies (grenades, projectiles).
  - `BvhWorld.ts` — Merged static world collision geometry indexed by `three-mesh-bvh` for fast hitscan and sightline queries.
  - `NavGrid.ts` — 1.0 m cell navigation grid + Dijkstra flow-field recomputed at <= 10 Hz only when the player changes cell, plus spatial hash for zombie separation steering.
  - `AudioEngine.ts` — Procedural Web Audio synthesizer with master limiter, bus gains (master, music, sfx, voice), positional 3D zombie/machine audio, layered gunshots, perk jingles, and low-health ducking.
  - `ProceduralAssets.ts` — Zero-404 procedural canvas PBR textures (albedo, normal, roughness/AO), chalk wall-buy decals, and composite 3–12 part procedural meshes (weapons, zombies, perks, props, vehicles).
  - `PostProcessPipeline.ts` — `postprocessing` EffectComposer with ACES tone mapping, selective bloom, vignette, chromatic aberration on hit, and low-health desaturation.
- `src/game/` — Gameplay systems:
  - `PlayerController.ts` — Capsule movement, sprint/crouch/jump, head bob, mouse look, ADS, melee lunge, grenade throw, health regeneration, Second Wind self-revive.
  - `WeaponSystem.ts` — 7-weapon roster, first-person viewmodels with procedural animations, recoil/camera kick, hitscan BVH raycasts, Phase Cannon projectile splash, hit/kill markers, decals/particles.
  - `ZombieSystem.ts` — 24-alive cap, reserve queue, barricade tear/climb, 4 enemy types (Shambler, Hound, Bloater, Brute), directional hit reactions, stuck detection, corpse shader dissolve.
  - `RoundSystem.ts` — Round state machine, special Hound rounds, Brute spawns, radio announcer cues.
  - `InteractablesSystem.ts` — Doors, barricades, wall-buys, Supply Crate (rolling, fire sale, relocation), Power Switch, Overclock Bench, 5 Perk machines, Electric Trap, Power-ups, and 3-step Easter Egg.
  - `MapBuilder.ts` — 90 m × 90 m "Hollowfield Station" across 5 interconnected zones (Farmhouse, Barn, Silo Yard, Lab Wing, Underground Bunker) with natural tree-line perimeter and authored lighting.
- `src/ui/` — Minimal diegetic HUD, tally-mark round counter, floating point deltas, main menu (over live 3D backdrop), pause/settings (quality, FOV, sensitivity, keybindings, audio buses), score screen, F3 perf overlay.
