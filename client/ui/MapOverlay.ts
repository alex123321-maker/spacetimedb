import type { WorldSnapshot } from "../net/NetClient";

const FIXED_SCALE = 1000;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function junkColor(kind: number): string {
  const normalized = Math.abs(kind) % 4;
  if (normalized === 0) return "#7f8c8d";
  if (normalized === 1) return "#9b59b6";
  if (normalized === 2) return "#f39c12";
  return "#3498db";
}

function generatorColor(state: string, connected: boolean): string {
  if (state === "controlled" && connected) return "#00b4d8";
  if (state === "controlled") return "#27ae60";
  if (state === "isolated") return "#e67e22";
  return "#95a5a6";
}

export class MapOverlay {
  private readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly canvasWrap: HTMLDivElement;
  private readonly ctx: CanvasRenderingContext2D;
  private open = false;

  constructor(container: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "map-overlay";
    this.root.innerHTML = `
      <div class="map-overlay-card">
        <div class="map-overlay-title">World Map</div>
        <div class="map-overlay-subtitle">M: toggle, Esc: close</div>
        <div class="map-overlay-canvas-wrap"></div>
      </div>
    `;

    container.appendChild(this.root);

    const canvasWrap = this.root.querySelector(".map-overlay-canvas-wrap");
    if (!(canvasWrap instanceof HTMLDivElement)) {
      throw new Error("Failed to create map overlay canvas wrapper");
    }
    this.canvasWrap = canvasWrap;

    this.canvas = document.createElement("canvas");
    this.canvas.className = "map-overlay-canvas";
    this.canvasWrap.appendChild(this.canvas);

    const context = this.canvas.getContext("2d");
    if (!context) {
      throw new Error("2D canvas context is unavailable");
    }
    this.ctx = context;

    window.addEventListener("resize", () => {
      if (this.open) {
        this.resizeCanvas();
      }
    });
  }

  isOpen(): boolean {
    return this.open;
  }

  toggle(): void {
    if (this.open) {
      this.close();
    } else {
      this.openOverlay();
    }
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.root.classList.remove("map-overlay-open");
  }

  render(
    snapshot: WorldSnapshot,
    viewportWorldPx: { x: number; y: number; w: number; h: number },
    tileSizePx: number,
  ): void {
    if (!this.open) return;

    this.resizeCanvas();

    const worldW = Math.max(1, snapshot.worldConfig?.worldWidth ?? 128);
    const worldH = Math.max(1, snapshot.worldConfig?.worldHeight ?? 128);
    const safeTileSize = Math.max(1, tileSizePx || 32);

    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const pad = 20;
    const availW = Math.max(1, width - pad * 2);
    const availH = Math.max(1, height - pad * 2);

    const scale = Math.max(0.5, Math.min(availW / worldW, availH / worldH));
    const mapW = worldW * scale;
    const mapH = worldH * scale;
    const mapX = (width - mapW) * 0.5;
    const mapY = (height - mapH) * 0.5;

    this.ctx.clearRect(0, 0, width, height);
    this.ctx.fillStyle = "#08111a";
    this.ctx.fillRect(0, 0, width, height);

    this.ctx.fillStyle = "#0f1c2b";
    this.ctx.fillRect(mapX, mapY, mapW, mapH);
    this.ctx.strokeStyle = "#5f7f98";
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(mapX, mapY, mapW, mapH);

    const cellSize = Math.max(1, scale);

    this.ctx.fillStyle = "#2f3f52";
    for (const obstacle of snapshot.obstacles) {
      this.ctx.fillRect(
        mapX + obstacle.x * scale,
        mapY + obstacle.y * scale,
        cellSize,
        cellSize,
      );
    }

    for (const junk of snapshot.junk) {
      this.ctx.fillStyle = junkColor(junk.kind);
      this.ctx.fillRect(
        mapX + junk.x * scale,
        mapY + junk.y * scale,
        Math.max(1, scale * 0.8),
        Math.max(1, scale * 0.8),
      );
    }

    this.ctx.lineWidth = Math.max(1, scale * 0.2);
    for (const line of snapshot.lines) {
      this.ctx.strokeStyle = line.active && !line.overheated ? "#8ecae6" : "#e74c3c";
      this.ctx.beginPath();
      this.ctx.moveTo(mapX + (line.aX + 0.5) * scale, mapY + (line.aY + 0.5) * scale);
      this.ctx.lineTo(mapX + (line.bX + 0.5) * scale, mapY + (line.bY + 0.5) * scale);
      this.ctx.stroke();
    }

    for (const generator of snapshot.generators) {
      this.ctx.fillStyle = generatorColor(generator.state, generator.isConnected);
      this.ctx.beginPath();
      this.ctx.arc(
        mapX + (generator.x + 0.5) * scale,
        mapY + (generator.y + 0.5) * scale,
        Math.max(2, scale * 0.4),
        0,
        Math.PI * 2,
      );
      this.ctx.fill();
    }

    for (const player of snapshot.players) {
      const isMe = snapshot.myPlayerId === player.playerId;
      this.ctx.fillStyle = isMe ? "#2ecc71" : "#f1c40f";
      this.ctx.beginPath();
      this.ctx.arc(
        mapX + (Number(player.posX) / FIXED_SCALE) * scale,
        mapY + (Number(player.posY) / FIXED_SCALE) * scale,
        isMe ? Math.max(2.4, scale * 0.34) : Math.max(2, scale * 0.28),
        0,
        Math.PI * 2,
      );
      this.ctx.fill();
    }

    const viewCellX = viewportWorldPx.x / safeTileSize;
    const viewCellY = viewportWorldPx.y / safeTileSize;
    const viewCellW = viewportWorldPx.w / safeTileSize;
    const viewCellH = viewportWorldPx.h / safeTileSize;

    const vx = mapX + viewCellX * scale;
    const vy = mapY + viewCellY * scale;
    const vw = viewCellW * scale;
    const vh = viewCellH * scale;

    const x1 = clamp(vx, mapX, mapX + mapW);
    const y1 = clamp(vy, mapY, mapY + mapH);
    const x2 = clamp(vx + vw, mapX, mapX + mapW);
    const y2 = clamp(vy + vh, mapY, mapY + mapH);

    this.ctx.strokeStyle = "#ffffff";
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(x1, y1, Math.max(1, x2 - x1), Math.max(1, y2 - y1));
  }

  private openOverlay(): void {
    this.open = true;
    this.root.classList.add("map-overlay-open");
    this.resizeCanvas();
  }

  private resizeCanvas(): void {
    const width = Math.max(1, Math.floor(this.canvasWrap.clientWidth));
    const height = Math.max(1, Math.floor(this.canvasWrap.clientHeight));
    const dpr = Math.max(1, window.devicePixelRatio || 1);

    this.canvas.width = Math.floor(width * dpr);
    this.canvas.height = Math.floor(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;

    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
  }
}
