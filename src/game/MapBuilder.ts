import * as THREE from 'three';
import type { PerkId, WeaponId, ZoneId } from '../config/balance';
import { BALANCE } from '../config/balance';
import type { BvhWorld, SurfaceType } from '../engine/BvhWorld';
import type { NavGrid } from '../engine/NavGrid';
import type { PhysicsWorld } from '../engine/PhysicsWorld';
import {
  createNoticeboardTexture,
  createOscilloscopeTexture,
  createSignageTexture,
  createWallBuyChalkTexture,
  type PbrMaterialSet,
} from '../engine/ProceduralAssets';

export interface DoorObject {
  id: string;
  label: string;
  cost: number;
  mesh: THREE.Group;
  collisionMesh: THREE.Mesh;
  center: THREE.Vector3;
  isOpen: boolean;
  unlockZones: ZoneId[];
}

export interface WindowBarricade {
  id: string;
  zone: ZoneId;
  center: THREE.Vector3;
  outsidePos: THREE.Vector3;
  insidePos: THREE.Vector3;
  planks: THREE.Mesh[];
  intactCount: number;
  repairProgress: number;
}

export interface WallBuyObject {
  id: string;
  weaponId: WeaponId;
  cost: number;
  ammoCost: number;
  position: THREE.Vector3;
  mesh: THREE.Mesh;
}

export interface PerkMachineObject {
  id: PerkId;
  position: THREE.Vector3;
  group: THREE.Group;
  light: THREE.PointLight;
  emissiveMat: THREE.MeshStandardMaterial;
}

export interface CrateSlot {
  index: number;
  position: THREE.Vector3;
  rotationY: number;
  group: THREE.Group;
  lid: THREE.Group;
  light: THREE.PointLight;
  active: boolean;
}

export interface SpawnPoint {
  id: string;
  zone: ZoneId;
  position: THREE.Vector3;
  windowId?: string;
}

export interface FusePickup {
  id: string;
  index: number;
  position: THREE.Vector3;
  mesh: THREE.Group;
  collected: boolean;
}

export interface MapBuildResult {
  doors: DoorObject[];
  windows: WindowBarricade[];
  wallBuys: WallBuyObject[];
  perkMachines: PerkMachineObject[];
  crateSlots: CrateSlot[];
  spawnPoints: SpawnPoint[];
  powerSwitchPos: THREE.Vector3;
  powerLeverMesh: THREE.Mesh;
  powerIndicatorMat: THREE.MeshStandardMaterial;
  overclockPos: THREE.Vector3;
  overclockRotor: THREE.Group;
  overclockLight: THREE.PointLight;
  electricTrapPos: THREE.Vector3;
  electricTrapCenter: THREE.Vector3;
  electricTrapArcs: THREE.Group;
  electricTrapLight: THREE.PointLight;
  fusePickups: FusePickup[];
  radioConsolePos: THREE.Vector3;
  radioScreenMat: THREE.MeshStandardMaterial;
  poweredLights: THREE.PointLight[];
  poweredEmissives: THREE.MeshStandardMaterial[];
  flickerLights: { light: THREE.PointLight; baseIntensity: number; phase: number }[];
}

export function getZoneAtPosition(x: number, z: number): ZoneId {
  if (z >= 10 && x >= -15 && x <= 1) return 'farmhouse';
  if (x >= 12 && z >= -7 && z <= 17) return 'barn';
  if (z <= -30) return 'bunker';
  if (z <= -14 && x >= -15 && x <= 15) return 'lab_wing';
  return 'silo_yard';
}

export const ZONE_LABELS: Record<ZoneId, string> = {
  farmhouse: 'Farmhouse Quarters',
  barn: 'Timber Barn',
  silo_yard: 'Silo Yard',
  lab_wing: 'Bio-Lab Wing',
  bunker: 'Underground Bunker',
};

export class MapBuilder {
  private readonly scene: THREE.Scene;
  private readonly physics: PhysicsWorld;
  private readonly bvh: BvhWorld;
  private readonly nav: NavGrid;
  private readonly mats: PbrMaterialSet;
  private readonly isSoftwareGl: boolean;

  constructor(
    scene: THREE.Scene,
    physics: PhysicsWorld,
    bvh: BvhWorld,
    nav: NavGrid,
    mats: PbrMaterialSet,
    isSoftwareGl: boolean,
  ) {
    this.scene = scene;
    this.physics = physics;
    this.bvh = bvh;
    this.nav = nav;
    this.mats = mats;
    this.isSoftwareGl = isSoftwareGl;
  }

  private tileBoxUvs(geo: THREE.BoxGeometry, scale = 0.35): void {
    const uv = geo.attributes.uv;
    const pos = geo.attributes.position;
    const norm = geo.attributes.normal;
    if (!uv || !pos || !norm) return;
    for (let i = 0; i < uv.count; i++) {
      const nx = Math.abs(norm.getX(i));
      const ny = Math.abs(norm.getY(i));
      const px = pos.getX(i);
      const py = pos.getY(i);
      const pz = pos.getZ(i);
      if (nx > 0.5) {
        uv.setXY(i, pz * scale, py * scale);
      } else if (ny > 0.5) {
        uv.setXY(i, px * scale, pz * scale);
      } else {
        uv.setXY(i, px * scale, py * scale);
      }
    }
    uv.needsUpdate = true;
  }

  private addFloorSlab(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    material: THREE.Material,
    surface: SurfaceType,
    uvScale = 0.38,
  ): THREE.Mesh {
    const geo = new THREE.BoxGeometry(w, h, d);
    this.tileBoxUvs(geo, uvScale);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.bvh.registerMesh(mesh, surface);
    return mesh;
  }

  private addWallBox(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    material: THREE.Material,
    surface: SurfaceType,
    options?: {
      castShadow?: boolean;
      receiveShadow?: boolean;
      navBlock?: boolean;
      physicsBlock?: boolean;
      uvScale?: number;
    },
  ): THREE.Mesh {
    const geo = new THREE.BoxGeometry(w, h, d);
    this.tileBoxUvs(geo, options?.uvScale ?? 0.36);

    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = (options?.castShadow ?? true) && !this.isSoftwareGl;
    mesh.receiveShadow = options?.receiveShadow ?? true;
    this.scene.add(mesh);

    this.bvh.registerMesh(mesh, surface);

    if (options?.physicsBlock !== false) {
      this.physics.addStaticBox({
        cx: x,
        cy: y,
        cz: z,
        hx: w * 0.5,
        hy: h * 0.5,
        hz: d * 0.5,
      });
    }

    if (options?.navBlock !== false && y - h * 0.5 < 1.6) {
      this.nav.addStaticObstacle({
        minX: x - w * 0.5,
        maxX: x + w * 0.5,
        minZ: z - d * 0.5,
        maxZ: z + d * 0.5,
      });
    }
    return mesh;
  }

