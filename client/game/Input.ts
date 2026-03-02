import { Camera } from "./Camera";
import { Selection } from "./Selection";
import { NetClient, type WorldSnapshot } from "../net/NetClient";

const FIXED_SCALE = 1000n;

interface HoverGeneratorPayload {
  generatorId: string;
  screenX: number;
  screenY: number;
}

interface InputOptions {
  canvas: HTMLCanvasElement;
  camera: Camera;
  net: NetClient;
  selection: Selection;
  getSnapshot: () => WorldSnapshot;
  getTileSize: () => number;
  isMapOpen: () => boolean;
  toggleMap: () => void;
  closeMap: () => void;
  setHoverGenerator: (payload: HoverGeneratorPayload | null) => void;
}

export class Input {
  private pointerDown = false;
  private dragging = false;
  private activePointerId: number | null = null;
  private downX = 0;
  private downY = 0;
  private lastX = 0;
  private lastY = 0;

  constructor(private readonly options: InputOptions) {
    this.attach();
  }

  private attach(): void {
    const { canvas } = this.options;

    canvas.addEventListener("contextmenu", (event) => {
      event.preventDefault();
    });

    window.addEventListener("keydown", this.onKeyDown);

    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerUp);
    canvas.addEventListener("pointerleave", this.onPointerLeave);
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === "KeyM") {
      event.preventDefault();
      this.options.toggleMap();
      this.options.setHoverGenerator(null);
      return;
    }

    if (event.code === "KeyB") {
      event.preventDefault();
      this.options.selection.toggleBuildLineMode();
      return;
    }

    if (event.code === "KeyX") {
      event.preventDefault();
      this.options.selection.toggleDestroyLineMode();
      return;
    }

    if (event.code === "Escape") {
      if (this.options.isMapOpen()) {
        this.options.closeMap();
      } else {
        this.options.selection.cancelMode();
      }
      this.options.setHoverGenerator(null);
    }
  };

  private onPointerDown = (event: PointerEvent): void => {
    if (this.options.isMapOpen()) {
      return;
    }

    if (event.button === 2) {
      this.options.net.stopMove().catch((error) => {
        console.warn("stopMove failed", error);
      });
      return;
    }

    if (event.button !== 0) {
      return;
    }

    const point = this.toCanvasPoint(event);
    this.pointerDown = true;
    this.dragging = false;
    this.activePointerId = event.pointerId;
    this.downX = point.x;
    this.downY = point.y;
    this.lastX = point.x;
    this.lastY = point.y;

    try {
      this.options.canvas.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture can fail on some platforms; regular flow still works.
    }
  };

  private onPointerMove = (event: PointerEvent): void => {
    const point = this.toCanvasPoint(event);
    this.updateHover(point.x, point.y);

    if (!this.pointerDown) return;
    if (this.activePointerId !== null && event.pointerId !== this.activePointerId) return;
    if (this.options.isMapOpen()) return;

    const dx = point.x - this.lastX;
    const dy = point.y - this.lastY;
    this.lastX = point.x;
    this.lastY = point.y;

    const totalDx = point.x - this.downX;
    const totalDy = point.y - this.downY;
    if (totalDx * totalDx + totalDy * totalDy > 36 || Math.abs(dx) + Math.abs(dy) > 6) {
      this.dragging = true;
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (!this.pointerDown) return;
    if (this.activePointerId !== null && event.pointerId !== this.activePointerId) return;

    this.pointerDown = false;
    this.activePointerId = null;

    if (this.options.isMapOpen()) {
      return;
    }

    if (event.button !== 0 || this.dragging) {
      return;
    }

    const point = this.toCanvasPoint(event);
    void this.handleLeftClick(point.x, point.y);
  };

  private onPointerLeave = (): void => {
    this.pointerDown = false;
    this.activePointerId = null;
    this.options.setHoverGenerator(null);
  };

  private async handleLeftClick(screenX: number, screenY: number): Promise<void> {
    const snapshot = this.options.getSnapshot();
    const tileSize = this.options.getTileSize();
    const world = this.options.camera.screenToWorldPx(screenX, screenY);

    const picked = this.pickGenerator(snapshot, world.x, world.y, tileSize);
    const mode = this.options.selection.mode;

    if (mode.kind === "buildLine") {
      if (!picked) return;

      this.options.selection.setSelectedGenerator(picked.id);
      if (mode.step === "pickA") {
        this.options.selection.setBuildLinePickB(picked.id);
        return;
      }

      const aId = mode.aId;
      if (!aId || aId === picked.id) {
        this.options.selection.setBuildLinePickB(picked.id);
        return;
      }

      this.options.selection.setLineA(aId);
      this.options.selection.setLineB(picked.id);
      try {
        await this.options.net.buildLine(aId, picked.id);
        this.options.selection.cancelMode();
      } catch (error) {
        console.warn("buildLine failed", error);
      }
      return;
    }

    if (mode.kind === "destroyLine") {
      const line = this.pickLine(snapshot, world.x, world.y, tileSize);
      if (line) {
        try {
          await this.options.net.destroyLine(line.id);
          this.options.selection.cancelMode();
        } catch (error) {
          console.warn("destroyLine failed", error);
        }
        return;
      }

      // Fallback: pick A/B generators and compute line ID.
      if (!picked || !snapshot.myPlayerId) return;
      this.options.selection.setSelectedGenerator(picked.id);
      if (!this.options.selection.lineA) {
        this.options.selection.setLineA(picked.id);
        this.options.selection.setLineB(null);
        return;
      }

      const aId = this.options.selection.lineA;
      if (aId === picked.id) return;
      const lineId = makeLineId(snapshot.myPlayerId, aId, picked.id);
      this.options.selection.setLineB(picked.id);
      try {
        await this.options.net.destroyLine(lineId);
        this.options.selection.cancelMode();
      } catch (error) {
        console.warn("destroyLine (fallback) failed", error);
      }
      return;
    }

    if (picked) {
      this.options.selection.cancelMode();
      this.options.selection.setSelectedGenerator(picked.id);
      return;
    }

    this.options.selection.setSelectedGenerator(null);

    const rawTargetPosX = BigInt(Math.floor((world.x * Number(FIXED_SCALE)) / tileSize));
    const rawTargetPosY = BigInt(Math.floor((world.y * Number(FIXED_SCALE)) / tileSize));
    const worldWidth = snapshot.worldConfig?.worldWidth ?? 128;
    const worldHeight = snapshot.worldConfig?.worldHeight ?? 128;
    const maxTargetPosX = BigInt(worldWidth) * FIXED_SCALE - 1n;
    const maxTargetPosY = BigInt(worldHeight) * FIXED_SCALE - 1n;
    const targetPosX = clampBigInt(rawTargetPosX, 0n, maxTargetPosX);
    const targetPosY = clampBigInt(rawTargetPosY, 0n, maxTargetPosY);

    try {
      await this.options.net.setMoveTarget(targetPosX, targetPosY);
    } catch (error) {
      console.warn("setMoveTarget failed", error);
    }
  }

  private pickGenerator(
    snapshot: WorldSnapshot,
    worldX: number,
    worldY: number,
    tileSize: number,
  ): { id: string } | null {
    const clickedCellX = Math.floor(worldX / tileSize);
    const clickedCellY = Math.floor(worldY / tileSize);
    for (const generator of snapshot.generators) {
      if (generator.x === clickedCellX && generator.y === clickedCellY) {
        return { id: generator.id };
      }
    }

    const radius = tileSize * 0.8;
    const radiusSq = radius * radius;

    let best: { id: string; distSq: number } | null = null;
    for (const generator of snapshot.generators) {
      const centerX = (generator.x + 0.5) * tileSize;
      const centerY = (generator.y + 0.5) * tileSize;
      const dx = centerX - worldX;
      const dy = centerY - worldY;
      const distSq = dx * dx + dy * dy;
      if (distSq > radiusSq) continue;
      if (!best || distSq < best.distSq) {
        best = { id: generator.id, distSq };
      }
    }

    return best ? { id: best.id } : null;
  }

  private updateHover(screenX: number, screenY: number): void {
    if (this.options.isMapOpen()) {
      this.options.setHoverGenerator(null);
      return;
    }

    const snapshot = this.options.getSnapshot();
    const tileSize = this.options.getTileSize();
    const world = this.options.camera.screenToWorldPx(screenX, screenY);
    const picked = this.pickGenerator(snapshot, world.x, world.y, tileSize);
    if (!picked) {
      this.options.setHoverGenerator(null);
      return;
    }

    this.options.setHoverGenerator({
      generatorId: picked.id,
      screenX,
      screenY,
    });
  }

  private pickLine(
    snapshot: WorldSnapshot,
    worldX: number,
    worldY: number,
    tileSize: number,
  ): { id: string } | null {
    const threshold = Math.max(8, tileSize * 0.28);
    const thresholdSq = threshold * threshold;
    const myPlayerId = snapshot.myPlayerId;
    if (!myPlayerId) return null;

    let best: { id: string; distSq: number } | null = null;
    for (const line of snapshot.lines) {
      if (line.ownerPlayerId !== myPlayerId) continue;
      const ax = (line.aX + 0.5) * tileSize;
      const ay = (line.aY + 0.5) * tileSize;
      const bx = (line.bX + 0.5) * tileSize;
      const by = (line.bY + 0.5) * tileSize;
      const distSq = pointToSegmentDistanceSq(worldX, worldY, ax, ay, bx, by);
      if (distSq > thresholdSq) continue;
      if (!best || distSq < best.distSq) {
        best = { id: line.id, distSq };
      }
    }

    return best ? { id: best.id } : null;
  }

  private toCanvasPoint(event: MouseEvent | PointerEvent): { x: number; y: number } {
    const rect = this.options.canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }
}

function clampBigInt(value: bigint, min: bigint, max: bigint): bigint {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function pointToSegmentDistanceSq(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const abLenSq = abx * abx + aby * aby;
  if (abLenSq <= 0) {
    const dx = px - ax;
    const dy = py - ay;
    return dx * dx + dy * dy;
  }

  let t = (apx * abx + apy * aby) / abLenSq;
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  const qx = ax + abx * t;
  const qy = ay + aby * t;
  const dx = px - qx;
  const dy = py - qy;
  return dx * dx + dy * dy;
}

function makeLineId(playerId: string, aGeneratorId: string, bGeneratorId: string): string {
  const a = aGeneratorId <= bGeneratorId ? aGeneratorId : bGeneratorId;
  const b = aGeneratorId <= bGeneratorId ? bGeneratorId : aGeneratorId;
  return `${playerId}:${a}<->${b}`;
}
