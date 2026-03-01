import { toFloat } from "../shared/fixed";
import { SpacetimeClient } from "./network";
import { mapInputToMove, renderObstacleMap, toCell } from "./ui";

const client = new SpacetimeClient();

function renderPosition(x: bigint, y: bigint): void {
  const el = document.getElementById("player-pos");
  if (!el) return;
  el.textContent = `x=${toFloat(Number(x)).toFixed(3)} y=${toFloat(Number(y)).toFixed(3)}`;
}

function renderObstacles(x: bigint, y: bigint): void {
  const cellX = toCell(x);
  const cellY = toCell(y);
  const map = renderObstacleMap(cellX, cellY, client.getObstacles());

  let el = document.getElementById("obstacles-map");
  if (!el) {
    el = document.createElement("pre");
    el.id = "obstacles-map";
    document.body.appendChild(el);
  }
  el.textContent = `obstacles around player (11x11):\n${map}`;
}

client.connect((player) => {
  renderPosition(player.posX, player.posY);
  renderObstacles(player.posX, player.posY);
});

window.addEventListener("keydown", (event) => {
  const move = mapInputToMove(event.key);
  if (!move) return;
  client.sendMove(move);
});
