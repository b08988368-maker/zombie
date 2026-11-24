import type { DamageSource } from './types';

export interface CircleEntity {
  x: number;
  z: number;
  radius: number;
}

export interface StandoffResult {
  nx: number;
  nz: number;
  pushed: boolean;
  shoveX: number;
  shoveZ: number;
}

/**
 * Resolves solid horizontal overlap between an attacker/zombie at (zx, zz)
 * and the player at (px, pz), preventing the zombie from ever clipping inside
 * the player's camera/capsule while computing a physical shove vector on the player.
 */
export function resolvePlayerZombieStandoff(
  zx: number,
  zz: number,
  zombieYaw: number,
  px: number,
  pz: number,
  minDistance: number,
  isWalkable: (x: number, z: number) => boolean,
): StandoffResult {
  const dx = zx - px;
  const dz = zz - pz;
  const distSq = dx * dx + dz * dz;
  if (distSq >= minDistance * minDistance) {
    return { nx: zx, nz: zz, pushed: false, shoveX: 0, shoveZ: 0 };
  }

  let dirX: number;
  let dirZ: number;
  const dist = Math.sqrt(distSq);
  if (dist > 0.001) {
    dirX = dx / dist;
    dirZ = dz / dist;
  } else {
    // Fallback: push zombie in front of its reverse facing so it doesn't sit at (0,0) offset
    dirX = -Math.sin(zombieYaw);
    dirZ = -Math.cos(zombieYaw);
    if (Math.hypot(dirX, dirZ) < 0.01) {
      dirX = 0;
      dirZ = 1;
    }
  }

  const targetX = px + dirX * minDistance;
  const targetZ = pz + dirZ * minDistance;
  const pen = minDistance - dist;

  let nx = zx;
  let nz = zz;
  if (isWalkable(targetX, targetZ)) {
    nx = targetX;
    nz = targetZ;
  } else {
    // Search tangential angles around the player so corner/wall-pinned players never get overlapped
    const slideAngles = [
      0.44, -0.44, 0.87, -0.87, 1.31, -1.31, 1.75, -1.75, 2.18, -2.18, 2.62, -2.62, 3.05,
    ];
    let placed = false;
    for (const ang of slideAngles) {
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const rx = dirX * ca - dirZ * sa;
      const rz = dirX * sa + dirZ * ca;
      const cx = px + rx * minDistance;
      const cz = pz + rz * minDistance;
      if (isWalkable(cx, cz)) {
        nx = cx;
        nz = cz;
        placed = true;
        break;
      }
    }

    // Tighter inner standoff ring (still well outside 0.35m player capsule + near-clip)
    if (!placed) {
      const innerDist = Math.max(0.92, minDistance * 0.78);
      const innerAngles = [0, 0.52, -0.52, 1.05, -1.05, 1.57, -1.57, 2.09, -2.09, 2.62, -2.62];
      for (const ang of innerAngles) {
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);
        const rx = dirX * ca - dirZ * sa;
        const rz = dirX * sa + dirZ * ca;
        const cx = px + rx * innerDist;
        const cz = pz + rz * innerDist;
        if (isWalkable(cx, cz)) {
          nx = cx;
          nz = cz;
          placed = true;
          break;
        }
      }
    }

    // Final axis-aligned fallback only if it keeps/increases separation
    if (!placed) {
      if (isWalkable(targetX, zz) && Math.hypot(targetX - px, zz - pz) > dist) {
        nx = targetX;
      } else if (isWalkable(zx, targetZ) && Math.hypot(zx - px, targetZ - pz) > dist) {
        nz = targetZ;
      }
    }
  }

  // Gentle physical shove away from zombie onto player
  const shoveMag = Math.min(2.4, pen * 4.5);
  return {
    nx,
    nz,
    pushed: true,
    shoveX: -dirX * shoveMag,
    shoveZ: -dirZ * shoveMag,
  };
}

