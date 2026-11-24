import type { ZoneId } from '../config/balance';
import { computeRelativeThreatAngle } from './combatPhysics';
import type { CampaignObjectiveInfo } from './types';

export interface CampaignFuseState {
  zone: ZoneId;
  x: number;
  z: number;
  collected: boolean;
}

export interface CampaignWorldInput {
  unlockedZones: ReadonlySet<ZoneId>;
  powerOn: boolean;
  fuses: readonly CampaignFuseState[];
  reactorPurged: boolean;
  wardenDefeated: boolean;
  radioActive: boolean;
  radioDefendRemaining: number;
  radioDefendDuration: number;
  bossSpawned: boolean;
  bossDefeated: boolean;
  extracted: boolean;
  endlessMode: boolean;
  wardenPos: { x: number; z: number } | null;
  bossPos: { x: number; z: number } | null;
  playerX: number;
  playerZ: number;
  playerYaw: number;
}

export const CAMPAIGN_WAYPOINTS = {
  siloYardDoor: { x: -7, z: 10 },
  barnDoor: { x: 12, z: 2 },
  labDoor: { x: 0, z: -14 },
  bunkerDoor: { x: -6, z: -30 },
  powerSwitch: { x: 13.5, z: -26.5 },
  reactorCore: { x: -15, z: -36 },
  radioConsole: { x: 0, z: -28.6 },
  extractionFlare: { x: 0, z: -1 },
} as const;

function withNav(
  base: Omit<CampaignObjectiveInfo, 'targetDistance' | 'targetBearingRad'>,
  playerX: number,
  playerZ: number,
  playerYaw: number,
): CampaignObjectiveInfo {
  if (!base.targetPos) {
    return { ...base, targetDistance: null, targetBearingRad: null };
  }
  const dist = Math.round(Math.hypot(base.targetPos.x - playerX, base.targetPos.z - playerZ));
  const bearing = computeRelativeThreatAngle(
    base.targetPos.x,
    base.targetPos.z,
    playerX,
    playerZ,
    playerYaw,
  );
  return {
    ...base,
    targetDistance: dist,
    targetBearingRad: bearing,
  };
}

