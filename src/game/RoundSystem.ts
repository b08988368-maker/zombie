import {
  BALANCE,
  calculateRoundZombieCount,
  calculateSpawnDelay,
  type DifficultyId,
  type EnemyType,
  type ZoneId,
} from '../config/balance';
import type { AudioEngine } from '../engine/AudioEngine';
import { selectSafeSpawnPoint } from './combatPhysics';
import { getZoneAtPosition, type SpawnPoint } from './MapBuilder';
import type { RoundPhase, SeededRng } from './types';
import type { ZombieSystem } from './ZombieSystem';

export class RoundSystem {
  public round = 1;
  public phase: RoundPhase = 'intro';
  public phaseTimer = 2.4;
  public remainingToSpawn = 0;
  public spawnTimer = 0;
  public isHoundRound = false;
  public nextHoundRound: number = BALANCE.rounds.houndFirstRoundDefault;
  public bruteSpawnedThisRound = false;
  public bannerText = 'ROUND 1';

  private readonly zombies: ZombieSystem;
  private readonly audio: AudioEngine;
  private readonly rng: SeededRng;

  constructor(zombies: ZombieSystem, audio: AudioEngine, rng: SeededRng) {
    this.zombies = zombies;
    this.audio = audio;
    this.rng = rng;
  }

  public reset(): void {
    this.round = 1;
    this.nextHoundRound = this.rng.int(5, 7);
    this.startRound(1);
  }

  public startRound(roundNum: number): void {
    this.round = roundNum;
    this.isHoundRound = roundNum === this.nextHoundRound;
    if (this.isHoundRound) {
      this.nextHoundRound = roundNum + this.rng.int(4, 6);
      this.remainingToSpawn =
        BALANCE.enemies.hound.countBase +
        Math.floor(roundNum / 2) * BALANCE.enemies.hound.countPerRound;
      this.phase = 'special_intro';
      this.phaseTimer = 3.2;
      this.bannerText = `ROUND ${roundNum} — FERAL PACK`;
      this.audio.playRoundStinger('special');
    } else {
      this.remainingToSpawn = calculateRoundZombieCount(roundNum);
      this.phase = 'intro';
      this.phaseTimer = 2.4;
      this.bannerText = `ROUND ${roundNum}`;
      this.audio.playRoundStinger('start');
    }
    this.bruteSpawnedThisRound = false;
    this.spawnTimer = 0.5;
  }

  public update(
    dt: number,
    unlockedZones: Set<ZoneId>,
    spawnPoints: SpawnPoint[],
    playerPos: { x: number; z: number },
    difficulty: DifficultyId,
    onBannerClear: () => void,
    onRadioAnnounce: (msg: string) => void,
    onBruteEntrance?: () => void,
  ): void {
    if (this.phase === 'intro' || this.phase === 'special_intro') {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) {
        this.phase = 'active';
        onBannerClear();
        if (this.isHoundRound) {
          onRadioAnnounce('Station Telemetry: Feral canine signatures emerging from the mist.');
        }
      }
      return;
    }

    if (this.phase === 'intermission') {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) {
        this.startRound(this.round + 1);
      }
      return;
    }

    // Active round spawning
    const alive = this.zombies.getAliveCount();
    if (this.remainingToSpawn > 0 && alive < BALANCE.rounds.maxAlive) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        const enemyType = this.pickEnemyType();
        const unlockedSpawns = spawnPoints.filter((s) => unlockedZones.has(s.zone));
        const playerZone = getZoneAtPosition(playerPos.x, playerPos.z);
        const remoteSpawns = unlockedSpawns.filter((s) => s.zone !== playerZone);
        let candidatePool = remoteSpawns.length >= 2 ? remoteSpawns : unlockedSpawns;
        if (enemyType === 'hound') {
          const openRemote = candidatePool.filter((s) => !s.windowId);
          const openUnlocked = unlockedSpawns.filter((s) => !s.windowId);
          if (openRemote.length > 0) {
            candidatePool = openRemote;
          } else if (openUnlocked.length > 0) {
            candidatePool = openUnlocked;
          }
        }
        const chosen = selectSafeSpawnPoint(
          candidatePool,
          playerPos.x,
          playerPos.z,
          this.rng.next(),
          14,
          8.5,
        );
        if (chosen) {
          if (this.zombies.spawnEnemy(enemyType, this.round, chosen, this.rng, difficulty)) {
            this.remainingToSpawn--;
            if (enemyType === 'brute') {
              this.audio.playRoundStinger('brute');
              onBruteEntrance?.();
              onRadioAnnounce('Warning: Heavy Brute specimen breached containment.');
            }
          }
        }
        this.spawnTimer = calculateSpawnDelay(this.round);
      }
    }

    // Check round end
    if (this.remainingToSpawn <= 0 && alive === 0) {
      this.phase = 'intermission';
      this.phaseTimer = this.isHoundRound
        ? BALANCE.rounds.specialRoundBreakSeconds
        : BALANCE.rounds.roundBreakSeconds;
      this.audio.playRoundStinger('end');
    }
  }

  private pickEnemyType(): EnemyType {
    if (this.isHoundRound) return 'hound';

    if (
      this.round >= BALANCE.rounds.bruteFirstRound &&
      (this.round - BALANCE.rounds.bruteFirstRound) % BALANCE.rounds.bruteInterval === 0 &&
      !this.bruteSpawnedThisRound
    ) {
      this.bruteSpawnedThisRound = true;
      return 'brute';
    }

    if (
      this.round >= BALANCE.rounds.bloaterMinRound &&
      this.rng.next() < BALANCE.rounds.bloaterChance
    ) {
      return 'bloater';
    }

    return 'shambler';
  }
}