  public build(): MapBuildResult {
    const doors: DoorObject[] = [];
    const windows: WindowBarricade[] = [];
    const wallBuys: WallBuyObject[] = [];
    const perkMachines: PerkMachineObject[] = [];
    const crateSlots: CrateSlot[] = [];
    const spawnPoints: SpawnPoint[] = [];
    const fusePickups: FusePickup[] = [];
    const poweredLights: THREE.PointLight[] = [];
    const poweredEmissives: THREE.MeshStandardMaterial[] = [];
    const flickerLights: { light: THREE.PointLight; baseIntensity: number; phase: number }[] = [];

    // 0. 360-degree Night Sky Dome with stars, moon halo & horizon mountain ridge
    const skyGeo = new THREE.SphereGeometry(145, 28, 16);
    const skyMat = new THREE.MeshBasicMaterial({
      map: this.mats.skyDomeTex,
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
    });
    const skyDome = new THREE.Mesh(skyGeo, skyMat);
    skyDome.renderOrder = -10;
    this.scene.add(skyDome);

    // 1. Extended valley terrain + yard surface with crisp world-scaled UVs
    const outerGroundGeo = new THREE.PlaneGeometry(200, 200);
    outerGroundGeo.rotateX(-Math.PI / 2);
    const uvAttr = outerGroundGeo.attributes.uv;
    if (uvAttr) {
      for (let i = 0; i < uvAttr.count; i++) {
        uvAttr.setXY(i, uvAttr.getX(i) * 44, uvAttr.getY(i) * 44);
      }
      uvAttr.needsUpdate = true;
    }
    const outerGround = new THREE.Mesh(outerGroundGeo, this.mats.soil);
    outerGround.position.y = 0;
    outerGround.receiveShadow = true;
    this.scene.add(outerGround);
    this.bvh.registerMesh(outerGround, 'dirt');

    // Yard wet asphalt apron with crisp 0.32 repeat/meter UVs
    this.addFloorSlab(0, 0.01, -2, 44, 0.08, 24, this.mats.wetAsphalt, 'concrete', 0.34);

    // Concrete curb border along north edge of yard leading to Bio-Lab
    this.addWallBox(0, 0.08, -13.6, 28, 0.16, 0.5, this.mats.concrete, 'concrete', {
      navBlock: false,
      physicsBlock: false,
    });

    // Natural perimeter fence + dense tree line + Bloom spores around 90x90 station
    this.buildPerimeter();

    // =========================================================================
    // ZONE 1: FARMHOUSE (x: -14 .. 0, z: 10 .. 26)
    // =========================================================================
    this.addFloorSlab(-7, 0.03, 18, 14.4, 0.06, 16.4, this.mats.barnWood, 'wood', 0.42);

    // Farmhouse roof (overhead shelter)
    this.addWallBox(-7, 4.1, 18, 14.8, 0.35, 16.8, this.mats.barnWood, 'wood', {
      navBlock: false,
      castShadow: true,
    });

    // South wall (solid)
    this.addWallBox(-7, 2, 26, 14.4, 4, 0.6, this.mats.plasterWall, 'wood');
    // North wall with door gap at x: -9 .. -5 (center -7, width 4)
    this.addWallBox(-11.7, 2, 10, 5.4, 4, 0.6, this.mats.plasterWall, 'wood');
    this.addWallBox(-2.3, 2, 10, 5.4, 4, 0.6, this.mats.plasterWall, 'wood');
    this.addWallBox(-7, 3.4, 10, 4.0, 1.2, 0.6, this.mats.plasterWall, 'wood', { navBlock: false });

    // West wall with Window 1 gap at z = 14 (width 2.4)
    this.addWallBox(-14, 2, 11.4, 0.6, 4, 2.8, this.mats.plasterWall, 'wood');
    this.addWallBox(-14, 2, 20.6, 0.6, 4, 10.8, this.mats.plasterWall, 'wood');
    // East wall with Window 2 gap at z = 21 (width 2.4)
    this.addWallBox(0, 2, 14.9, 0.6, 4, 9.8, this.mats.plasterWall, 'wood');
    this.addWallBox(0, 2, 24.1, 0.6, 4, 3.8, this.mats.plasterWall, 'wood');

    // Detailed Farmhouse Kitchen Island (countertop overhang, sink basin, recessed cabinetry)
    this.addWallBox(-7, 0.5, 18, 3.3, 1.0, 1.85, this.mats.timberBeam, 'wood');
    this.addWallBox(-7, 1.04, 18, 3.55, 0.1, 2.1, this.mats.concrete, 'concrete', { navBlock: false });
    const sinkRim = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.65), this.mats.brushedSteel);
    sinkRim.position.set(-7.9, 1.1, 18);
    const faucetStem = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.28, 8), this.mats.brushedSteel);
    faucetStem.position.set(-7.9, 1.24, 17.72);
    const faucetSpout = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.16), this.mats.brushedSteel);
    faucetSpout.position.set(-7.9, 1.36, 17.78);
    this.scene.add(sinkRim, faucetStem, faucetSpout);

    // Window 1 & 2
    windows.push(
      this.createWindowBarricade('win_fh_west', 'farmhouse', -14, 14, 'x', -19.5, -12.0),
      this.createWindowBarricade('win_fh_east', 'farmhouse', 0, 21, 'x', 5.5, -2.0),
    );
    spawnPoints.push(
      { id: 'sp_fh_w', zone: 'farmhouse', position: new THREE.Vector3(-20, 0, 14), windowId: 'win_fh_west' },
      { id: 'sp_fh_e', zone: 'farmhouse', position: new THREE.Vector3(6, 0, 21), windowId: 'win_fh_east' },
    );

    // Farmhouse warm tungsten hanging cage lamps + rafters + wainscoting + noticeboard
    const fhLight = new THREE.PointLight(0xffad58, 3.1, 18, 1.7);
    fhLight.position.set(-7, 3.25, 16.5);
    this.scene.add(fhLight);
    flickerLights.push({ light: fhLight, baseIntensity: 3.1, phase: 0.4 });
    this.createHangingLamp(-7, 3.9, 16.5);
    this.createLightShaft(-7, 3.3, 16.5, 1.5, 2.8, 0xffad58, 0.024);

    for (let z = 12; z <= 24; z += 4) {
      this.addWallBox(-7, 3.84, z, 13.6, 0.22, 0.24, this.mats.timberBeam, 'wood', { navBlock: false });
    }
    for (const [px, pz] of [
      [-13.55, 10.45],
      [-0.45, 10.45],
      [-13.55, 25.55],
      [-0.45, 25.55],
      [-9.1, 10.35],
      [-4.9, 10.35],
    ] as const) {
      this.addWallBox(px, 2, pz, 0.34, 3.9, 0.34, this.mats.timberBeam, 'wood', { navBlock: false });
    }
    // Wood wainscot paneling along North & West Farmhouse walls
    this.addWallBox(-11.7, 0.45, 10.34, 5.2, 0.9, 0.08, this.mats.barnWood, 'wood', {
      navBlock: false,
      physicsBlock: false,
    });
    this.addWallBox(-2.3, 0.45, 10.34, 5.2, 0.9, 0.08, this.mats.barnWood, 'wood', {
      navBlock: false,
      physicsBlock: false,
    });
    this.addWallBox(-7, 0.45, 25.66, 13.4, 0.9, 0.08, this.mats.barnWood, 'wood', {
      navBlock: false,
      physicsBlock: false,
    });

    // Quarantine Noticeboard on Farmhouse West-North wall
    const noticeMat = new THREE.MeshStandardMaterial({
      map: createNoticeboardTexture(),
      roughness: 0.72,
    });
    const noticeBoard = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.08, 0.06), noticeMat);
    noticeBoard.position.set(-11.4, 1.75, 10.36);
    this.scene.add(noticeBoard);

    // Corner crates, table & chemical drums in Farmhouse
    this.createBarrel(-12.5, 11.4);
    this.createBarrel(-1.5, 11.4);
    this.createWoodCrate(-12.2, 24.0, 1.1);
    this.createWoodCrate(-11.0, 24.1, 0.75);
    this.createFloorStain(-7, 13.2, 1.6);

    this.addStationSign(-7, 2.9, 25.6, 0, 'HOLLOWFIELD STATION', 'QUARTERS // SECTOR 01');

    // Wall-buy: Hedgerow Pump Shotgun
    wallBuys.push(
      this.createWallBuy('hedgerow', new THREE.Vector3(-0.36, 1.55, 15.0), -Math.PI / 2),
    );

    // Door 1: Farmhouse to Yard (750)
    doors.push(
      this.createDoor(
        'farmhouse_to_yard',
        'Unlock Silo Yard Gate',
        BALANCE.economy.doors.farmhouse_to_yard,
        new THREE.Vector3(-7, 1.4, 10),
        3.9,
        2.8,
        0.45,
        0,
        ['silo_yard'],
      ),
    );

    // =========================================================================
    // ZONE 3: SILO YARD (Outdoor central hub)
    // =========================================================================
    // Twin corrugated grain silos + overhead auger bridge
    this.createSilo(-17, -4.5);
    this.createSilo(-17, 3.0);
    this.createSiloBridge(-17, -4.5, -17, 3.0);

    // High-craft 1986 farm tractor + yard barrels, crates & utility poles with overhead cables
    this.createTractor(-1, 2.5);
    this.createBarrel(-13.5, 1.5);
    this.createBarrel(-13.2, 2.4);
    this.createWoodCrate(5.5, 4.2, 1.2);
    this.createWoodCrate(6.6, 4.5, 0.85);

    // Sodium street lamp poles + sagging overhead power wires
    this.createLampPost(-11, 6, flickerLights, true);
    this.createLampPost(7, -8, flickerLights, !this.isSoftwareGl);
    this.createLampPost(9, 6, flickerLights, !this.isSoftwareGl);
    this.createOverheadCable(-11, 5.1, 6, 9, 5.1, 6);
    this.createOverheadCable(9, 5.1, 6, 7, 5.1, -8);
    this.createOverheadCable(7, 5.1, -8, 12.5, 3.7, -14);

    // Outdoor tree-line spawns
    spawnPoints.push(
      { id: 'sp_yard_w', zone: 'silo_yard', position: new THREE.Vector3(-26, 0, -5) },
      { id: 'sp_yard_e', zone: 'silo_yard', position: new THREE.Vector3(24, 0, -10) },
    );

    // Electric Trap Archway at (-7, 5.5)
    const trapBuilt = this.createElectricTrap(-7, 5.5, poweredEmissives);

    // =========================================================================
    // ZONE 2: TIMBER BARN (x: 12 .. 30, z: -6 .. 16)
    // =========================================================================
    this.addFloorSlab(21, 0.03, 5, 18.4, 0.06, 22.4, this.mats.barnWood, 'wood', 0.42);

    // Barn roof + interior structural trusses
    this.addWallBox(21, 6.2, 5, 18.8, 0.35, 22.8, this.mats.rustedMetal, 'metal', {
      navBlock: false,
      castShadow: true,
    });
    for (let bz = -2; bz <= 12; bz += 7) {
      this.addWallBox(21, 5.85, bz, 17.8, 0.28, 0.32, this.mats.timberBeam, 'wood', {
        navBlock: false,
        physicsBlock: false,
      });
    }

    // West wall with Door 2 gap at z: 0..4 (center 2, width 4)
    this.addWallBox(12, 3, -3.2, 0.6, 6, 6.4, this.mats.barnWood, 'wood');
    this.addWallBox(12, 3, 10.2, 0.6, 6, 12.4, this.mats.barnWood, 'wood');
    this.addWallBox(12, 4.6, 2, 0.6, 2.8, 4.2, this.mats.barnWood, 'wood', { navBlock: false });

    // South wall with Window 3 at x = 20
    this.addWallBox(15.4, 3, 16, 6.8, 6, 0.6, this.mats.barnWood, 'wood');
    this.addWallBox(25.6, 3, 16, 8.8, 6, 0.6, this.mats.barnWood, 'wood');
    // East wall with Window 4 at z = 5
    this.addWallBox(30, 3, -1.1, 0.6, 6, 9.8, this.mats.barnWood, 'wood');
    this.addWallBox(30, 3, 11.1, 0.6, 6, 9.8, this.mats.barnWood, 'wood');
    // North wall with Window 5 at x = 21
    this.addWallBox(15.9, 3, -6, 7.8, 6, 0.6, this.mats.barnWood, 'wood');
    this.addWallBox(26.1, 3, -6, 7.8, 6, 0.6, this.mats.barnWood, 'wood');

    // Interior golden straw hay bale stack (stepped bales with hayStraw PBR material)
    this.addWallBox(19, 0.55, 5, 2.4, 1.1, 2.8, this.mats.hayStraw, 'wood', { uvScale: 0.7 });
    this.addWallBox(19.15, 1.45, 4.9, 1.6, 0.72, 1.9, this.mats.hayStraw, 'wood', {
      navBlock: false,
      uvScale: 0.7,
    });

    // Hay loft platform + structural support posts + safety guardrail + walkable ramp
    this.addWallBox(25.5, 2.5, 1.5, 6.5, 0.35, 11.0, this.mats.timberBeam, 'wood', { navBlock: false });
    // Support posts under hayloft edges (fixing floating slab!)
    for (const [lx, lz] of [
      [22.4, -3.7],
      [22.4, 1.5],
      [22.4, 6.7],
      [28.5, -3.7],
      [28.5, 6.7],
    ] as const) {
      this.addWallBox(lx, 1.25, lz, 0.28, 2.5, 0.28, this.mats.timberBeam, 'wood');
    }
    // Hayloft wooden safety rail on west edge (x=22.35, z=-3.8..6.8)
    this.addWallBox(22.35, 3.45, 1.5, 0.1, 0.1, 10.8, this.mats.timberBeam, 'wood', { navBlock: false });
    for (let rz = -3.6; rz <= 6.6; rz += 2.55) {
      this.addWallBox(22.35, 3.05, rz, 0.1, 0.85, 0.1, this.mats.timberBeam, 'wood', { navBlock: false });
    }
    this.createWalkableRamp(25.5, 0, 10.0, 2.6, 2.5, 6.0);

    windows.push(
      this.createWindowBarricade('win_barn_s', 'barn', 20, 16, 'z', 22.0, 14.0),
      this.createWindowBarricade('win_barn_e', 'barn', 30, 5, 'x', 36.0, 28.0),
      this.createWindowBarricade('win_barn_n', 'barn', 21, -6, 'z', -12.0, -4.0),
    );
    spawnPoints.push(
      { id: 'sp_barn_s', zone: 'barn', position: new THREE.Vector3(20, 0, 23), windowId: 'win_barn_s' },
      { id: 'sp_barn_e', zone: 'barn', position: new THREE.Vector3(37, 0, 5), windowId: 'win_barn_e' },
      { id: 'sp_barn_n', zone: 'barn', position: new THREE.Vector3(21, 0, -13), windowId: 'win_barn_n' },
    );

    const barnLight = new THREE.PointLight(0xf59e42, 3.2, 22, 1.5);
    barnLight.position.set(21, 5.2, 5);
    this.scene.add(barnLight);
    poweredLights.push(barnLight);
    this.createHangingLamp(21, 6.0, 5);
    this.createLightShaft(21, 5.4, 5, 2.6, 5.2, 0xf59e42, 0.042);

    // Wall-buy: Rattler SMG
    wallBuys.push(
      this.createWallBuy('rattler', new THREE.Vector3(12.36, 1.55, -2.5), Math.PI / 2),
    );

    // Perk Machine: Quickhands
    perkMachines.push(this.createPerkMachine('quickhands', new THREE.Vector3(27.5, 0, 13.5), -Math.PI * 0.75));

    // Door 2: Yard to Barn (1000)
    doors.push(
      this.createDoor(
        'yard_to_barn',
        'Unlock Barn Doors',
        BALANCE.economy.doors.yard_to_barn,
        new THREE.Vector3(12, 1.6, 2),
        0.45,
        3.2,
        3.9,
        0,
        ['barn'],
      ),
    );

    // =========================================================================
    // ZONE 4: LAB WING (x: -14 .. 14, z: -30 .. -14)
    // =========================================================================
    this.addFloorSlab(0, 0.03, -22, 28.4, 0.06, 16.4, this.mats.labTile, 'concrete', 0.45);

    // Lab ceiling + overhead industrial fluorescent light fixtures
    this.addWallBox(0, 4.2, -22, 28.8, 0.35, 16.8, this.mats.concrete, 'concrete', { navBlock: false });
    this.createFluorescentFixture(-6, 3.98, -22, poweredEmissives);
    this.createFluorescentFixture(6, 3.98, -22, poweredEmissives);

    // South wall with Door 3 gap at x: -2..2
    this.addWallBox(-8.2, 2, -14, 12.0, 4, 0.6, this.mats.labTile, 'concrete');
    this.addWallBox(8.2, 2, -14, 12.0, 4, 0.6, this.mats.labTile, 'concrete');
    this.addWallBox(0, 3.4, -14, 4.4, 1.2, 0.6, this.mats.labTile, 'concrete', { navBlock: false });

    // North wall with Door 4 gap at x: -8..-4 (center -6)
    this.addWallBox(-11.2, 2, -30, 6.0, 4, 0.6, this.mats.labTile, 'concrete');
    this.addWallBox(5.2, 2, -30, 18.0, 4, 0.6, this.mats.labTile, 'concrete');
    this.addWallBox(-6, 3.4, -30, 4.4, 1.2, 0.6, this.mats.labTile, 'concrete', { navBlock: false });

    // West wall (solid)
    this.addWallBox(-14, 2, -22, 0.6, 4, 16.4, this.mats.labTile, 'concrete');
    // East wall with Window 6 at z = -22
    this.addWallBox(14, 2, -17.4, 0.6, 4, 7.2, this.mats.labTile, 'concrete');
    this.addWallBox(14, 2, -26.6, 0.6, 4, 7.2, this.mats.labTile, 'concrete');

    // Central bio-containment tank & equipped lab workbenches (figure-8 loops)
    this.createBioVat(0, -22);
    this.createLabBench(-7, -22, poweredEmissives);
    this.createLabBench(7, -22, poweredEmissives);

    windows.push(
      this.createWindowBarricade('win_lab_e', 'lab_wing', 14, -22, 'x', 20.0, 12.0),
    );
    spawnPoints.push(
      { id: 'sp_lab_e', zone: 'lab_wing', position: new THREE.Vector3(21, 0, -22), windowId: 'win_lab_e' },
    );

    // Lab fluorescent lights
    const labLightA = new THREE.PointLight(0xa7f3d0, 2.4, 18, 1.5);
    labLightA.position.set(-6, 3.7, -22);
    this.scene.add(labLightA);
    poweredLights.push(labLightA);

    const labLightB = new THREE.PointLight(0xa7f3d0, 2.4, 18, 1.5);
    labLightB.position.set(6, 3.7, -22);
    if (!this.isSoftwareGl) {
      this.scene.add(labLightB);
      poweredLights.push(labLightB);
    }

    this.addStationSign(0, 3.1, -14.4, 0, 'BIO-CONTAINMENT LAB', 'BLOOM RESEARCH // B-04');

    // Wall-buy: Ironsight Rifle
    wallBuys.push(
      this.createWallBuy('ironsight', new THREE.Vector3(-9.5, 1.55, -14.36), 0),
    );

    // Perk Machine: Ironhide
    perkMachines.push(this.createPerkMachine('ironhide', new THREE.Vector3(-12.2, 0, -27.2), Math.PI * 0.25));

    // Power Switch on East Lab Wall
    const powerSwitch = this.createPowerSwitch(new THREE.Vector3(13.5, 1.4, -26.5));

    // Emergency Radio Console (Easter Egg Step 3)
    const radioConsole = this.createRadioConsole(new THREE.Vector3(0, 0, -28.6));

    // Door 3: Yard to Lab (1250)
    doors.push(
      this.createDoor(
        'yard_to_lab',
        'Unlock Lab Airlock',
        BALANCE.economy.doors.yard_to_lab,
        new THREE.Vector3(0, 1.5, -14),
        4.0,
        3.0,
        0.45,
        0,
        ['lab_wing'],
      ),
    );

    // =========================================================================
    // ZONE 5: UNDERGROUND BUNKER (x: -28 .. -2, z: -42 .. -30)
    // =========================================================================
    this.addFloorSlab(-15, 0.03, -36, 26.4, 0.06, 12.4, this.mats.concrete, 'concrete', 0.42);
    this.addWallBox(-15, 3.9, -36, 26.8, 0.35, 12.8, this.mats.concrete, 'concrete', { navBlock: false });

    // South wall (joins Lab Wing with Door 4 gap at x: -8..-4)
    this.addWallBox(-18.2, 2, -30, 19.6, 4, 0.6, this.mats.concrete, 'concrete');
    this.addWallBox(-3.0, 2, -30, 2.0, 4, 0.6, this.mats.concrete, 'concrete');
    // North, West, East bunker walls
    this.addWallBox(-15, 2, -42, 26.4, 4, 0.6, this.mats.concrete, 'concrete');
    this.addWallBox(-28, 2, -36, 0.6, 4, 12.4, this.mats.concrete, 'concrete');
    this.addWallBox(-2, 2, -36, 0.6, 4, 12.4, this.mats.concrete, 'concrete');

    // Ribbed concrete & steel bunker arch frames + overhead utility pipes
    for (let bx = -24; bx <= -6; bx += 6) {
      this.addWallBox(bx, 3.6, -36, 0.45, 0.42, 11.8, this.mats.brushedSteel, 'metal', {
        navBlock: false,
        physicsBlock: false,
      });
    }
    const pipeRun = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.11, 25, 10),
      this.mats.rustedMetal,
    );
    pipeRun.rotation.z = Math.PI / 2;
    pipeRun.position.set(-15, 3.45, -41.3);
    this.scene.add(pipeRun);

    // Reinforced central bunker reactor column (concrete base + brushed steel core + hazard collar + beacon)
    this.createBunkerReactorCore(-15, -36, poweredEmissives);

    // Bunker spawn points
    spawnPoints.push(
      { id: 'sp_bunk_w', zone: 'bunker', position: new THREE.Vector3(-26, 0, -36) },
      { id: 'sp_bunk_e', zone: 'bunker', position: new THREE.Vector3(-4, 0, -36) },
    );

    const bunkerLight = new THREE.PointLight(0xef4444, 1.8, 20, 1.5);
    bunkerLight.position.set(-15, 3.4, -36);
    if (!this.isSoftwareGl) {
      this.scene.add(bunkerLight);
    }

    const bunkerMainLight = new THREE.PointLight(0xfde68a, 2.8, 24, 1.5);
    bunkerMainLight.position.set(-21, 3.4, -36);
    this.scene.add(bunkerMainLight);
    poweredLights.push(bunkerMainLight);

    // Overclock Bench at (-15, 0, -40.3)
    const overclock = this.createOverclockBench(new THREE.Vector3(-15, 0, -40.3));

    // Remaining 3 Perk Machines in Bunker
    perkMachines.push(
      this.createPerkMachine('second_wind', new THREE.Vector3(-26.3, 0, -32.2), Math.PI * 0.5),
      this.createPerkMachine('twin_barrel', new THREE.Vector3(-26.3, 0, -39.8), Math.PI * 0.5),
      this.createPerkMachine('marathon', new THREE.Vector3(-3.7, 0, -39.8), -Math.PI * 0.5),
    );

    // Door 4: Lab to Bunker (1500)
    doors.push(
      this.createDoor(
        'lab_to_bunker',
        'Unlock Bunker Bulkhead',
        BALANCE.economy.doors.lab_to_bunker,
        new THREE.Vector3(-6, 1.5, -30),
        4.0,
        3.0,
        0.45,
        0,
        ['bunker'],
      ),
    );

    // =========================================================================
    // SUPPLY CRATE LOCATIONS A (Yard), B (Lab), C (Bunker)
    // =========================================================================
    crateSlots.push(
      this.createSupplyCrate(0, new THREE.Vector3(2.5, 0, -6.5), Math.PI * 0.15, true),
      this.createSupplyCrate(1, new THREE.Vector3(9.0, 0, -27.2), -Math.PI * 0.2, false),
      this.createSupplyCrate(2, new THREE.Vector3(-15.0, 0, -31.8), 0, false),
    );

    // =========================================================================
    // EASTER EGG FUSES (3 hidden components)
    // =========================================================================
    fusePickups.push(
      this.createFusePickup('fuse_fh', 0, new THREE.Vector3(-7.0, 1.15, 18.0)),
      this.createFusePickup('fuse_barn', 1, new THREE.Vector3(23.5, 2.75, 2.0)),
      this.createFusePickup('fuse_bunker', 2, new THREE.Vector3(-11.5, 0.8, -40.3)),
    );

    // Ensure spawn & doorway cells are explicitly walkable
    this.nav.clearAreaWalkable(-9, -5, 8, 12);
    this.nav.clearAreaWalkable(10, 14, 0, 4);
    this.nav.clearAreaWalkable(-2, 2, -16, -12);
    this.nav.clearAreaWalkable(-8, -4, -32, -28);

    for (const pl of poweredLights) {
      pl.userData.fullIntensity = pl.intensity;
      pl.intensity = 0.24;
    }

    return {
      doors,
      windows,
      wallBuys,
      perkMachines,
      crateSlots,
      spawnPoints,
      powerSwitchPos: powerSwitch.pos,
      powerLeverMesh: powerSwitch.lever,
      powerIndicatorMat: powerSwitch.indicatorMat,
      overclockPos: overclock.pos,
      overclockRotor: overclock.rotor,
      overclockLight: overclock.light,
      electricTrapPos: trapBuilt.switchPos,
      electricTrapCenter: trapBuilt.center,
      electricTrapArcs: trapBuilt.arcs,
      electricTrapLight: trapBuilt.light,
      fusePickups,
      radioConsolePos: radioConsole.pos,
      radioScreenMat: radioConsole.screenMat,
      poweredLights,
      poweredEmissives,
      flickerLights,
    };
  }

  private buildPerimeter(): void {
    const postGeo = new THREE.BoxGeometry(0.24, 2.2, 0.24);
    const railGeo = new THREE.BoxGeometry(4.0, 0.1, 0.08);
    const perimeterBounds = 43;

    const postMatrices: THREE.Matrix4[] = [];
    const railMatrices: THREE.Matrix4[] = [];
    const m = new THREE.Matrix4();
    const r = new THREE.Matrix4();

    for (let p = -perimeterBounds; p <= perimeterBounds; p += 4) {
      m.makeTranslation(p, 1.1, -perimeterBounds);
      postMatrices.push(m.clone());
      m.makeTranslation(p, 1.1, perimeterBounds);
      postMatrices.push(m.clone());
      m.makeTranslation(-perimeterBounds, 1.1, p);
      postMatrices.push(m.clone());
      m.makeTranslation(perimeterBounds, 1.1, p);
      postMatrices.push(m.clone());

      if (p < perimeterBounds) {
        for (const h of [0.85, 1.65]) {
          r.makeTranslation(p + 2, h, -perimeterBounds);
          railMatrices.push(r.clone());
          r.makeTranslation(p + 2, h, perimeterBounds);
          railMatrices.push(r.clone());

          r.makeRotationY(Math.PI / 2);
          r.setPosition(-perimeterBounds, h, p + 2);
          railMatrices.push(r.clone());
          r.setPosition(perimeterBounds, h, p + 2);
          railMatrices.push(r.clone());
        }
      }
    }

    const postInst = new THREE.InstancedMesh(postGeo, this.mats.darkTrim, postMatrices.length);
    postMatrices.forEach((mat, i) => postInst.setMatrixAt(i, mat));
    postInst.computeBoundingSphere();
    this.scene.add(postInst);

    const railInst = new THREE.InstancedMesh(railGeo, this.mats.rustedMetal, railMatrices.length);
    railMatrices.forEach((mat, i) => railInst.setMatrixAt(i, mat));
    railInst.computeBoundingSphere();
    this.scene.add(railInst);

    // Invisible boundary colliders at +-43.5
    this.physics.addStaticBox({ cx: 0, cy: 3, cz: -43.5, hx: 45, hy: 3, hz: 0.5 });
    this.physics.addStaticBox({ cx: 0, cy: 3, cz: 43.5, hx: 45, hy: 3, hz: 0.5 });
    this.physics.addStaticBox({ cx: -43.5, cy: 3, cz: 0, hx: 0.5, hy: 3, hz: 45 });
    this.physics.addStaticBox({ cx: 43.5, cy: 3, cz: 0, hx: 0.5, hy: 3, hz: 45 });

    // Multi-tiered pine/dead trees surrounding the valley perimeter (46m .. 85m)
    const trunkGeo = new THREE.CylinderGeometry(0.24, 0.42, 5.4, 7);
    trunkGeo.translate(0, 2.7, 0);
    const crownLowGeo = new THREE.ConeGeometry(2.7, 5.0, 7);
    crownLowGeo.translate(0, 5.8, 0);
    const crownTopGeo = new THREE.ConeGeometry(1.9, 4.6, 7);
    crownTopGeo.translate(0, 8.6, 0);
    const treeMat = new THREE.MeshStandardMaterial({ color: 0x18251a, roughness: 0.92 });

    const treePositions: { x: number; z: number; s: number }[] = [];
    for (let i = 0; i < 110; i++) {
      const ang = (i / 110) * Math.PI * 2 + (i % 5) * 0.04;
      const dist = 47 + ((i * 17) % 32);
      const x = Math.cos(ang) * dist;
      const z = Math.sin(ang) * dist;
      const s = 0.82 + ((i * 13) % 10) * 0.048;
      treePositions.push({ x, z, s });
    }

    const trunkInst = new THREE.InstancedMesh(trunkGeo, this.mats.timberBeam, treePositions.length);
    const crownLowInst = new THREE.InstancedMesh(crownLowGeo, treeMat, treePositions.length);
    const crownTopInst = new THREE.InstancedMesh(crownTopGeo, treeMat, treePositions.length);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    treePositions.forEach((tp, idx) => {
      dummy.position.set(tp.x, 0, tp.z);
      dummy.scale.set(tp.s, tp.s, tp.s);
      dummy.rotation.y = idx * 0.9;
      dummy.updateMatrix();
      trunkInst.setMatrixAt(idx, dummy.matrix);
      crownLowInst.setMatrixAt(idx, dummy.matrix);
      crownTopInst.setMatrixAt(idx, dummy.matrix);
      color.setHSL(0.32 + (idx % 5) * 0.015, 0.24, 0.14 + (idx % 4) * 0.03);
      crownLowInst.setColorAt(idx, color);
      crownTopInst.setColorAt(idx, color);
    });
    trunkInst.computeBoundingSphere();
    crownLowInst.computeBoundingSphere();
    crownTopInst.computeBoundingSphere();
    this.scene.add(trunkInst, crownLowInst, crownTopInst);

    // Subtle bioluminescent Bloom spore clusters outside Lab/Yard perimeter
    const sporeGeo = new THREE.DodecahedronGeometry(0.28, 0);
    const sporeMat = new THREE.MeshStandardMaterial({
      color: 0xd97706,
      emissive: 0xb45309,
      emissiveIntensity: 0.9,
      roughness: 0.55,
    });
    const sporeCoords = [
      [-15.5, 0.22, -14.8],
      [-14.8, 0.2, -16.2],
      [15.2, 0.22, -15.4],
      [-21.2, 0.22, -1.5],
      [10.8, 0.2, -12.5],
      [-3.5, 0.2, -13.1],
    ] as const;
    const sporeInst = new THREE.InstancedMesh(sporeGeo, sporeMat, sporeCoords.length);
    sporeCoords.forEach(([sx, sy, sz], i) => {
      dummy.position.set(sx, sy, sz);
      dummy.scale.set(1 + (i % 3) * 0.25, 0.7 + (i % 2) * 0.4, 1);
      dummy.rotation.set(i * 0.4, i * 1.1, 0);
      dummy.updateMatrix();
      sporeInst.setMatrixAt(i, dummy.matrix);
    });
    sporeInst.computeBoundingSphere();
    this.scene.add(sporeInst);
  }

  private createDoor(
    id: string,
    label: string,
    cost: number,
    center: THREE.Vector3,
    w: number,
    h: number,
    d: number,
    rotY: number,
    unlockZones: ZoneId[],
  ): DoorObject {
    const group = new THREE.Group();
    group.position.copy(center);
    group.rotation.y = rotY;

    const panelGeo = new THREE.BoxGeometry(w, h, d);
    this.tileBoxUvs(panelGeo, 0.5);
    const panel = new THREE.Mesh(panelGeo, this.mats.warningStripe);
    panel.castShadow = !this.isSoftwareGl;
    panel.receiveShadow = true;
    group.add(panel);

    const frameTop = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.22, 0.24, d + 0.18),
      this.mats.brushedSteel,
    );
    frameTop.position.y = h * 0.5 - 0.1;
    group.add(frameTop);

    // Horizontal steel locking bar & valve lock wheel
    const lockBar = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.92, 0.16, d + 0.1),
      this.mats.brushedSteel,
    );
    lockBar.position.y = -0.25;
    group.add(lockBar);

    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.035, 8, 16), this.mats.rustedMetal);
    wheel.position.set(w * 0.28, -0.25, d * 0.5 + 0.06);
    group.add(wheel);

    const signMat = new THREE.MeshStandardMaterial({
      map: createSignageTexture(`${cost} PTS`, label.toUpperCase(), '#1a1410'),
      roughness: 0.7,
    });
    const signA = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.65), signMat);
    signA.position.set(0, 0.35, d * 0.5 + 0.02);
    group.add(signA);
    const signB = signA.clone();
    signB.rotation.y = Math.PI;
    signB.position.z = -d * 0.5 - 0.02;
    group.add(signB);

    this.scene.add(group);

    this.physics.addStaticBox({
      cx: center.x,
      cy: center.y,
      cz: center.z,
      hx: w * 0.5,
      hy: h * 0.5,
      hz: d * 0.5,
      doorId: id,
    });

    this.bvh.registerMesh(panel, 'metal', id);

    this.nav.addDoorObstacle(id, {
      minX: center.x - w * 0.5,
      maxX: center.x + w * 0.5,
      minZ: center.z - d * 0.5,
      maxZ: center.z + d * 0.5,
    });

    return {
      id,
      label,
      cost,
      mesh: group,
      collisionMesh: panel,
      center: center.clone(),
      isOpen: false,
      unlockZones,
    };
  }

  private createWindowBarricade(
    id: string,
    zone: ZoneId,
    cx: number,
    cz: number,
    axis: 'x' | 'z',
    outsideCoord: number,
    insideCoord: number,
  ): WindowBarricade {
    const w = axis === 'z' ? 2.4 : 0.6;
    const d = axis === 'x' ? 2.4 : 0.6;

    // Sill & header leave 1.9m tall opening for zombies, block player capsule
    this.addWallBox(cx, 0.55, cz, w, 1.1, d, this.mats.timberBeam, 'wood', { navBlock: false });
    this.addWallBox(cx, 3.55, cz, w, 1.3, d, this.mats.timberBeam, 'wood', { navBlock: false });

    // Side casing jambs
    const jambOffset = 1.14;
    if (axis === 'x') {
      this.addWallBox(cx, 2.0, cz - jambOffset, 0.7, 2.0, 0.14, this.mats.timberBeam, 'wood', {
        navBlock: false,
        physicsBlock: false,
      });
      this.addWallBox(cx, 2.0, cz + jambOffset, 0.7, 2.0, 0.14, this.mats.timberBeam, 'wood', {
        navBlock: false,
        physicsBlock: false,
      });
    } else {
      this.addWallBox(cx - jambOffset, 2.0, cz, 0.14, 2.0, 0.7, this.mats.timberBeam, 'wood', {
        navBlock: false,
        physicsBlock: false,
      });
      this.addWallBox(cx + jambOffset, 2.0, cz, 0.14, 2.0, 0.7, this.mats.timberBeam, 'wood', {
        navBlock: false,
        physicsBlock: false,
      });
    }

    this.nav.clearAreaWalkable(cx - 1.5, cx + 1.5, cz - 1.5, cz + 1.5);

    const planks: THREE.Mesh[] = [];
    for (let i = 0; i < BALANCE.economy.barricade.maxPlanks; i++) {
      const plankGeo = new THREE.BoxGeometry(axis === 'z' ? 2.3 : 0.14, 0.18, axis === 'x' ? 2.3 : 0.14);
      this.tileBoxUvs(plankGeo, 0.5);
      const plank = new THREE.Mesh(plankGeo, this.mats.barnWood);
      plank.position.set(cx, 1.25 + i * 0.28, cz);
      plank.rotation.z = axis === 'z' ? (i % 2 === 0 ? 0.05 : -0.05) : 0;
      plank.rotation.x = axis === 'x' ? (i % 2 === 0 ? 0.05 : -0.05) : 0;
      plank.castShadow = !this.isSoftwareGl;
      this.scene.add(plank);
      planks.push(plank);
    }

    return {
      id,
      zone,
      center: new THREE.Vector3(cx, 1.3, cz),
      outsidePos:
        axis === 'x' ? new THREE.Vector3(outsideCoord, 0, cz) : new THREE.Vector3(cx, 0, outsideCoord),
      insidePos:
        axis === 'x' ? new THREE.Vector3(insideCoord, 0, cz) : new THREE.Vector3(cx, 0, insideCoord),
      planks,
      intactCount: BALANCE.economy.barricade.maxPlanks,
      repairProgress: 0,
    };
  }

  private createWallBuy(weaponId: WeaponId, pos: THREE.Vector3, rotY: number): WallBuyObject {
    const cfg = BALANCE.weapons[weaponId];
    const tex = createWallBuyChalkTexture(weaponId, cfg.name, cfg.wallPrice);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.75, 0.88), mat);
    mesh.position.copy(pos);
    mesh.rotation.y = rotY;
    this.scene.add(mesh);

    return {
      id: `wallbuy_${weaponId}`,
      weaponId,
      cost: cfg.wallPrice,
      ammoCost: Math.round(cfg.wallPrice * BALANCE.economy.wallAmmoRatio),
      position: pos.clone(),
      mesh,
    };
  }

  private createPerkMachine(perkId: PerkId, pos: THREE.Vector3, rotY: number): PerkMachineObject {
    const cfg = BALANCE.perks.list[perkId];
    const group = new THREE.Group();
    group.position.copy(pos);
    group.rotation.y = rotY;

    const cabinet = new THREE.Mesh(new THREE.BoxGeometry(1.15, 2.25, 0.85), this.mats.brushedSteel);
    cabinet.position.y = 1.125;
    cabinet.castShadow = !this.isSoftwareGl;
    cabinet.receiveShadow = true;
    group.add(cabinet);

    const accentMat = new THREE.MeshStandardMaterial({
      color: cfg.color,
      roughness: 0.4,
      metalness: 0.35,
    });
    const trim = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.18, 0.94), accentMat);
    trim.position.y = 2.28;
    group.add(trim);

    const sideRails = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.5, 0.12), accentMat);
    sideRails.position.set(0, 1.3, 0.38);
    group.add(sideRails);

    const emissiveMat = new THREE.MeshStandardMaterial({
      color: cfg.color,
      emissive: new THREE.Color(cfg.color),
      emissiveIntensity: 0.18,
      roughness: 0.25,
    });
    const marquee = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.56, 0.08), emissiveMat);
    marquee.position.set(0, 1.82, 0.44);
    group.add(marquee);

    // Bottle dispenser slot + signage
    const dispWindow = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.35, 0.1), this.mats.darkTrim);
    dispWindow.position.set(0, 0.62, 0.43);
    group.add(dispWindow);

    const signMat = new THREE.MeshStandardMaterial({
      map: createSignageTexture(cfg.name.toUpperCase(), `${cfg.price} PTS`, '#141716'),
      roughness: 0.5,
    });
    const plaque = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.32), signMat);
    plaque.position.set(0, 1.25, 0.45);
    group.add(plaque);

    const light = new THREE.PointLight(cfg.color, 0.2, 8, 1.8);
    light.position.set(0, 1.85, 0.85);
    if (!this.isSoftwareGl) {
      group.add(light);
    }

    this.scene.add(group);

    this.physics.addStaticBox({
      cx: pos.x,
      cy: 1.1,
      cz: pos.z,
      hx: 0.62,
      hy: 1.15,
      hz: 0.62,
    });
    this.nav.addStaticObstacle({
      minX: pos.x - 0.6,
      maxX: pos.x + 0.6,
      minZ: pos.z - 0.6,
      maxZ: pos.z + 0.6,
    });

    return { id: perkId, position: pos.clone(), group, light, emissiveMat };
  }

  private createSupplyCrate(
    index: number,
    pos: THREE.Vector3,
    rotY: number,
    active: boolean,
  ): CrateSlot {
    const group = new THREE.Group();
    group.position.copy(pos);
    group.rotation.y = rotY;
    group.visible = active;

    const baseGeo = new THREE.BoxGeometry(2.1, 0.8, 0.95);
    this.tileBoxUvs(baseGeo, 0.6);
    const base = new THREE.Mesh(baseGeo, this.mats.barnWood);
    base.position.y = 0.4;
    base.castShadow = !this.isSoftwareGl;
    base.receiveShadow = true;
    group.add(base);

    const band = new THREE.Mesh(new THREE.BoxGeometry(2.14, 0.12, 0.99), this.mats.rustedMetal);
    band.position.y = 0.72;
    group.add(band);

    // Corner latches
    for (const lx of [-0.95, 0.95]) {
      const latch = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.28, 0.08), this.mats.brushedSteel);
      latch.position.set(lx, 0.65, 0.48);
      group.add(latch);
    }

    const lid = new THREE.Group();
    lid.position.set(0, 0.8, -0.46);
    const lidGeo = new THREE.BoxGeometry(2.14, 0.16, 0.96);
    this.tileBoxUvs(lidGeo, 0.6);
    const lidMesh = new THREE.Mesh(lidGeo, this.mats.timberBeam);
    lidMesh.position.set(0, 0.08, 0.46);
    lid.add(lidMesh);
    group.add(lid);

    const light = new THREE.PointLight(0xfbbf24, active ? 1.8 : 0, 7, 1.7);
    light.position.set(0, 1.5, 0);
    if (!this.isSoftwareGl) {
      group.add(light);
    }

    this.scene.add(group);

    this.physics.addStaticBox({
      cx: pos.x,
      cy: 0.45,
      cz: pos.z,
      hx: 1.05,
      hy: 0.5,
      hz: 0.55,
    });
    this.nav.addStaticObstacle({
      minX: pos.x - 1.05,
      maxX: pos.x + 1.05,
      minZ: pos.z - 0.55,
      maxZ: pos.z + 0.55,
    });

    return { index, position: pos.clone(), rotationY: rotY, group, lid, light, active };
  }

  private createSilo(x: number, z: number): void {
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    const concreteBase = new THREE.Mesh(new THREE.CylinderGeometry(2.55, 2.65, 0.6, 18), this.mats.concrete);
    concreteBase.position.y = 0.3;
    group.add(concreteBase);

    const body = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 9.2, 18), this.mats.rustedMetal);
    body.position.y = 5.1;
    body.castShadow = !this.isSoftwareGl;
    body.receiveShadow = true;
    group.add(body);

    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(2.42, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      this.mats.brushedSteel,
    );
    dome.position.y = 9.7;
    group.add(dome);

    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 0.5, 10), this.mats.darkTrim);
    cap.position.y = 12.1;
    group.add(cap);

    // Structural steel collar rings
    for (const ry of [3.2, 6.4, 9.5]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.45, 0.08, 8, 24), this.mats.darkTrim);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = ry;
      group.add(ring);
    }

    // Exterior vertical access ladder facing the Silo Yard (+X)
    const railL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 8.6, 0.06), this.mats.darkTrim);
    railL.position.set(2.55, 5.2, -0.25);
    const railR = railL.clone();
    railR.position.z = 0.25;
    group.add(railL, railR);

    const rungGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.5, 6);
    rungGeo.rotateX(Math.PI / 2);
    const rungInst = new THREE.InstancedMesh(rungGeo, this.mats.brushedSteel, 14);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 14; i++) {
      m.makeTranslation(2.55, 1.3 + i * 0.58, 0);
      rungInst.setMatrixAt(i, m);
    }
    rungInst.computeBoundingSphere();
    group.add(rungInst);

    this.scene.add(group);
    this.bvh.registerMesh(body, 'metal');
    this.physics.addStaticBox({ cx: x, cy: 4.5, cz: z, hx: 2.4, hy: 4.5, hz: 2.4 });
    this.nav.addStaticObstacle({ minX: x - 2.45, maxX: x + 2.45, minZ: z - 2.45, maxZ: z + 2.45 });
  }

  private createSiloBridge(x1: number, z1: number, x2: number, z2: number): void {
    const midX = (x1 + x2) * 0.5;
    const midZ = (z1 + z2) * 0.5;
    const dist = Math.hypot(x2 - x1, z2 - z1);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.14, dist), this.mats.brushedSteel);
    deck.position.set(midX, 9.6, midZ);
    const railA = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.75, dist), this.mats.darkTrim);
    railA.position.set(midX - 0.5, 10.05, midZ);
    const railB = railA.clone();
    railB.position.x = midX + 0.5;
    const auger = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, dist + 1.2, 10), this.mats.rustedMetal);
    auger.rotation.x = Math.PI / 2;
    auger.position.set(midX + 0.6, 10.35, midZ);
    this.scene.add(deck, railA, railB, auger);
  }

  private createTractor(x: number, z: number): void {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x7a281d, roughness: 0.62, metalness: 0.38 });

    // Lower chassis frame
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.38, 3.3), this.mats.darkTrim);
    frame.position.set(0, 0.62, 0.05);
    group.add(frame);

    // Tapered engine hood + radiator grille
    const hood = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.68, 1.75), bodyMat);
    hood.position.set(0, 1.15, 0.7);
    hood.castShadow = !this.isSoftwareGl;
    group.add(hood);

    const grille = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.6, 0.12), this.mats.brushedSteel);
    grille.position.set(0, 1.14, 1.56);
    group.add(grille);

    // Vertical exhaust stack with hinged flapper cap
    const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.075, 1.25, 10), this.mats.rustedMetal);
    exhaust.position.set(-0.34, 1.85, 1.05);
    const exhaustCap = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.03, 0.18), this.mats.brushedSteel);
    exhaustCap.position.set(-0.34, 2.5, 1.05);
    exhaustCap.rotation.z = 0.35;
    group.add(exhaust, exhaustCap);

    // Headlights
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xfef3c7, emissive: 0xf59e0b, emissiveIntensity: 0.35 });
    for (const hx of [-0.48, 0.48]) {
      const hl = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.14, 10), lampMat);
      hl.rotation.x = Math.PI / 2;
      hl.position.set(hx, 1.16, 1.48);
      group.add(hl);
    }

    // Rear wheel fenders + operator seat + steering column
    for (const fx of [-0.92, 0.92]) {
      const fender = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.14, 1.35), bodyMat);
      fender.position.set(fx, 1.48, -0.78);
      group.add(fender);
    }
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.16, 0.52), this.mats.gunPolymer);
    seat.position.set(0, 1.24, -0.75);
    const backrest = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.42, 0.12), this.mats.gunPolymer);
    backrest.position.set(0, 1.46, -0.96);
    const steerCol = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.65, 8), this.mats.darkTrim);
    steerCol.rotation.x = -0.45;
    steerCol.position.set(0, 1.48, -0.2);
    const steerWheel = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.03, 8, 16), this.mats.gunPolymer);
    steerWheel.rotation.x = 1.1;
    steerWheel.position.set(0, 1.75, -0.34);
    group.add(seat, backrest, steerCol, steerWheel);

    // ROPS rollbar frame
    const postL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.55, 0.1), this.mats.darkTrim);
    postL.position.set(-0.68, 2.0, -1.25);
    const postR = postL.clone();
    postR.position.x = 0.68;
    const topBar = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.1, 0.12), this.mats.darkTrim);
    topBar.position.set(0, 2.78, -1.25);
    group.add(postL, postR, topBar);

    // Rear big agricultural tires + front steering wheels with red wheel hubs
    const rearTireGeo = new THREE.CylinderGeometry(0.76, 0.76, 0.48, 16);
    rearTireGeo.rotateZ(Math.PI / 2);
    const rearHubGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.52, 12);
    rearHubGeo.rotateZ(Math.PI / 2);
    for (const wx of [-0.98, 0.98]) {
      const tire = new THREE.Mesh(rearTireGeo, this.mats.gunPolymer);
      tire.position.set(wx, 0.76, -0.82);
      const hub = new THREE.Mesh(rearHubGeo, bodyMat);
      hub.position.set(wx, 0.76, -0.82);
      group.add(tire, hub);
    }

    const frontTireGeo = new THREE.CylinderGeometry(0.46, 0.46, 0.3, 14);
    frontTireGeo.rotateZ(Math.PI / 2);
    const frontHubGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.34, 10);
    frontHubGeo.rotateZ(Math.PI / 2);
    for (const wx of [-0.88, 0.88]) {
      const tire = new THREE.Mesh(frontTireGeo, this.mats.gunPolymer);
      tire.position.set(wx, 0.46, 1.22);
      const hub = new THREE.Mesh(frontHubGeo, bodyMat);
      hub.position.set(wx, 0.46, 1.22);
      group.add(tire, hub);
    }

    this.scene.add(group);
    this.bvh.registerMesh(hood, 'metal');
    this.bvh.registerMesh(frame, 'metal');
    this.physics.addStaticBox({ cx: x, cy: 1.0, cz: z, hx: 1.25, hy: 1.2, hz: 2.0 });
    this.nav.addStaticObstacle({ minX: x - 1.25, maxX: x + 1.25, minZ: z - 2.0, maxZ: z + 2.0 });
  }

  private createOverheadCable(
    x1: number,
    y1: number,
    z1: number,
    x2: number,
    y2: number,
    z2: number,
  ): void {
    const pts: THREE.Vector3[] = [];
    const segs = 8;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const sag = Math.sin(t * Math.PI) * 0.75;
      pts.push(
        new THREE.Vector3(
          THREE.MathUtils.lerp(x1, x2, t),
          THREE.MathUtils.lerp(y1, y2, t) - sag,
          THREE.MathUtils.lerp(z1, z2, t),
        ),
      );
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const geo = new THREE.TubeGeometry(curve, 12, 0.025, 5, false);
    const wire = new THREE.Mesh(geo, this.mats.darkTrim);
    this.scene.add(wire);
  }

  private createFluorescentFixture(
    x: number,
    y: number,
    z: number,
    poweredEmissives: THREE.MeshStandardMaterial[],
  ): void {
    const housing = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.14, 0.42), this.mats.brushedSteel);
    housing.position.set(x, y, z);
    const tubeMat = new THREE.MeshStandardMaterial({
      color: 0xd1fae5,
      emissive: 0x6ee7b7,
      emissiveIntensity: 0.2,
      roughness: 0.2,
    });
    poweredEmissives.push(tubeMat);
    const tubeA = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.55, 8), tubeMat);
    tubeA.rotation.z = Math.PI / 2;
    tubeA.position.set(x, y - 0.07, z - 0.1);
    const tubeB = tubeA.clone();
    tubeB.position.z = z + 0.1;
    this.scene.add(housing, tubeA, tubeB);
  }

  private createLabBench(
    x: number,
    z: number,
    poweredEmissives: THREE.MeshStandardMaterial[],
  ): void {
    this.addWallBox(x, 0.55, z, 2.6, 1.1, 1.6, this.mats.brushedSteel, 'metal');

    // Lab CRT monitor & reagent jars on top
    const mon = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.48, 0.45), this.mats.darkTrim);
    mon.position.set(x - 0.65, 1.34, z);
    const screenMat = new THREE.MeshStandardMaterial({
      color: 0x064e3b,
      emissive: 0x10b981,
      emissiveIntensity: 0.15,
      roughness: 0.25,
    });
    poweredEmissives.push(screenMat);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.34), screenMat);
    screen.position.set(x - 0.65, 1.36, z + 0.23);

    const jarMat = new THREE.MeshStandardMaterial({
      color: 0x34d399,
      emissive: 0x059669,
      emissiveIntensity: 0.45,
      roughness: 0.18,
    });
    const jarA = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.32, 10), jarMat);
    jarA.position.set(x + 0.45, 1.26, z - 0.15);
    const jarB = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.24, 10), jarMat);
    jarB.position.set(x + 0.72, 1.22, z + 0.18);

    this.scene.add(mon, screen, jarA, jarB);
  }

  private createBioVat(x: number, z: number): void {
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.38, 1.5, 0.65, 18), this.mats.brushedSteel);
    base.position.y = 0.325;
    group.add(base);

    // Four vertical structural containment struts around glass cylinder
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2 + Math.PI * 0.25;
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 2.75, 8), this.mats.darkTrim);
      strut.position.set(Math.cos(ang) * 1.26, 1.9, Math.sin(ang) * 1.26);
      group.add(strut);
    }

    const glass = new THREE.Mesh(
      new THREE.CylinderGeometry(1.14, 1.14, 2.55, 18),
      new THREE.MeshPhysicalMaterial({
        color: 0x6ee7b7,
        emissive: 0x10b981,
        emissiveIntensity: 0.32,
        roughness: 0.14,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
      }),
    );
    glass.position.y = 1.9;
    group.add(glass);

    // Sculpted fungal Bloom specimen inside containment vat
    const bloomMat = new THREE.MeshStandardMaterial({
      color: 0xd97706,
      emissive: 0xf59e0b,
      emissiveIntensity: 1.15,
      roughness: 0.45,
    });
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.26, 1.75, 10), bloomMat);
    stalk.position.y = 1.5;
    group.add(stalk);

    const headCore = new THREE.Mesh(new THREE.DodecahedronGeometry(0.46, 1), bloomMat);
    headCore.position.y = 2.28;
    group.add(headCore);

    for (let s = 0; s < 5; s++) {
      const a = (s / 5) * Math.PI * 2;
      const lobe = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), bloomMat);
      lobe.position.set(Math.cos(a) * 0.42, 1.85 + (s % 2) * 0.35, Math.sin(a) * 0.42);
      group.add(lobe);
    }

    const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.38, 1.38, 0.5, 18), this.mats.brushedSteel);
    cap.position.y = 3.45;
    group.add(cap);

    this.scene.add(group);
    this.bvh.registerMesh(base, 'metal');
    this.physics.addStaticBox({ cx: x, cy: 1.8, cz: z, hx: 1.35, hy: 1.8, hz: 1.35 });
    this.nav.addStaticObstacle({ minX: x - 1.35, maxX: x + 1.35, minZ: z - 1.35, maxZ: z + 1.35 });
  }

  private createBunkerReactorCore(
    x: number,
    z: number,
    poweredEmissives: THREE.MeshStandardMaterial[],
  ): void {
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    const base = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.9, 2.3), this.mats.concrete);
    base.position.y = 0.45;
    group.add(base);

    const core = new THREE.Mesh(new THREE.BoxGeometry(2.9, 2.2, 1.9), this.mats.brushedSteel);
    core.position.y = 2.0;
    group.add(core);

    const stripeCollar = new THREE.Mesh(new THREE.BoxGeometry(3.15, 0.34, 2.15), this.mats.warningStripe);
    stripeCollar.position.y = 1.0;
    group.add(stripeCollar);

    const topCap = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.75, 2.3), this.mats.concrete);
    topCap.position.y = 3.4;
    group.add(topCap);

    // Side glowing coolant conduits + status strip
    const conduitMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      emissive: 0xd97706,
      emissiveIntensity: 0.2,
      roughness: 0.3,
    });
    poweredEmissives.push(conduitMat);
    for (const side of [-1, 1]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.6, 0.14), conduitMat);
      strip.position.set(side * 1.52, 2.0, 0);
      group.add(strip);
    }

    this.scene.add(group);
    this.bvh.registerMesh(base, 'concrete');
    this.bvh.registerMesh(core, 'metal');
    this.physics.addStaticBox({ cx: x, cy: 1.8, cz: z, hx: 1.65, hy: 1.85, hz: 1.15 });
    this.nav.addStaticObstacle({ minX: x - 1.65, maxX: x + 1.65, minZ: z - 1.15, maxZ: z + 1.15 });
  }

  private createLampPost(
    x: number,
    z: number,
    flickerLights: { light: THREE.PointLight; baseIntensity: number; phase: number }[],
    addLight = true,
  ): void {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 5.4, 8), this.mats.timberBeam);
    pole.position.set(x, 2.7, z);
    this.scene.add(pole);

    const crossArm = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.1, 0.1), this.mats.darkTrim);
    crossArm.position.set(x, 5.05, z);
    this.scene.add(crossArm);

    const hood = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.22, 10, 1, true), this.mats.rustedMetal);
    hood.position.set(x, 5.42, z);
    this.scene.add(hood);

    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffc878 }),
    );
    bulb.position.set(x, 5.28, z);
    this.scene.add(bulb);

    if (addLight) {
      const light = new THREE.PointLight(0xffb454, 4.2, 24, 1.5);
      light.position.set(x, 5.1, z);
      this.scene.add(light);
      flickerLights.push({ light, baseIntensity: 4.2, phase: x * 0.7 + z * 0.3 });
    }

    this.createLightShaft(x, 5.1, z, 2.4, 5.0, 0xffb454, 0.068);
    this.physics.addStaticBox({ cx: x, cy: 2.5, cz: z, hx: 0.25, hy: 2.5, hz: 0.25 });
  }

  private createLightShaft(
    x: number,
    y: number,
    z: number,
    radius: number,
    height: number,
    colorHex: number,
    opacity: number,
  ): void {
    const geo = new THREE.ConeGeometry(radius, height, 14, 1, true);
    geo.translate(0, -height * 0.5, 0);
    const pos = geo.attributes.position;
    if (pos) {
      const colors = new Float32Array(pos.count * 3);
      const col = new THREE.Color(colorHex);
      for (let i = 0; i < pos.count; i++) {
        const py = pos.getY(i);
        const factor = Math.max(0, Math.min(1, 1 + py / height));
        const fade = factor * factor;
        colors[i * 3] = col.r * fade;
        colors[i * 3 + 1] = col.g * fade;
        colors[i * 3 + 2] = col.b * fade;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      transparent: true,
      opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const cone = new THREE.Mesh(geo, mat);
    cone.position.set(x, y, z);
    this.scene.add(cone);
  }

  private createWalkableRamp(
    x: number,
    yBase: number,
    zCenter: number,
    width: number,
    height: number,
    length: number,
  ): void {
    const steps = 10;
    const stepH = height / steps;
    const stepL = length / steps;
    for (let i = 0; i < steps; i++) {
      const sy = yBase + (i + 0.5) * stepH;
      const sz = zCenter - i * stepL;
      this.addWallBox(x, sy, sz, width, stepH, stepL + 0.08, this.mats.barnWood, 'wood', {
        navBlock: false,
        castShadow: false,
      });
    }
  }

  private createPowerSwitch(pos: THREE.Vector3): {
    pos: THREE.Vector3;
    lever: THREE.Mesh;
    indicatorMat: THREE.MeshStandardMaterial;
  } {
    const group = new THREE.Group();
    group.position.copy(pos);

    const box = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.96, 0.62), this.mats.brushedSteel);
    group.add(box);

    const conduit = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.2, 8), this.mats.rustedMetal);
    conduit.position.set(0.08, 1.3, 0);
    group.add(conduit);

    const indicatorMat = new THREE.MeshStandardMaterial({
      color: 0xef4444,
      emissive: 0xef4444,
      emissiveIntensity: 1.4,
    });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 10), indicatorMat);
    bulb.position.set(-0.18, 0.3, 0);
    group.add(bulb);

    const lever = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.44, 0.08), this.mats.warningStripe);
    lever.position.set(-0.22, -0.05, 0);
    lever.rotation.z = 0.55;
    group.add(lever);

    this.scene.add(group);
    return { pos: pos.clone(), lever, indicatorMat };
  }

  private createOverclockBench(pos: THREE.Vector3): {
    pos: THREE.Vector3;
    rotor: THREE.Group;
    light: THREE.PointLight;
  } {
    const group = new THREE.Group();
    group.position.copy(pos);

    const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.02, 1.05), this.mats.brushedSteel);
    chassis.position.y = 0.51;
    group.add(chassis);

    const topPlate = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.1, 1.1), this.mats.warningStripe);
    topPlate.position.y = 1.07;
    group.add(topPlate);

    // Side induction capacitor towers + clamping vice
    for (const sx of [-0.9, 0.9]) {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.68, 12), this.mats.rustedMetal);
      cap.position.set(sx, 1.44, -0.22);
      group.add(cap);
      const insulator = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.03, 6, 14), this.mats.darkTrim);
      insulator.rotation.x = Math.PI / 2;
      insulator.position.set(sx, 1.56, -0.22);
      group.add(insulator);
    }

    const clamp = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.14, 0.34), this.mats.darkTrim);
    clamp.position.set(0, 1.18, 0.12);
    group.add(clamp);

    const rotor = new THREE.Group();
    rotor.position.set(0, 1.56, 0.08);
    const coilMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0ea5e9,
      emissiveIntensity: 0.45,
      metalness: 0.72,
      roughness: 0.25,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.055, 10, 22), coilMat);
    const innerRing = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.035, 8, 18), coilMat);
    innerRing.rotation.y = Math.PI / 2;
    rotor.add(ring, innerRing);
    group.add(rotor);

    const light = new THREE.PointLight(0x38bdf8, 0.2, 8, 1.6);
    light.position.set(0, 1.75, 0.6);
    if (!this.isSoftwareGl) {
      group.add(light);
    }

    this.scene.add(group);
    this.physics.addStaticBox({ cx: pos.x, cy: 0.6, cz: pos.z, hx: 1.2, hy: 0.65, hz: 0.58 });
    this.nav.addStaticObstacle({
      minX: pos.x - 1.2,
      maxX: pos.x + 1.2,
      minZ: pos.z - 0.58,
      maxZ: pos.z + 0.58,
    });

    return { pos: pos.clone(), rotor, light };
  }

  private createElectricTrap(
    cx: number,
    cz: number,
    poweredEmissives: THREE.MeshStandardMaterial[],
  ): {
    switchPos: THREE.Vector3;
    center: THREE.Vector3;
    arcs: THREE.Group;
    light: THREE.PointLight;
  } {
    const pylonMat = this.mats.brushedSteel;
    const leftPylon = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 3.2, 10), pylonMat);
    leftPylon.position.set(cx - 2.3, 1.6, cz);
    const rightPylon = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 3.2, 10), pylonMat);
    rightPylon.position.set(cx + 2.3, 1.6, cz);
    const crossBar = new THREE.Mesh(new THREE.BoxGeometry(5.0, 0.18, 0.24), this.mats.darkTrim);
    crossBar.position.set(cx, 3.18, cz);
    this.scene.add(leftPylon, rightPylon, crossBar);

    const trapReadyMat = new THREE.MeshStandardMaterial({
      color: 0x3b82f6,
      emissive: 0x3b82f6,
      emissiveIntensity: 0.2,
    });
    poweredEmissives.push(trapReadyMat);
    const capL = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), trapReadyMat);
    capL.position.set(cx - 2.3, 3.28, cz);
    const capR = capL.clone();
    capR.position.x = cx + 2.3;
    this.scene.add(capL, capR);

    const switchBox = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.6, 0.35), this.mats.warningStripe);
    switchBox.position.set(cx + 2.55, 1.25, cz + 0.3);
    this.scene.add(switchBox);

    const arcs = new THREE.Group();
    arcs.position.set(cx, 1.4, cz);
    arcs.visible = false;
    const arcMat = new THREE.MeshBasicMaterial({ color: 0x60a5fa });
    for (let i = 0; i < 4; i++) {
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 4.4, 6), arcMat);
      bar.rotation.z = Math.PI / 2;
      bar.position.y = -0.8 + i * 0.55;
      arcs.add(bar);
    }
    this.scene.add(arcs);

    const light = new THREE.PointLight(0x38bdf8, 0, 12, 1.6);
    light.position.set(cx, 2.2, cz);
    if (!this.isSoftwareGl) {
      this.scene.add(light);
    }

    this.physics.addStaticBox({ cx: cx - 2.3, cy: 1.5, cz, hx: 0.28, hy: 1.6, hz: 0.28 });
    this.physics.addStaticBox({ cx: cx + 2.3, cy: 1.5, cz, hx: 0.28, hy: 1.6, hz: 0.28 });

    return {
      switchPos: new THREE.Vector3(cx + 2.55, 1.25, cz + 0.3),
      center: new THREE.Vector3(cx, 0, cz),
      arcs,
      light,
    };
  }

  private createFusePickup(id: string, index: number, pos: THREE.Vector3): FusePickup {
    const group = new THREE.Group();
    group.position.copy(pos);
    group.visible = false;

    const core = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 0.32, 10),
      new THREE.MeshStandardMaterial({
        color: 0xf59e0b,
        emissive: 0xf59e0b,
        emissiveIntensity: 1.8,
        roughness: 0.3,
      }),
    );
    core.rotation.z = Math.PI / 2;
    group.add(core);

    const capMat = this.mats.gunMetal;
    const c1 = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.06, 10), capMat);
    c1.rotation.z = Math.PI / 2;
    c1.position.x = -0.15;
    group.add(c1);
    const c2 = c1.clone();
    c2.position.x = 0.15;
    group.add(c2);

    this.scene.add(group);
    return { id, index, position: pos.clone(), mesh: group, collected: false };
  }

  private createRadioConsole(pos: THREE.Vector3): {
    pos: THREE.Vector3;
    screenMat: THREE.MeshStandardMaterial;
  } {
    const group = new THREE.Group();
    group.position.copy(pos);

    const desk = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.95, 0.9), this.mats.brushedSteel);
    desk.position.y = 0.475;
    group.add(desk);

    const unit = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.58, 0.56), this.mats.darkTrim);
    unit.position.set(0, 1.24, -0.1);
    group.add(unit);

    const screenMat = new THREE.MeshStandardMaterial({
      map: createOscilloscopeTexture(),
      color: 0x94a3b8,
      emissive: 0xef4444,
      emissiveIntensity: 0.45,
      roughness: 0.28,
    });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.3), screenMat);
    screen.position.set(-0.22, 1.25, 0.185);
    group.add(screen);

    // Rotary tuning dials
    for (let d = 0; d < 3; d++) {
      const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.04, 10), this.mats.brushedSteel);
      dial.rotation.x = Math.PI / 2;
      dial.position.set(0.22 + d * 0.14, 1.15, 0.19);
      group.add(dial);
    }

    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 1.15, 6), this.mats.gunMetal);
    antenna.position.set(0.46, 1.85, -0.1);
    group.add(antenna);

    this.scene.add(group);
    this.physics.addStaticBox({ cx: pos.x, cy: 0.6, cz: pos.z, hx: 0.95, hy: 0.65, hz: 0.5 });
    return { pos: pos.clone(), screenMat };
  }

  private addStationSign(
    x: number,
    y: number,
    z: number,
    rotY: number,
    title: string,
    subtitle: string,
  ): void {
    const mat = new THREE.MeshStandardMaterial({
      map: createSignageTexture(title, subtitle),
      roughness: 0.65,
    });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.95), mat);
    sign.position.set(x, y, z);
    sign.rotation.y = rotY;
    this.scene.add(sign);
  }

  private createHangingLamp(x: number, yCeiling: number, z: number): void {
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.55, 6), this.mats.darkTrim);
    cord.position.set(x, yCeiling - 0.28, z);
    const shade = new THREE.Mesh(
      new THREE.ConeGeometry(0.28, 0.22, 10, 1, true),
      this.mats.rustedMetal,
    );
    shade.position.set(x, yCeiling - 0.55, z);
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffd28a }),
    );
    bulb.position.set(x, yCeiling - 0.62, z);
    this.scene.add(cord, shade, bulb);
  }

  private createBarrel(x: number, z: number): void {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const drumMat = new THREE.MeshStandardMaterial({ color: 0x5c2b21, roughness: 0.65, metalness: 0.45 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 1.02, 12), drumMat);
    body.position.y = 0.51;
    body.castShadow = !this.isSoftwareGl;
    body.receiveShadow = true;
    const rimA = new THREE.Mesh(new THREE.TorusGeometry(0.365, 0.025, 6, 14), this.mats.darkTrim);
    rimA.rotation.x = Math.PI / 2;
    rimA.position.y = 0.72;
    const rimB = rimA.clone();
    rimB.position.y = 0.32;
    g.add(body, rimA, rimB);
    this.scene.add(g);
    this.physics.addStaticBox({ cx: x, cy: 0.51, cz: z, hx: 0.38, hy: 0.51, hz: 0.38 });
    this.nav.addStaticObstacle({ minX: x - 0.38, maxX: x + 0.38, minZ: z - 0.38, maxZ: z + 0.38 });
  }

  private createWoodCrate(x: number, z: number, size: number): void {
    const geo = new THREE.BoxGeometry(size, size, size);
    this.tileBoxUvs(geo, 0.8);
    const box = new THREE.Mesh(geo, this.mats.barnWood);
    box.position.set(x, size * 0.5, z);
    box.castShadow = !this.isSoftwareGl;
    box.receiveShadow = true;
    this.scene.add(box);
    this.bvh.registerMesh(box, 'wood');
    this.physics.addStaticBox({ cx: x, cy: size * 0.5, cz: z, hx: size * 0.5, hy: size * 0.5, hz: size * 0.5 });
    this.nav.addStaticObstacle({ minX: x - size * 0.5, maxX: x + size * 0.5, minZ: z - size * 0.5, maxZ: z + size * 0.5 });
  }

  private createFloorStain(x: number, z: number, radius: number): void {
    const stain = new THREE.Mesh(
      new THREE.PlaneGeometry(radius, radius),
      new THREE.MeshBasicMaterial({
        map: this.mats.bloodSplatterTex,
        transparent: true,
        opacity: 0.65,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      }),
    );
    stain.rotation.x = -Math.PI / 2;
    stain.position.set(x, 0.065, z);
    this.scene.add(stain);
  }
}
