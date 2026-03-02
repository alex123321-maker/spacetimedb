import { Application } from "pixi.js";
import { Camera } from "./Camera";
import { Input } from "./Input";
import { Interpolation } from "./Interpolation";
import { Selection } from "./Selection";
import { WorldRenderer } from "./WorldRenderer";
import { loadTextures } from "./Assets";
import { NetClient, type WorldSnapshot } from "../net/NetClient";
import { Hud } from "../ui/Hud";
import { MapOverlay } from "../ui/MapOverlay";

const FIXED_SCALE = 1000;

interface GameAppOptions {
  mount: HTMLElement;
  net: NetClient;
}

export class GameApp {
  private readonly net: NetClient;
  private readonly mount: HTMLElement;

  private app!: Application;
  private renderer!: WorldRenderer;
  private camera!: Camera;
  private interpolation!: Interpolation;
  private selection!: Selection;
  private hud!: Hud;
  private mapOverlay!: MapOverlay;
  private input!: Input;

  private snapshot: WorldSnapshot;
  private lastServerTick = 0;
  private lastServerTickAtMs = performance.now();

  private constructor(options: GameAppOptions) {
    this.net = options.net;
    this.mount = options.mount;
    this.snapshot = this.net.getSnapshot();
  }

  static async create(options: GameAppOptions): Promise<GameApp> {
    const app = new GameApp(options);
    await app.init();
    return app;
  }

  private async init(): Promise<void> {
    this.mount.innerHTML = `
      <div class="client-shell">
        <div class="canvas-wrap" id="canvas-wrap"></div>
        <div id="hud-wrap"></div>
      </div>
    `;

    const canvasWrap = this.mount.querySelector("#canvas-wrap");
    const hudWrap = this.mount.querySelector("#hud-wrap");
    if (!(canvasWrap instanceof HTMLElement) || !(hudWrap instanceof HTMLElement)) {
      throw new Error("Failed to create client shell");
    }

    this.app = new Application();
    await this.app.init({
      background: "#050b11",
      antialias: true,
      resizeTo: window,
      resolution: Math.max(1, window.devicePixelRatio || 1),
      autoDensity: true,
    });
    canvasWrap.appendChild(this.app.canvas);

    await loadTextures();
    this.renderer = new WorldRenderer(this.app);
    this.camera = new Camera(this.renderer.layers.worldContainer);
    this.interpolation = new Interpolation();
    this.selection = new Selection();
    this.hud = new Hud(hudWrap, this.net, this.selection);
    this.mapOverlay = new MapOverlay(this.mount);

    this.input = new Input({
      canvas: this.app.canvas,
      camera: this.camera,
      net: this.net,
      selection: this.selection,
      getSnapshot: () => this.snapshot,
      getTileSize: () => this.renderer.getTileSize(this.snapshot),
      isMapOpen: () => this.mapOverlay.isOpen(),
      toggleMap: () => this.mapOverlay.toggle(),
      closeMap: () => this.mapOverlay.close(),
      setHoverGenerator: (payload) => this.hud.setHoverGenerator(payload),
    });

    this.net.onStoreChanged(() => {
      this.snapshot = this.net.getSnapshot();
      this.hud.render(this.snapshot);
    });

    this.selection.onChange(() => {
      this.hud.render(this.snapshot);
    });

    this.hud.render(this.snapshot);

    this.app.ticker.add(() => {
      this.renderFrame();
    });
  }

  private renderFrame(): void {
    const snapshot = this.snapshot;
    const tileSize = this.renderer.getTileSize(snapshot);
    const worldWidthCells = snapshot.worldConfig?.worldWidth ?? 128;
    const worldHeightCells = snapshot.worldConfig?.worldHeight ?? 128;
    const worldWidthPx = worldWidthCells * tileSize;
    const worldHeightPx = worldHeightCells * tileSize;

    this.camera.setViewportSize(this.app.screen.width, this.app.screen.height);

    this.interpolation.update(snapshot.players, tileSize);

    const renderTick = this.computeRenderTick(snapshot);
    const interpolated = new Map<string, { x: number; y: number }>();

    for (const player of snapshot.players) {
      const pos = this.interpolation.getInterpolatedPx(player.playerId, renderTick);
      if (!pos) continue;
      interpolated.set(player.playerId, pos);
    }

    const myPlayer = snapshot.myPlayerId
      ? snapshot.players.find((player) => player.playerId === snapshot.myPlayerId) ?? null
      : null;

    if (myPlayer) {
      const p = interpolated.get(myPlayer.playerId);
      const px = p?.x ?? (Number(myPlayer.posX) / FIXED_SCALE) * tileSize;
      const py = p?.y ?? (Number(myPlayer.posY) / FIXED_SCALE) * tileSize;
      this.camera.updateFollow(
        px + tileSize * 0.5,
        py + tileSize * 0.5,
        worldWidthPx,
        worldHeightPx,
      );
    }

    this.renderer.render(snapshot, interpolated, this.selection.selectedGeneratorId);
    this.mapOverlay.render(snapshot, this.camera.getViewRectWorldPx(), tileSize);
  }

  private computeRenderTick(snapshot: WorldSnapshot): number {
    const serverTick = Number(snapshot.worldState?.currentTick ?? 0n);
    const tickRate = Number(snapshot.worldState?.tickRate ?? 20);
    const now = performance.now();

    if (serverTick !== this.lastServerTick) {
      this.lastServerTick = serverTick;
      this.lastServerTickAtMs = now;
    }

    const tickDurationMs = 1000 / Math.max(1, tickRate);
    const elapsed = Math.max(0, now - this.lastServerTickAtMs);
    const alpha = Math.min(1, elapsed / tickDurationMs);
    return this.lastServerTick + alpha;
  }
}