/**
 * Computes relative screen-space angle (in radians, 0 = straight ahead,
 * +PI/2 = right, -PI/2 = left, +-PI = directly behind) from player pose to a world point.
 * Matches PlayerController yaw convention where yaw=0 faces -Z and turning right decreases yaw.
 */
export function computeRelativeThreatAngle(
  attackerX: number,
  attackerZ: number,
  playerX: number,
  playerZ: number,
  playerYaw: number,
): number {
  const dx = attackerX - playerX;
  const dz = attackerZ - playerZ;
  if (dx * dx + dz * dz < 1e-6) return Math.PI;
  const worldAngle = Math.atan2(dx, -dz);
  let rel = worldAngle + playerYaw;
  while (rel > Math.PI) rel -= Math.PI * 2;
  while (rel < -Math.PI) rel += Math.PI * 2;
  return rel;
}

export function isAngleOutsideFov(relativeAngleRad: number, halfFovRad = (52 * Math.PI) / 180): boolean {
  return Math.abs(relativeAngleRad) > halfFovRad;
}

export interface DirectionalFallParams {
  /** Pitch target in radians: negative = fall forward, positive = fall backward */
  targetPitchX: number;
  /** Roll target in radians */
  targetRollZ: number;
  /** Initial horizontal slide velocity X */
  slideVx: number;
  /** Initial horizontal slide velocity Z */
  slideVz: number;
}

/**
 * Computes realistic momentum-driven death collapse direction based on shot direction
 * relative to the zombie's facing yaw.
 * Note: Three.js positive X rotation on bodyGroup pitches the top backward (-Z local),
 * while negative X rotation pitches forward (+Z local facing).
 */
export function computeDirectionalFall(
  shotDirX: number,
  shotDirZ: number,
  zombieYaw: number,
  impulseSpeed: number,
  randomRollJitter = 0,
): DirectionalFallParams {
  const len = Math.hypot(shotDirX, shotDirZ);
  const dx = len > 0.001 ? shotDirX / len : Math.sin(zombieYaw);
  const dz = len > 0.001 ? shotDirZ / len : Math.cos(zombieYaw);

  // Zombie local forward is (sin(yaw), cos(yaw)), local right is (cos(yaw), -sin(yaw))
  const fwdX = Math.sin(zombieYaw);
  const fwdZ = Math.cos(zombieYaw);
  const rightX = Math.cos(zombieYaw);
  const rightZ = -Math.sin(zombieYaw);

  // If shot travels OPPOSITE zombie facing (frontal shot), forwardDot < 0 -> zombie falls BACKWARD (+pitchX)
  const forwardDot = dx * fwdX + dz * fwdZ;
  const sideDot = dx * rightX + dz * rightZ;

  // Determine primary topple pitch: backward (+1.48 rad) vs forward (-1.48 rad)
  const fallBackward = forwardDot <= 0.2;
  const targetPitchX = fallBackward ? 1.48 : -1.48;
  const targetRollZ = THREE_CLAMP(-sideDot * 0.42 + randomRollJitter, -0.55, 0.55);

  return {
    targetPitchX,
    targetRollZ,
    slideVx: dx * impulseSpeed,
    slideVz: dz * impulseSpeed,
  };
}

