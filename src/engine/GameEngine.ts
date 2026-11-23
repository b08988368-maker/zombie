import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { BALANCE, type EnemyType } from '../config/balance';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveBestRun,
  saveSettings,
} from '../config/settings';
import { AudioEngine } from './AudioEngine';
import { BvhWorld } from './BvhWorld';
import { NavGrid } from './NavGrid';
import { PhysicsWorld } from './PhysicsWorld';
import { PostProcessPipeline } from './PostProcessPipeline';
import { createPbrMaterialSet, type PbrMaterialSet } from './ProceduralAssets';
import { detectSoftwareWebGL, scheduleAfterDraw } from './SoftwareGl';
import { InteractablesSystem } from '../game/InteractablesSystem';
import { getZoneAtPosition, MapBuilder, ZONE_LABELS, type MapBuildResult } from '../game/MapBuilder';
import { PlayerController, type PlayerInputState } from '../game/PlayerController';
import { RoundSystem } from '../game/RoundSystem';
import {
  createSeededRng,
  type GameScreen,
  type HudSnapshot,
  type PointDelta,
  type RunStats,
} from '../game/types';
import { WeaponSystem } from '../game/WeaponSystem';
import { ZombieSystem } from '../game/ZombieSystem';

export interface DebugApi {
  getState: () => HudSnapshot;
  getPlayerPose: () => { x: number; y: number; z: number; yaw: number; pitch: number };
  getZombies: () => { id: number; type: EnemyType; x: number; z: number; state: string; health: number }[];
  getStuckTeleports: () => number;
  startRun: () => void;
  setPlayerPose: (x: number, y: number, z: number, yaw?: number, pitch?: number) => void;
  addPoints: (amt: number) => void;
  jumpToRound: (r: number) => void;
  spawnAllZombiesTest: (count: number) => void;
  triggerAction: (action: 'shoot' | 'reload' | 'melee' | 'interact' | 'swap' | 'grenade' | 'inspect') => void;
}

export class GameEngine {
  private readonly container: HTMLElement;
  private readonly onSnapshot: (snap: HudSnapshot) => void;

  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private flashlight!: THREE.SpotLight;
  private flashlightTarget!: THREE.Object3D;
  private sporePoints: THREE.Points | null = null;
  private flashlightOn = true;
  private postProcess!: PostProcessPipeline;
  private mats!: PbrMaterialSet;

  private readonly physics = new PhysicsWorld();
  private readonly bvh = new BvhWorld();
  private readonly nav = new NavGrid();
  private readonly audio = new AudioEngine();
  private readonly rng = createSeededRng(19861031);

  private map!: MapBuildResult;
  private player!: PlayerController;
  private zombies!: ZombieSystem;
  private weapons!: WeaponSystem;
  private rounds!: RoundSystem;
  private interactables!: InteractablesSystem;

  private settings = loadSettings();
  private screen: GameScreen = 'loading';
  private showDebug = false;
  private isSoftwareGl = false;
  private pointerLocked = false;
  private pointerLockBlocked = false;
  private ignoreUnlockPause = false;
  private ignoreNextMouseMove = false;
  private lastMouseX: number | null = null;
  private lastMouseY: number | null = null;
  private edgeTurnDir = 0;
  private disposed = false;

  private points: number = BALANCE.player.startingPoints;
  private stats: RunStats = this.createEmptyStats();
  private pointDeltas: PointDelta[] = [];
  private nextDeltaId = 1;
  private hitMarkerType: 'none' | 'hit' | 'kill' | 'headshot' = 'none';
  private hitMarkerTimer = 0;
  private radioMessage: string | null = null;
  private radioTimer = 0;
  private roundBannerVisible = true;
  private errorBanner: string | null = null;

  private hitStopTimer = 0;
  private simAccum = 0;
  private lastTimeMs = 0;
  private hudEmitAccum = 0;
  private aiTickMs = 0;
  private frameTimeMs = 16.6;
  private fps = 60;
  private menuOrbitAngle = 0.42;

  private frameId = 0;
  private timerIds = new Set<number>();

  private readonly keysDown = new Set<string>();
  private mouseLeftDown = false;
  private mouseRightDown = false;
  private pendingFirePress = false;
  private pendingReloadPress = false;
  private pendingMeleePress = false;
  private pendingGrenadePress = false;
  private pendingSwapPress = false;

  private readonly tmpEye = new THREE.Vector3();
  private readonly tmpForward = new THREE.Vector3();
  private readonly tmpUp = new THREE.Vector3(0, 1, 0);

  constructor(container: HTMLElement, onSnapshot: (snap: HudSnapshot) => void) {
    this.container = container;
    this.onSnapshot = onSnapshot;
    void this.bootstrap();
  }

  private createEmptyStats(): RunStats {
    return {
      round: 1,
      kills: 0,
      headshots: 0,
      meleeKills: 0,
      pointsEarned: 0,
      shotsFired: 0,
      shotsHit: 0,
      doorsOpened: 0,
      perksBought: 0,
      elapsedSeconds: 0,
    };
  }

