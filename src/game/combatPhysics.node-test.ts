import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeDirectionalFall,
  computeRelativeThreatAngle,
  isAngleOutsideFov,
  resolvePlayerZombieStandoff,
} from './combatPhysics';

test('resolvePlayerZombieStandoff prevents zombie from clipping inside player capsule', () => {
  const alwaysWalkable = () => true;
  const res = resolvePlayerZombieStandoff(0.1, 0.1, 0, 0, 0, 1.08, alwaysWalkable);
  assert.equal(res.pushed, true);
  const dist = Math.hypot(res.nx, res.nz);
  assert.ok(dist >= 1.079, `expected pushed distance >= 1.08, got ${dist}`);
  assert.ok(Math.hypot(res.shoveX, res.shoveZ) > 0, 'expected non-zero player shove vector');
});

test('resolvePlayerZombieStandoff leaves distant zombies untouched', () => {
  const res = resolvePlayerZombieStandoff(2.5, 0, 0, 0, 0, 0.85, () => true);
  assert.equal(res.pushed, false);
  assert.equal(res.nx, 2.5);
  assert.equal(res.nz, 0);
});

test('resolvePlayerZombieStandoff slides zombie tangentially around player when backed against a wall', () => {
  // Wall blocks z > 0.35; player backed at (0, 0), zombie clipped at (0, 0.25)
  const walkableWithWallBehindPlayer = (_x: number, z: number) => z <= 0.35;
  const res = resolvePlayerZombieStandoff(0, 0.25, 0, 0, 0, 1.36, walkableWithWallBehindPlayer);
  assert.equal(res.pushed, true);
  assert.ok(walkableWithWallBehindPlayer(res.nx, res.nz), 'standoff target must remain walkable');
  const dist = Math.hypot(res.nx, res.nz);
  assert.ok(dist >= 1.35, `expected tangential slide standoff >= 1.35m, got ${dist}`);
});

test('computeRelativeThreatAngle accurately identifies front, right, left, and behind threats', () => {
  // Facing -Z (yaw = 0)
  assert.ok(Math.abs(computeRelativeThreatAngle(0, -5, 0, 0, 0)) < 0.01);
  assert.ok(Math.abs(computeRelativeThreatAngle(5, 0, 0, 0, 0) - Math.PI / 2) < 0.01);
  assert.ok(Math.abs(computeRelativeThreatAngle(-5, 0, 0, 0, 0) + Math.PI / 2) < 0.01);
  assert.ok(Math.abs(Math.abs(computeRelativeThreatAngle(0, 5, 0, 0, 0)) - Math.PI) < 0.01);

  // Turned 90 deg right (yaw = -PI/2, facing +X): attacker at +X is now straight ahead (0 rad)
  assert.ok(Math.abs(computeRelativeThreatAngle(5, 0, 0, 0, -Math.PI / 2)) < 0.01);
  assert.equal(isAngleOutsideFov(0.1), false);
  assert.equal(isAngleOutsideFov(Math.PI * 0.85), true);
});

test('computeDirectionalFall falls backward on frontal hit and forward on back hit', () => {
  // Zombie facing +Z (yaw = 0); player shoots toward +Z (hit in back) -> falls forward (-pitchX)
  const hitFromBehind = computeDirectionalFall(0, 1, 0, 3.0);
  assert.ok(hitFromBehind.targetPitchX < 0, 'shot from behind should topple forward');
  assert.ok(hitFromBehind.slideVz > 2.5);

  // Zombie facing +Z (yaw = 0); player shoots toward -Z (frontal shot) -> falls backward (+pitchX)
  const hitFromFront = computeDirectionalFall(0, -1, 0, 3.0);
  assert.ok(hitFromFront.targetPitchX > 0, 'frontal shot should topple backward');
  assert.ok(hitFromFront.slideVz < -2.5);
});

import {
  accelerateWishDir,
  applyGroundFriction,
  computeSmoothAimAssistStep,
  stepAdsBlend,
  stepSlidePhysics,
} from './combatPhysics';

test('applyGroundFriction + accelerateWishDir reaches exact sprintSpeed without steady-state drag loss', () => {
  let vx = 0;
  let vz = 0;
  const dt = 1 / 60;
  for (let i = 0; i < 60; i++) {
    const fric = applyGroundFriction(vx, vz, 8.5, 1.8, dt);
    const acc = accelerateWishDir(fric.vx, fric.vz, 0, -1, 7.2, 14.0, dt);
    vx = acc.vx;
    vz = acc.vz;
  }
  const speed = Math.hypot(vx, vz);
  assert.ok(Math.abs(speed - 7.2) < 0.02, `expected speed ~7.2 m/s, got ${speed}`);
});

test('accelerateWishDir preserves airborne momentum when no movement key is held', () => {
  const air = accelerateWishDir(0, -6.8, 0, 0, 4.6, 3.2, 1 / 60);
  assert.equal(air.vx, 0);
  assert.equal(air.vz, -6.8);
});

