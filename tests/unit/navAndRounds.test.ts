import { describe, expect, it } from 'vitest';
import { BALANCE, calculateRoundZombieCount } from '../../src/config/balance';
import { NavGrid } from '../../src/engine/NavGrid';
import { createSeededRng } from '../../src/game/types';

describe('Flow-Field NavGrid & Deterministic 20-Round Simulation', () => {
  it('routes around static walls and opens flow through unlocked doors', () => {
    const nav = new NavGrid();
    // Enclosed room x=-14..0, z=10..26 with a door gap at x=-9..-5, z=10
    nav.addStaticObstacle({ minX: -14, maxX: -9, minZ: 9.7, maxZ: 10.3 }, 0.1);
    nav.addStaticObstacle({ minX: -5, maxX: 0, minZ: 9.7, maxZ: 10.3 }, 0.1);
    nav.addStaticObstacle({ minX: -14.3, maxX: -13.7, minZ: 10, maxZ: 26 }, 0.1);
    nav.addStaticObstacle({ minX: -0.3, maxX: 0.3, minZ: 10, maxZ: 26 }, 0.1);
    nav.addStaticObstacle({ minX: -14, maxX: 0, minZ: 25.7, maxZ: 26.3 }, 0.1);
    nav.addDoorObstacle('farmhouse_to_yard', { minX: -9, maxX: -5, minZ: 9.7, maxZ: 10.3 });

    // Target in yard (-7, 4), query inside closed farmhouse (-7, 16)
    nav.updateFlowField(-7, 4, 1, true);
    const closedDist = nav.getDistanceToTarget(-7, 16);
    expect(closedDist).toBeGreaterThan(1000);

    // Open door -> path distance drops to ~12 cells
    nav.setDoorOpen('farmhouse_to_yard', true);
    nav.updateFlowField(-7, 4, 1, true);
    const openDist = nav.getDistanceToTarget(-7, 16);
    expect(openDist).toBeLessThan(18);

    const flow = { x: 0, z: 0 };
    nav.sampleFlow(-7, 16, flow);
    expect(Math.hypot(flow.x, flow.z)).toBeGreaterThan(0.9);
  });

  it('computes spatial-hash separation steering to avoid zombie stacking', () => {
    const nav = new NavGrid();
    const px = new Float32Array(24);
    const pz = new Float32Array(24);
    const active = new Uint8Array(24);
    active[0] = 1;
    active[1] = 1;
    px[0] = 0;
    pz[0] = 0;
    px[1] = 0.2;
    pz[1] = 0;

    nav.rebuildSpatialHash(px, pz, active, 24);
    const sep = { x: 0, z: 0 };
    nav.computeSeparation(0, px[0]!, pz[0]!, px, pz, BALANCE.nav.separationRadius, sep);
    expect(sep.x).toBeLessThan(0); // pushed away from zombie 1 at +0.2
  });

  it('simulates rounds 1-20 deterministically with special hound rounds, brutes, and maxAlive=24', () => {
    const rng = createSeededRng(19861031);
    let nextHoundRound = rng.int(5, 7);
    const houndRounds: number[] = [];
    const bruteRounds: number[] = [];

    for (let r = 1; r <= 20; r++) {
      const isHound = r === nextHoundRound;
      if (isHound) {
        houndRounds.push(r);
        nextHoundRound = r + rng.int(4, 6);
      } else {
        const count = calculateRoundZombieCount(r);
        expect(count).toBeGreaterThanOrEqual(6);
        const maxConcurrent = Math.min(count, BALANCE.rounds.maxAlive);
        expect(maxConcurrent).toBeLessThanOrEqual(24);

        if (
          r >= BALANCE.rounds.bruteFirstRound &&
          (r - BALANCE.rounds.bruteFirstRound) % BALANCE.rounds.bruteInterval === 0
        ) {
          bruteRounds.push(r);
        }
      }
    }

    expect(houndRounds.length).toBeGreaterThanOrEqual(3);
    expect(houndRounds[0]).toBeGreaterThanOrEqual(5);
    expect(houndRounds[0]).toBeLessThanOrEqual(7);
    expect(bruteRounds.length).toBeGreaterThanOrEqual(3);
  });
});
