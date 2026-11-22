import RAPIER from '@dimforge/rapier3d-compat';
import { BALANCE } from '../config/balance';

export interface BoxColliderDesc {
  id?: string;
  cx: number;
  cy: number;
  cz: number;
  hx: number;
  hy: number;
  hz: number;
  doorId?: string;
}

export interface DynamicGrenadeBody {
  id: number;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
}

export class PhysicsWorld {
  private static initialized = false;
  public world!: RAPIER.World;
  public playerBody!: RAPIER.RigidBody;
  public playerCollider!: RAPIER.Collider;
  public characterController!: RAPIER.KinematicCharacterController;

  private readonly doorColliders = new Map<string, RAPIER.Collider[]>();
  private readonly grenades: DynamicGrenadeBody[] = [];
  private nextGrenadeId = 1;

  public static async ensureInit(): Promise<void> {
    if (!PhysicsWorld.initialized) {
      await RAPIER.init();
      PhysicsWorld.initialized = true;
    }
  }

  public initWorld(spawnX: number, spawnY: number, spawnZ: number): void {
    this.world = new RAPIER.World({ x: 0, y: -BALANCE.player.gravity, z: 0 });
    this.doorColliders.clear();
    this.grenades.length = 0;

    // Ground plane collider at y = 0
    const groundDesc = RAPIER.ColliderDesc.cuboid(65, 0.25, 65).setTranslation(0, -0.25, 0);
    this.world.createCollider(groundDesc);

    // Player kinematic capsule
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
      spawnX,
      spawnY,
      spawnZ,
    );
    this.playerBody = this.world.createRigidBody(bodyDesc);
    const colDesc = RAPIER.ColliderDesc.capsule(
      BALANCE.player.capsuleHalfHeight,
      BALANCE.player.capsuleRadius,
    );
    this.playerCollider = this.world.createCollider(colDesc, this.playerBody);

    this.characterController = this.world.createCharacterController(0.04);
    this.characterController.enableAutostep(0.45, 0.25, true);
    this.characterController.enableSnapToGround(0.35);
    this.characterController.setSlideEnabled(true);
    this.characterController.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.characterController.setMinSlopeSlideAngle((55 * Math.PI) / 180);
  }

  public addStaticBox(desc: BoxColliderDesc): RAPIER.Collider {
    const colDesc = RAPIER.ColliderDesc.cuboid(desc.hx, desc.hy, desc.hz).setTranslation(
      desc.cx,
      desc.cy,
      desc.cz,
    );
    const col = this.world.createCollider(colDesc);
    if (desc.doorId) {
      const list = this.doorColliders.get(desc.doorId) ?? [];
      list.push(col);
      this.doorColliders.set(desc.doorId, list);
    }
    return col;
  }

  public setDoorColliderEnabled(doorId: string, enabled: boolean): void {
    const list = this.doorColliders.get(doorId);
    if (!list) return;
    for (const col of list) {
      col.setEnabled(enabled);
    }
  }

  public movePlayer(
    dx: number,
    dy: number,
    dz: number,
  ): { x: number; y: number; z: number; grounded: boolean } {
    this.characterController.computeColliderMovement(this.playerCollider, {
      x: dx,
      y: dy,
      z: dz,
    });
    const corrected = this.characterController.computedMovement();
    const cur = this.playerBody.translation();
    const nx = cur.x + corrected.x;
    const ny = cur.y + corrected.y;
    const nz = cur.z + corrected.z;
    this.playerBody.setNextKinematicTranslation({ x: nx, y: ny, z: nz });
    this.world.step();
    const grounded = this.characterController.computedGrounded();
    return { x: nx, y: ny, z: nz, grounded };
  }

  public getPlayerPosition(): { x: number; y: number; z: number } {
    const t = this.playerBody.translation();
    return { x: t.x, y: t.y, z: t.z };
  }

  public spawnGrenadeBody(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
  ): DynamicGrenadeBody {
    const rbDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z)
      .setLinvel(vx, vy, vz)
      .setAngularDamping(1.8)
      .setLinearDamping(0.35);
    const body = this.world.createRigidBody(rbDesc);
    const colDesc = RAPIER.ColliderDesc.ball(0.11)
      .setRestitution(0.42)
      .setFriction(0.75);
    const collider = this.world.createCollider(colDesc, body);
    const item: DynamicGrenadeBody = {
      id: this.nextGrenadeId++,
      body,
      collider,
    };
    this.grenades.push(item);
    return item;
  }

  public removeGrenadeBody(id: number): void {
    const idx = this.grenades.findIndex((g) => g.id === id);
    if (idx === -1) return;
    const item = this.grenades[idx]!;
    this.world.removeRigidBody(item.body);
    this.grenades.splice(idx, 1);
  }

  public dispose(): void {
    this.doorColliders.clear();
    this.grenades.length = 0;
    if (this.world) {
      this.world.free();
    }
  }
}