test('stepSlidePhysics tapers burst speed cleanly and terminates below minSpeed', () => {
  let vx = 0;
  let vz = -10.4;
  let timer = 0.68;
  let ended = false;
  for (let i = 0; i < 50; i++) {
    const res = stepSlidePhysics({
      vx,
      vz,
      dirX: 0,
      dirZ: -1,
      wishX: 0,
      wishZ: -1,
      slideTimer: timer,
      minSpeed: 2.8,
      dt: 1 / 60,
    });
    vx = res.vx;
    vz = res.vz;
    timer = res.nextTimer;
    ended = res.ended;
    if (ended) break;
  }
  assert.equal(ended, true);
  assert.ok(Math.hypot(vx, vz) < 10.4);
});

test('stepAdsBlend and computeSmoothAimAssistStep interpolate smoothly without snapping', () => {
  let blend = 0;
  for (let i = 0; i < 8; i++) {
    blend = stepAdsBlend(blend, true, 16, 1 / 60);
  }
  assert.ok(blend > 0.7 && blend < 1.0, `expected smooth partial blend, got ${blend}`);

  const assist = computeSmoothAimAssistStep(0.12, -0.04, 0.992, true, 1 / 60);
  assert.ok(assist.deltaYaw > 0 && assist.deltaYaw < 0.03, 'should pull gradually, not hard-snap');
  assert.ok(assist.sensFriction < 0.7, 'should apply subtle target friction inside reticle cone');

  const outOfCone = computeSmoothAimAssistStep(0.5, 0.2, 0.9, true, 1 / 60);
  assert.equal(outOfCone.deltaYaw, 0);
  assert.equal(outOfCone.sensFriction, 1.0);
});

import {
  canZombieStrikePlayer,
  computeOffscreenThreats,
  selectSafeSpawnPoint,
} from './combatPhysics';

test('selectSafeSpawnPoint avoids spawning right next to player or falling back to index 0', () => {
  const spawns = [
    { id: 'near', position: { x: 2, z: 0 } },
    { id: 'mid', position: { x: 9, z: 0 } },
    { id: 'far', position: { x: 16, z: 0 } },
  ];
  // When >= 12m spawn exists, picks 'far'
  const pickedPref = selectSafeSpawnPoint(spawns, 0, 0, 0.1, 12, 7.5);
  assert.equal(pickedPref?.id, 'far');

  // When only mid (9m) and near (2m) exist, avoids near and picks mid
  const pickedFallback = selectSafeSpawnPoint(spawns.slice(0, 2), 0, 0, 0.1, 12, 7.5);
  assert.equal(pickedFallback?.id, 'mid');

  // Even when all are inside fallbackMinDist, picks farthest instead of valid[0]
  const closeSpawns = [
    { id: 'too_close', position: { x: 1.5, z: 0 } },
    { id: 'less_close', position: { x: 6.0, z: 0 } },
  ];
  const pickedFarthest = selectSafeSpawnPoint(closeSpawns, 0, 0, 0.0, 12, 7.5);
  assert.equal(pickedFarthest?.id, 'less_close');
});

test('canZombieStrikePlayer blocks underground, staggered, dodged, cross-floor, and cover-blocked strikes', () => {
  const base = {
    isRising: false,
    isStaggered: false,
    horizontalDist: 1.5,
    maxReach: 1.84,
    zombieY: 0,
    playerFeetY: 0,
    zombieYaw: 0, // facing +Z
    toPlayerX: 0,
    toPlayerZ: 1.5,
    hasDualHeightLos: true,
  };
  assert.equal(canZombieStrikePlayer(base), true);
  assert.equal(canZombieStrikePlayer({ ...base, isRising: true }), false);
  assert.equal(canZombieStrikePlayer({ ...base, zombieBodyY: -0.58 }), false);
  assert.equal(canZombieStrikePlayer({ ...base, zombieBodyY: 0.16 }), true);
  assert.equal(canZombieStrikePlayer({ ...base, isStaggered: true }), false);
  assert.equal(canZombieStrikePlayer({ ...base, horizontalDist: 2.05 }), false);
  assert.equal(canZombieStrikePlayer({ ...base, playerFeetY: 2.5 }), false);
  assert.equal(canZombieStrikePlayer({ ...base, hasDualHeightLos: false }), false);
  // Player slid behind zombie (zombie facing +Z, player now at -Z)
  assert.equal(canZombieStrikePlayer({ ...base, toPlayerZ: -1.4 }), false);
  // Zombie mid-window vault (y > 0.35) or zero-distance inside capsule (< 0.35) must not hit
  assert.equal(canZombieStrikePlayer({ ...base, zombieY: 0.65 }), false);
  assert.equal(canZombieStrikePlayer({ ...base, horizontalDist: 0.2 }), false);
});

