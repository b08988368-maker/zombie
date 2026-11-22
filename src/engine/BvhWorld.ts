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
  private readonly activeMeshes: THREE.Mesh[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly tmpNormal = new THREE.Vector3();
  private readonly tmpNormalMat = new THREE.Matrix3();

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

  public raycast(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    maxDistance: number,
  ): WorldHitResult | null {
    this.raycaster.set(origin, direction);
    this.raycaster.near = 0.05;
    this.raycaster.far = maxDistance;
    (this.raycaster as THREE.Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true;

    const hits = this.raycaster.intersectObjects(this.activeMeshes, false);
    if (hits.length === 0) return null;

    const hit = hits[0]!;
    const hitMesh = hit.object as THREE.Mesh;
    const entry = this.entries.find((e) => e.mesh === hitMesh);
    const surface: SurfaceType = entry?.surface ?? 'concrete';

    const normal = new THREE.Vector3(0, 1, 0);
    if (hit.face) {
      this.tmpNormal.copy(hit.face.normal);
      this.tmpNormalMat.getNormalMatrix(hitMesh.matrixWorld);
      normal.copy(this.tmpNormal).applyMatrix3(this.tmpNormalMat).normalize();
    }

    return {
      distance: hit.distance,
      point: hit.point.clone(),
      normal,
      surface,
      mesh: hitMesh,
    };
  }

  public hasLineOfSight(from: THREE.Vector3, to: THREE.Vector3): boolean {
    const dir = new THREE.Vector3().subVectors(to, from);
    const dist = dir.length();
    if (dist < 0.1) return true;
    dir.divideScalar(dist);
    const hit = this.raycast(from, dir, dist - 0.15);
    return hit === null;
  }

  public dispose(): void {
    for (const e of this.entries) {
      const geo = e.mesh.geometry as THREE.BufferGeometry;
      if (geo.boundsTree) {
        geo.disposeBoundsTree();
      }
    }
    this.entries.length = 0;
    this.activeMeshes.length = 0;
  }
}
