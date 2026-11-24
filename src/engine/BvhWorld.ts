import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';

// Patch Three.js BufferGeometry & Mesh once for accelerated BVH raycasting
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export type SurfaceType = 'concrete' | 'metal' | 'wood' | 'dirt';

export interface StaticBvhMeshEntry {
  mesh: THREE.Mesh;
  surface: SurfaceType;
  doorId?: string;
  active: boolean;
}

export interface WorldHitResult {
  distance: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  surface: SurfaceType;
  mesh: THREE.Mesh;
}

export class BvhWorld {
  private readonly entries: StaticBvhMeshEntry[] = [];
  private readonly entryByMesh = new Map<THREE.Mesh, StaticBvhMeshEntry>();
  private readonly activeMeshes: THREE.Mesh[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly tmpNormal = new THREE.Vector3();
  private readonly tmpLosDir = new THREE.Vector3();
  private readonly tmpNormalMat = new THREE.Matrix3();
  private readonly scratchPoint = new THREE.Vector3();
  private readonly scratchNormal = new THREE.Vector3();
  private readonly scratchHit: WorldHitResult = {
    distance: 0,
    point: this.scratchPoint,
    normal: this.scratchNormal,
    surface: 'concrete',
    mesh: null as unknown as THREE.Mesh,
  };

  public registerMesh(mesh: THREE.Mesh, surface: SurfaceType, doorId?: string): void {
    const geo = mesh.geometry as THREE.BufferGeometry;
    if (!geo.boundsTree) {
      geo.boundsTree = new MeshBVH(geo);
    }
    mesh.updateMatrixWorld(true);
    const entry: StaticBvhMeshEntry = {
      mesh,
      surface,
      doorId,
      active: true,
    };
    this.entries.push(entry);
    this.entryByMesh.set(mesh, entry);
    this.rebuildActiveList();
  }

  public setDoorActive(doorId: string, active: boolean): void {
    let changed = false;
    for (const e of this.entries) {
      if (e.doorId === doorId && e.active !== active) {
        e.active = active;
        changed = true;
      }
    }
    if (changed) {
      this.rebuildActiveList();
    }
  }

  private rebuildActiveList(): void {
    this.activeMeshes.length = 0;
    for (const e of this.entries) {
      if (e.active) {
        this.activeMeshes.push(e.mesh);
      }
    }
  }

  /**
   * Zero-allocation BVH raycast that populates an internal scratch result (valid until next raycastInto call).
   */
  public raycastFast(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    maxDistance: number,
    near = 0.05,
  ): WorldHitResult | null {
    this.raycaster.set(origin, direction);
    this.raycaster.near = near;
    this.raycaster.far = maxDistance;
    (this.raycaster as THREE.Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true;

    const hits = this.raycaster.intersectObjects(this.activeMeshes, false);
    if (hits.length === 0) return null;

    const hit = hits[0]!;
    const hitMesh = hit.object as THREE.Mesh;
    const entry = this.entryByMesh.get(hitMesh);
    const surface: SurfaceType = entry?.surface ?? 'concrete';

    this.scratchNormal.set(0, 1, 0);
    if (hit.face) {
      this.tmpNormal.copy(hit.face.normal);
      this.tmpNormalMat.getNormalMatrix(hitMesh.matrixWorld);
      this.scratchNormal.copy(this.tmpNormal).applyMatrix3(this.tmpNormalMat).normalize();
    }

    this.scratchHit.distance = hit.distance;
    this.scratchHit.point.copy(hit.point);
    this.scratchHit.surface = surface;
    this.scratchHit.mesh = hitMesh;
    return this.scratchHit;
  }

  public raycast(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    maxDistance: number,
  ): WorldHitResult | null {
    const fast = this.raycastFast(origin, direction, maxDistance);
    if (!fast) return null;
    return {
      distance: fast.distance,
      point: fast.point.clone(),
      normal: fast.normal.clone(),
      surface: fast.surface,
      mesh: fast.mesh,
    };
  }

  public hasLineOfSight(from: THREE.Vector3, to: THREE.Vector3): boolean {
    this.tmpLosDir.subVectors(to, from);
    const dist = this.tmpLosDir.length();
    if (dist < 0.08) return true;
    this.tmpLosDir.divideScalar(dist);
    const maxD = Math.max(0.01, dist - 0.02);
    if (this.raycastFast(from, this.tmpLosDir, maxD, 0.001) !== null) {
      return false;
    }
    // Also test reverse ray so FrontSide wall/ramp/crate faces catch origins pressing flush against or inside a collider
    this.tmpLosDir.negate();
    return this.raycastFast(to, this.tmpLosDir, maxD, 0.001) === null;
  }

  public dispose(): void {
    for (const e of this.entries) {
      const geo = e.mesh.geometry as THREE.BufferGeometry;
      if (geo.boundsTree) {
        geo.disposeBoundsTree();
      }
    }
    this.entries.length = 0;
    this.entryByMesh.clear();
    this.activeMeshes.length = 0;
  }
}
