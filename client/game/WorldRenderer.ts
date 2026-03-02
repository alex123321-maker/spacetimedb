import { Application, Graphics, Sprite } from "pixi.js";
import type { Generator } from "../module_bindings/types";
import type { WorldSnapshot } from "../net/NetClient";
import { Layers } from "./Layers";
import { getJunkTextureCount, getTexture } from "./Assets";
import { COLORS, drawLines } from "./Sprites";

const DEFAULT_TILE_SIZE = 32;
const DEFAULT_WORLD_WIDTH = 128;
const DEFAULT_WORLD_HEIGHT = 128;
const FIXED_SCALE = 1000;

export class WorldRenderer {
  readonly layers: Layers;

  private readonly bgGraphics = new Graphics();
  private readonly lineGraphics = new Graphics();

  private readonly obstacleSprites = new Map<string, Sprite>();
  private readonly junkSprites = new Map<string, Sprite>();
  private readonly junkTextureKeys = new Map<string, string>();
  private readonly generatorSprites = new Map<string, Sprite>();
  private readonly generatorGlowSprites = new Map<string, Sprite>();
  private readonly generatorTextureKeys = new Map<string, string>();
  private readonly playerSprites = new Map<string, Sprite>();

  private readonly targetMarker = new Sprite(getTexture("target"));
  private readonly selectionRing = new Sprite(getTexture("selection"));

  private lastBgKey = "";

  constructor(private readonly app: Application) {
    this.layers = new Layers();
    this.app.stage.addChild(this.layers.worldContainer);

    this.layers.bgLayer.addChild(this.bgGraphics);
    this.layers.lineLayer.addChild(this.lineGraphics);

    this.targetMarker.anchor.set(0.5);
    this.targetMarker.tint = 0xffb85c;
    this.targetMarker.visible = false;
    this.layers.overlayLayer.addChild(this.targetMarker);

    this.selectionRing.anchor.set(0.5);
    this.selectionRing.tint = 0xaee8ff;
    this.selectionRing.visible = false;
    this.layers.overlayLayer.addChild(this.selectionRing);
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
    }

    this.syncObstacles(snapshot, tileSize);
    this.syncJunk(snapshot, tileSize);
    this.drawGenerators(snapshot, tileSize);
    this.drawPlayers(snapshot, tileSize, interpolatedPlayerPx);
    drawLines(
      this.lineGraphics,
      snapshot.lines,
      new Map(snapshot.generators.map((generator) => [generator.id, generator])),
      tileSize,
    );
    this.updateTargetMarker(snapshot, tileSize);
    this.updateSelectionRing(snapshot, selectedGeneratorId, tileSize);
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

  private syncObstacles(snapshot: WorldSnapshot, tileSize: number): void {
    const live = new Set<string>();

    for (const obstacle of snapshot.obstacles) {
      live.add(obstacle.id);

      let sprite = this.obstacleSprites.get(obstacle.id);
      if (!sprite) {
        sprite = new Sprite(getTexture("obstacle"));
        sprite.anchor.set(0.5);
        this.obstacleSprites.set(obstacle.id, sprite);
        this.layers.obstacleLayer.addChild(sprite);
      }

      this.fitSpriteToTile(sprite, tileSize);
      sprite.position.set(
        (obstacle.x + 0.5) * tileSize,
        (obstacle.y + 0.5) * tileSize,
      );
    }

    for (const [obstacleId, sprite] of this.obstacleSprites.entries()) {
      if (live.has(obstacleId)) continue;
      this.layers.obstacleLayer.removeChild(sprite);
      this.obstacleSprites.delete(obstacleId);
      sprite.destroy();
    }
  }

  private syncJunk(snapshot: WorldSnapshot, tileSize: number): void {
    const live = new Set<string>();
    const junkTextureCount = Math.max(1, getJunkTextureCount());

    for (const junk of snapshot.junk) {
      live.add(junk.id);

      const textureKey = `junk_${Math.abs(junk.kind) % junkTextureCount}`;
      let sprite = this.junkSprites.get(junk.id);
      if (!sprite) {
        sprite = new Sprite(getTexture(textureKey));
        sprite.anchor.set(0.5);
        this.junkSprites.set(junk.id, sprite);
        this.junkTextureKeys.set(junk.id, textureKey);
        this.layers.junkLayer.addChild(sprite);
      } else if (this.junkTextureKeys.get(junk.id) !== textureKey) {
        sprite.texture = getTexture(textureKey);
        this.junkTextureKeys.set(junk.id, textureKey);
      }

      this.fitSpriteToTile(sprite, tileSize);
      sprite.position.set((junk.x + 0.5) * tileSize, (junk.y + 0.5) * tileSize);
    }

    for (const [junkId, sprite] of this.junkSprites.entries()) {
      if (live.has(junkId)) continue;
      this.layers.junkLayer.removeChild(sprite);
      this.junkSprites.delete(junkId);
      this.junkTextureKeys.delete(junkId);
      sprite.destroy();
    }
  }

