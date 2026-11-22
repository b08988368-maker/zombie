# HOLLOWFIELD — Engineering Decisions Log

## D-001: Rapier WASM Compat Package (`@dimforge/rapier3d-compat`)
- **Decision:** Use `@dimforge/rapier3d-compat` instead of `@dimforge/rapier3d`.
- **Reason:** `@dimforge/rapier3d-compat` initializes via `await RAPIER.init()` cleanly in Vite dev and static production builds without requiring `vite-plugin-wasm` or top-level await bundler hacks.
- **Alternative Rejected:** `@dimforge/rapier3d` raw ESM/WASM bundle, which fails under certain static host MIME/rollup configurations.

## D-002: 100% Procedural PBR Assets & Web Audio Synthesis
- **Decision:** Generate all PBR textures (concrete, rusted corrugated metal, weathered barn wood, fungal soil, asphalt, lab tile, normal/roughness maps), composite 3D models (guns, skinned-style articulated zombies, perk machines, farmhouse/barn/silo/lab/bunker props), and layered Web Audio sound effects/music procedurally in TypeScript.
- **Reason:** Guarantees zero 404 network failures in offline/hermetic static deployments, keeps bundle size tiny and loading instant, and gives full artistic control over cohesive 1986 agricultural horror PBR materials with zero untextured primitives.
- **Alternative Rejected:** Runtime fetching external `.glb`/`.mp3` files from third-party CDNs (fragile, network-dependent, potential CORS/404 failure).

## D-003: Flow-Field Navigation Grid (1.0 m cells, <= 10 Hz)
- **Decision:** Implement a 92×92 cell (1.0 m) 2D flow field with zone/door connectivity masks, recomputed only when the player changes grid cell or a door opens, throttled to <= 10 Hz, combined with spatial-hash separation steering.
- **Reason:** Scales to 24+ active zombies in < 0.5 ms per tick with zero per-zombie A* allocation and eliminates conga-lining.
- **Alternative Rejected:** Per-zombie A* pathfinding every frame (O(N * grid) CPU spike and conga-line stacking).

## D-004: `postprocessing` (pmndrs) with Software-WebGL Guard
- **Decision:** Build the post-processing pipeline with `postprocessing` (`EffectComposer`, `RenderPass`, `BloomEffect`, `VignetteEffect`, `ToneMappingEffect`, `SMAAEffect`, custom damage/desat pass) on hardware GPUs, and detect software WebGL (`SwiftShader`/`llvmpipe`) at runtime to scale pixelRatio/shadows/multi-pass cost without changing scene content, layout, or gameplay logic.
- **Reason:** Meets the visual realism target on real GPUs while keeping headless Playwright verification responsive and deterministic.
- **Alternative Rejected:** Running heavy multi-pass MSAA + full-res bloom unconditionally in SwiftShader (causes >200 ms CPU stall per frame).

## D-005: Articulated Multi-Part Hierarchical Zombies with Shared Pose Matrices
- **Decision:** Construct zombies from hierarchical multi-part articulated rigs (pelvis, spine/torso, head with emissive eyes, upper/lower arms, upper/lower legs, clothing/blood variants) driven by procedural keyframe/state blending (walk, run, sprint, tear, climb, attack, hit-react, crawl, death) and custom `onBeforeCompile` shader dissolve for corpse fade-out.
- **Reason:** Delivers readable silhouette, directional hit regions (head/torso/limbs/back weakpoint), 6+ visual variants, and smooth corpse dissolve without external `.glb` download failures.
- **Alternative Rejected:** Single-primitive capsule/box enemies (prohibited by visual quality rules).
