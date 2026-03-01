import { Container } from "pixi.js";

const DEAD_ZONE_W_FRAC = 0.35;
const DEAD_ZONE_H_FRAC = 0.3;
const FOLLOW_SMOOTHING = 0.12;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export class Camera {
  private viewportW = 1;
  private viewportH = 1;
  private camCenterX = 0;
  private camCenterY = 0;

  constructor(private readonly worldContainer: Container) {
    this.worldContainer.scale.set(1);
  }

  setViewportSize(widthPx: number, heightPx: number): void {
    this.viewportW = Math.max(1, widthPx);
    this.viewportH = Math.max(1, heightPx);
  }

  updateFollow(
    targetWorldPxX: number,
    targetWorldPxY: number,
    worldPxWidth: number,
    worldPxHeight: number,
  ): void {
    const safeWorldW = Math.max(1, worldPxWidth);
    const safeWorldH = Math.max(1, worldPxHeight);

    const halfDZx = (this.viewportW * DEAD_ZONE_W_FRAC) * 0.5;
    const halfDZy = (this.viewportH * DEAD_ZONE_H_FRAC) * 0.5;

    const dx = targetWorldPxX - this.camCenterX;
    const dy = targetWorldPxY - this.camCenterY;

    let desiredCenterX = this.camCenterX;
    let desiredCenterY = this.camCenterY;

    if (dx > halfDZx) {
      desiredCenterX = this.camCenterX + (dx - halfDZx);
    } else if (dx < -halfDZx) {
      desiredCenterX = this.camCenterX + (dx + halfDZx);
    }

    if (dy > halfDZy) {
      desiredCenterY = this.camCenterY + (dy - halfDZy);
    } else if (dy < -halfDZy) {
      desiredCenterY = this.camCenterY + (dy + halfDZy);
    }

    this.camCenterX += (desiredCenterX - this.camCenterX) * FOLLOW_SMOOTHING;
    this.camCenterY += (desiredCenterY - this.camCenterY) * FOLLOW_SMOOTHING;

    this.camCenterX = this.clampCenterAxis(this.camCenterX, this.viewportW, safeWorldW);
    this.camCenterY = this.clampCenterAxis(this.camCenterY, this.viewportH, safeWorldH);

    this.worldContainer.position.x = -this.camCenterX + this.viewportW * 0.5;
    this.worldContainer.position.y = -this.camCenterY + this.viewportH * 0.5;
  }

  getViewRectWorldPx(): { x: number; y: number; w: number; h: number } {
    return {
      x: this.camCenterX - this.viewportW * 0.5,
      y: this.camCenterY - this.viewportH * 0.5,
      w: this.viewportW,
      h: this.viewportH,
    };
  }

  screenToWorldPx(screenX: number, screenY: number): { x: number; y: number } {
    return {
      x: screenX - this.worldContainer.position.x,
      y: screenY - this.worldContainer.position.y,
    };
  }

  worldPxToCell(worldPxX: number, worldPxY: number, tileSize: number): { cellX: number; cellY: number } {
    return {
      cellX: Math.floor(worldPxX / tileSize),
      cellY: Math.floor(worldPxY / tileSize),
    };
  }

  private clampCenterAxis(center: number, viewportSize: number, worldSize: number): number {
    if (worldSize <= viewportSize) {
      return worldSize * 0.5;
    }

    const minCenter = viewportSize * 0.5;
    const maxCenter = worldSize - viewportSize * 0.5;
    return clamp(center, minCenter, maxCenter);
  }
}
