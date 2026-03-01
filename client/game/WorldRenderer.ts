import { Application, Graphics } from "pixi.js";
import type { WorldSnapshot } from "../net/NetClient";
import { Layers } from "./Layers";
import {
  COLORS,
  drawGenerator,
  drawLines,
  drawPlayer,
  getJunkColor,
} from "./Sprites";

const DEFAULT_TILE_SIZE = 32;
const DEFAULT_WORLD_WIDTH = 128;
const DEFAULT_WORLD_HEIGHT = 128;
const FIXED_SCALE = 1000;

export class WorldRenderer {
  readonly layers: Layers;

  private readonly bgGraphics = new Graphics();
  private readonly obstacleGraphics = new Graphics();
  private readonly junkGraphics = new Graphics();
  private readonly lineGraphics = new Graphics();

  private readonly generatorSprites = new Map<string, Graphics>();
  private readonly playerSprites = new Map<string, Graphics>();
  private readonly playerSelfState = new Map<string, boolean>();

  private lastBgKey = "";
  private lastObstacleVersion = -1;
  private lastJunkVersion = -1;
  private lastTileSize = -1;

  constructor(private readonly app: Application) {
    this.layers = new Layers();
    this.app.stage.addChild(this.layers.worldContainer);

    this.layers.bgLayer.addChild(this.bgGraphics);
    this.layers.obstacleLayer.addChild(this.obstacleGraphics);
    this.layers.junkLayer.addChild(this.junkGraphics);
    this.layers.lineLayer.addChild(this.lineGraphics);
  }

  getTileSize(snapshot: WorldSnapshot): number {
    return snapshot.worldConfig?.tileSizePx ?? DEFAULT_TILE_SIZE;
  }

  render(
    snapshot: WorldSnapshot,
    interpolatedPlayerPx: Map<string, { x: number; y: number }>,
    selectedGeneratorId: string | null,
  ): void {
    const tileSize = this.getTileSize(snapshot);
    const worldWidth = snapshot.worldConfig?.worldWidth ?? DEFAULT_WORLD_WIDTH;
    const worldHeight = snapshot.worldConfig?.worldHeight ?? DEFAULT_WORLD_HEIGHT;

    const bgKey = `${worldWidth}:${worldHeight}:${tileSize}`;
    if (bgKey !== this.lastBgKey) {
      this.drawBackground(worldWidth, worldHeight, tileSize);
      this.lastBgKey = bgKey;
      this.lastTileSize = tileSize;
      this.lastObstacleVersion = -1;
      this.lastJunkVersion = -1;
    }

    if (this.lastObstacleVersion !== snapshot.versions.obstacle || this.lastTileSize !== tileSize) {
      this.drawObstacles(snapshot, tileSize);
      this.lastObstacleVersion = snapshot.versions.obstacle;
    }

    if (this.lastJunkVersion !== snapshot.versions.junk || this.lastTileSize !== tileSize) {
      this.drawJunk(snapshot, tileSize);
      this.lastJunkVersion = snapshot.versions.junk;
    }

    this.drawGenerators(snapshot, tileSize, selectedGeneratorId);
    this.drawPlayers(snapshot, tileSize, interpolatedPlayerPx);
    drawLines(
      this.lineGraphics,
      snapshot.lines,
      new Map(snapshot.generators.map((generator) => [generator.id, generator])),
      tileSize,
    );
  }

  private drawBackground(worldWidth: number, worldHeight: number, tileSize: number): void {
    const widthPx = worldWidth * tileSize;
    const heightPx = worldHeight * tileSize;

    this.bgGraphics.clear();
    this.bgGraphics.rect(0, 0, widthPx, heightPx).fill({ color: COLORS.background });

    for (let x = 0; x <= worldWidth; x += 1) {
      const px = x * tileSize;
      this.bgGraphics.moveTo(px, 0).lineTo(px, heightPx).stroke({
        color: COLORS.grid,
        width: 1,
        alpha: 0.35,
      });
    }

    for (let y = 0; y <= worldHeight; y += 1) {
      const py = y * tileSize;
      this.bgGraphics.moveTo(0, py).lineTo(widthPx, py).stroke({
        color: COLORS.grid,
        width: 1,
        alpha: 0.35,
      });
    }
  }

  private drawObstacles(snapshot: WorldSnapshot, tileSize: number): void {
    this.obstacleGraphics.clear();
    for (const obstacle of snapshot.obstacles) {
      this.obstacleGraphics
        .rect(obstacle.x * tileSize, obstacle.y * tileSize, tileSize, tileSize)
        .fill({ color: COLORS.obstacle });
    }
  }

  private drawJunk(snapshot: WorldSnapshot, tileSize: number): void {
    this.junkGraphics.clear();
    const pad = tileSize * 0.24;
    const size = tileSize - pad * 2;
    for (const junk of snapshot.junk) {
      this.junkGraphics
        .rect(junk.x * tileSize + pad, junk.y * tileSize + pad, size, size)
        .fill({ color: getJunkColor(junk.kind) });
    }
  }

  private drawGenerators(
    snapshot: WorldSnapshot,
    tileSize: number,
    selectedGeneratorId: string | null,
  ): void {
    const live = new Set<string>();

    for (const generator of snapshot.generators) {
      live.add(generator.id);

      let sprite = this.generatorSprites.get(generator.id);
      if (!sprite) {
        sprite = new Graphics();
        this.generatorSprites.set(generator.id, sprite);
        this.layers.generatorLayer.addChild(sprite);
      }

      drawGenerator(sprite, tileSize, generator, selectedGeneratorId === generator.id);
      sprite.position.set(generator.x * tileSize, generator.y * tileSize);
    }

    for (const [generatorId, sprite] of this.generatorSprites.entries()) {
      if (live.has(generatorId)) continue;
      this.layers.generatorLayer.removeChild(sprite);
      this.generatorSprites.delete(generatorId);
      sprite.destroy();
    }
  }

  private drawPlayers(
    snapshot: WorldSnapshot,
    tileSize: number,
    interpolatedPlayerPx: Map<string, { x: number; y: number }>,
  ): void {
    const live = new Set<string>();

    for (const player of snapshot.players) {
      live.add(player.playerId);

      let sprite = this.playerSprites.get(player.playerId);
      if (!sprite) {
        sprite = new Graphics();
        this.playerSprites.set(player.playerId, sprite);
        this.layers.playerLayer.addChild(sprite);
      }

      const isSelf = snapshot.myPlayerId === player.playerId;
      const lastSelfState = this.playerSelfState.get(player.playerId);
      if (lastSelfState !== isSelf || this.lastTileSize !== tileSize) {
        drawPlayer(sprite, tileSize, isSelf);
        this.playerSelfState.set(player.playerId, isSelf);
      }

      const interpolated = interpolatedPlayerPx.get(player.playerId);
      const fallbackX = (Number(player.posX) / FIXED_SCALE) * tileSize;
      const fallbackY = (Number(player.posY) / FIXED_SCALE) * tileSize;
      const positionX = interpolated?.x ?? fallbackX;
      const positionY = interpolated?.y ?? fallbackY;
      sprite.position.set(positionX, positionY);
    }

    for (const [playerId, sprite] of this.playerSprites.entries()) {
      if (live.has(playerId)) continue;
      this.layers.playerLayer.removeChild(sprite);
      this.playerSprites.delete(playerId);
      this.playerSelfState.delete(playerId);
      sprite.destroy();
    }
  }
}
