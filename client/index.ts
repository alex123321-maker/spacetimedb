import { toFloat } from "../shared/fixed";
import { SpacetimeClient } from "./network";
import {
  mapInputToMove,
  renderGeneratorsList,
  renderSpawnMarkersList,
  renderWorldMap,
  toCell
} from "./ui";

const client = new SpacetimeClient();

function ensurePre(id: string): HTMLElement {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement("pre");
    el.id = id;
    document.body.appendChild(el);
  }
  return el;
}

function renderPosition(x: bigint, y: bigint): void {
  const el = document.getElementById("player-pos");
  if (!el) return;
  el.textContent = `x=${toFloat(Number(x)).toFixed(3)} y=${toFloat(Number(y)).toFixed(3)}`;
}

function renderWorldState(playerX: bigint, playerY: bigint): void {
  const cellX = toCell(playerX);
  const cellY = toCell(playerY);
  const currentTick = client.getCurrentTick();
  const obstacles = client.getObstacles();
  const markers = client.getSpawnMarkers();
  const generators = client.getGenerators();

  const map = renderWorldMap(cellX, cellY, obstacles, markers, generators);
  ensurePre("world-map").textContent = `world map (11x11):\n${map}`;

  const generatorsText = renderGeneratorsList(generators, currentTick);
  const markersText = renderSpawnMarkersList(markers);
  ensurePre("world-entities").textContent = `${generatorsText}\n\n${markersText}`;
}

client.connect((player) => {
  renderPosition(player.posX, player.posY);
  renderWorldState(player.posX, player.posY);
});

window.addEventListener("keydown", (event) => {
  const move = mapInputToMove(event.key);
  if (!move) return;
  client.sendMove(move);
});
