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
});

