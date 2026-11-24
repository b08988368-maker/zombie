import { BALANCE } from '../config/balance';

export interface RectObstacle {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  doorId?: string;
}

export interface NavLink {
  id: string;
  outsideX: number;
  outsideZ: number;
  insideX: number;
  insideZ: number;
}

const DIRS_8 = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, 1.414],
  [1, -1, 1.414],
  [-1, 1, 1.414],
  [-1, -1, 1.414],
] as const;

export class NavGrid {
  public readonly cellSize = BALANCE.nav.cellSize;
  public readonly minX = BALANCE.nav.gridMinX;
  public readonly maxX = BALANCE.nav.gridMaxX;
  public readonly minZ = BALANCE.nav.gridMinZ;
  public readonly maxZ = BALANCE.nav.gridMaxZ;
  public readonly width: number;
  public readonly height: number;
  public readonly totalCells: number;

  private readonly staticBlocked: Uint8Array;
  private readonly walkable: Uint8Array;
  private readonly dist: Float32Array;
  private readonly dirX: Float32Array;
  private readonly dirZ: Float32Array;
  private readonly queue: Int32Array;
  private readonly doorObstacles = new Map<string, RectObstacle[]>();
  private readonly openDoors = new Set<string>();

  private lastTargetCell = -1;
  private timeSinceUpdate = 999;

  // Spatial hash for zombie separation steering (O(1) per zombie, zero GC)
  private readonly hashHead: Int32Array;
  private readonly hashNext: Int32Array;

  constructor() {
    this.width = Math.ceil((this.maxX - this.minX) / this.cellSize);
    this.height = Math.ceil((this.maxZ - this.minZ) / this.cellSize);
    this.totalCells = this.width * this.height;

    this.staticBlocked = new Uint8Array(this.totalCells);
    this.walkable = new Uint8Array(this.totalCells);
    this.walkable.fill(1);
    this.dist = new Float32Array(this.totalCells);
    this.dirX = new Float32Array(this.totalCells);
    this.dirZ = new Float32Array(this.totalCells);
    this.queue = new Int32Array(this.totalCells * 4);

    this.hashHead = new Int32Array(this.totalCells);
    this.hashNext = new Int32Array(BALANCE.rounds.maxAlive + 8);
  }

  public worldToCell(x: number, z: number): { cx: number; cz: number; idx: number } {
    const cx = Math.max(0, Math.min(this.width - 1, Math.floor((x - this.minX) / this.cellSize)));
    const cz = Math.max(0, Math.min(this.height - 1, Math.floor((z - this.minZ) / this.cellSize)));
    return { cx, cz, idx: cz * this.width + cx };
  }

  public cellToWorld(cx: number, cz: number): { x: number; z: number } {
    return {
      x: this.minX + (cx + 0.5) * this.cellSize,
      z: this.minZ + (cz + 0.5) * this.cellSize,
    };
  }

