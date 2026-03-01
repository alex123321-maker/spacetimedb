import { SpacetimeClient } from "./network";
import "./styles.css";
import {
  mapInputToMove,
  renderGeneratorsList,
  renderLinesList,
  renderPlayersList,
  renderSpawnMarkersList,
  renderWorldMap,
  toPlayerCell
} from "./ui";

const client = new SpacetimeClient();
let selectedLineA = "";
let selectedLineB = "";

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
      <div id="root-status"></div>
      <div id="line-status"></div>
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
      <h2>Root Actions</h2>
      <div id="generator-actions"></div>
    </section>
    <section class="panel">
      <h2>Line Builder</h2>
      <div id="line-builder"></div>
      <pre id="lines-list"></pre>
      <div id="line-actions"></div>
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

function setHtml(id: string, html: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = html;
}

function renderRootStatus(
  ownId: string | null,
  currentTick: number,
  rootGeneratorId: string,
  rootMoveAvailableAtTick: bigint
): void {
  if (!ownId) {
    setText("root-status", "root: waiting for identity...");
    return;
  }

  const relocation = client
    .getRootRelocations()
    .find((item) => item.playerId === ownId);

  const now = BigInt(currentTick);
  const cooldownLeft =
    rootMoveAvailableAtTick > now ? rootMoveAvailableAtTick - now : 0n;

  if (relocation) {
    const finishIn =
      relocation.finishTick > now ? relocation.finishTick - now : 0n;
    setText(
      "root-status",
      `root=${rootGeneratorId || "none"} | relocating ${relocation.fromGeneratorId} -> ${relocation.toGeneratorId} | finishesIn=${finishIn.toString()} ticks | cooldownLeft=${cooldownLeft.toString()} ticks`
    );
    return;
  }

  setText(
    "root-status",
    `root=${rootGeneratorId || "none"} | cooldownLeft=${cooldownLeft.toString()} ticks`
  );
}

function renderGeneratorActions(ownId: string | null): void {
  const generators = client.getGenerators();
  if (!ownId || generators.length === 0) {
    setHtml("generator-actions", "<p class=\"help\">No generators available yet.</p>");
    return;
  }

  const rows = generators
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((generator) => {
      const owner = generator.ownerPlayerId || "none";
      return `
        <div class="action-row">
          <code>${generator.id}</code>
          <span>cell=(${generator.x},${generator.y}) state=${generator.state} owner=${owner}</span>
          <button data-action="place-root" data-generator-id="${generator.id}">Place Root</button>
          <button data-action="move-root" data-generator-id="${generator.id}">Move Root</button>
        </div>
      `;
    })
    .join("");

  setHtml("generator-actions", rows);
}

