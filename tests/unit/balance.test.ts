import { describe, expect, it } from 'vitest';
import {
  BALANCE,
  calculateRoundZombieCount,
  calculateSpawnDelay,
  calculateZombieHealth,
  getSpeedClassWeights,
} from '../../src/config/balance';

describe('HOLLOWFIELD Balance & Round Formulas', () => {
  it('matches the exact round zombie health table', () => {
    expect(calculateZombieHealth(1)).toBe(150);
    expect(calculateZombieHealth(2)).toBe(250);
    expect(calculateZombieHealth(9)).toBe(950);
    expect(calculateZombieHealth(15)).toBe(1683);
    expect(calculateZombieHealth(30)).toBe(7030);
    expect(calculateZombieHealth(50)).toBe(47296);
  });

  it('matches solo zombie count per round', () => {
    const early = [6, 8, 13, 18, 24, 27, 28, 28, 29, 33];
    early.forEach((expected, idx) => {
      expect(calculateRoundZombieCount(idx + 1)).toBe(expected);
    });
    expect(calculateRoundZombieCount(11)).toBe(Math.round(24 * 0.15 * 11));
    expect(calculateRoundZombieCount(20)).toBe(Math.round(24 * 0.15 * 20));
  });

  it('decays spawn delay by 0.95 per round with 0.1s floor', () => {
    expect(calculateSpawnDelay(1)).toBeCloseTo(2.0, 4);
    expect(calculateSpawnDelay(2)).toBeCloseTo(1.9, 4);
    expect(calculateSpawnDelay(100)).toBe(0.1);
  });

  it('enforces weapon, knife scaling, overclock, and perk config invariants', () => {
    expect(Object.keys(BALANCE.weapons)).toHaveLength(7);
    expect(Object.keys(BALANCE.perks.list)).toHaveLength(5);
    expect(BALANCE.rounds.maxAlive).toBe(24);
    expect(BALANCE.economy.barricade.maxPlanks).toBe(6);

    // Knife kills Round 1 shambler (150 HP) in 1 hit, Round 2 (250 HP) requires 2 hits
    const r1Knife = BALANCE.player.knifeDamageBase;
    const r2Knife = BALANCE.player.knifeDamageBase + BALANCE.player.knifeDamagePerRoundStep;
    expect(r1Knife).toBeGreaterThanOrEqual(calculateZombieHealth(1));
    expect(r2Knife).toBeLessThan(calculateZombieHealth(2));

    // Overclock multipliers match §4
    expect(BALANCE.overclock.damageMult).toBe(2.5);
    expect(BALANCE.overclock.magMult).toBe(1.5);

    // Crate weights > 0 for all non-starting weapons
    expect(BALANCE.weapons.service_pistol.crateWeight).toBe(0);
    expect(BALANCE.weapons.phase_cannon.crateOnly).toBe(true);
    expect(BALANCE.weapons.phase_cannon.crateWeight).toBeGreaterThan(0);

    // Speed class weights sum to 1.0 across rounds
    for (const r of [1, 5, 9, 14, 20]) {
      const w = getSpeedClassWeights(r);
      expect(w.walk + w.run + w.sprint).toBeCloseTo(1.0, 5);
    }

    // Tactical slide & movement physics invariants
    expect(BALANCE.player.slideInitialSpeed).toBeGreaterThan(BALANCE.player.sprintSpeed);
    expect(BALANCE.player.groundAccel).toBeGreaterThan(BALANCE.player.friction);
  });
});