  private drawGenerators(snapshot: WorldSnapshot, tileSize: number): void {
    const live = new Set<string>();

    for (const generator of snapshot.generators) {
      live.add(generator.id);

      const textureKey = this.getGeneratorTextureKey(generator);
      let sprite = this.generatorSprites.get(generator.id);
      if (!sprite) {
        sprite = new Sprite(getTexture(textureKey));
        sprite.anchor.set(0.5);
        this.generatorSprites.set(generator.id, sprite);
        this.generatorTextureKeys.set(generator.id, textureKey);
        this.layers.generatorLayer.addChild(sprite);
      } else if (this.generatorTextureKeys.get(generator.id) !== textureKey) {
        sprite.texture = getTexture(textureKey);
        this.generatorTextureKeys.set(generator.id, textureKey);
      }

      let glow = this.generatorGlowSprites.get(generator.id);
      if (generator.isConnected) {
        if (!glow) {
          glow = new Sprite(getTexture("selection"));
          glow.anchor.set(0.5);
          glow.tint = 0x77ffb0;
          glow.alpha = 0.35;
          this.generatorGlowSprites.set(generator.id, glow);
          this.layers.generatorLayer.addChild(glow);
        }
        this.fitSpriteToTile(glow, tileSize, 1.45);
        glow.position.set(
          (generator.x + 0.5) * tileSize,
          (generator.y + 0.5) * tileSize,
        );
      } else if (glow) {
        this.layers.generatorLayer.removeChild(glow);
        this.generatorGlowSprites.delete(generator.id);
        glow.destroy();
      }

      this.fitSpriteToTile(sprite, tileSize);
      sprite.position.set(
        (generator.x + 0.5) * tileSize,
        (generator.y + 0.5) * tileSize,
      );
    }

    for (const [generatorId, sprite] of this.generatorSprites.entries()) {
      if (live.has(generatorId)) continue;
      this.layers.generatorLayer.removeChild(sprite);
      this.generatorSprites.delete(generatorId);
      this.generatorTextureKeys.delete(generatorId);
      sprite.destroy();

      const glow = this.generatorGlowSprites.get(generatorId);
      if (glow) {
        this.layers.generatorLayer.removeChild(glow);
        this.generatorGlowSprites.delete(generatorId);
        glow.destroy();
      }
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
        sprite = new Sprite(getTexture("player"));
        sprite.anchor.set(0.5);
        this.playerSprites.set(player.playerId, sprite);
        this.layers.playerLayer.addChild(sprite);
      }

      const interpolated = interpolatedPlayerPx.get(player.playerId);
      const fallbackX = (Number(player.posX) / FIXED_SCALE) * tileSize;
      const fallbackY = (Number(player.posY) / FIXED_SCALE) * tileSize;
      const positionX = interpolated?.x ?? fallbackX;
      const positionY = interpolated?.y ?? fallbackY;
      this.fitSpriteToTile(sprite, tileSize);
      sprite.position.set(positionX + tileSize * 0.5, positionY + tileSize * 0.5);
    }

    for (const [playerId, sprite] of this.playerSprites.entries()) {
      if (live.has(playerId)) continue;
      this.layers.playerLayer.removeChild(sprite);
      this.playerSprites.delete(playerId);
      sprite.destroy();
    }
  }

  private getGeneratorTextureKey(generator: Generator): string {
    if (generator.isConnected) return "gen_connected";
    if (generator.state === "controlled") return "gen_controlled";
    if (generator.state === "isolated") return "gen_isolated";
    return "gen_neutral";
  }

  private updateTargetMarker(snapshot: WorldSnapshot, tileSize: number): void {
    const myPlayer = snapshot.myPlayerId
      ? snapshot.players.find((player) => player.playerId === snapshot.myPlayerId) ?? null
      : null;

    if (!myPlayer || !myPlayer.moving) {
      this.targetMarker.visible = false;
      return;
    }

    this.targetMarker.visible = true;
    this.fitSpriteToTile(this.targetMarker, tileSize, 1.1);
    this.targetMarker.position.set(
      (Number(myPlayer.targetPosX) / FIXED_SCALE) * tileSize + tileSize * 0.5,
      (Number(myPlayer.targetPosY) / FIXED_SCALE) * tileSize + tileSize * 0.5,
    );
  }

  private updateSelectionRing(
    snapshot: WorldSnapshot,
    selectedGeneratorId: string | null,
    tileSize: number,
  ): void {
    if (!selectedGeneratorId) {
      this.selectionRing.visible = false;
      return;
    }

    const selected = snapshot.generators.find((generator) => generator.id === selectedGeneratorId);
    if (!selected) {
      this.selectionRing.visible = false;
      return;
    }

    this.selectionRing.visible = true;
    this.fitSpriteToTile(this.selectionRing, tileSize, 1.15);
    this.selectionRing.position.set(
      (selected.x + 0.5) * tileSize,
      (selected.y + 0.5) * tileSize,
    );
  }

  private fitSpriteToTile(sprite: Sprite, tileSize: number, multiplier = 1): void {
    const baseSize = Math.max(1, Math.max(sprite.texture.width, sprite.texture.height));
    const scale = (tileSize / baseSize) * multiplier;
    sprite.scale.set(scale);
  }
}
