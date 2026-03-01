import type { Fixed } from "../../shared/fixed";

export interface Player {
  playerId: string;
  posX: Fixed;
  posY: Fixed;
  lastProcessedTick: number;
}
