import { Assets, Rectangle, Texture } from "pixi.js";

const textures = new Map<string, Texture>();
let loaded = false;
let junkTextureCount = 0;

const generatorSheetUrl = new URL("../assets/generators_spritesheet.png", import.meta.url).href;
const junkSheetUrl = new URL("../assets/junks_spritesheet.png", import.meta.url).href;
const playerUrl = new URL("../assets/player.png", import.meta.url).href;
const obstacleUrl = new URL("../assets/obstacle.png", import.meta.url).href;
const cursorUrl = new URL("../assets/cursor.png", import.meta.url).href;
const groundUrl = new URL("../assets/tile.png", import.meta.url).href;

type FrameRect = { x: number; y: number; w: number; h: number };

const GENERATOR_FRAMES: Record<string, FrameRect> = {
  gen_neutral: { x: 304, y: 157, w: 376, h: 323 },
  gen_controlled: { x: 825, y: 157, w: 410, h: 323 },
  gen_isolated: { x: 304, y: 537, w: 376, h: 334 },
  gen_connected: { x: 825, y: 537, w: 410, h: 334 },
};

const JUNK_COLS = [
  { x: 241, w: 241 },
  { x: 527, w: 211 },
  { x: 785, w: 236 },
  { x: 1056, w: 234 },
];

const JUNK_ROWS = [
  { y: 116, h: 158 },
  { y: 395, h: 144 },
  { y: 641, h: 215 },
];

const PLAYER_FRAME: FrameRect = { x: 316, y: 257, w: 402, h: 474 };
const OBSTACLE_FRAME: FrameRect = { x: 206, y: 255, w: 622, h: 451 };
const TARGET_FRAME: FrameRect = { x: 541, y: 280, w: 452, h: 413 };
const GROUND_FRAME: FrameRect = { x: 379, y: 106, w: 777, h: 782 };

function setNearest(texture: Texture): void {
  texture.source.scaleMode = "nearest";
}

function makeSubTexture(base: Texture, frame: FrameRect): Texture {
  const texture = new Texture({
    source: base.source,
    frame: new Rectangle(frame.x, frame.y, frame.w, frame.h),
  });
  setNearest(texture);
  return texture;
}

function putTexture(key: string, texture: Texture): void {
  setNearest(texture);
  textures.set(key, texture);
}

export async function loadTextures(): Promise<void> {
  if (loaded) return;

  const generatorSheet = await Assets.load<Texture>(generatorSheetUrl);
  for (const [key, frame] of Object.entries(GENERATOR_FRAMES)) {
    putTexture(key, makeSubTexture(generatorSheet, frame));
  }

  const junkSheet = await Assets.load<Texture>(junkSheetUrl);
  junkTextureCount = 0;
  for (const row of JUNK_ROWS) {
    for (const col of JUNK_COLS) {
      const key = `junk_${junkTextureCount}`;
      putTexture(
        key,
        makeSubTexture(junkSheet, { x: col.x, y: row.y, w: col.w, h: row.h }),
      );
      junkTextureCount += 1;
    }
  }

  const playerBase = await Assets.load<Texture>(playerUrl);
  putTexture("player", makeSubTexture(playerBase, PLAYER_FRAME));

  const obstacleBase = await Assets.load<Texture>(obstacleUrl);
  putTexture("obstacle", makeSubTexture(obstacleBase, OBSTACLE_FRAME));

  const cursorBase = await Assets.load<Texture>(cursorUrl);
  putTexture("target", makeSubTexture(cursorBase, TARGET_FRAME));
  putTexture("selection", makeSubTexture(cursorBase, TARGET_FRAME));

  const groundBase = await Assets.load<Texture>(groundUrl);
  putTexture("ground", makeSubTexture(groundBase, GROUND_FRAME));

  loaded = true;
}

export function getTexture(key: string): Texture {
  const texture = textures.get(key);
  if (!texture) {
    throw new Error(`Texture '${key}' is not loaded`);
  }
  return texture;
}

export function getJunkTextureCount(): number {
  return junkTextureCount;
}
