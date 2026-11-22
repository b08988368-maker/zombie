import { describe, expect, it } from 'vitest';
import {
  BALANCE,
  calculateRoundZombieCount,
  calculateSpawnDelay,
  calculateZombieHealth,
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

  it('enforces weapon and perk config invariants', () => {
    expect(Object.keys(BALANCE.weapons)).toHaveLength(7);
    expect(Object.keys(BALANCE.perks.list)).toHaveLength(5);
    expect(BALANCE.rounds.maxAlive).toBe(24);
    expect(BALANCE.economy.barricade.maxPlanks).toBe(6);
  });
});