  private async bootstrap(): Promise<void> {
    this.emitLoad(0.1, 'Initializing Physics Kernel...');
    await PhysicsWorld.ensureInit();
    if (this.disposed) return;

    this.emitLoad(0.3, 'Configuring WebGL2 Renderer...');
    this.isSoftwareGl = detectSoftwareWebGL();
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.display = 'block';
    this.container.appendChild(this.renderer.domElement);

    this.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.errorBanner = 'WebGL context lost. Attempting recovery...';
      this.emitHud();
    });
    this.renderer.domElement.addEventListener('webglcontextrestored', () => {
      this.errorBanner = null;
      this.emitHud();
    });

    this.scene = new THREE.Scene();
    const fogColor = new THREE.Color(0x070a09);
    this.scene.background = fogColor;
    this.scene.fog = new THREE.FogExp2(0x070a09, 0.032);

    this.camera = new THREE.PerspectiveCamera(
      this.settings.fov,
      window.innerWidth / window.innerHeight,
      0.06,
      180,
    );
    this.scene.add(this.camera);

    // Camera-mounted tactical flashlight (toggleable via T)
    this.flashlight = new THREE.SpotLight(0xfff1d6, 2.8, 28, Math.PI / 4.2, 0.95, 1.35);
    this.flashlight.position.set(0.06, -0.04, -0.45);
    this.flashlightTarget = new THREE.Object3D();
    this.flashlightTarget.position.set(0, -0.04, -12);
    this.camera.add(this.flashlight);
    this.camera.add(this.flashlightTarget);
    this.flashlight.target = this.flashlightTarget;

    // Atmospheric drifting fungal spore motes across the station (1 draw call)
    this.createSporeAtmosphere();

    // Mandatory studio environment reflection for PBR metals
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    // Base moonlight & cool/warm contrast fill
    const hemi = new THREE.HemisphereLight(0x2c3f57, 0x100d0a, 0.44);
    this.scene.add(hemi);

    const moon = new THREE.DirectionalLight(0x88a8cc, 0.72);
    moon.position.set(-28, 42, -24);
    moon.castShadow = !this.isSoftwareGl;
    moon.shadow.mapSize.set(1024, 1024);
    moon.shadow.camera.left = -36;
    moon.shadow.camera.right = 36;
    moon.shadow.camera.top = 36;
    moon.shadow.camera.bottom = -36;
    moon.shadow.camera.near = 4;
    moon.shadow.camera.far = 95;
    moon.shadow.bias = -0.0005;
    moon.shadow.normalBias = 0.02;
    this.scene.add(moon);

    this.emitLoad(0.55, 'Synthesizing PBR Materials...');
    this.mats = createPbrMaterialSet(this.renderer, this.isSoftwareGl);

    this.emitLoad(0.75, 'Constructing Hollowfield Station...');
    this.physics.initWorld(-7, 0.9, 22);
    const builder = new MapBuilder(
      this.scene,
      this.physics,
      this.bvh,
      this.nav,
      this.mats,
      this.isSoftwareGl,
    );
    this.map = builder.build();

    this.emitLoad(0.9, 'Initializing AI Flow-Fields & Weapons...');
    this.player = new PlayerController(this.physics, this.audio);
    this.zombies = new ZombieSystem(this.scene, this.nav, this.audio, this.mats, this.isSoftwareGl);
    this.weapons = new WeaponSystem(
      this.scene,
      this.camera,
      this.bvh,
      this.physics,
      this.zombies,
      this.audio,
      this.mats,
    );
    this.rounds = new RoundSystem(this.zombies, this.audio, this.rng);
    this.interactables = new InteractablesSystem(
      this.scene,
      this.map,
      this.physics,
      this.bvh,
      this.nav,
      this.audio,
      this.rng,
      this.mats,
    );

    this.postProcess = new PostProcessPipeline(
      this.renderer,
      this.scene,
      this.camera,
      this.isSoftwareGl,
    );
    this.postProcess.applyQuality(this.settings.quality, this.settings.resolutionScale);

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this.bindEvents();
    this.registerDebugApi();

    this.screen = 'menu';
    this.emitLoad(1.0, 'Ready');
    this.emitHud();

    this.lastTimeMs = performance.now();
    this.loop();
  }

  private emitLoad(progress: number, label: string): void {
    this.onSnapshot({
      screen: 'loading',
      loadProgress: progress,
      loadLabel: label,
      pointerLocked: false,
      pointerLockBlocked: this.pointerLockBlocked,
      health: 100,
      maxHealth: 100,
      isReviving: false,
      reviveProgress: 0,
      points: 500,
      round: 1,
      roundPhase: 'intro',
      roundBannerText: '',
      isHoundRound: false,
      powerOn: false,
      currentZone: 'farmhouse',
      currentZoneLabel: ZONE_LABELS.farmhouse,
      weapons: [],
      activeSlot: 0,
      activeWeaponId: 'service_pistol',
      isReloading: false,
      reloadProgress: 0,
      isAds: false,
      isSprinting: false,
      crosshairSpread: 0.25,
      flashlightOn: this.flashlightOn,
      zombiesRemaining: 6,
      grenades: 2,
      maxGrenades: 4,
      perks: [],
      activePowerUps: [],
      interactPrompt: null,
      pointDeltas: [],
      hitMarkerType: 'none',
      hitMarkerAlpha: 0,
      damageFlash: 0,
      damageIndicatorAngle: null,
      damageIndicatorAlpha: 0,
      radioMessage: null,
      objectiveHint: null,
      easterEggStep: 0,
      fusesCollected: 0,
      radioDefendRemaining: 0,
      stats: this.createEmptyStats(),
      perf: { fps: 60, frameTimeMs: 16, drawCalls: 0, triangles: 0, zombieCount: 0, aiTickMs: 0, memoryMb: 0 },
      showDebug: false,
      activeEnemyTypes: [],
      errorBanner: this.errorBanner,
    });
  }

  private bindEvents(): void {
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('blur', this.onWindowBlur);
    window.addEventListener('contextmenu', this.onContextMenu);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('pointerlockerror', this.onPointerLockError);
  }

  private clearInputs(): void {
    this.keysDown.clear();
    this.mouseLeftDown = false;
    this.mouseRightDown = false;
    this.pendingFirePress = false;
    this.pendingReloadPress = false;
    this.pendingMeleePress = false;
    this.pendingGrenadePress = false;
    this.pendingSwapPress = false;
    this.lastMouseX = null;
    this.lastMouseY = null;
    this.edgeTurnDir = 0;
  }

  private exitPointerLockSafely(): void {
    if (document.pointerLockElement) {
      this.ignoreUnlockPause = true;
      try {
        document.exitPointerLock?.();
      } catch {
        this.ignoreUnlockPause = false;
      }
    }
  }

  private onWindowBlur = (): void => {
    this.clearInputs();
  };

  private onResize = (): void => {
    this.postProcess.resize(window.innerWidth, window.innerHeight);
  };

  private onContextMenu = (e: MouseEvent): void => {
    if (this.screen === 'playing') e.preventDefault();
  };

  private onPointerLockError = (): void => {
    this.pointerLockBlocked = true;
    this.emitHud();
  };

  private onPointerLockChange = (): void => {
    const nextLocked = document.pointerLockElement === this.renderer.domElement;
    const wasLocked = this.pointerLocked;
    if (nextLocked) {
      this.ignoreNextMouseMove = true;
      this.pointerLockBlocked = false;
    }
    this.pointerLocked = nextLocked;
    if (wasLocked && !nextLocked && this.screen === 'playing' && !this.ignoreUnlockPause) {
      this.pauseGame();
      return;
    }
    this.ignoreUnlockPause = false;
    this.emitHud();
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'F3') {
      e.preventDefault();
      this.showDebug = !this.showDebug;
      this.emitHud();
      return;
    }

    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (this.screen === 'playing') {
        this.pauseGame();
        return;
      } else if (this.screen === 'paused') {
        this.resumeGame();
        return;
      }
    }

    if (this.screen !== 'playing') return;

    if (
      e.code === 'ArrowUp' ||
      e.code === 'ArrowDown' ||
      e.code === 'ArrowLeft' ||
      e.code === 'ArrowRight' ||
      e.code === 'Space'
    ) {
      e.preventDefault();
    }

    this.keysDown.add(e.code);
    if (e.code === 'KeyT') {
      this.flashlightOn = !this.flashlightOn;
      this.flashlight.intensity = this.flashlightOn ? 2.8 : 0;
      this.emitHud();
    }
    if (e.code === 'KeyX') {
      this.weapons.triggerInspect();
    }
    const kb = this.settings.keyBindings;
    if (e.code === kb.reload) this.pendingReloadPress = true;
    if (e.code === kb.melee) this.pendingMeleePress = true;
    if (e.code === kb.grenade) this.pendingGrenadePress = true;
    if (e.code === kb.swap) this.pendingSwapPress = true;
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keysDown.delete(e.code);
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (this.screen !== 'playing') return;
    const allowUnlocked = this.pointerLockBlocked || this.mouseRightDown;
    if (!this.pointerLocked && !allowUnlocked) {
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
      return;
    }
    if (this.ignoreNextMouseMove) {
      this.ignoreNextMouseMove = false;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
      return;
    }

    let dx = e.movementX;
    let dy = e.movementY;
    if (dx === 0 && dy === 0 && this.lastMouseX !== null && this.lastMouseY !== null) {
      dx = e.clientX - this.lastMouseX;
      dy = e.clientY - this.lastMouseY;
    }
    this.lastMouseX = e.clientX;
    this.lastMouseY = e.clientY;

    if (this.pointerLockBlocked && !this.pointerLocked) {
      const w = Math.max(1, window.innerWidth);
      const edge = w * 0.14;
      if (e.clientX <= edge) {
        this.edgeTurnDir = -Math.pow((edge - e.clientX) / edge, 1.35);
      } else if (e.clientX >= w - edge) {
        this.edgeTurnDir = Math.pow((e.clientX - (w - edge)) / edge, 1.35);
      } else {
        this.edgeTurnDir = 0;
      }
    } else {
      this.edgeTurnDir = 0;
    }

    if (Math.abs(dx) > 450 || Math.abs(dy) > 450) return;
    const cfg = this.weapons.getActiveConfig();
    const friction = !this.pointerLocked && this.isReticleNearZombie() ? 0.6 : 1.0;
    this.player.applyLookDelta(dx * friction, dy * friction, this.settings, cfg.adsSensScale);
    this.weapons.addLookSway(dx * friction, dy * friction);
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (this.screen !== 'playing') return;
    this.audio.init();
    this.audio.resume();
    if (
      e.button === 0 &&
      !this.pointerLocked &&
      !this.pointerLockBlocked &&
      e.target === this.renderer.domElement
    ) {
      this.requestPointerLock();
    }
    if (e.button === 0) {
      this.mouseLeftDown = true;
      this.pendingFirePress = true;
    } else if (e.button === 2) {
      if (!this.mouseRightDown && !this.pointerLocked) {
        this.snapAimTowardNearestTarget();
      }
      this.mouseRightDown = true;
    }
  };

  private onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) this.mouseLeftDown = false;
    if (e.button === 2) this.mouseRightDown = false;
  };

  public requestPointerLock(): void {
    try {
      const maybePromise = this.renderer.domElement.requestPointerLock?.() as unknown as
        | Promise<void>
        | undefined;
      if (maybePromise && typeof maybePromise.catch === 'function') {
        maybePromise.catch(() => {
          this.pointerLockBlocked = true;
          this.emitHud();
        });
      }
    } catch {
      this.pointerLockBlocked = true;
      this.emitHud();
    }
    const tid = window.setTimeout(() => {
      this.timerIds.delete(tid);
      if (
        !this.disposed &&
        this.screen === 'playing' &&
        !this.pointerLocked &&
        document.pointerLockElement !== this.renderer.domElement
      ) {
        this.pointerLockBlocked = true;
        this.emitHud();
      }
    }, 150);
    this.timerIds.add(tid);
  }

  public startNewGame(): void {
    this.audio.init();
    this.audio.resume();
    this.audio.updateSettings(this.settings);
    this.clearInputs();

    this.physics.playerBody.setNextKinematicTranslation({ x: -7, y: 0.9, z: 22 });
    this.physics.world.step();

    this.player.reset(-7, 0.9, 22);
    this.zombies.killAll();
    this.zombies.stuckTeleportCount = 0;
    this.weapons.reset();
    this.interactables.reset();
    this.rounds.reset();

    this.points = BALANCE.player.startingPoints;
    this.stats = this.createEmptyStats();
    this.pointDeltas = [];
    this.hitStopTimer = 0;
    this.simAccum = 0;
    this.hitMarkerType = 'none';
    this.hitMarkerTimer = 0;
    this.lastPrompt = null;
    this.lastTimeMs = performance.now();
    this.roundBannerVisible = true;
    this.radioMessage = 'Station Radio: "Bloom containment failed. Hold the farmhouse until dawn."';
    this.radioTimer = 6.0;
    this.nav.updateFlowField(-7, 22, 1, true);

    this.screen = 'playing';
    this.requestPointerLock();
    this.emitHud();
  }

  public restartGame(): void {
    this.audio.init();
    this.audio.resume();
    this.clearInputs();
    this.physics.playerBody.setNextKinematicTranslation({ x: -7, y: 0.9, z: 22 });
    this.physics.world.step();
    this.player.reset(-7, 0.9, 22);

    this.zombies.killAll();
    this.zombies.stuckTeleportCount = 0;
    this.weapons.reset();
    this.interactables.reset();
    this.rounds.reset();

    this.points = BALANCE.player.startingPoints;
    this.stats = this.createEmptyStats();
    this.pointDeltas = [];
    this.hitStopTimer = 0;
    this.simAccum = 0;
    this.hitMarkerType = 'none';
    this.hitMarkerTimer = 0;
    this.lastPrompt = null;
    this.lastTimeMs = performance.now();
    this.roundBannerVisible = true;
    this.radioMessage = 'Station Radio: "Stay sharp. Tear-in from the west windows."';
    this.radioTimer = 5.5;
    this.nav.updateFlowField(-7, 22, 1, true);

    this.screen = 'playing';
    this.requestPointerLock();
    this.emitHud();
  }

  public pauseGame(): void {
    if (this.screen !== 'playing') return;
    this.clearInputs();
    this.screen = 'paused';
    this.exitPointerLockSafely();
    this.emitHud();
  }

  public resumeGame(): void {
    if (this.screen !== 'paused') return;
    this.clearInputs();
    this.simAccum = 0;
    this.lastTimeMs = performance.now();
    this.screen = 'playing';
    this.requestPointerLock();
    this.emitHud();
  }

  public returnToMenu(): void {
    this.clearInputs();
    this.screen = 'menu';
    this.exitPointerLockSafely();
    this.emitHud();
  }

  public updateSettings(next: typeof DEFAULT_SETTINGS): void {
    this.settings = structuredClone(next);
    saveSettings(this.settings);
    this.audio.updateSettings(this.settings);
    this.postProcess.applyQuality(this.settings.quality, this.settings.resolutionScale);
    this.camera.fov = this.settings.fov;
    this.camera.updateProjectionMatrix();
    this.emitHud();
  }

  public getSettings(): typeof DEFAULT_SETTINGS {
    return structuredClone(this.settings);
  }

  private loop = (): void => {
    if (this.disposed) return;

    const nowMs = performance.now();
    const instantMs = Math.max(1, nowMs - this.lastTimeMs);
    const rawDt = Math.min(BALANCE.sim.maxFrameDt, instantMs / 1000);
    this.lastTimeMs = nowMs;

    // Frame timing metrics (unclamped so stalls are never hidden)
    this.frameTimeMs = this.frameTimeMs * 0.9 + instantMs * 0.1;
    this.fps = Math.round(1000 / Math.max(1, this.frameTimeMs));

    if (this.sporePoints) {
      this.sporePoints.rotation.y += rawDt * 0.012;
      this.sporePoints.position.y = Math.sin(nowMs * 0.00055) * 0.16;
    }

    if (this.screen === 'menu') {
      // Atmospheric 3D backdrop camera orbit across the foggy Silo Yard
      this.menuOrbitAngle += rawDt * 0.14;
      this.camera.position.set(
        Math.cos(this.menuOrbitAngle) * 10.5,
        3.6,
        -1.5 + Math.sin(this.menuOrbitAngle) * 8.5,
      );
      this.camera.lookAt(-3.5, 2.2, -1.5);
      this.weapons.viewmodelRoot.visible = false;
      this.flashlight.intensity = 0.8;
      this.animateLights(nowMs * 0.001);
    } else if (this.screen === 'playing') {
      this.weapons.viewmodelRoot.visible = true;
      this.flashlight.intensity = this.flashlightOn ? 2.8 : 0;
      this.stepSimulation(rawDt, nowMs * 0.001);
    } else {
      this.weapons.viewmodelRoot.visible = this.screen === 'paused';
    }

    this.postProcess.render();

    if (this.isSoftwareGl) {
      scheduleAfterDraw(this.renderer, this.loop, (tid) => this.timerIds.add(tid));
    } else {
      this.frameId = requestAnimationFrame(this.loop);
    }
  };

  private stepSimulation(dt: number, elapsedSec: number): void {
    if (this.hitStopTimer > 0) {
      this.hitStopTimer -= dt;
      return;
    }

    this.simAccum += dt;
    const fixedDt = BALANCE.sim.fixedDt;
    while (this.simAccum >= fixedDt) {
      this.fixedTick(fixedDt, elapsedSec);
      this.simAccum -= fixedDt;
    }

    this.hudEmitAccum += dt;
    if (this.hudEmitAccum >= 0.05) {
      this.hudEmitAccum = 0;
      this.emitHud();
    }
  }

  private pollGamepad(): { dx: number; dy: number; fire: boolean; ads: boolean; sprint: boolean; reload: boolean; interact: boolean; jump: boolean } {
    const pads = navigator.getGamepads?.();
    const gp = pads ? pads[0] : null;
    if (!gp) return { dx: 0, dy: 0, fire: false, ads: false, sprint: false, reload: false, interact: false, jump: false };
    const dz = this.settings.gamepadDeadzone;
    const rx = Math.abs(gp.axes[2] ?? 0) > dz ? gp.axes[2]! : 0;
    const ry = Math.abs(gp.axes[3] ?? 0) > dz ? gp.axes[3]! : 0;
    if (rx !== 0 || ry !== 0) {
      const cfg = this.weapons.getActiveConfig();
      this.player.applyLookDelta(rx * 14, ry * 11, this.settings, cfg.adsSensScale);
    }
    return {
      dx: Math.abs(gp.axes[0] ?? 0) > dz ? gp.axes[0]! : 0,
      dy: Math.abs(gp.axes[1] ?? 0) > dz ? gp.axes[1]! : 0,
      fire: (gp.buttons[7]?.value ?? 0) > 0.35,
      ads: (gp.buttons[6]?.value ?? 0) > 0.35,
      sprint: Boolean(gp.buttons[10]?.pressed),
      reload: Boolean(gp.buttons[2]?.pressed),
      interact: Boolean(gp.buttons[3]?.pressed),
      jump: Boolean(gp.buttons[0]?.pressed),
    };
  }

  private fixedTick(dt: number, elapsedSec: number): void {
    this.stats.elapsedSeconds += dt;
    const kb = this.settings.keyBindings;
    const gp = this.pollGamepad();

    const input: PlayerInputState = {
      forward: this.keysDown.has(kb.forward) || gp.dy < -0.25,
      backward: this.keysDown.has(kb.backward) || gp.dy > 0.25,
      left: this.keysDown.has(kb.left) || gp.dx < -0.25,
      right: this.keysDown.has(kb.right) || gp.dx > 0.25,
      jump: this.keysDown.has(kb.jump) || gp.jump,
      sprint: this.keysDown.has(kb.sprint) || gp.sprint,
      crouch: this.keysDown.has(kb.crouch),
      ads: this.mouseRightDown || gp.ads,
      fireHeld: this.mouseLeftDown || gp.fire,
      firePressed: this.pendingFirePress,
      reloadPressed: this.pendingReloadPress || gp.reload,
      interactHeld: this.keysDown.has(kb.interact) || gp.interact,
      meleePressed: this.pendingMeleePress,
      grenadePressed: this.pendingGrenadePress,
      swapPressed: this.pendingSwapPress,
    };

    this.pendingFirePress = false;
    this.pendingReloadPress = false;
    this.pendingMeleePress = false;
    this.pendingGrenadePress = false;
    this.pendingSwapPress = false;

    const activeCfg = this.weapons.getActiveConfig();
    const yawTurn =
      (this.keysDown.has('ArrowLeft') ? -1 : 0) +
      (this.keysDown.has('ArrowRight') ? 1 : 0) +
      (!this.pointerLocked && this.pointerLockBlocked ? this.edgeTurnDir : 0);
    const pitchTurn =
      (this.keysDown.has('ArrowUp') ? -1 : 0) +
      (this.keysDown.has('ArrowDown') ? 1 : 0);
    if (yawTurn !== 0 || pitchTurn !== 0) {
      const turnRate = 720 * dt;
      this.player.applyLookDelta(
        yawTurn * turnRate,
        pitchTurn * turnRate * 0.7,
        this.settings,
        activeCfg.adsSensScale,
      );
      this.weapons.addLookSway(yawTurn * turnRate * 0.6, pitchTurn * turnRate * 0.4);
    }

    this.player.update(
      dt,
      input,
      this.interactables.perks,
      this.settings,
      this.camera,
      activeCfg.adsFov,
    );
    this.camera.updateMatrixWorld(true);

    const zone = getZoneAtPosition(this.player.position.x, this.player.position.z);
    this.audio.setRoundIntensity(this.rounds.round, zone);

    this.player.getEyePosition(this.tmpEye);
    this.camera.getWorldDirection(this.tmpForward);
    this.audio.updateListener(
      this.tmpEye.x,
      this.tmpEye.y,
      this.tmpEye.z,
      this.tmpForward.x,
      this.tmpForward.y,
      this.tmpForward.z,
      this.tmpUp.x,
      this.tmpUp.y,
      this.tmpUp.z,
      this.player.health / Math.max(1, this.player.maxHealth),
      dt,
    );

    this.postProcess.setDamageAndHealthEffects(
      this.player.damageFlash,
      this.player.health / Math.max(1, this.player.maxHealth),
    );

    // Update Flow Field & Zombies (profile AI tick time for F3 overlay & Gate 2)
    const aiStart = performance.now();
    this.nav.updateFlowField(this.player.position.x, this.player.position.z, dt);
    this.zombies.update(
      dt,
      this.player.position,
      this.interactables.windowsById,
      this.interactables.unlockedZones,
      this.map.spawnPoints,
      (dmg, ax, az) => {
        this.player.takeDamage(
          dmg,
          ax,
          az,
          this.interactables.perks,
          () => {
            this.zombies.pushAwayFrom(
              this.player.position.x,
              this.player.position.z,
              BALANCE.player.secondWindPushRadius,
              4.2,
            );
            this.audio.playPowerUp('nuke');
            this.setRadioMessage('Second Wind triggered — reviving!');
          },
          () => {
            this.triggerGameOver();
          },
        );
      },
      (bx, by, bz) => {
        this.triggerBloaterExplosion(bx, by, bz);
      },
    );
    this.aiTickMs = this.aiTickMs * 0.85 + (performance.now() - aiStart) * 0.15;

    // Update Weapons & Hitscan
    this.weapons.update(
      dt,
      this.player,
      input,
      this.interactables.perks,
      { instaKill: this.interactables.isInstaKill() },
      this.rounds.round,
      {
        onPoints: (amt, reason) => this.awardPoints(amt, reason),
        onHitMarker: (kind) => {
          this.hitMarkerType = kind;
          this.hitMarkerTimer = 0.16;
        },
        onKillEnemy: (enemyType, kx, ky, kz, isHeadshot, isMelee) => {
          this.handleEnemyKilled(enemyType, kx, ky, kz, isHeadshot, isMelee);
        },
        onBloaterExplode: (bx, by, bz) => {
          this.triggerBloaterExplosion(bx, by, bz);
        },
        onHitStop: () => {
          this.hitStopTimer = BALANCE.sim.hitStopKillMs / 1000;
        },
        onShotStats: (fired, hit) => {
          if (fired) this.stats.shotsFired++;
          if (hit) this.stats.shotsHit++;
        },
      },
    );

    // Update Rounds
    const prevRound = this.rounds.round;
    this.rounds.update(
      dt,
      this.interactables.unlockedZones,
      this.map.spawnPoints,
      this.player.position,
      () => {
        this.roundBannerVisible = false;
      },
      (msg) => this.setRadioMessage(msg),
      () => {
        this.player.addCameraShake(0.085);
      },
    );
    if (this.rounds.round !== prevRound) {
      this.roundBannerVisible = true;
      this.stats.round = this.rounds.round;
      this.interactables.onNewRound();
    }

    // Update Interactables
    this.lastPrompt = this.interactables.update(
      dt,
      this.player,
      this.weapons,
      this.zombies,
      this.points,
      this.rounds.round,
      input.interactHeld,
      (cost) => {
        this.points = Math.max(0, this.points - cost);
      },
      (amt, reason) => this.awardPoints(amt, reason),
      (msg) => this.setRadioMessage(msg),
      () => {
        this.stats.doorsOpened++;
      },
      () => {
        this.stats.perksBought++;
      },
      (type, kx, ky, kz) => {
        this.handleEnemyKilled(type, kx, ky, kz, false, false);
      },
    );

    // Timers
    if (this.hitMarkerTimer > 0) {
      this.hitMarkerTimer -= dt;
      if (this.hitMarkerTimer <= 0) this.hitMarkerType = 'none';
    }
    if (this.radioTimer > 0) {
      this.radioTimer -= dt;
      if (this.radioTimer <= 0) this.radioMessage = null;
    }
    const now = performance.now();
    this.pointDeltas = this.pointDeltas.filter((d) => now - d.timestamp < 1400);

    this.animateLights(elapsedSec);
  }

  private lastPrompt: ReturnType<InteractablesSystem['update']> = null;

  private handleEnemyKilled(
    enemyType: EnemyType,
    x: number,
    y: number,
    z: number,
    isHeadshot: boolean,
    isMelee: boolean,
  ): void {
    this.stats.kills++;
    if (isHeadshot) this.stats.headshots++;
    if (isMelee) this.stats.meleeKills++;

    // Blood splatter decal on floor below kill
    this.weapons.spawnDecal(
      new THREE.Vector3(x, 0.03, z),
      new THREE.Vector3(0, 1, 0),
      'blood',
    );

    // Last hound in hound round guarantees Max Ammo
    const forceMaxAmmo =
      this.rounds.isHoundRound &&
      enemyType === 'hound' &&
      this.rounds.remainingToSpawn === 0 &&
      this.zombies.getAliveCount() === 0;

    this.interactables.trySpawnPowerUp(
      x,
      0,
      z,
      this.rounds.round,
      forceMaxAmmo ? 'max_ammo' : undefined,
    );
  }

  private triggerBloaterExplosion(x: number, y: number, z: number): void {
    this.audio.playExplosion(x, y, z);
    this.weapons.spawnParticles(new THREE.Vector3(x, y, z), 0x84cc16, 22, 6.2);
    const dist = Math.hypot(x - this.player.position.x, z - this.player.position.z);
    if (dist <= BALANCE.enemies.bloater.explosionRadius) {
      const falloff = 1 - dist / BALANCE.enemies.bloater.explosionRadius;
      this.player.takeDamage(
        Math.round(BALANCE.enemies.bloater.explosionDamagePlayer * Math.max(0.35, falloff)),
        x,
        z,
        this.interactables.perks,
        () => {
          this.zombies.pushAwayFrom(
            this.player.position.x,
            this.player.position.z,
            BALANCE.player.secondWindPushRadius,
            4.2,
          );
        },
        () => this.triggerGameOver(),
      );
    }
    this.zombies.applySplashDamage(
      x,
      y,
      z,
      BALANCE.enemies.bloater.explosionRadius,
      BALANCE.enemies.bloater.explosionDamageZombie,
      140,
      false,
      (ent) => {
        this.awardPoints(BALANCE.economy.explosiveKillPoints, 'Bloater Chain');
        this.handleEnemyKilled(ent.type, ent.x, ent.y + 1, ent.z, false, false);
      },
    );
  }

  private awardPoints(baseAmount: number, reason: string): void {
    const amt = this.interactables.isDoublePoints() ? baseAmount * 2 : baseAmount;
    this.points += amt;
    this.stats.pointsEarned += amt;
    this.pointDeltas.push({
      id: this.nextDeltaId++,
      amount: amt,
      reason,
      timestamp: performance.now(),
    });
    if (this.pointDeltas.length > 6) {
      this.pointDeltas.shift();
    }
  }

  private setRadioMessage(msg: string): void {
    this.radioMessage = msg;
    this.radioTimer = 5.5;
    this.audio.playRadioChirp();
  }

  private triggerGameOver(): void {
    this.clearInputs();
    this.screen = 'gameover';
    this.exitPointerLockSafely();
    saveBestRun(this.rounds.round, this.stats.kills, this.stats.pointsEarned);
    this.emitHud();
  }

  private createSporeAtmosphere(): void {
    const count = 180;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (this.rng.next() - 0.5) * 68;
      positions[i * 3 + 1] = 0.35 + this.rng.next() * 4.4;
      positions[i * 3 + 2] = -42 + this.rng.next() * 68;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xd9f99d,
      size: 0.11,
      transparent: true,
      opacity: 0.36,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.sporePoints = new THREE.Points(geo, mat);
    this.scene.add(this.sporePoints);
  }

  private isReticleNearZombie(): boolean {
    this.camera.getWorldPosition(this.tmpEye);
    this.camera.getWorldDirection(this.tmpForward);
    for (const e of this.zombies.entities) {
      if (!e.active || e.state === 'dying' || e.state === 'dead') continue;
      const headY = e.y + (e.type === 'hound' ? 0.58 : e.isCrawler ? 0.42 : 1.46);
      const dx = e.x - this.tmpEye.x;
      const dy = headY - this.tmpEye.y;
      const dz = e.z - this.tmpEye.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist < 0.4 || dist > 26) continue;
      const dot = (dx * this.tmpForward.x + dy * this.tmpForward.y + dz * this.tmpForward.z) / dist;
      if (dot > 0.992) return true;
    }
    return false;
  }

  private snapAimTowardNearestTarget(): void {
    this.camera.getWorldPosition(this.tmpEye);
    this.camera.getWorldDirection(this.tmpForward);
    let bestDot = 0.97;
    let bestDx = 0;
    let bestDy = 0;
    let bestDz = 0;
    let found = false;
    for (const e of this.zombies.entities) {
      if (!e.active || e.state === 'dying' || e.state === 'dead') continue;
      const headY = e.y + (e.type === 'hound' ? 0.58 : e.isCrawler ? 0.42 : 1.46);
      const dx = e.x - this.tmpEye.x;
      const dy = headY - this.tmpEye.y;
      const dz = e.z - this.tmpEye.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist < 0.6 || dist > 26) continue;
      const dot = (dx * this.tmpForward.x + dy * this.tmpForward.y + dz * this.tmpForward.z) / dist;
      if (dot > bestDot) {
        bestDot = dot;
        bestDx = dx;
        bestDy = dy;
        bestDz = dz;
        found = true;
      }
    }
    if (!found) return;
    const targetYaw = Math.atan2(-bestDx, -bestDz);
    const horiz = Math.hypot(bestDx, bestDz);
    const targetPitch = Math.atan2(bestDy, Math.max(0.01, horiz));
    let dyaw = targetYaw - this.player.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    this.player.yaw += dyaw * 0.65;
    this.player.pitch = THREE.MathUtils.clamp(
      this.player.pitch + (targetPitch - this.player.pitch) * 0.65,
      -1.45,
      1.45,
    );
  }

  private animateLights(t: number): void {
    for (const fl of this.map.flickerLights) {
      const n = Math.sin(t * 7.3 + fl.phase) * Math.sin(t * 17.1 + fl.phase * 2.1);
      fl.light.intensity = fl.baseIntensity * (n > 0.86 ? 0.55 : 0.96 + n * 0.04);
    }
  }

  private getObjectiveHint(): string | null {
    if (this.rounds.round > 4) return null;
    if (!this.interactables.unlockedZones.has('silo_yard')) {
      return 'Defend the Farmhouse, rebuild barricades (F), and unlock the Silo Yard Gate (750 PTS).';
    }
    if (!this.interactables.unlockedZones.has('lab_wing')) {
      return 'Cross the Silo Yard and unlock the Bio-Lab Airlock (1250 PTS) to reach the Power Switch.';
    }
    if (!this.interactables.powerOn) {
      return 'Locate and flip the Station Power Switch on the east wall of the Bio-Lab.';
    }
    return null;
  }

  public getSnapshot(): HudSnapshot {
    const zone = getZoneAtPosition(this.player.position.x, this.player.position.z);
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return {
      screen: this.screen,
      loadProgress: 1,
      loadLabel: 'Ready',
      pointerLocked: this.pointerLocked,
      pointerLockBlocked: this.pointerLockBlocked,
      health: Math.ceil(this.player.health),
      maxHealth: this.player.maxHealth,
      isReviving: this.player.isReviving,
      reviveProgress: this.player.isReviving
        ? 1 - this.player.reviveTimer / BALANCE.player.secondWindDuration
        : 0,
      points: this.points,
      round: this.rounds.round,
      roundPhase: this.rounds.phase,
      roundBannerText:
        this.roundBannerVisible || this.rounds.phase === 'intermission'
          ? this.rounds.phase === 'intermission'
            ? `ROUND ${this.rounds.round} CLEARED`
            : this.rounds.bannerText
          : '',
      isHoundRound: this.rounds.isHoundRound,
      powerOn: this.interactables.powerOn,
      currentZone: zone,
      currentZoneLabel: ZONE_LABELS[zone],
      weapons: this.weapons.slots.map((s) => ({ ...s })),
      activeSlot: this.weapons.activeSlot,
      activeWeaponId: this.weapons.getActiveWeapon().id,
      isReloading: this.weapons.isReloading,
      reloadProgress: this.weapons.isReloading
        ? Math.min(1, this.weapons.reloadTimer / Math.max(0.1, this.weapons.reloadDuration))
        : 0,
      isAds: this.player.isAds,
      isSprinting: this.player.isSprinting,
      crosshairSpread: this.weapons.getCrosshairSpread(this.player),
      flashlightOn: this.flashlightOn,
      zombiesRemaining: this.rounds.remainingToSpawn + this.zombies.getAliveCount(),
      grenades: this.player.grenades,
      maxGrenades: BALANCE.player.grenadesMax,
      perks: Array.from(this.interactables.perks),
      activePowerUps: this.interactables.getActivePowerUpList(),
      interactPrompt: this.lastPrompt ? { ...this.lastPrompt } : null,
      pointDeltas: [...this.pointDeltas],
      hitMarkerType: this.hitMarkerType,
      hitMarkerAlpha: this.hitMarkerTimer > 0 ? this.hitMarkerTimer / 0.16 : 0,
      damageFlash: this.player.damageFlash,
      damageIndicatorAngle: this.player.damageIndicatorAngle,
      damageIndicatorAlpha: this.player.damageIndicatorAlpha,
      radioMessage: this.radioMessage,
      objectiveHint: this.getObjectiveHint(),
      easterEggStep: this.interactables.easterEggStep,
      fusesCollected: this.interactables.fusesCollected,
      radioDefendRemaining: Math.ceil(this.interactables.radioDefendTimer),
      stats: { ...this.stats, round: this.rounds.round },
      perf: {
        fps: this.fps,
        frameTimeMs: Number(this.frameTimeMs.toFixed(1)),
        drawCalls: this.renderer.info.render.calls,
        triangles: this.renderer.info.render.triangles,
        zombieCount: this.zombies.getAliveCount(),
        aiTickMs: Number(this.aiTickMs.toFixed(2)),
        memoryMb: mem ? Math.round(mem.usedJSHeapSize / (1024 * 1024)) : 0,
      },
      showDebug: this.showDebug,
      activeEnemyTypes: this.zombies.getActiveEnemyTypes(),
      errorBanner: this.errorBanner,
    };
  }

  private emitHud(): void {
    this.onSnapshot(this.getSnapshot());
  }

  private registerDebugApi(): void {
    const api: DebugApi = {
      getState: () => this.getSnapshot(),
      getPlayerPose: () => ({
        x: Number(this.player.position.x.toFixed(3)),
        y: Number(this.player.position.y.toFixed(3)),
        z: Number(this.player.position.z.toFixed(3)),
        yaw: Number(this.player.yaw.toFixed(4)),
        pitch: Number(this.player.pitch.toFixed(4)),
      }),
      getZombies: () =>
        this.zombies.entities
          .filter((e) => e.active && e.state !== 'dead')
          .map((e) => ({
            id: e.id,
            type: e.type,
            x: Number(e.x.toFixed(2)),
            z: Number(e.z.toFixed(2)),
            state: e.state,
            health: Math.round(e.health),
          })),
      getStuckTeleports: () => this.zombies.stuckTeleportCount,
      startRun: () => {
        if (this.screen === 'menu') this.startNewGame();
        else this.restartGame();
      },
      setPlayerPose: (x, y, z, yaw, pitch) => {
        this.physics.playerBody.setNextKinematicTranslation({ x, y, z });
        this.physics.world.step();
        this.player.position.set(x, y, z);
        if (yaw !== undefined) this.player.yaw = yaw;
        if (pitch !== undefined) this.player.pitch = pitch;
      },
      addPoints: (amt) => {
        this.points += amt;
        this.emitHud();
      },
      jumpToRound: (r) => {
        this.zombies.killAll();
        this.rounds.startRound(r);
        this.stats.round = r;
        this.emitHud();
      },
      spawnAllZombiesTest: (count) => {
        const valid = this.map.spawnPoints.filter((s) =>
          this.interactables.unlockedZones.has(s.zone),
        );
        const pool = valid.length > 0 ? valid : this.map.spawnPoints;
        for (let i = 0; i < count; i++) {
          const sp = pool[i % pool.length]!;
          this.zombies.spawnEnemy('shambler', this.rounds.round, sp, this.rng);
        }
      },
      triggerAction: (action) => {
        if (action === 'shoot') this.pendingFirePress = true;
        if (action === 'reload') this.pendingReloadPress = true;
        if (action === 'melee') this.pendingMeleePress = true;
        if (action === 'swap') this.pendingSwapPress = true;
        if (action === 'grenade') this.pendingGrenadePress = true;
        if (action === 'inspect') this.weapons.triggerInspect();
      },
    };
    (window as unknown as { __HOLLOWFIELD_DEBUG__?: DebugApi }).__HOLLOWFIELD_DEBUG__ = api;
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    for (const id of this.timerIds) clearTimeout(id);
    this.timerIds.clear();

    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('blur', this.onWindowBlur);
    window.removeEventListener('contextmenu', this.onContextMenu);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.removeEventListener('pointerlockerror', this.onPointerLockError);

    this.postProcess?.dispose();
    this.bvh.dispose();
    this.physics.dispose();
    this.audio.dispose();
    if (this.renderer?.domElement?.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
    this.renderer?.dispose();
  }
}