test('computeOffscreenThreats detects runners within widened 10.5m range, prioritizes telegraphed specials, and ignores wall-occluded, climbing, cross-floor, and widescreen on-screen targets', () => {
  const widescreenHalfFov = 0.86; // ~49.3 deg
  const threats = computeOffscreenThreats(
    [
      { id: 1, x: 0, y: 0, z: 9.2, state: 'chase', speedClass: 'run', isRising: false, hasLos: true },
      { id: 2, x: 4.5, y: 0, z: 0, state: 'bloater_fuse', speedClass: 'walk', isRising: false, hasLos: true },
      { id: 3, x: 0, y: 0, z: -3.0, state: 'chase', speedClass: 'sprint', isRising: false, hasLos: true }, // in front FOV
      { id: 4, x: 0, y: 0, z: 2.0, state: 'chase', speedClass: 'walk', isRising: true, hasLos: true }, // still rising
      { id: 5, x: -3.0, y: 0, z: 0, state: 'tear_board', speedClass: 'walk', isRising: false, hasLos: true }, // outside window
      { id: 6, x: 0, y: 0, z: 2.5, state: 'chase', speedClass: 'sprint', isRising: false, hasLos: false }, // sealed behind solid wall
      { id: 7, x: -3.5, y: 0.6, z: 0, state: 'climb_in', speedClass: 'walk', isRising: false, hasLos: true }, // mid window climb
      { id: 8, x: 3.5, y: 0, z: 0, state: 'chase', speedClass: 'sprint', isRising: false, hasLos: true }, // different floor (hayloft at y=2.6)
      { id: 9, x: 2.5, y: 0, z: -3.2, state: 'chase', speedClass: 'run', isRising: false, hasLos: true }, // ~38 deg: visible inside 16:9 widescreen
    ],
    0,
    0,
    0,
    10.5,
    widescreenHalfFov,
    4,
    2.6,
  );
  // With playerFeetY = 2.6, all ground-floor threats (y=0) are excluded (same-floor only)
  assert.equal(threats.length, 0);

  const sameFloorThreats = computeOffscreenThreats(
    [
      { id: 1, x: 0, y: 0, z: 9.2, state: 'chase', speedClass: 'run', isRising: false, hasLos: true },
      { id: 2, x: 4.5, y: 0, z: 0, state: 'bloater_fuse', speedClass: 'walk', isRising: false, hasLos: true },
      { id: 3, x: 0, y: 0, z: -3.0, state: 'chase', speedClass: 'sprint', isRising: false, hasLos: true },
      { id: 4, x: 0, y: 0, z: 2.0, state: 'chase', speedClass: 'walk', isRising: true, hasLos: true },
      { id: 5, x: -3.0, y: 0, z: 0, state: 'tear_board', speedClass: 'walk', isRising: false, hasLos: true },
      { id: 6, x: 0, y: 0, z: 2.5, state: 'chase', speedClass: 'sprint', isRising: false, hasLos: false },
      { id: 7, x: -3.5, y: 0.6, z: 0, state: 'climb_in', speedClass: 'walk', isRising: false, hasLos: true },
      { id: 9, x: 2.5, y: 0, z: -3.2, state: 'chase', speedClass: 'run', isRising: false, hasLos: true },
    ],
    0,
    0,
    0,
    10.5,
    widescreenHalfFov,
    4,
    0,
  );
  assert.equal(sameFloorThreats.length, 2);
  assert.equal(sameFloorThreats[0]?.id, 2);
  assert.equal(sameFloorThreats[0]?.isAttacking, true);
  assert.equal(sameFloorThreats[1]?.id, 1);
});

import { canBloaterDamagePlayer, formatDamageCallout } from './combatPhysics';

test('canBloaterDamagePlayer blocks explosion splash behind solid walls/cover', () => {
  assert.equal(
    canBloaterDamagePlayer({ dist: 2.1, maxRadius: 4.5, hasDualHeightLos: false }),
    false,
  );
  assert.equal(
    canBloaterDamagePlayer({ dist: 4.6, maxRadius: 4.5, hasDualHeightLos: true }),
    false,
  );
  assert.equal(
    canBloaterDamagePlayer({ dist: 2.8, maxRadius: 4.5, hasDualHeightLos: true }),
    true,
  );
});

test('formatDamageCallout clearly identifies enemy source, direction, and damage', () => {
  assert.equal(formatDamageCallout('shambler', Math.PI, 34), 'SHAMBLER · BEHIND (-34)');
  assert.equal(formatDamageCallout('brute_charge', -Math.PI / 2, 50), 'BRUTE CHARGE · LEFT (-50)');
  assert.equal(formatDamageCallout('bloater_blast', Math.PI / 2, 42.4), 'BLOATER BLAST · RIGHT (-42)');
  assert.equal(formatDamageCallout('alpha_boss', 0, 55), 'ALPHA BLOOM BRUTE · AHEAD (-55)');
});

