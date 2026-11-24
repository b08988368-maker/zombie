import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateZombieHealth, type ZoneId } from '../config/balance';
import { CAMPAIGN_WAYPOINTS, computeCampaignSnapshot, type CampaignWorldInput } from './campaign';

function baseCampaignInput(): CampaignWorldInput {
  return {
    unlockedZones: new Set<ZoneId>(['farmhouse']),
    powerOn: false,
    fuses: [
      { zone: 'barn', x: 18, z: -2, collected: false },
      { zone: 'lab_wing', x: -12, z: -24, collected: false },
      { zone: 'bunker', x: -18, z: -38, collected: false },
    ],
    reactorPurged: false,
    wardenDefeated: false,
    radioActive: false,
    radioDefendRemaining: 35,
    radioDefendDuration: 35,
    bossSpawned: false,
    bossDefeated: false,
    extracted: false,
    endlessMode: false,
    wardenPos: null,
    bossPos: null,
    playerX: 0,
    playerZ: 15,
    playerYaw: 0,
  };
}

test('campaign progresses through all 6 chapters with accurate targets and bearings', () => {
  // Ch 1: Farmhouse -> Silo Yard Gate
  const ch1 = computeCampaignSnapshot(baseCampaignInput());
  assert.equal(ch1.chapter, 1);
  assert.equal(ch1.phase, 'breach_yard');
  assert.deepEqual(ch1.targetPos, CAMPAIGN_WAYPOINTS.siloYardDoor);
  assert.ok(ch1.targetDistance !== null && ch1.targetDistance > 0);

  // Ch 2: Unlocked Silo Yard -> Unlock Lab Door -> Flip Power
  const unlockedYard = new Set<ZoneId>(['farmhouse', 'silo_yard']);
  const ch2a = computeCampaignSnapshot({ ...baseCampaignInput(), unlockedZones: unlockedYard });
  assert.equal(ch2a.chapter, 2);
  assert.deepEqual(ch2a.targetPos, CAMPAIGN_WAYPOINTS.labDoor);

  const unlockedLab = new Set<ZoneId>(['farmhouse', 'silo_yard', 'lab_wing']);
  const ch2b = computeCampaignSnapshot({ ...baseCampaignInput(), unlockedZones: unlockedLab });
  assert.equal(ch2b.chapter, 2);
  assert.deepEqual(ch2b.targetPos, CAMPAIGN_WAYPOINTS.powerSwitch);

  // Ch 3: Power on -> points to unlocked lab fuse first, then routes to Barn door when remaining fuses are locked
  const ch3a = computeCampaignSnapshot({
    ...baseCampaignInput(),
    unlockedZones: unlockedLab,
    powerOn: true,
  });
  assert.equal(ch3a.chapter, 3);
  assert.equal(ch3a.phase, 'recover_fuses');
  assert.deepEqual(ch3a.targetPos, { x: -12, z: -24 });

  const ch3b = computeCampaignSnapshot({
    ...baseCampaignInput(),
    unlockedZones: unlockedLab,
    powerOn: true,
    fuses: [
      { zone: 'barn', x: 18, z: -2, collected: false },
      { zone: 'lab_wing', x: -12, z: -24, collected: true },
      { zone: 'bunker', x: -18, z: -38, collected: false },
    ],
  });
  assert.equal(ch3b.chapter, 3);
  assert.deepEqual(ch3b.targetPos, CAMPAIGN_WAYPOINTS.barnDoor);

  // Ch 4: All fuses collected -> Bunker Bulkhead -> Reactor Core -> Defeat Warden
  const allFuses = baseCampaignInput().fuses.map((f) => ({ ...f, collected: true }));
  const ch4a = computeCampaignSnapshot({
    ...baseCampaignInput(),
    unlockedZones: unlockedLab,
    powerOn: true,
    fuses: allFuses,
  });
  assert.equal(ch4a.chapter, 4);
  assert.equal(ch4a.phase, 'purge_reactor');
  assert.deepEqual(ch4a.targetPos, CAMPAIGN_WAYPOINTS.bunkerDoor);

  const unlockedAll = new Set<ZoneId>(['farmhouse', 'silo_yard', 'barn', 'lab_wing', 'bunker']);
  const ch4b = computeCampaignSnapshot({
    ...baseCampaignInput(),
    unlockedZones: unlockedAll,
    powerOn: true,
    fuses: allFuses,
  });
  assert.deepEqual(ch4b.targetPos, CAMPAIGN_WAYPOINTS.reactorCore);

  const ch4c = computeCampaignSnapshot({
    ...baseCampaignInput(),
    unlockedZones: unlockedAll,
    powerOn: true,
    fuses: allFuses,
    reactorPurged: true,
    wardenPos: { x: -10, z: -32 },
  });
  assert.equal(ch4c.phase, 'defeat_warden');
  assert.deepEqual(ch4c.targetPos, { x: -10, z: -32 });

  // Ch 5: Defend Radio -> Defeat Alpha Bloom Brute
  const ch5a = computeCampaignSnapshot({
    ...baseCampaignInput(),
    unlockedZones: unlockedAll,
    powerOn: true,
    fuses: allFuses,
    reactorPurged: true,
    wardenDefeated: true,
    radioActive: true,
    radioDefendRemaining: 14.2,
  });
  assert.equal(ch5a.chapter, 5);
  assert.equal(ch5a.phase, 'defend_radio');
  assert.ok(ch5a.instruction.includes('15s'));

  const ch5b = computeCampaignSnapshot({
    ...baseCampaignInput(),
    unlockedZones: unlockedAll,
    powerOn: true,
    fuses: allFuses,
    reactorPurged: true,
    wardenDefeated: true,
    bossSpawned: true,
    bossPos: { x: 2, z: -22 },
  });
  assert.equal(ch5b.phase, 'defeat_boss');
  assert.deepEqual(ch5b.targetPos, { x: 2, z: -22 });

  // Ch 6: Extract -> Victory / Endless
  const ch6 = computeCampaignSnapshot({
    ...baseCampaignInput(),
    unlockedZones: unlockedAll,
    powerOn: true,
    fuses: allFuses,
    reactorPurged: true,
    wardenDefeated: true,
    bossSpawned: true,
    bossDefeated: true,
  });
  assert.equal(ch6.chapter, 6);
  assert.equal(ch6.phase, 'extract');
  assert.deepEqual(ch6.targetPos, CAMPAIGN_WAYPOINTS.extractionFlare);
});

test('difficulty presets scale zombie health cleanly while keeping Survivor 1.0x default', () => {
  assert.equal(calculateZombieHealth(1), 150);
  assert.equal(calculateZombieHealth(1, 'survivor'), 150);
  assert.equal(calculateZombieHealth(1, 'recruit'), 117);
  assert.equal(calculateZombieHealth(1, 'nightmare'), 188);
});