  public addStaticObstacle(rect: RectObstacle, pad = 0.28): void {
    const minCx = Math.max(0, Math.floor((rect.minX - pad - this.minX) / this.cellSize));
    const maxCx = Math.min(this.width - 1, Math.floor((rect.maxX + pad - this.minX) / this.cellSize));
    const minCz = Math.max(0, Math.floor((rect.minZ - pad - this.minZ) / this.cellSize));
    const maxCz = Math.min(this.height - 1, Math.floor((rect.maxZ + pad - this.minZ) / this.cellSize));

    for (let cz = minCz; cz <= maxCz; cz++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        this.staticBlocked[cz * this.width + cx] = 1;
      }
    }
    this.rebuildWalkable();
  }

  public clearAreaWalkable(minX: number, maxX: number, minZ: number, maxZ: number): void {
    const minCx = Math.max(0, Math.floor((minX - this.minX) / this.cellSize));
    const maxCx = Math.min(this.width - 1, Math.floor((maxX - this.minX) / this.cellSize));
    const minCz = Math.max(0, Math.floor((minZ - this.minZ) / this.cellSize));
    const maxCz = Math.min(this.height - 1, Math.floor((maxZ - this.minZ) / this.cellSize));

    for (let cz = minCz; cz <= maxCz; cz++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        this.staticBlocked[cz * this.width + cx] = 0;
      }
    }
    this.rebuildWalkable();
  }

  public addDoorObstacle(doorId: string, rect: RectObstacle): void {
    const existing = this.doorObstacles.get(doorId) ?? [];
    existing.push(rect);
    this.doorObstacles.set(doorId, existing);
    this.rebuildWalkable();
  }

  public setDoorOpen(doorId: string, open: boolean): void {
    if (open) {
      this.openDoors.add(doorId);
    } else {
      this.openDoors.delete(doorId);
    }
    this.rebuildWalkable();
    this.lastTargetCell = -1; // force recompute on next tick
  }

  public isDoorOpen(doorId: string): boolean {
    return this.openDoors.has(doorId);
  }

  private rebuildWalkable(): void {
    for (let i = 0; i < this.totalCells; i++) {
      this.walkable[i] = this.staticBlocked[i] === 1 ? 0 : 1;
    }
    for (const [doorId, rects] of this.doorObstacles) {
      if (this.openDoors.has(doorId)) continue;
      for (const rect of rects) {
        const minCx = Math.max(0, Math.floor((rect.minX - this.minX) / this.cellSize));
        const maxCx = Math.min(this.width - 1, Math.floor((rect.maxX - this.minX) / this.cellSize));
        const minCz = Math.max(0, Math.floor((rect.minZ - this.minZ) / this.cellSize));
        const maxCz = Math.min(this.height - 1, Math.floor((rect.maxZ - this.minZ) / this.cellSize));
        for (let cz = minCz; cz <= maxCz; cz++) {
          for (let cx = minCx; cx <= maxCx; cx++) {
            this.walkable[cz * this.width + cx] = 0;
          }
        }
      }
    }
  }

  public isWalkableWorld(x: number, z: number): boolean {
    const { idx } = this.worldToCell(x, z);
    return this.walkable[idx] === 1;
  }

  public updateFlowField(targetX: number, targetZ: number, dt: number, force = false): boolean {
    this.timeSinceUpdate += dt;
    const minInterval = 1 / BALANCE.nav.flowFieldUpdateHz;
    const targetCell = this.worldToCell(targetX, targetZ);

    if (!force) {
      if (targetCell.idx === this.lastTargetCell && this.lastTargetCell !== -1) {
        return false;
      }
      if (this.timeSinceUpdate < minInterval) {
        return false;
      }
    }

    this.timeSinceUpdate = 0;
    this.lastTargetCell = targetCell.idx;

    const INF = 1e9;
    this.dist.fill(INF);
    this.dirX.fill(0);
    this.dirZ.fill(0);

    // Ensure target cell is walkable or find nearest walkable neighbor
    let startIdx = targetCell.idx;
    if (this.walkable[startIdx] === 0) {
      for (let r = 1; r <= 3; r++) {
        let found = -1;
        for (let dz = -r; dz <= r; dz++) {
          for (let dx = -r; dx <= r; dx++) {
            const nx = targetCell.cx + dx;
            const nz = targetCell.cz + dz;
            if (nx >= 0 && nx < this.width && nz >= 0 && nz < this.height) {
              const ni = nz * this.width + nx;
              if (this.walkable[ni] === 1) {
                found = ni;
                break;
              }
            }
          }
          if (found !== -1) break;
        }
        if (found !== -1) {
          startIdx = found;
          break;
        }
      }
    }

    let head = 0;
    let tail = 0;
    this.dist[startIdx] = 0;
    this.queue[tail++] = startIdx;

    while (head < tail) {
      const curr = this.queue[head++]!;
      const currDist = this.dist[curr]!;
      const cx = curr % this.width;
      const cz = (curr - cx) / this.width;

      for (let d = 0; d < 8; d++) {
        const dir = DIRS_8[d]!;
        const nx = cx + dir[0];
        const nz = cz + dir[1];
        if (nx < 0 || nx >= this.width || nz < 0 || nz >= this.height) continue;
        const ni = nz * this.width + nx;
        if (this.walkable[ni] === 0) continue;

        // Prevent diagonal corner cutting across blocked cells
        if (dir[0] !== 0 && dir[1] !== 0) {
          if (
            this.walkable[cz * this.width + nx] === 0 ||
            this.walkable[nz * this.width + cx] === 0
          ) {
            continue;
          }
        }

        const nd = currDist + dir[2];
        if (nd < this.dist[ni]! - 1e-4) {
          this.dist[ni] = nd;
          if (tail < this.queue.length) {
            this.queue[tail++] = ni;
          }
        }
      }
    }

    // Compute normalized flow vector per cell pointing toward lowest-distance neighbor
    for (let cz = 0; cz < this.height; cz++) {
      for (let cx = 0; cx < this.width; cx++) {
        const idx = cz * this.width + cx;
        if (this.walkable[idx] === 0) continue;
        const selfDist = this.dist[idx]!;
        if (selfDist >= INF * 0.5) continue;

        let bestDist = selfDist;
        let vx = 0;
        let vz = 0;

        for (let d = 0; d < 8; d++) {
          const dir = DIRS_8[d]!;
          const nx = cx + dir[0];
          const nz = cz + dir[1];
          if (nx < 0 || nx >= this.width || nz < 0 || nz >= this.height) continue;
          const ni = nz * this.width + nx;
          if (this.walkable[ni] === 0) continue;
          if (dir[0] !== 0 && dir[1] !== 0) {
            if (
              this.walkable[cz * this.width + nx] === 0 ||
              this.walkable[nz * this.width + cx] === 0
            ) {
              continue;
            }
          }
          const nd = this.dist[ni]!;
          if (nd < bestDist) {
            bestDist = nd;
            vx = dir[0];
            vz = dir[1];
          }
        }

        const len = Math.hypot(vx, vz);
        if (len > 0.001) {
          this.dirX[idx] = vx / len;
          this.dirZ[idx] = vz / len;
        }
      }
    }

    return true;
  }

  public sampleFlow(x: number, z: number, out: { x: number; z: number }): void {
    const { cx, cz, idx } = this.worldToCell(x, z);
    const fx = this.dirX[idx] ?? 0;
    const fz = this.dirZ[idx] ?? 0;
    if (fx !== 0 || fz !== 0) {
      out.x = fx;
      out.z = fz;
      return;
    }
    // If standing on edge/blocked cell, steer gently toward nearest walkable cell
    let bestDist = 1e9;
    let bx = 0;
    let bz = 0;
    for (let r = 1; r <= 3; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = cx + dx;
          const nz = cz + dz;
          if (nx < 0 || nx >= this.width || nz < 0 || nz >= this.height) continue;
          const ni = nz * this.width + nx;
          if (this.walkable[ni] === 1 && (this.dist[ni] ?? 1e9) < bestDist) {
            bestDist = this.dist[ni]!;
            bx = dx;
            bz = dz;
          }
        }
      }
      if (bx !== 0 || bz !== 0) break;
    }
    const len = Math.hypot(bx, bz);
    if (len > 0.001) {
      out.x = bx / len;
      out.z = bz / len;
    } else {
      out.x = 0;
      out.z = 0;
    }
  }

  public getDistanceToTarget(x: number, z: number): number {
    const { idx } = this.worldToCell(x, z);
    return this.dist[idx] ?? 1e9;
  }

  public rebuildSpatialHash(positionsX: Float32Array, positionsZ: Float32Array, activeFlags: Uint8Array, count: number): void {
    this.hashHead.fill(-1);
    for (let i = 0; i < count; i++) {
      if (activeFlags[i] === 0) continue;
      const { idx } = this.worldToCell(positionsX[i]!, positionsZ[i]!);
      this.hashNext[i] = this.hashHead[idx]!;
      this.hashHead[idx] = i;
    }
  }

  public computeSeparation(
    selfIndex: number,
    x: number,
    z: number,
    positionsX: Float32Array,
    positionsZ: Float32Array,
    radius: number,
    out: { x: number; z: number },
  ): void {
    out.x = 0;
    out.z = 0;
    const { cx, cz } = this.worldToCell(x, z);
    const rSq = radius * radius;

    for (let dz = -1; dz <= 1; dz++) {
      const nz = cz + dz;
      if (nz < 0 || nz >= this.height) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx;
        if (nx < 0 || nx >= this.width) continue;
        const cellIdx = nz * this.width + nx;
        let other = this.hashHead[cellIdx]!;
        while (other !== -1) {
          if (other !== selfIndex) {
            const ox = x - positionsX[other]!;
            const oz = z - positionsZ[other]!;
            const dSq = ox * ox + oz * oz;
            if (dSq > 0.0001 && dSq < rSq) {
              const d = Math.sqrt(dSq);
              const strength = (radius - d) / radius;
              out.x += (ox / d) * strength;
              out.z += (oz / d) * strength;
            } else if (dSq <= 0.0001) {
              out.x += (selfIndex % 2 === 0 ? 1 : -1) * 0.5;
              out.z += (selfIndex % 3 === 0 ? 1 : -1) * 0.5;
            }
          }
          other = this.hashNext[other]!;
        }
      }
    }
  }
}
