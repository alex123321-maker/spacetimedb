import { Container } from "pixi.js";

export class Layers {
  readonly worldContainer = new Container();
  readonly bgLayer = new Container();
  readonly junkLayer = new Container();
  readonly obstacleLayer = new Container();
  readonly lineLayer = new Container();
  readonly generatorLayer = new Container();
  readonly playerLayer = new Container();
  readonly overlayLayer = new Container();

  constructor() {
    this.worldContainer.addChild(this.bgLayer);
    this.worldContainer.addChild(this.junkLayer);
    this.worldContainer.addChild(this.obstacleLayer);
    this.worldContainer.addChild(this.lineLayer);
    this.worldContainer.addChild(this.generatorLayer);
    this.worldContainer.addChild(this.playerLayer);
    this.worldContainer.addChild(this.overlayLayer);
  }
}
