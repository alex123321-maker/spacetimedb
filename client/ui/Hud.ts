import type { Generator, Line, Player } from "../module_bindings/types";
import { NetClient, type WorldSnapshot } from "../net/NetClient";
import { Selection } from "../game/Selection";

const FIXED_SCALE = 1000;

function getMaxLines(controlledCount: number): number {
  const maxLines =
    4 + controlledCount * 2 - Math.floor((controlledCount * controlledCount) / 10);
  return Math.max(4, maxLines);
}

function normalizedLineKey(aId: string, bId: string): string {
  return aId <= bId ? `${aId}<->${bId}` : `${bId}<->${aId}`;
}

function playerCell(player: Player): { x: number; y: number } {
  return {
    x: Number(player.posX) / FIXED_SCALE,
    y: Number(player.posY) / FIXED_SCALE,
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export class Hud {
  private readonly root: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly selectedEl: HTMLElement;
  private readonly actionsEl: HTMLElement;
  private readonly linesEl: HTMLElement;
  private readonly errorEl: HTMLElement;

  constructor(container: HTMLElement, private readonly net: NetClient, private readonly selection: Selection) {
    this.root = document.createElement("aside");
    this.root.className = "hud";
    this.root.innerHTML = `
      <h1 class="hud-title">Continuum Grid</h1>
      <div id="hud-status" class="hud-block"></div>
      <div id="hud-selected" class="hud-block"></div>
      <div id="hud-actions" class="hud-block"></div>
      <div id="hud-lines" class="hud-block"></div>
      <div id="hud-error" class="hud-error"></div>
      <div class="hud-help">LMB: move/select, RMB: stop, M: map, Esc: close map</div>
    `;

    container.appendChild(this.root);

    this.statusEl = this.root.querySelector("#hud-status") as HTMLElement;
    this.selectedEl = this.root.querySelector("#hud-selected") as HTMLElement;
    this.actionsEl = this.root.querySelector("#hud-actions") as HTMLElement;
    this.linesEl = this.root.querySelector("#hud-lines") as HTMLElement;
    this.errorEl = this.root.querySelector("#hud-error") as HTMLElement;

    this.root.addEventListener("click", this.onClick);
  }

  render(snapshot: WorldSnapshot): void {
    const currentTick = Number(snapshot.worldState?.currentTick ?? 0n);
    const myPlayer = snapshot.myPlayerId
      ? snapshot.players.find((player) => player.playerId === snapshot.myPlayerId) ?? null
      : null;

    const myCell = myPlayer ? playerCell(myPlayer) : { x: 0, y: 0 };
    const range = snapshot.worldConfig?.interactRangeCells ?? 0;
    const recentEvents = snapshot.eventLog
      .slice()
      .sort((a, b) => {
        if (a.tick !== b.tick) {
          return a.tick > b.tick ? -1 : 1;
        }
        return b.id.localeCompare(a.id);
      })
      .slice(0, 5);
    const recentEventsHtml =
      recentEvents.length === 0
        ? "<div class=\"hud-meta\">events: none</div>"
        : recentEvents
            .map((event) => {
              const payload = event.payloadJson.length > 80
                ? `${event.payloadJson.slice(0, 80)}...`
                : event.payloadJson;
              return `<div class="hud-meta">[${event.tick.toString()}] ${escapeHtml(
                event.eventType,
              )} ${escapeHtml(payload)}</div>`;
            })
            .join("");

    this.statusEl.innerHTML = `
      <div><strong>id:</strong> ${snapshot.myPlayerId ?? "connecting..."}</div>
      <div><strong>tick:</strong> ${currentTick}</div>
      <div><strong>ping:</strong> n/a</div>
      <div><strong>pos:</strong> ${myPlayer ? `${myCell.x.toFixed(2)}, ${myCell.y.toFixed(2)}` : "n/a"}</div>
      <div><strong>range:</strong> ${range}</div>
      <div><strong>generators:</strong> ${snapshot.generators.length}</div>
      <div><strong>recent events:</strong></div>
      ${recentEventsHtml}
    `;

    const selected = this.selection.selectedGeneratorId
      ? snapshot.generators.find((generator) => generator.id === this.selection.selectedGeneratorId) ?? null
      : null;

    let dist = Infinity;
    if (selected && myPlayer) {
      dist = Math.hypot(selected.x - myCell.x, selected.y - myCell.y);
    }

    this.selectedEl.innerHTML = selected
      ? `
      <div><strong>Selected Generator</strong></div>
      <div>id: ${selected.id}</div>
      <div>state: ${selected.state}</div>
      <div>owner: ${selected.ownerPlayerId || "none"}</div>
      <div>connected: ${selected.isConnected}</div>
      <div>dist: ${Number.isFinite(dist) ? dist.toFixed(2) : "n/a"}</div>
    `
      : `<div><strong>Selected Generator</strong></div><div>none</div>`;

    this.renderActions(snapshot, myPlayer, selected, dist, currentTick);
    this.renderLines(snapshot);
  }

  private renderActions(
    snapshot: WorldSnapshot,
    myPlayer: Player | null,
    selected: Generator | null,
    distance: number,
    currentTick: number,
  ): void {
    const inRange = Number.isFinite(distance)
      ? distance <= (snapshot.worldConfig?.interactRangeCells ?? 0)
      : false;
    const rootRelocation = snapshot.myPlayerId
      ? snapshot.rootRelocations.find((item) => item.playerId === snapshot.myPlayerId) ?? null
      : null;

    const hasRoot = Boolean(myPlayer?.rootGeneratorId);
    const isNeutralTarget = Boolean(
      selected && selected.state === "neutral" && selected.ownerPlayerId === "",
    );
    const cooldownOk =
      myPlayer && BigInt(currentTick) >= myPlayer.rootMoveAvailableAtTick;

    const placeRootVisible = Boolean(
      selected && myPlayer && isNeutralTarget && !hasRoot && inRange && !rootRelocation,
    );

    const moveRootVisible = Boolean(
      selected && myPlayer && isNeutralTarget && hasRoot && inRange && cooldownOk && !rootRelocation,
    );

    const setABEnabled = Boolean(selected);

    const controlledGenerators = snapshot.generators.filter(
      (generator) =>
        snapshot.myPlayerId !== null &&
        generator.ownerPlayerId === snapshot.myPlayerId &&
        generator.state === "controlled",
    );
    const controlledSet = new Set(controlledGenerators.map((generator) => generator.id));
    const myLines = snapshot.lines.filter(
      (line) => snapshot.myPlayerId !== null && line.ownerPlayerId === snapshot.myPlayerId,
    );

    const lineA = this.selection.lineA;
    const lineB = this.selection.lineB;
    const hasAB = Boolean(lineA && lineB);
    const bothControlled = Boolean(lineA && lineB && controlledSet.has(lineA) && controlledSet.has(lineB));
    const lineExists = Boolean(
      lineA &&
        lineB &&
        myLines.some((line) => normalizedLineKey(line.aGeneratorId, line.bGeneratorId) === normalizedLineKey(lineA, lineB)),
    );
    const maxLines = getMaxLines(controlledGenerators.length);
    const buildEnabled = Boolean(
      hasAB &&
        lineA !== lineB &&
        bothControlled &&
        myLines.length < maxLines &&
        !lineExists &&
        !rootRelocation,
    );

    this.actionsEl.innerHTML = `
      <div><strong>Actions</strong></div>
      <div class="hud-row">
        <button data-action="place-root" ${placeRootVisible ? "" : "disabled"}>Place Root</button>
        <button data-action="move-root" ${moveRootVisible ? "" : "disabled"}>Move Root</button>
      </div>
      <div class="hud-row">
        <button data-action="set-a" ${setABEnabled ? "" : "disabled"}>Set A</button>
        <button data-action="set-b" ${setABEnabled ? "" : "disabled"}>Set B</button>
      </div>
      <div class="hud-row">
        <button data-action="build-line" ${buildEnabled ? "" : "disabled"}>Build Line</button>
      </div>
      <div class="hud-meta">A=${lineA ?? "-"}, B=${lineB ?? "-"}</div>
      <div class="hud-meta">lines ${myLines.length}/${maxLines}</div>
      ${rootRelocation ? `<div class="hud-meta">relocation: ${rootRelocation.fromGeneratorId} -> ${rootRelocation.toGeneratorId}</div>` : ""}
    `;
  }

  private renderLines(snapshot: WorldSnapshot): void {
    const myLines = snapshot.lines
      .filter((line) => snapshot.myPlayerId !== null && line.ownerPlayerId === snapshot.myPlayerId)
      .sort((a, b) => a.id.localeCompare(b.id));

    if (myLines.length === 0) {
      this.linesEl.innerHTML = `<div><strong>My Lines</strong></div><div>none</div>`;
      return;
    }

    const rows = myLines
      .map(
        (line) => `
        <div class="hud-line-row">
          <div class="hud-line-text">${line.aGeneratorId} <-> ${line.bGeneratorId}</div>
          <button data-action="destroy-line" data-line-id="${line.id}">Destroy</button>
        </div>
      `,
      )
      .join("");

    this.linesEl.innerHTML = `<div><strong>My Lines</strong></div>${rows}`;
  }

  private onClick = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const action = target.dataset.action;
    if (!action) return;

    this.errorEl.textContent = "";

    try {
      if (action === "place-root") {
        const generatorId = this.selection.selectedGeneratorId;
        if (!generatorId) return;
        this.net.placeRoot(generatorId);
        return;
      }

      if (action === "move-root") {
        const generatorId = this.selection.selectedGeneratorId;
        if (!generatorId) return;
        this.net.startMoveRoot(generatorId);
        return;
      }

      if (action === "set-a") {
        this.selection.setLineA(this.selection.selectedGeneratorId);
        return;
      }

      if (action === "set-b") {
        this.selection.setLineB(this.selection.selectedGeneratorId);
        return;
      }

      if (action === "build-line") {
        if (!this.selection.lineA || !this.selection.lineB) return;
        this.net.buildLine(this.selection.lineA, this.selection.lineB);
        return;
      }

      if (action === "destroy-line") {
        const lineId = target.dataset.lineId;
        if (!lineId) return;
        this.net.destroyLine(lineId);
      }
    } catch (error) {
      this.errorEl.textContent =
        error instanceof Error ? error.message : "Action failed";
    }
  };
}
