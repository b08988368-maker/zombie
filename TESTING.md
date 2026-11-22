# HOLLOWFIELD — Testing Guide

## Unit & Logic Tests (Vitest)
Run all deterministic simulation and formula tests:
```bash
npm test
```
Covers:
- Round zombie health table (`round 1 = 150`, `round 9 = 950`, `round 15 = 1683`, `round 30 = 7030`)
- Round zombie count formula and 24-alive cap + reserve queue
- Spawn delay decay and minimum cap
- Point economy (hit, body kill, headshot, melee, explosive, Double Points)
- Weapon damage falloff, Overclock Bench upgrade multipliers, Perk effects
- Flow-field pathing around obstacles and door-unlock connectivity
- Deterministic seeded 20-round bot simulation (special hound rounds, brutes, bloaters, power-up drops)

## Typecheck & Production Build
```bash
npm run lint
npm run build
```

## End-to-End Browser & Performance Tests (Playwright)
Start the dev server (or preview build) and run the Playwright verification suite:
```bash
npm run test:e2e
```
Includes:
- Smoke boot & WebGL canvas render check (zero console/page errors)
- Interactive player movement, shooting, ADS, reloading, barricade repair, and round progression
- 24-zombie AI navigation & anti-stuck verification
- Automated screenshot capture to `tests/artifacts/`
- Frame-time telemetry logging (p50 / p95 / p99)