function renderLineControls(ownId: string | null): void {
  if (!ownId) {
    setHtml("line-builder", "<p class=\"help\">Join first to build lines.</p>");
    setHtml("line-actions", "");
    return;
  }

  const generators = client
    .getGenerators()
    .filter(
      (generator) =>
        generator.ownerPlayerId === ownId && generator.state === "controlled"
    )
    .sort((a, b) => a.id.localeCompare(b.id));

  if (generators.length === 0) {
    setHtml("line-builder", "<p class=\"help\">Need controlled generators to build lines.</p>");
    setHtml("line-actions", "");
    return;
  }

  if (!selectedLineA || !generators.some((generator) => generator.id === selectedLineA)) {
    selectedLineA = generators[0].id;
  }
  if (!selectedLineB || !generators.some((generator) => generator.id === selectedLineB)) {
    selectedLineB = generators[Math.min(1, generators.length - 1)].id;
  }

  const options = generators
    .map(
      (generator) =>
        `<option value="${generator.id}">${generator.id}</option>`
    )
    .join("");

  setHtml(
    "line-builder",
    `
      <div class="line-builder-grid">
        <label>A generator</label>
        <select id="line-a-select">${options}</select>
        <label>B generator</label>
        <select id="line-b-select">${options}</select>
        <button data-action="build-line">Build Line</button>
      </div>
    `
  );

  const selectA = document.getElementById("line-a-select") as HTMLSelectElement | null;
  const selectB = document.getElementById("line-b-select") as HTMLSelectElement | null;
  if (selectA) {
    selectA.value = selectedLineA;
    selectA.addEventListener("change", () => {
      selectedLineA = selectA.value;
    });
  }
  if (selectB) {
    selectB.value = selectedLineB;
    selectB.addEventListener("change", () => {
      selectedLineB = selectB.value;
    });
  }

  const ownLines = client
    .getLines()
    .filter((line) => line.ownerPlayerId === ownId)
    .sort((a, b) => a.id.localeCompare(b.id));
  const lineRows = ownLines
    .map(
      (line) => `
        <div class="action-row">
          <code>${line.id}</code>
          <span>${line.aGeneratorId}<->${line.bGeneratorId} cap=${line.capacity} temp=${line.temp} active=${line.active}</span>
          <button data-action="destroy-line" data-line-id="${line.id}">Destroy Line</button>
        </div>
      `
    )
    .join("");
  setHtml("line-actions", lineRows);
}

function render(): void {
  const ownId = client.getOwnPlayerId();
  const currentTick = client.getCurrentTick();
  const players = client.getPlayers().map((player) =>
    toPlayerCell(
      player.playerId,
      player.posX,
      player.posY,
      player.rootGeneratorId,
      player.rootMoveAvailableAtTick,
      ownId
    )
  );
  const me = players.find((player) => player.isSelf);

  setText("status", ownId ? `connected as ${ownId}` : "connected");
  setText("tick", `tick: ${currentTick}`);
  setText("players-list", renderPlayersList(players));
  setText("generators-list", renderGeneratorsList(client.getGenerators(), currentTick));
  setText("lines-list", renderLinesList(client.getLines(), ownId));
  setText("markers-list", renderSpawnMarkersList(client.getSpawnMarkers()));

  if (me) {
    renderRootStatus(ownId, currentTick, me.rootGeneratorId, me.rootMoveAvailableAtTick);
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
    setText("root-status", "root: waiting for own player row...");
    setText("world-map", "Waiting for own player row...");
  }

  renderGeneratorActions(ownId);
  renderLineControls(ownId);
}

client.connect(() => {
  render();
});

app.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) return;
  const action = target.dataset.action;
  if (!action) return;

  try {
    if (action === "place-root") {
      const generatorId = target.dataset.generatorId;
      if (!generatorId) return;
      client.placeRoot(generatorId);
      return;
    }
    if (action === "move-root") {
      const generatorId = target.dataset.generatorId;
      if (!generatorId) return;
      client.startMoveRoot(generatorId);
      return;
    }
    if (action === "build-line") {
      const selectA = document.getElementById("line-a-select") as HTMLSelectElement | null;
      const selectB = document.getElementById("line-b-select") as HTMLSelectElement | null;
      const aId = selectA?.value ?? selectedLineA;
      const bId = selectB?.value ?? selectedLineB;
      selectedLineA = aId;
      selectedLineB = bId;
      client.buildLine(aId, bId);
      setText("line-status", `line build requested: ${aId}<->${bId}`);
      return;
    }
    if (action === "destroy-line") {
      const lineId = target.dataset.lineId;
      if (!lineId) return;
      client.destroyLine(lineId);
      setText("line-status", `line destroy requested: ${lineId}`);
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown action error";
    if (action.includes("line")) {
      setText("line-status", `line action failed: ${message}`);
    } else {
      setText("root-status", `root action failed: ${message}`);
    }
  }
});

window.addEventListener("keydown", (event) => {
  const move = mapInputToMove(event.key);
  if (!move) return;
  event.preventDefault();
  client.sendMove(move);
});
