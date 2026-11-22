# HOLLOWFIELD

**HOLLOWFIELD** is a single-player 3D round-based zombie survival first-person shooter set in 1986 at an abandoned agricultural research station overrun by a failed fungal experiment ("the Bloom").

## Quick Start
```bash
npm install
npm run dev
```
Open `http://localhost:3000` in a modern WebGL2 desktop browser (Chrome, Edge, or Firefox).

For a static production bundle:
```bash
npm run build
npm run preview
```

## Controls (Default, Rebindable in Settings)
- **Mouse**: Aim / Look (click viewport to lock pointer)
- **Left Click**: Fire Weapon
- **Right Click**: Aim Down Sights (ADS)
- **W / A / S / D**: Move
- **Shift**: Sprint
- **C**: Crouch
- **Space**: Jump
- **R**: Reload
- **Q**: Swap Weapon
- **F**: Hold to Interact (Doors, Wall-Buys, Barricades, Supply Crate, Perks, Power, Overclock Bench, Trap, Easter Egg)
- **V**: Knife Melee Lunge
- **G**: Throw Frag Grenade
- **F3**: Toggle Performance Telemetry Overlay
- **Esc / P**: Pause & Settings

## Zones & Progression
1. **Farmhouse Quarters**: Starting holdout with 2 barricaded windows, the *Hedgerow* pump shotgun wall-buy (1500 PTS), and the Silo Yard Gate (750 PTS).
2. **Silo Yard**: Foggy exterior loop around twin silos and a ruined tractor, featuring Supply Crate Slot A and the Electric Arc Trap (1000 PTS).
3. **Timber Barn**: Unlocked for 1000 PTS. Houses the *Rattler* SMG (1000 PTS), *Quickhands Elixir* (3000 PTS), 3 barricade windows, and an elevated hayloft vantage.
4. **Bio-Lab Wing**: Unlocked for 1250 PTS. Houses the **Station Power Switch**, *Ironsight* rifle (1200 PTS), *Ironhide Tonic* (2500 PTS), and the Emergency Telemetry Radio.
5. **Underground Bunker**: Unlocked for 1500 PTS. Houses the **Overclock Bench** (5000 PTS), *Second Wind* (500 PTS), *Twin Barrel Brew* (2000 PTS), and *Marathon Cordial* (2000 PTS).

## Testing
```bash
npm run lint
npm test
npm run build
npm run test:e2e
```
See `TESTING.md`, `EASTER_EGG.md`, `ARCHITECTURE.md`, `DECISIONS.md`, and `CREDITS.md` for complete technical documentation.

## Known Notes
- Headless software WebGL (SwiftShader) automatically scales down pixel ratio, real-time shadow maps, and multi-pass post-processing to maintain responsive verification frame pacing while preserving identical gameplay logic and scene lighting.
