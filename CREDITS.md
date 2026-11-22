# HOLLOWFIELD — Credits & Asset Provenance

All 3D geometry, PBR surface maps (albedo, normal, roughness/metalness, decals), UI typography integration, and Web Audio synthesized soundscapes in HOLLOWFIELD are original works created specifically for this project (CC0 / MIT compatible), with zero external copyrighted assets.

## Libraries & Tools
- **Three.js** — MIT License — 3D WebGL2 rendering engine
- **@dimforge/rapier3d-compat** — Apache-2.0 License — Physics & capsule character controller
- **three-mesh-bvh** — MIT License — BVH raycasting acceleration
- **postprocessing (pmndrs)** — MIT License — Post-processing effects pipeline
- **React & React DOM** — MIT License — HUD and menu UI overlay
- **Lucide React** — ISC License — Functional UI icons
- **Tailwind CSS** — MIT License — UI styling
- **Vitest & Playwright** — MIT / Apache-2.0 — Automated unit and browser testing

## Typography
- **Oswald**, **Plus Jakarta Sans**, **JetBrains Mono** — SIL Open Font License (OFL 1.1) via Google Fonts

## Original Procedural Assets
- **Environment & Props (`src/engine/ProceduralAssets.ts`, `src/game/MapBuilder.ts`)**: Original procedural PBR textures and composite 3D meshes (1986 Hollowfield Agricultural Research Station).
- **Weapons & Characters (`src/game/WeaponSystem.ts`, `src/game/ZombieSystem.ts`)**: Original composite 3D viewmodels and articulated infected models.
- **Audio (`src/engine/AudioEngine.ts`)**: Original Web Audio API procedural synthesis (gunshots, reload mechanics, zombie vocalizations, perk jingles, ambient station drones).
