import type { GameServer } from "../server/index";
import { LocalRealtimeClient } from "./network";
import { mapInputToMove } from "./ui";

export interface ClientApp {
  playerId: string;
  client: LocalRealtimeClient;
  handleInput: (input: string) => void;
  dispose: () => void;
}

export function bootClient(server: GameServer): ClientApp {
  const client = new LocalRealtimeClient();
  const playerId = client.connect(server);
  const unsubscribe = client.subscribeToOwnPlayer(() => {
    // UI rendering hook: real app updates local scene here.
  });

  return {
    playerId,
    client,
    handleInput(input: string): void {
      const move = mapInputToMove(input);
      if (!move) return;
      client.sendMove(move);
    },
    dispose(): void {
      unsubscribe();
    }
  };
}
