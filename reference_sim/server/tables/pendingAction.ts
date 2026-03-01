export interface MovePayload {
  dx: number;
  dy: number;
}

export interface PendingAction {
  id: string;
  tick: number;
  playerId: string;
  seq: number;
  type: string;
  payload: unknown;
}

export interface ClientActionEnvelope {
  type: string;
  tick: number;
  seq: number;
  payload: unknown;
}