export function computeCampaignSnapshot(input: CampaignWorldInput): CampaignObjectiveInfo {
  const {
    unlockedZones,
    powerOn,
    fuses,
    reactorPurged,
    wardenDefeated,
    radioActive,
    radioDefendRemaining,
    radioDefendDuration,
    bossSpawned,
    bossDefeated,
    extracted,
    endlessMode,
    wardenPos,
    bossPos,
    playerX,
    playerZ,
    playerYaw,
  } = input;

  if (extracted || endlessMode) {
    return withNav(
      {
        chapter: 6,
        totalChapters: 6,
        chapterTitle: endlessMode ? 'Endless Survival' : 'Dawn Extraction Complete',
        phase: 'complete',
        instruction: endlessMode
          ? 'Survive the endless swarm'
          : 'Hollowfield Station purged — extraction secured',
        detail: endlessMode
          ? 'Campaign complete. Hold out as many rounds as you can.'
          : 'All 6 chapters cleared.',
        progressText: '6 / 6 CLEARED',
        targetPos: null,
        endlessMode,
      },
      playerX,
      playerZ,
      playerYaw,
    );
  }

  // Chapter 1: Perimeter Breach (Farmhouse -> Silo Yard)
  if (!unlockedZones.has('silo_yard')) {
    return withNav(
      {
        chapter: 1,
        totalChapters: 6,
        chapterTitle: 'Perimeter Breach',
        phase: 'breach_yard',
        instruction: 'Unlock Silo Yard Gate (750 PTS)',
        detail: 'Earn points by eliminating zombies and repairing boards, then open the north gate.',
        progressText: 'GATE LOCKED',
        targetPos: CAMPAIGN_WAYPOINTS.siloYardDoor,
        endlessMode: false,
      },
      playerX,
      playerZ,
      playerYaw,
    );
  }

  // Chapter 2: Cold Restart (Bio-Lab Wing + Main Power)
  if (!powerOn) {
    if (!unlockedZones.has('lab_wing')) {
      return withNav(
        {
          chapter: 2,
          totalChapters: 6,
          chapterTitle: 'Cold Restart',
          phase: 'restore_power',
          instruction: 'Unlock Bio-Lab Airlock (1250 PTS)',
          detail: 'Cross the Silo Yard north to breach the Bio-Lab Research Wing.',
          progressText: 'STEP 1/2',
          targetPos: CAMPAIGN_WAYPOINTS.labDoor,
          endlessMode: false,
        },
        playerX,
        playerZ,
        playerYaw,
      );
    }
    return withNav(
      {
        chapter: 2,
        totalChapters: 6,
        chapterTitle: 'Cold Restart',
        phase: 'restore_power',
        instruction: 'Flip Main Power Breaker in Bio-Lab',
        detail: 'Throw the power switch on the east Bio-Lab wall to energize station relays.',
        progressText: 'STEP 2/2',
        targetPos: CAMPAIGN_WAYPOINTS.powerSwitch,
        endlessMode: false,
      },
      playerX,
      playerZ,
      playerYaw,
    );
  }

  // Chapter 3: Relay Recovery (Collect 3 High-Voltage Fuses)
  const uncollected = fuses.filter((f) => !f.collected);
  if (uncollected.length > 0) {
    const collectedCount = fuses.length - uncollected.length;
    // Prefer an uncollected fuse inside an already unlocked zone; otherwise route to its locked door
    const unlockedFuse = uncollected.find((f) => unlockedZones.has(f.zone));
    let targetPos: { x: number; z: number } | null = null;
    let instruction = `Collect High-Voltage Fuses (${collectedCount}/${fuses.length})`;
    let detail =
      'Search Farmhouse Kitchen Island, Timber Barn Loft, and Bunker Pedestal for glowing amber fuses.';

    if (unlockedFuse) {
      let bestDist = Infinity;
      for (const f of uncollected) {
        if (!unlockedZones.has(f.zone)) continue;
        const d = Math.hypot(f.x - playerX, f.z - playerZ);
        if (d < bestDist) {
          bestDist = d;
          targetPos = { x: f.x, z: f.z };
        }
      }
    } else {
      const nextLocked = uncollected[0]!;
      if (nextLocked.zone === 'barn' && !unlockedZones.has('barn')) {
        targetPos = CAMPAIGN_WAYPOINTS.barnDoor;
        instruction = `Unlock Farmstead Barn Door (1000 PTS) for Fuse`;
        detail = 'Open the Barn entrance east of the Silo Yard to recover the Barn fuse.';
      } else if (nextLocked.zone === 'bunker' && !unlockedZones.has('bunker')) {
        targetPos = CAMPAIGN_WAYPOINTS.bunkerDoor;
        instruction = `Unlock Bunker Bulkhead (1500 PTS) for Fuse`;
        detail = 'Descend from the Bio-Lab west wing to reach the Underground Bunker fuse.';
      } else {
        targetPos = { x: nextLocked.x, z: nextLocked.z };
      }
    }

    return withNav(
      {
        chapter: 3,
        totalChapters: 6,
        chapterTitle: 'Relay Recovery',
        phase: 'recover_fuses',
        instruction,
        detail,
        progressText: `${collectedCount} / ${fuses.length} FUSES`,
        targetPos,
        endlessMode: false,
      },
      playerX,
      playerZ,
      playerYaw,
    );
  }

  // Chapter 4: Reactor Purge + Containment Warden miniboss
  if (!reactorPurged) {
    if (!unlockedZones.has('bunker')) {
      return withNav(
        {
          chapter: 4,
          totalChapters: 6,
          chapterTitle: 'Reactor Purge',
          phase: 'purge_reactor',
          instruction: 'Unlock Bunker Bulkhead (1500 PTS)',
          detail: 'Open the sealed bulkhead in the Bio-Lab west wing to access the Reactor Core.',
          progressText: 'STEP 1/2',
          targetPos: CAMPAIGN_WAYPOINTS.bunkerDoor,
          endlessMode: false,
        },
        playerX,
        playerZ,
        playerYaw,
      );
    }
    return withNav(
      {
        chapter: 4,
        totalChapters: 6,
        chapterTitle: 'Reactor Purge',
        phase: 'purge_reactor',
        instruction: 'Purge Bunker Reactor Core [F]',
        detail: 'Interact with the glowing Containment Reactor in the Bunker to flush the sub-level.',
        progressText: 'READY',
        targetPos: CAMPAIGN_WAYPOINTS.reactorCore,
        endlessMode: false,
      },
      playerX,
      playerZ,
      playerYaw,
    );
  }

  if (!wardenDefeated) {
    return withNav(
      {
        chapter: 4,
        totalChapters: 6,
        chapterTitle: 'Reactor Purge',
        phase: 'defeat_warden',
        instruction: 'Eliminate the Containment Warden',
        detail: 'Aim for its glowing back tank or use upgraded firepower while kiting around cover.',
        progressText: 'WARDEN ACTIVE',
        targetPos: wardenPos,
        endlessMode: false,
      },
      playerX,
      playerZ,
      playerYaw,
    );
  }

  // Chapter 5: Blackout Broadcast + Alpha Bloom Brute Boss
  if (!bossSpawned) {
    const secs = Math.max(0, Math.ceil(radioDefendRemaining));
    return withNav(
      {
        chapter: 5,
        totalChapters: 6,
        chapterTitle: 'Blackout Broadcast',
        phase: 'defend_radio',
        instruction: radioActive
          ? `Hold Lab Wing · Radio Uplink ${secs}s`
          : 'Transmit Distress Signal at Lab Radio [F]',
        detail: radioActive
          ? 'Stay alive while the emergency antenna locks onto the extraction chopper.'
          : 'Return to the Bio-Lab north console and trigger the emergency broadcast.',
        progressText: radioActive
          ? `${Math.min(100, Math.round(((radioDefendDuration - radioDefendRemaining) / Math.max(1, radioDefendDuration)) * 100))}%`
          : 'UPLINK READY',
        targetPos: CAMPAIGN_WAYPOINTS.radioConsole,
        endlessMode: false,
      },
      playerX,
      playerZ,
      playerYaw,
    );
  }

  if (!bossDefeated) {
    return withNav(
      {
        chapter: 5,
        totalChapters: 6,
        chapterTitle: 'Apex Specimen',
        phase: 'defeat_boss',
        instruction: 'Defeat the Alpha Bloom Brute',
        detail: 'Keep moving! Sidestep its bull-charge and focus fire on head & back weakpoints.',
        progressText: 'BOSS ENCOUNTER',
        targetPos: bossPos,
        endlessMode: false,
      },
      playerX,
      playerZ,
      playerYaw,
    );
  }

  // Chapter 6: Dawn Extraction
  return withNav(
    {
      chapter: 6,
      totalChapters: 6,
      chapterTitle: 'Dawn Extraction',
      phase: 'extract',
      instruction: 'Reach Extraction Flare in Silo Yard [F]',
      detail: 'Sprint to the green extraction flare outside the farmhouse and secure evac.',
      progressText: 'EVAC ACTIVE',
      targetPos: CAMPAIGN_WAYPOINTS.extractionFlare,
      endlessMode: false,
    },
    playerX,
    playerZ,
    playerYaw,
  );
}
