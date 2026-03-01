import { Container } from "pixi.js";

export class Camera {
  private zoom = 1;
  private readonly minZoom = 0.4;
  private readonly maxZoom = 3.5;
  private followEnabled = true;

  constructor(private readonly worldContainer: Container) {}

  getZoom(): number {
    return this.zoom;
  }

  isFollowEnabled(): boolean {
    return this.followEnabled;
  }

  setFollowEnabled(enabled: boolean): void {
    this.followEnabled = enabled;
  }

  pan(dx: number, dy: number): void {
    this.worldContainer.position.x += dx;
    this.worldContainer.position.y += dy;
  }

  setZoom(nextZoom: number, anchorScreenX?: number, anchorScreenY?: number): void {
    const clamped = Math.max(this.minZoom, Math.min(this.maxZoom, nextZoom));
    if (clamped === this.zoom) return;

    if (anchorScreenX === undefined || anchorScreenY === undefined) {
      this.zoom = clamped;
      this.worldContainer.scale.set(this.zoom);
      return;
    }

    const before = this.screenToWorldPx(anchorScreenX, anchorScreenY);
    this.zoom = clamped;
    this.worldContainer.scale.set(this.zoom);
    this.worldContainer.position.x = anchorScreenX - before.x * this.zoom;
    this.worldContainer.position.y = anchorScreenY - before.y * this.zoom;
  }

  follow(targetPxX: number, targetPxY: number, viewportW: number, viewportH: number): void {
    if (!this.followEnabled) return;
    this.worldContainer.position.set(
      viewportW * 0.5 - targetPxX * this.zoom,
      viewportH * 0.5 - targetPxY * this.zoom,
    );
  }

  screenToWorldPx(screenX: number, screenY: number): { x: number; y: number } {
    return {
      x: (screenX - this.worldContainer.position.x) / this.zoom,
      y: (screenY - this.worldContainer.position.y) / this.zoom,
    };
  }

  worldPxToCell(worldPxX: number, worldPxY: number, tileSize: number): { cellX: number; cellY: number } {
    return {
      cellX: Math.floor(worldPxX / tileSize),
      cellY: Math.floor(worldPxY / tileSize),
    };
  }
}
