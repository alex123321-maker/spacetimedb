import { toFloat } from "../shared/fixed";
import { SpacetimeClient } from "./network";
import { mapInputToMove } from "./ui";

const client = new SpacetimeClient();

function renderPosition(x: bigint, y: bigint): void {
  const el = document.getElementById("player-pos");
  if (!el) return;
  el.textContent = `x=${toFloat(Number(x)).toFixed(3)} y=${toFloat(Number(y)).toFixed(3)}`;
}

client.connect((player) => {
  renderPosition(player.posX, player.posY);
});

window.addEventListener("keydown", (event) => {
  const move = mapInputToMove(event.key);
  if (!move) return;
  client.sendMove(move);
});
