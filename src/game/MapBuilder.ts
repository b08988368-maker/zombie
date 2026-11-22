import * as THREE from 'three';
import type { PerkId, WeaponId, ZoneId } from '../config/balance';
import { BALANCE } from '../config/balance';
import type { BvhWorld, SurfaceType } from '../engine/BvhWorld';
import type { NavGrid } from '../engine/NavGrid';
import type { PhysicsWorld } from '../engine/PhysicsWorld';
import {
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

  private addWallBox(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    material: THREE.Material,
    surface: SurfaceType,
    options?: { castShadow?: boolean; receiveShadow?: boolean; navBlock?: boolean; physicsBlock?: boolean },
  ): THREE.Mesh {
    const geo = new THREE.BoxGeometry(w, h, d);
    // Tile UVs proportionally to world meters so textures never stretch
    const uv = geo.attributes.uv;
    const pos = geo.attributes.position;
    const norm = geo.attributes.normal;
    if (uv && pos && norm) {
      for (let i = 0; i < uv.count; i++) {
        const nx = Math.abs(norm.getX(i));
        const ny = Math.abs(norm.getY(i));
        const px = pos.getX(i);
        const py = pos.getY(i);
        const pz = pos.getZ(i);
        if (nx > 0.5) {
          uv.setXY(i, pz * 0.35, py * 0.35);
        } else if (ny > 0.5) {
          uv.setXY(i, px * 0.35, pz * 0.35);
        } else {
          uv.setXY(i, px * 0.35, py * 0.35);
        }
      }
      uv.needsUpdate = true;
    }

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

    // 1. Extended valley terrain + yard surface (no void edges)
    const outerGroundGeo = new THREE.PlaneGeometry(200, 200);
    outerGroundGeo.rotateX(-Math.PI / 2);
    const uvAttr = outerGroundGeo.attributes.uv;
    if (uvAttr) {
      for (let i = 0; i < uvAttr.count; i++) {
        uvAttr.setXY(i, uvAttr.getX(i) * 40, uvAttr.getY(i) * 40);
      }
    }
    const outerGround = new THREE.Mesh(outerGroundGeo, this.mats.soil);
    outerGround.position.y = 0;
    outerGround.receiveShadow = true;
    this.scene.add(outerGround);
    this.bvh.registerMesh(outerGround, 'dirt');

    // Yard wet asphalt apron (offset Y by 0.05m top to prevent Z-fighting)
    const yardPad = new THREE.Mesh(new THREE.BoxGeometry(44, 0.08, 24), this.mats.wetAsphalt);
    yardPad.position.set(0, 0.01, -2);
    yardPad.receiveShadow = true;
    this.scene.add(yardPad);
    this.bvh.registerMesh(yardPad, 'concrete');

    // Natural perimeter fence + dense tree line around 90x90 station
    this.buildPerimeter();

    // =========================================================================
    // ZONE 1: FARMHOUSE (x: -14 .. 0, z: 10 .. 26)
    // =========================================================================
    const fhFloor = new THREE.Mesh(new THREE.BoxGeometry(14.4, 0.06, 16.4), this.mats.barnWood);
    fhFloor.position.set(-7, 0.03, 18);
    fhFloor.receiveShadow = true;
    this.scene.add(fhFloor);
    this.bvh.registerMesh(fhFloor, 'wood');

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

    // Kitchen island loop in center of farmhouse
    this.addWallBox(-7, 0.55, 18, 3.4, 1.1, 2.0, this.mats.barnWood, 'wood');

    // Window 1 & 2
    windows.push(
      this.createWindowBarricade('win_fh_west', 'farmhouse', -14, 14, 'x', -19.5, -12.0),
      this.createWindowBarricade('win_fh_east', 'farmhouse', 0, 21, 'x', 5.5, -2.0),
    );
    spawnPoints.push(
      { id: 'sp_fh_w', zone: 'farmhouse', position: new THREE.Vector3(-20, 0, 14), windowId: 'win_fh_west' },
      { id: 'sp_fh_e', zone: 'farmhouse', position: new THREE.Vector3(6, 0, 21), windowId: 'win_fh_east' },
    );

    // Farmhouse warm tungsten hanging cage lamp + rafters + wall trim + corner props
    const fhLight = new THREE.PointLight(0xffad58, 3.1, 18, 1.7);
    fhLight.position.set(-7, 3.25, 16.5);
    this.scene.add(fhLight);
    flickerLights.push({ light: fhLight, baseIntensity: 3.1, phase: 0.4 });
    this.createHangingLamp(-7, 3.9, 16.5);
    this.createLightShaft(-7, 3.3, 16.5, 1.5, 2.8, 0xffad58, 0.026);

    // Timber ceiling rafters & wall columns in Farmhouse
    for (let z = 12; z <= 24; z += 4) {
      this.addWallBox(-7, 3.85, z, 13.6, 0.22, 0.24, this.mats.barnWood, 'wood', { navBlock: false });
    }
    this.addWallBox(-13.6, 2, 10.4, 0.35, 3.9, 0.35, this.mats.barnWood, 'wood', { navBlock: false });
    this.addWallBox(-0.4, 2, 10.4, 0.35, 3.9, 0.35, this.mats.barnWood, 'wood', { navBlock: false });
    this.addWallBox(-13.6, 2, 25.6, 0.35, 3.9, 0.35, this.mats.barnWood, 'wood', { navBlock: false });
    this.addWallBox(-0.4, 2, 25.6, 0.35, 3.9, 0.35, this.mats.barnWood, 'wood', { navBlock: false });
    // Baseboards along North wall framing the Silo Yard Gate
    this.addWallBox(-11.7, 0.25, 10.35, 5.2, 0.5, 0.1, this.mats.barnWood, 'wood', { navBlock: false, physicsBlock: false });
    this.addWallBox(-2.3, 0.25, 10.35, 5.2, 0.5, 0.1, this.mats.barnWood, 'wood', { navBlock: false, physicsBlock: false });

    // Corner crates & chemical drums in Farmhouse
    this.createBarrel(-12.5, 11.4);
    this.createBarrel(-1.5, 11.4);
    this.createWoodCrate(-12.2, 24.0, 1.1);
    this.createFloorStain(-7, 13.2, 1.6);

    this.addStationSign(-7, 2.9, 25.6, 0, 'HOLLOWFIELD STATION', 'QUARTERS // SECTOR 01');

    // Wall-buy: Hedgerow Pump Shotgun
    wallBuys.push(
      this.createWallBuy('hedgerow', new THREE.Vector3(-0.38, 1.55, 15.0), -Math.PI / 2),
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
    // Twin corrugated grain silos (composite cylindrical structures with domed tops)
    this.createSilo(-17, -4);
    this.createSilo(-17, 3);
    // Ruined 1980s farm tractor for loop cover + yard barrels & crates
    this.createTractor(-1, 2.5);
    this.createBarrel(-13.5, 1.5);
    this.createBarrel(-13.2, 2.4);
    this.createWoodCrate(5.5, 4.2, 1.2);
    // Sodium street lamp poles
    this.createLampPost(-11, 6, flickerLights, true);
    this.createLampPost(7, -8, flickerLights, !this.isSoftwareGl);
    this.createLampPost(9, 6, flickerLights, !this.isSoftwareGl);

    // Outdoor tree-line spawns (walk straight into yard once yard is open)
    spawnPoints.push(
      { id: 'sp_yard_w', zone: 'silo_yard', position: new THREE.Vector3(-26, 0, -5) },
      { id: 'sp_yard_e', zone: 'silo_yard', position: new THREE.Vector3(24, 0, -10) },
    );

    // Electric Trap Archway at (-7, 5)
    const trapBuilt = this.createElectricTrap(-7, 5.5, poweredEmissives);

    // =========================================================================
    // ZONE 2: TIMBER BARN (x: 12 .. 30, z: -6 .. 16)
    // =========================================================================
    const barnFloor = new THREE.Mesh(new THREE.BoxGeometry(18.4, 0.06, 22.4), this.mats.barnWood);
    barnFloor.position.set(21, 0.03, 5);
    barnFloor.receiveShadow = true;
    this.scene.add(barnFloor);
    this.bvh.registerMesh(barnFloor, 'wood');

    // Barn roof
    this.addWallBox(21, 6.2, 5, 18.8, 0.35, 22.8, this.mats.rustedMetal, 'metal', {
      navBlock: false,
      castShadow: true,
    });

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

    // Interior hay bale stack (loop obstacle)
    this.addWallBox(19, 0.75, 5, 2.4, 1.5, 2.8, this.mats.barnWood, 'wood');

    // Hay loft platform + walkable ramp (sniper vantage overlooking yard/barn)
    this.addWallBox(25.5, 2.5, 1.5, 6.5, 0.35, 11.0, this.mats.barnWood, 'wood', { navBlock: false });
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

    // Barn light shaft cone
    this.createLightShaft(21, 5.4, 5, 2.6, 5.2, 0xf59e42, 0.045);

    // Wall-buy: Rattler SMG
    wallBuys.push(
      this.createWallBuy('rattler', new THREE.Vector3(12.38, 1.55, -2.5), Math.PI / 2),
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
    const labFloor = new THREE.Mesh(new THREE.BoxGeometry(28.4, 0.06, 16.4), this.mats.labTile);
    labFloor.position.set(0, 0.03, -22);
    labFloor.receiveShadow = true;
    this.scene.add(labFloor);
    this.bvh.registerMesh(labFloor, 'concrete');

    // Lab ceiling
    this.addWallBox(0, 4.2, -22, 28.8, 0.35, 16.8, this.mats.concrete, 'concrete', { navBlock: false });

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

    // Central bio-containment tank & lab workbenches (figure-8 training loops)
    this.createBioVat(0, -22);
    this.addWallBox(-7, 0.55, -22, 2.6, 1.1, 1.6, this.mats.rustedMetal, 'metal');
    this.addWallBox(7, 0.55, -22, 2.6, 1.1, 1.6, this.mats.rustedMetal, 'metal');

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
      this.createWallBuy('ironsight', new THREE.Vector3(-9.5, 1.55, -14.38), 0),
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
    const bunkerFloor = new THREE.Mesh(new THREE.BoxGeometry(26.4, 0.06, 12.4), this.mats.concrete);
    bunkerFloor.position.set(-15, 0.03, -36);
    bunkerFloor.receiveShadow = true;
    this.scene.add(bunkerFloor);
    this.bvh.registerMesh(bunkerFloor, 'concrete');

    this.addWallBox(-15, 3.9, -36, 26.8, 0.35, 12.8, this.mats.concrete, 'concrete', { navBlock: false });

    // South wall (joins Lab Wing with Door 4 gap at x: -8..-4)
    this.addWallBox(-18.2, 2, -30, 19.6, 4, 0.6, this.mats.concrete, 'concrete');
    this.addWallBox(-3.0, 2, -30, 2.0, 4, 0.6, this.mats.concrete, 'concrete');
    // North, West, East bunker walls
    this.addWallBox(-15, 2, -42, 26.4, 4, 0.6, this.mats.concrete, 'concrete');
    this.addWallBox(-28, 2, -36, 0.6, 4, 12.4, this.mats.concrete, 'concrete');
    this.addWallBox(-2, 2, -36, 0.6, 4, 12.4, this.mats.concrete, 'concrete');

    // Central bunker reactor pillar (loop around!)
    this.addWallBox(-15, 1.8, -36, 3.2, 3.6, 2.2, this.mats.rustedMetal, 'metal');

    // Bunker spawn points (just inside breach grates at west/east ends)
    spawnPoints.push(
      { id: 'sp_bunk_w', zone: 'bunker', position: new THREE.Vector3(-26, 0, -36) },
      { id: 'sp_bunk_e', zone: 'bunker', position: new THREE.Vector3(-4, 0, -36) },
    );

    const bunkerLight = new THREE.PointLight(0xef4444, 1.6, 20, 1.5);
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

    // Dim powered lights initially (power starts OFF)
    for (const pl of poweredLights) {
      pl.userData.fullIntensity = pl.intensity;
      pl.intensity = 0.22;
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
    // Low chain-link/wood perimeter posts around +-43m + dense instanced pine/dead trees beyond
    const postGeo = new THREE.BoxGeometry(0.3, 2.2, 0.3);
    const railGeo = new THREE.BoxGeometry(4.0, 0.14, 0.12);
    const perimeterBounds = 43;

    const postMatrices: THREE.Matrix4[] = [];
    const m = new THREE.Matrix4();
    for (let p = -perimeterBounds; p <= perimeterBounds; p += 4) {
      m.makeTranslation(p, 1.1, -perimeterBounds);
      postMatrices.push(m.clone());
      m.makeTranslation(p, 1.1, perimeterBounds);
      postMatrices.push(m.clone());
      m.makeTranslation(-perimeterBounds, 1.1, p);
      postMatrices.push(m.clone());
      m.makeTranslation(perimeterBounds, 1.1, p);
      postMatrices.push(m.clone());
    }
    const postInst = new THREE.InstancedMesh(postGeo, this.mats.darkTrim, postMatrices.length);
    postMatrices.forEach((mat, i) => postInst.setMatrixAt(i, mat));
    postInst.computeBoundingSphere();
    this.scene.add(postInst);

    // Invisible boundary colliders at +-43.5 so player stays in the valley
    this.physics.addStaticBox({ cx: 0, cy: 3, cz: -43.5, hx: 45, hy: 3, hz: 0.5 });
    this.physics.addStaticBox({ cx: 0, cy: 3, cz: 43.5, hx: 45, hy: 3, hz: 0.5 });
    this.physics.addStaticBox({ cx: -43.5, cy: 3, cz: 0, hx: 0.5, hy: 3, hz: 45 });
    this.physics.addStaticBox({ cx: 43.5, cy: 3, cz: 0, hx: 0.5, hy: 3, hz: 45 });

    // Dense instanced trees surrounding the station perimeter (46m .. 85m)
    const trunkGeo = new THREE.CylinderGeometry(0.28, 0.45, 5.2, 7);
    trunkGeo.translate(0, 2.6, 0);
    const crownGeo = new THREE.ConeGeometry(2.6, 7.5, 7);
    crownGeo.translate(0, 7.0, 0);
    const treeMat = new THREE.MeshStandardMaterial({ color: 0x1a261c, roughness: 0.92 });

    const treePositions: { x: number; z: number; s: number }[] = [];
    for (let i = 0; i < 110; i++) {
      const ang = (i / 110) * Math.PI * 2 + (i % 5) * 0.04;
      const dist = 47 + ((i * 17) % 32);
      const x = Math.cos(ang) * dist;
      const z = Math.sin(ang) * dist;
      const s = 0.82 + ((i * 13) % 10) * 0.045;
      treePositions.push({ x, z, s });
    }

    const trunkInst = new THREE.InstancedMesh(trunkGeo, this.mats.barnWood, treePositions.length);
    const crownInst = new THREE.InstancedMesh(crownGeo, treeMat, treePositions.length);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    treePositions.forEach((tp, idx) => {
      dummy.position.set(tp.x, 0, tp.z);
      dummy.scale.set(tp.s, tp.s, tp.s);
      dummy.rotation.y = idx * 0.9;
      dummy.updateMatrix();
      trunkInst.setMatrixAt(idx, dummy.matrix);
      crownInst.setMatrixAt(idx, dummy.matrix);
      color.setHSL(0.32 + (idx % 5) * 0.015, 0.22, 0.14 + (idx % 4) * 0.03);
      crownInst.setColorAt(idx, color);
    });
    trunkInst.computeBoundingSphere();
    crownInst.computeBoundingSphere();
    this.scene.add(trunkInst);
    this.scene.add(crownInst);
    void railGeo;
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

    const panel = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this.mats.warningStripe);
    panel.castShadow = !this.isSoftwareGl;
    panel.receiveShadow = true;
    group.add(panel);

    const frameTop = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.2, 0.22, d + 0.16),
      this.mats.rustedMetal,
    );
    frameTop.position.y = h * 0.5 - 0.1;
    group.add(frameTop);

    const signMat = new THREE.MeshStandardMaterial({
      map: createSignageTexture(`${cost} PTS`, label.toUpperCase(), '#1a1410'),
      roughness: 0.7,
    });
    const signA = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.65), signMat);
    signA.position.set(0, 0.2, d * 0.5 + 0.02);
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
    this.addWallBox(cx, 0.55, cz, w, 1.1, d, this.mats.barnWood, 'wood', { navBlock: false });
    this.addWallBox(cx, 3.55, cz, w, 1.3, d, this.mats.barnWood, 'wood', { navBlock: false });

    // Mark window column walkable for zombies only when approaching window navlink
    this.nav.clearAreaWalkable(cx - 1.5, cx + 1.5, cz - 1.5, cz + 1.5);

    const planks: THREE.Mesh[] = [];
    for (let i = 0; i < BALANCE.economy.barricade.maxPlanks; i++) {
      const plankGeo = new THREE.BoxGeometry(axis === 'z' ? 2.3 : 0.14, 0.18, axis === 'x' ? 2.3 : 0.14);
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
    const tex = createWallBuyChalkTexture(cfg.name, cfg.wallPrice);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.85), mat);
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

    // 4-part retro 1986 vending dispenser
    const cabinet = new THREE.Mesh(new THREE.BoxGeometry(1.15, 2.25, 0.85), this.mats.rustedMetal);
    cabinet.position.y = 1.125;
    cabinet.castShadow = !this.isSoftwareGl;
    cabinet.receiveShadow = true;
    group.add(cabinet);

    const trim = new THREE.Mesh(
      new THREE.BoxGeometry(1.22, 0.16, 0.92),
      new THREE.MeshStandardMaterial({ color: cfg.color, roughness: 0.45, metalness: 0.35 }),
    );
    trim.position.y = 2.25;
    group.add(trim);

    const emissiveMat = new THREE.MeshStandardMaterial({
      color: cfg.color,
      emissive: new THREE.Color(cfg.color),
      emissiveIntensity: 0.15, // increases to 1.6 when power turns ON
      roughness: 0.25,
    });
    const marquee = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.56, 0.08), emissiveMat);
    marquee.position.set(0, 1.78, 0.43);
    group.add(marquee);

    const dispWindow = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.35, 0.1), this.mats.darkTrim);
    dispWindow.position.set(0, 0.65, 0.42);
    group.add(dispWindow);

    const light = new THREE.PointLight(cfg.color, 0.2, 8, 1.8);
    light.position.set(0, 1.85, 0.8);
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

    const base = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.8, 0.95), this.mats.barnWood);
    base.position.y = 0.4;
    base.castShadow = !this.isSoftwareGl;
    base.receiveShadow = true;
    group.add(base);

    const band = new THREE.Mesh(new THREE.BoxGeometry(2.14, 0.12, 0.99), this.mats.rustedMetal);
    band.position.y = 0.72;
    group.add(band);

    const lid = new THREE.Group();
    lid.position.set(0, 0.8, -0.46);
    const lidMesh = new THREE.Mesh(new THREE.BoxGeometry(2.14, 0.16, 0.96), this.mats.barnWood);
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
    const body = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 9.5, 16), this.mats.rustedMetal);
    body.position.y = 4.75;
    body.castShadow = !this.isSoftwareGl;
    body.receiveShadow = true;
    group.add(body);

    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(2.4, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      this.mats.rustedMetal,
    );
    dome.position.y = 9.5;
    group.add(dome);

    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.44, 0.08, 8, 24), this.mats.darkTrim);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 5.0;
    group.add(ring);

    this.scene.add(group);
    this.bvh.registerMesh(body, 'metal');
    this.physics.addStaticBox({ cx: x, cy: 4.5, cz: z, hx: 2.35, hy: 4.5, hz: 2.35 });
    this.nav.addStaticObstacle({ minX: x - 2.4, maxX: x + 2.4, minZ: z - 2.4, maxZ: z + 2.4 });
  }

  private createTractor(x: number, z: number): void {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x6b271c, roughness: 0.72, metalness: 0.38 });
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.1, 3.6), bodyMat);
    chassis.position.y = 0.95;
    chassis.castShadow = !this.isSoftwareGl;
    group.add(chassis);

    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.55, 1.15, 1.45), this.mats.rustedMetal);
    cab.position.set(0, 1.9, -0.7);
    group.add(cab);

    const wheelGeo = new THREE.CylinderGeometry(0.62, 0.62, 0.38, 12);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheelOffsets = [
      [-1.05, 0.62, -0.9],
      [1.05, 0.62, -0.9],
      [-1.0, 0.46, 1.15],
      [1.0, 0.46, 1.15],
    ] as const;
    for (const [wx, wy, wz] of wheelOffsets) {
      const w = new THREE.Mesh(wheelGeo, this.mats.gunPolymer);
      w.position.set(wx, wy, wz);
      group.add(w);
    }

    this.scene.add(group);
    this.bvh.registerMesh(chassis, 'metal');
    this.physics.addStaticBox({ cx: x, cy: 1.0, cz: z, hx: 1.25, hy: 1.2, hz: 2.0 });
    this.nav.addStaticObstacle({ minX: x - 1.25, maxX: x + 1.25, minZ: z - 2.0, maxZ: z + 2.0 });
  }

  private createBioVat(x: number, z: number): void {
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.45, 0.65, 16), this.mats.darkTrim);
    base.position.y = 0.325;
    group.add(base);

    const glass = new THREE.Mesh(
      new THREE.CylinderGeometry(1.15, 1.15, 2.5, 16),
      new THREE.MeshPhysicalMaterial({
        color: 0x6ee7b7,
        emissive: 0x10b981,
        emissiveIntensity: 0.35,
        roughness: 0.15,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
      }),
    );
    glass.position.y = 1.9;
    group.add(glass);

    const core = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.55, 1),
      new THREE.MeshStandardMaterial({
        color: 0xd97706,
        emissive: 0xf59e0b,
        emissiveIntensity: 1.2,
        roughness: 0.5,
      }),
    );
    core.position.y = 1.9;
    group.add(core);

    const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.35, 0.5, 16), this.mats.darkTrim);
    cap.position.y = 3.4;
    group.add(cap);

    this.scene.add(group);
    this.bvh.registerMesh(base, 'metal');
    this.physics.addStaticBox({ cx: x, cy: 1.8, cz: z, hx: 1.35, hy: 1.8, hz: 1.35 });
    this.nav.addStaticObstacle({ minX: x - 1.35, maxX: x + 1.35, minZ: z - 1.35, maxZ: z + 1.35 });
  }

  private createLampPost(
    x: number,
    z: number,
    flickerLights: { light: THREE.PointLight; baseIntensity: number; phase: number }[],
    addLight = true,
  ): void {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 5.4, 8), this.mats.darkTrim);
    pole.position.set(x, 2.7, z);
    this.scene.add(pole);

    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffc878 }),
    );
    bulb.position.set(x, 5.3, z);
    this.scene.add(bulb);

    if (addLight) {
      const light = new THREE.PointLight(0xffb454, 4.2, 24, 1.5);
      light.position.set(x, 5.1, z);
      this.scene.add(light);
      flickerLights.push({ light, baseIntensity: 4.2, phase: x * 0.7 + z * 0.3 });
    }

    this.createLightShaft(x, 5.1, z, 2.4, 5.0, 0xffb454, 0.075);
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
    // Fade vertex color to black at the bottom rim so additive cone never shows a hard edge
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

    const box = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.9, 0.55), this.mats.rustedMetal);
    group.add(box);

    const indicatorMat = new THREE.MeshStandardMaterial({
      color: 0xef4444,
      emissive: 0xef4444,
      emissiveIntensity: 1.4,
    });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 10), indicatorMat);
    bulb.position.set(-0.16, 0.3, 0);
    group.add(bulb);

    const lever = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.42, 0.08), this.mats.warningStripe);
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

    const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.05, 1.0), this.mats.darkTrim);
    chassis.position.y = 0.525;
    group.add(chassis);

    const topPlate = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.1, 1.05), this.mats.warningStripe);
    topPlate.position.y = 1.08;
    group.add(topPlate);

    const rotor = new THREE.Group();
    rotor.position.set(0, 1.45, 0);
    const coilMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0ea5e9,
      emissiveIntensity: 0.4,
      metalness: 0.7,
      roughness: 0.25,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.06, 10, 20), coilMat);
    rotor.add(ring);
    group.add(rotor);

    const light = new THREE.PointLight(0x38bdf8, 0.2, 8, 1.6);
    light.position.set(0, 1.7, 0.5);
    if (!this.isSoftwareGl) {
      group.add(light);
    }

    this.scene.add(group);
    this.physics.addStaticBox({ cx: pos.x, cy: 0.6, cz: pos.z, hx: 1.15, hy: 0.65, hz: 0.55 });
    this.nav.addStaticObstacle({
      minX: pos.x - 1.15,
      maxX: pos.x + 1.15,
      minZ: pos.z - 0.55,
      maxZ: pos.z + 0.55,
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
    const pylonMat = this.mats.rustedMetal;
    const leftPylon = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 3.2, 10), pylonMat);
    leftPylon.position.set(cx - 2.3, 1.6, cz);
    this.scene.add(leftPylon);

    const rightPylon = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 3.2, 10), pylonMat);
    rightPylon.position.set(cx + 2.3, 1.6, cz);
    this.scene.add(rightPylon);

    const switchBox = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.6, 0.35), this.mats.warningStripe);
    switchBox.position.set(cx + 2.55, 1.25, cz + 0.3);
    this.scene.add(switchBox);

    const arcs = new THREE.Group();
    arcs.position.set(cx, 1.4, cz);
    arcs.visible = false;
    const arcMat = new THREE.MeshBasicMaterial({ color: 0x60a5fa });
    poweredEmissives.push(
      new THREE.MeshStandardMaterial({ color: 0x3b82f6, emissive: 0x3b82f6, emissiveIntensity: 1.2 }),
    );
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

    const desk = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.95, 0.9), this.mats.darkTrim);
    desk.position.y = 0.475;
    group.add(desk);

    const unit = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.55, 0.55), this.mats.rustedMetal);
    unit.position.set(0, 1.22, -0.1);
    group.add(unit);

    const screenMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      emissive: 0xef4444,
      emissiveIntensity: 0.45,
      roughness: 0.3,
    });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.28), screenMat);
    screen.position.set(-0.2, 1.25, 0.185);
    group.add(screen);

    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 1.1, 6), this.mats.gunMetal);
    antenna.position.set(0.45, 1.8, -0.1);
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
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.365, 0.025, 6, 14), this.mats.darkTrim);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.72;
    g.add(body, rim);
    this.scene.add(g);
    this.physics.addStaticBox({ cx: x, cy: 0.51, cz: z, hx: 0.38, hy: 0.51, hz: 0.38 });
    this.nav.addStaticObstacle({ minX: x - 0.38, maxX: x + 0.38, minZ: z - 0.38, maxZ: z + 0.38 });
  }

  private createWoodCrate(x: number, z: number, size: number): void {
    const box = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), this.mats.barnWood);
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