function THREE_CLAMP(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export interface HorizontalVel {
  vx: number;
  vz: number;
}

/**
 * Applies Source/Quake-style ground friction before wish-direction acceleration so
 * moving players achieve true walkSpeed/sprintSpeed instead of falling short.
 */
export function applyGroundFriction(
  vx: number,
  vz: number,
  friction: number,
  stopSpeed: number,
  dt: number,
): HorizontalVel {
  const speed = Math.hypot(vx, vz);
  if (speed < 0.0005) {
    return { vx: 0, vz: 0 };
  }
  const control = speed < stopSpeed ? stopSpeed : speed;
  const drop = control * friction * dt;
  const newSpeed = Math.max(0, speed - drop);
  if (newSpeed <= 0) {
    return { vx: 0, vz: 0 };
  }
  const ratio = newSpeed / speed;
  return { vx: vx * ratio, vz: vz * ratio };
}

/**
 * Projects velocity onto normalized horizontal wishDir and accelerates up to wishSpeed.
 * Leaves velocity unchanged when wishDir is zero (preserves airborne jump momentum).
 */
export function accelerateWishDir(
  vx: number,
  vz: number,
  wishX: number,
  wishZ: number,
  wishSpeed: number,
  accel: number,
  dt: number,
): HorizontalVel {
  if (wishSpeed <= 0 || (wishX === 0 && wishZ === 0)) {
    return { vx, vz };
  }
  const currentSpeed = vx * wishX + vz * wishZ;
  const addSpeed = wishSpeed - currentSpeed;
  if (addSpeed <= 0) {
    return { vx, vz };
  }
  const accelSpeed = Math.min(addSpeed, accel * wishSpeed * dt);
  return {
    vx: vx + accelSpeed * wishX,
    vz: vz + accelSpeed * wishZ,
  };
}

export interface SlideStepInput {
  vx: number;
  vz: number;
  dirX: number;
  dirZ: number;
  wishX: number;
  wishZ: number;
  slideTimer: number;
  minSpeed: number;
  dt: number;
}

export interface SlideStepResult {
  vx: number;
  vz: number;
  nextTimer: number;
  ended: boolean;
}

/**
 * Advances tactical sprint-slide momentum with low kinetic friction and subtle lateral steering.
 */
export function stepSlidePhysics(input: SlideStepInput): SlideStepResult {
  const nextTimer = Math.max(0, input.slideTimer - input.dt);
  const speed = Math.hypot(input.vx, input.vz);
  if (nextTimer <= 0 || speed < input.minSpeed) {
    return { vx: input.vx, vz: input.vz, nextTimer: 0, ended: true };
  }

  // Subtle lateral steer blended perpendicular/along slide heading
  const steerX = input.dirX + input.wishX * 0.28;
  const steerZ = input.dirZ + input.wishZ * 0.28;
  const steerLen = Math.hypot(steerX, steerZ) || 1;
  const ux = steerX / steerLen;
  const uz = steerZ / steerLen;

  // Quadratic-like decay: fast burst early, tapers smoothly into crouch speed
  const nextSpeed = Math.max(0, speed - (3.8 + speed * 0.52) * input.dt);
  return {
    vx: ux * nextSpeed,
    vz: uz * nextSpeed,
    nextTimer,
    ended: nextSpeed < input.minSpeed,
  };
}

export function stepAdsBlend(currentBlend: number, isAds: boolean, speed: number, dt: number): number {
  const target = isAds ? 1 : 0;
  const factor = 1 - Math.exp(-speed * dt);
  const next = currentBlend + (target - currentBlend) * factor;
  if (Math.abs(target - next) < 0.001) return target;
  return THREE_CLAMP(next, 0, 1);
}

export interface AimAssistResult {
  deltaYaw: number;
  deltaPitch: number;
  sensFriction: number;
}

/**
 * Smooth continuous ADS aim magnetism + sensitivity friction (zero abrupt single-frame snap).
 */
export function computeSmoothAimAssistStep(
  yawErrorRad: number,
  pitchErrorRad: number,
  alignmentDot: number,
  isAds: boolean,
  dt: number,
): AimAssistResult {
  if (alignmentDot < 0.962) {
    return { deltaYaw: 0, deltaPitch: 0, sensFriction: 1.0 };
  }
  const coneStrength = THREE_CLAMP((alignmentDot - 0.962) / (1.0 - 0.962), 0, 1);
  const pullRate = (isAds ? 7.2 : 1.4) * (0.45 + 0.55 * coneStrength);
  const alpha = 1 - Math.exp(-pullRate * dt);
  const maxStep = (isAds ? 0.045 : 0.012) * (dt * 60);

  const deltaYaw = THREE_CLAMP(yawErrorRad * alpha, -maxStep, maxStep);
  const deltaPitch = THREE_CLAMP(pitchErrorRad * alpha, -maxStep, maxStep);
  const sensFriction = alignmentDot >= 0.985 ? (isAds ? 0.54 : 0.72) : 1.0 - coneStrength * 0.22;

  return { deltaYaw, deltaPitch, sensFriction };
}

export interface PositionedSpawn {
  position: { x: number; z: number };
}

/**
 * Selects a safe spawn point well outside immediate ambush distance from the player.
 * Prefers >= preferredMinDist (default 12m), falls back to >= fallbackMinDist (7.5m),
 * and otherwise selects the single farthest spawn point (never arbitrary index 0).
 */
export function selectSafeSpawnPoint<T extends PositionedSpawn>(
  candidates: readonly T[],
  playerX: number,
  playerZ: number,
  randomUnit: number,
  preferredMinDist = 12,
  fallbackMinDist = 7.5,
): T | null {
  if (candidates.length === 0) return null;
  const prefSq = preferredMinDist * preferredMinDist;
  const fallSq = fallbackMinDist * fallbackMinDist;

  const preferred: T[] = [];
  const fallback: T[] = [];
  let farthest = candidates[0]!;
  let farthestSq = -1;

  for (const sp of candidates) {
    const dx = sp.position.x - playerX;
    const dz = sp.position.z - playerZ;
    const dSq = dx * dx + dz * dz;
    if (dSq > farthestSq) {
      farthestSq = dSq;
      farthest = sp;
    }
    if (dSq >= prefSq) {
      preferred.push(sp);
    } else if (dSq >= fallSq) {
      fallback.push(sp);
    }
  }

  const pool = preferred.length > 0 ? preferred : fallback;
  if (pool.length === 0) return farthest;
  const clamped = Math.max(0, Math.min(0.999999, randomUnit));
  return pool[Math.floor(clamped * pool.length)]!;
}

export interface ZombieStrikeCheckInput {
  isRising: boolean;
  isStaggered: boolean;
  horizontalDist: number;
  maxReach: number;
  zombieY: number;
  playerFeetY: number;
  zombieYaw: number;
  toPlayerX: number;
  toPlayerZ: number;
  hasDualHeightLos: boolean;
  zombieBodyY?: number;
}

/**
 * Validates whether a zombie's melee windup actually connects with the player on the strike frame.
 * Rejects rising/underground spawns, staggered swings, over-extended reaches, vertical floor gaps,
 * waist-height cover/window obstructions, and attacks dodged past the zombie's swing arc.
 */
export function canZombieStrikePlayer(input: ZombieStrikeCheckInput): boolean {
  if (input.isRising || input.isStaggered) return false;
  if (input.zombieBodyY !== undefined && input.zombieBodyY < -0.08) return false;
  if (input.zombieY > 0.35) return false;
  if (input.horizontalDist < 0.35 || input.horizontalDist > input.maxReach) return false;
  if (Math.abs(input.playerFeetY - input.zombieY) >= 1.55) return false;
  if (!input.hasDualHeightLos) return false;

  const len = Math.hypot(input.toPlayerX, input.toPlayerZ);
  if (len > 0.05) {
    const nx = input.toPlayerX / len;
    const nz = input.toPlayerZ / len;
    const fwdX = Math.sin(input.zombieYaw);
    const fwdZ = Math.cos(input.zombieYaw);
    const facingDot = nx * fwdX + nz * fwdZ;
    if (facingDot < 0.22) return false;
  }

  return true;
}

export interface BloaterDamageCheckInput {
  dist: number;
  maxRadius: number;
  hasDualHeightLos: boolean;
}

/**
 * Prevents Bloater ruptures from damaging the player through solid walls, sealed doors, or cover.
 */
export function canBloaterDamagePlayer(input: BloaterDamageCheckInput): boolean {
  if (input.dist >= input.maxRadius) return false;
  return input.hasDualHeightLos;
}

/**
 * Formats an explicit attacker & direction callout so every hit is 100% attributable.
 */
export function formatDamageCallout(
  source: DamageSource,
  relativeAngleRad: number,
  amount: number,
): string {
  const sourceLabels: Record<DamageSource, string> = {
    shambler: 'SHAMBLER',
    hound: 'PLAGUE HOUND',
    bloater_blast: 'BLOATER BLAST',
    brute: 'ARMORED BRUTE',
    brute_charge: 'BRUTE CHARGE',
    warden: 'CONTAINMENT WARDEN',
    alpha_boss: 'ALPHA BLOOM BRUTE',
  };

  let dir = 'AHEAD';
  const abs = Math.abs(relativeAngleRad);
  if (abs >= (130 * Math.PI) / 180) {
    dir = 'BEHIND';
  } else if (relativeAngleRad >= (38 * Math.PI) / 180) {
    dir = 'RIGHT';
  } else if (relativeAngleRad <= -(38 * Math.PI) / 180) {
    dir = 'LEFT';
  }

  return `${sourceLabels[source]} · ${dir} (-${Math.max(1, Math.round(amount))})`;
}

export interface OffscreenThreatInput {
  id: number;
  x: number;
  y?: number;
  z: number;
  state: string;
  speedClass: 'walk' | 'run' | 'sprint';
  isRising: boolean;
  hasLos?: boolean;
}

export interface OffscreenThreatIndicator {
  id: number;
  angle: number;
  urgency: number;
  isAttacking: boolean;
}

/**
 * Computes up to maxResults off-screen/flanking threats within maxRange meters so the player
 * receives clear peripheral warning before fast runners, hounds, charges, or bloaters strike.
 */
export function computeOffscreenThreats(
  zombies: readonly OffscreenThreatInput[],
  playerX: number,
  playerZ: number,
  playerYaw: number,
  maxRange = 10.5,
  halfFovRad = (38 * Math.PI) / 180,
  maxResults = 4,
  playerFeetY?: number,
): OffscreenThreatIndicator[] {
  const results: OffscreenThreatIndicator[] = [];

  for (const e of zombies) {
    if (e.isRising) continue;
    if (e.hasLos === false) continue;
    if (
      e.state === 'dying' ||
      e.state === 'dead' ||
      e.state === 'approach_window' ||
      e.state === 'tear_board' ||
      e.state === 'climb_in'
    ) {
      continue;
    }
    if (e.y !== undefined) {
      if (e.y > 0.35) continue;
      if (playerFeetY !== undefined && Math.abs(playerFeetY - e.y) >= 1.55) continue;
    }
    const dist = Math.hypot(e.x - playerX, e.z - playerZ);
    if (dist > maxRange) continue;
    const rel = computeRelativeThreatAngle(e.x, e.z, playerX, playerZ, playerYaw);
    if (!isAngleOutsideFov(rel, halfFovRad)) continue;

    const isTelegraph = e.state === 'brute_charge' || e.state === 'bloater_fuse';
    const isAttacking = e.state === 'attack' || isTelegraph;
    const baseProximity = Math.max(0, 1 - dist / maxRange);
    const speedBoost = e.speedClass === 'sprint' ? 0.22 : e.speedClass === 'run' ? 0.08 : 0;
    const urgency = Math.min(
      1,
      baseProximity * 0.92 + speedBoost + (isTelegraph ? 0.55 : isAttacking ? 0.45 : 0),
    );
    if (urgency <= 0.14) continue;

    results.push({ id: e.id, angle: rel, urgency, isAttacking });
  }

  results.sort((a, b) => b.urgency - a.urgency);
  if (results.length > maxResults) {
    results.length = maxResults;
  }
  return results;
}
