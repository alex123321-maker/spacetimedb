import { Camera } from "./Camera";
import { Selection } from "./Selection";
import { NetClient, type WorldSnapshot } from "../net/NetClient";

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
}

export class Input {
  private pointerDown = false;
  private dragging = false;
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
    canvas.addEventListener("pointerleave", this.onPointerUp);
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === "KeyM") {
      event.preventDefault();
      this.options.toggleMap();
      return;
    }

    if (event.code === "Escape") {
      this.options.closeMap();
    }
  };

  private onPointerDown = (event: PointerEvent): void => {
    if (this.options.isMapOpen()) {
      return;
    }

    const point = this.toCanvasPoint(event);
    this.pointerDown = true;
    this.dragging = false;
    this.lastX = point.x;
    this.lastY = point.y;

    if (event.button === 2) {
      try {
        this.options.net.stopMove();
      } catch (error) {
        console.warn("stopMove failed", error);
      }
      return;
    }
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.pointerDown) return;
    if (this.options.isMapOpen()) return;

    const point = this.toCanvasPoint(event);
    const dx = point.x - this.lastX;
    const dy = point.y - this.lastY;
    this.lastX = point.x;
    this.lastY = point.y;

    if (Math.abs(dx) + Math.abs(dy) > 4) {
      this.dragging = true;
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (!this.pointerDown) return;

    this.pointerDown = false;

    if (this.options.isMapOpen()) {
      return;
    }

    if (event.button !== 0 || this.dragging) {
      return;
    }

    const point = this.toCanvasPoint(event);
    this.handleLeftClick(point.x, point.y);
  };

  private handleLeftClick(screenX: number, screenY: number): void {
    const snapshot = this.options.getSnapshot();
    const tileSize = this.options.getTileSize();
    const world = this.options.camera.screenToWorldPx(screenX, screenY);

    const picked = this.pickGenerator(snapshot, world.x, world.y, tileSize);
    if (picked) {
      this.options.selection.setSelectedGenerator(picked.id);
      return;
    }

    this.options.selection.setSelectedGenerator(null);

    const { cellX, cellY } = this.options.camera.worldPxToCell(world.x, world.y, tileSize);
    let targetX = cellX;
    let targetY = cellY;
    if (snapshot.worldConfig) {
      targetX = Math.max(0, Math.min(snapshot.worldConfig.worldWidth - 1, targetX));
      targetY = Math.max(0, Math.min(snapshot.worldConfig.worldHeight - 1, targetY));
    }

    try {
      this.options.net.setMoveTarget(targetX, targetY);
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
    const radius = tileSize * 0.4;
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

  private toCanvasPoint(event: MouseEvent | PointerEvent): { x: number; y: number } {
    const rect = this.options.canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }
}
