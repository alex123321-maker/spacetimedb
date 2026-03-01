import { SpacetimeClient } from "./network";
import "./styles.css";
import {
  mapInputToMove,
  renderGeneratorsList,
  renderPlayersList,
  renderSpawnMarkersList,
  renderWorldMap,
  toPlayerCell
} from "./ui";

const client = new SpacetimeClient();

const app = document.getElementById("app");
if (!app) {
  throw new Error("Missing #app root element");
}

app.innerHTML = `
  <main class="layout">
    <section class="panel">
      <h1>Continuum Grid Client</h1>
      <p class="help">Move: WASD / Arrow keys. Open this page in two browser profiles to test multiplayer visibility.</p>
      <div id="status">Connecting...</div>
      <div id="tick">tick: 0</div>
    </section>
    <section class="panel">
      <h2>World Map</h2>
      <pre id="world-map"></pre>
      <p class="legend">Legend: P = you, p = other player, G = generator, ? = spawn marker, # = obstacle</p>
    </section>
    <section class="panel">
      <h2>Players</h2>
      <pre id="players-list"></pre>
    </section>
    <section class="panel">
      <h2>Generators</h2>
      <pre id="generators-list"></pre>
    </section>
    <section class="panel">
      <h2>Spawn Markers</h2>
      <pre id="markers-list"></pre>
    </section>
  </main>
`;

function setText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
}

function render(): void {
  const ownId = client.getOwnPlayerId();
  const currentTick = client.getCurrentTick();
  const players = client
    .getPlayers()
    .map((player) => toPlayerCell(player.playerId, player.posX, player.posY, ownId));
  const me = players.find((player) => player.isSelf);

  setText("status", ownId ? `connected as ${ownId}` : "connected");
  setText("tick", `tick: ${currentTick}`);
  setText("players-list", renderPlayersList(players));
  setText("generators-list", renderGeneratorsList(client.getGenerators(), currentTick));
  setText("markers-list", renderSpawnMarkersList(client.getSpawnMarkers()));

  if (me) {
    setText(
      "world-map",
      renderWorldMap(
        me.x,
        me.y,
        client.getObstacles(),
        client.getSpawnMarkers(),
        client.getGenerators(),
        players
      )
    );
  } else {
    setText("world-map", "Waiting for own player row...");
  }
}

client.connect(() => {
  render();
});

window.addEventListener("keydown", (event) => {
  const move = mapInputToMove(event.key);
  if (!move) return;
  event.preventDefault();
  client.sendMove(move);
});
