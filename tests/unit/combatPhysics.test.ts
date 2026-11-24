import { describe, expect, it } from 'vitest';
import {
  canZombieStrikePlayer,
  computeDirectionalFall,
  computeOffscreenThreats,
  computeRelativeThreatAngle,
  isAngleOutsideFov,
  resolvePlayerZombieStandoff,
  selectSafeSpawnPoint,
} from '../../src/game/combatPhysics';

describe('HOLLOWFIELD Combat Physics & Threat Direction', () => {
  it('prevents zombies from clipping inside the player capsule', () => {
    const res = resolvePlayerZombieStandoff(0.1, 0.1, 0, 0, 0, 1.08, () => true);
    expect(res.pushed).toBe(true);
    const dist = Math.hypot(res.nx, res.nz);
    expect(dist).toBeGreaterThanOrEqual(1.079);
    expect(Math.hypot(res.shoveX, res.shoveZ)).toBeGreaterThan(0);
  });

  it('leaves distant zombies untouched', () => {
    const res = resolvePlayerZombieStandoff(2.5, 0, 0, 0, 0, 0.85, () => true);
    expect(res.pushed).toBe(false);
    expect(res.nx).toBe(2.5);
    expect(res.nz).toBe(0);
  });

  it('computes relative threat angles accurately across headings', () => {
    expect(Math.abs(computeRelativeThreatAngle(0, -5, 0, 0, 0))).toBeLessThan(0.01);
    expect(Math.abs(computeRelativeThreatAngle(5, 0, 0, 0, 0) - Math.PI / 2)).toBeLessThan(0.01);
    expect(Math.abs(computeRelativeThreatAngle(-5, 0, 0, 0, 0) + Math.PI / 2)).toBeLessThan(0.01);
    expect(Math.abs(Math.abs(computeRelativeThreatAngle(0, 5, 0, 0, 0)) - Math.PI)).toBeLessThan(0.01);
    expect(Math.abs(computeRelativeThreatAngle(5, 0, 0, 0, -Math.PI / 2))).toBeLessThan(0.01);
    expect(isAngleOutsideFov(0.1)).toBe(false);
    expect(isAngleOutsideFov(Math.PI * 0.85)).toBe(true);
  });

  it('computes directional collapse based on shot vector relative to zombie yaw', () => {
    const hitFromBehind = computeDirectionalFall(0, 1, 0, 3.0);
    expect(hitFromBehind.targetPitchX).toBeLessThan(0);
    expect(hitFromBehind.slideVz).toBeGreaterThan(2.5);

    const hitFromFront = computeDirectionalFall(0, -1, 0, 3.0);
    expect(hitFromFront.targetPitchX).toBeGreaterThan(0);
    expect(hitFromFront.slideVz).toBeLessThan(-2.5);
  });

  it('selects safe distant spawns and blocks impossible/cover-occluded zombie strikes', () => {
    const spawns = [
      { id: 'near', position: { x: 2, z: 0 } },
      { id: 'far', position: { x: 14, z: 0 } },
    ];
    expect(selectSafeSpawnPoint(spawns, 0, 0, 0.2, 12, 7.5)?.id).toBe('far');
    expect(
      canZombieStrikePlayer({
        isRising: false,
        isStaggered: false,
        horizontalDist: 1.5,
        maxReach: 1.84,
        zombieY: 0,
        playerFeetY: 0,
        zombieYaw: 0,
        toPlayerX: 0,
        toPlayerZ: 1.5,
        hasDualHeightLos: false,
      }),
    ).toBe(false);
    const threats = computeOffscreenThreats(
      [{ id: 7, x: 0, z: 6.0, state: 'chase', speedClass: 'sprint', isRising: false }],
      0,
      0,
      0,
    );
    expect(threats).toHaveLength(1);
    expect(threats[0]?.id).toBe(7);
  });

  it('slides zombies tangentially when player is against a wall and rejects climb_in/cross-floor/on-screen threats', () => {
    const wallCheck = (_x: number, z: number) => z <= 0.35;
    const res = resolvePlayerZombieStandoff(0, 0.25, 0, 0, 0, 1.36, wallCheck);
    expect(res.pushed).toBe(true);
    expect(wallCheck(res.nx, res.nz)).toBe(true);
    expect(Math.hypot(res.nx, res.nz)).toBeGreaterThanOrEqual(1.35);

    expect(
      canZombieStrikePlayer({
        isRising: false,
        isStaggered: false,
        horizontalDist: 0.25,
        maxReach: 1.96,
        zombieY: 0,
        playerFeetY: 0,
        zombieYaw: 0,
        toPlayerX: 0,
        toPlayerZ: 0.25,
        hasDualHeightLos: true,
      }),
    ).toBe(false);

    const filtered = computeOffscreenThreats(
      [
        { id: 1, x: -3.2, y: 0.6, z: 0, state: 'climb_in', speedClass: 'walk', isRising: false, hasLos: true },
        { id: 2, x: 3.5, y: 0, z: 0, state: 'chase', speedClass: 'sprint', isRising: false, hasLos: true },
        { id: 3, x: 2.5, y: 0, z: -3.2, state: 'chase', speedClass: 'run', isRising: false, hasLos: true },
      ],
      0,
      0,
      0,
      10.5,
      0.86,
      4,
      2.6,
    );
    expect(filtered).toHaveLength(0);
  });
});

