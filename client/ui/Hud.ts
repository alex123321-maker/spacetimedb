import type { Generator, Player } from "../module_bindings/types";
import { NetClient, type WorldSnapshot } from "../net/NetClient";
import { Selection } from "../game/Selection";

const FIXED_SCALE = 1000;

function getMaxLines(controlledCount: number): number {
  const maxLines =
    4 + controlledCount * 2 - Math.floor((controlledCount * controlledCount) / 10);
  return Math.max(4, maxLines);
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

interface HoverGeneratorPayload {
  generatorId: string;
  screenX: number;
  screenY: number;
}

export class Hud {
  private readonly root: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly selectedEl: HTMLElement;
  private readonly actionsEl: HTMLElement;
  private readonly networkEl: HTMLElement;
  private readonly errorEl: HTMLElement;
  private readonly hoverTooltipEl: HTMLElement;
  private readonly btnPlaceRoot: HTMLButtonElement;
  private readonly btnMoveRoot: HTMLButtonElement;
  private readonly btnCapture: HTMLButtonElement;
  private readonly btnCancelCapture: HTMLButtonElement;
  private readonly btnToggleBuild: HTMLButtonElement;
  private readonly btnToggleDestroy: HTMLButtonElement;
  private readonly btnSetA: HTMLButtonElement;
  private readonly btnSetB: HTMLButtonElement;
  private readonly btnCancelMode: HTMLButtonElement;
  private readonly actionsABEl: HTMLElement;
  private readonly actionsHintEl: HTMLElement;
  private readonly actionsCaptureEl: HTMLElement;
  private readonly actionsRelocationEl: HTMLElement;

  private lastSnapshot: WorldSnapshot | null = null;
  private hoverPayload: HoverGeneratorPayload | null = null;

  constructor(
    container: HTMLElement,
    private readonly net: NetClient,
    private readonly selection: Selection,
  ) {
    this.root = document.createElement("aside");
    this.root.className = "hud";
    this.root.innerHTML = `
      <h1 class="hud-title">Continuum Grid</h1>
      <div id="hud-status" class="hud-block"></div>
      <div id="hud-selected" class="hud-block"></div>
      <div id="hud-actions" class="hud-block"></div>
      <div id="hud-network" class="hud-block"></div>
      <div id="hud-error" class="hud-error"></div>
      <div class="hud-help">LMB: interact/move, RMB: stop, B: build mode, X: destroy mode, Esc: cancel, M: map</div>
    `;

    container.appendChild(this.root);

    this.statusEl = this.root.querySelector("#hud-status") as HTMLElement;
    this.selectedEl = this.root.querySelector("#hud-selected") as HTMLElement;
    this.actionsEl = this.root.querySelector("#hud-actions") as HTMLElement;
    this.networkEl = this.root.querySelector("#hud-network") as HTMLElement;
    this.errorEl = this.root.querySelector("#hud-error") as HTMLElement;

    this.hoverTooltipEl = document.createElement("div");
    this.hoverTooltipEl.className = "hud-hover-tooltip";
    this.hoverTooltipEl.style.display = "none";
    document.body.appendChild(this.hoverTooltipEl);

    const makeButton = (label: string): HTMLButtonElement => {
      const button = document.createElement("button");
      button.textContent = label;
      return button;
    };
    const makeRow = (): HTMLDivElement => {
      const row = document.createElement("div");
      row.className = "hud-row";
      return row;
    };
    const makeMeta = (): HTMLDivElement => {
      const meta = document.createElement("div");
      meta.className = "hud-meta";
      return meta;
    };

    this.actionsEl.innerHTML = "";
    const title = document.createElement("div");
    title.innerHTML = "<strong>Actions</strong>";
    this.actionsEl.appendChild(title);

    const row1 = makeRow();
    this.btnPlaceRoot = makeButton("Place Root");
    this.btnMoveRoot = makeButton("Move Root");
    this.btnCapture = makeButton("Capture");
    this.btnCancelCapture = makeButton("Cancel Capture");
    row1.append(
      this.btnPlaceRoot,
      this.btnMoveRoot,
      this.btnCapture,
      this.btnCancelCapture,
    );
    this.actionsEl.appendChild(row1);

    const row2 = makeRow();
    this.btnToggleBuild = makeButton("Build Line");
    this.btnToggleDestroy = makeButton("Destroy Line");
    row2.append(this.btnToggleBuild, this.btnToggleDestroy);
    this.actionsEl.appendChild(row2);

    const row3 = makeRow();
    this.btnSetA = makeButton("Set as A");
    this.btnSetB = makeButton("Set as B");
    row3.append(this.btnSetA, this.btnSetB);
    this.actionsEl.appendChild(row3);

    const row4 = makeRow();
    this.btnCancelMode = makeButton("Cancel (Esc)");
    row4.append(this.btnCancelMode);
    this.actionsEl.appendChild(row4);

    this.actionsABEl = makeMeta();
    this.actionsHintEl = makeMeta();
    this.actionsCaptureEl = makeMeta();
    this.actionsRelocationEl = makeMeta();
    this.actionsEl.append(
      this.actionsABEl,
      this.actionsHintEl,
      this.actionsCaptureEl,
      this.actionsRelocationEl,
    );

    this.btnPlaceRoot.addEventListener("click", () => {
      void this.handleAction("place-root");
    });
    this.btnMoveRoot.addEventListener("click", () => {
      void this.handleAction("move-root");
    });
    this.btnCapture.addEventListener("click", () => {
      void this.handleAction("capture");
    });
    this.btnCancelCapture.addEventListener("click", () => {
      void this.handleAction("cancel-capture");
    });
    this.btnToggleBuild.addEventListener("click", () => {
      void this.handleAction("toggle-build-line");
    });
    this.btnToggleDestroy.addEventListener("click", () => {
      void this.handleAction("toggle-destroy-line");
    });
    this.btnSetA.addEventListener("click", () => {
      void this.handleAction("set-a");
    });
    this.btnSetB.addEventListener("click", () => {
      void this.handleAction("set-b");
    });
    this.btnCancelMode.addEventListener("click", () => {
      void this.handleAction("cancel-mode");
    });
  }

  render(snapshot: WorldSnapshot): void {
    this.lastSnapshot = snapshot;

    const currentTick = Number(snapshot.worldState?.currentTick ?? 0n);
    const myPlayer = snapshot.myPlayerId
      ? snapshot.players.find((player) => player.playerId === snapshot.myPlayerId) ?? null
      : null;
    const myCell = myPlayer ? playerCell(myPlayer) : { x: 0, y: 0 };
    const range = snapshot.worldConfig?.interactRangeCells ?? 0;

    const modeLabel =
      this.selection.mode.kind === "default"
        ? "default"
        : this.selection.mode.kind === "destroyLine"
          ? "destroy-line"
          : `build-line (${this.selection.mode.step}${this.selection.mode.aId ? `:${this.selection.mode.aId}` : ""})`;

    this.statusEl.innerHTML = `
      <div><strong>id:</strong> ${snapshot.myPlayerId ?? "connecting..."}</div>
      <div><strong>tick:</strong> ${currentTick}</div>
      <div><strong>pos:</strong> ${myPlayer ? `${myCell.x.toFixed(2)}, ${myCell.y.toFixed(2)}` : "n/a"}</div>
      <div><strong>range:</strong> ${range}</div>
      <div><strong>generators:</strong> ${snapshot.generators.length}</div>
      <div><strong>mode:</strong> ${modeLabel}</div>
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
      <div>reserved: ${selected.reservedByPlayerId || "none"}</div>
      <div>connected: ${selected.isConnected}</div>
      <div>dist: ${Number.isFinite(dist) ? dist.toFixed(2) : "n/a"}</div>
    `
      : `<div><strong>Selected Generator</strong></div><div>none</div>`;

    this.renderActions(snapshot, myPlayer, selected, dist, currentTick);
    this.renderNetwork(snapshot);
    this.renderHoverTooltip();
  }

  setHoverGenerator(payload: HoverGeneratorPayload | null): void {
    this.hoverPayload = payload;
    this.renderHoverTooltip();
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
    const isUnreservedTarget = Boolean(selected && selected.reservedByPlayerId === "");
    const cooldownOk =
      myPlayer && BigInt(currentTick) >= myPlayer.rootMoveAvailableAtTick;
    const activeCapture = selected
      ? snapshot.captureAttempts.find((attempt) => attempt.generatorId === selected.id) ?? null
      : null;
    const canCapture = Boolean(
      selected &&
      myPlayer &&
      hasRoot &&
      inRange &&
      !rootRelocation &&
      isNeutralTarget &&
      isUnreservedTarget &&
      !activeCapture,
    );
    const canCancelCapture = Boolean(
      selected &&
      activeCapture &&
      snapshot.myPlayerId &&
      activeCapture.playerId === snapshot.myPlayerId,
    );
    const remainingTicks = activeCapture
      ? Number(
          activeCapture.finishTick > BigInt(currentTick)
            ? activeCapture.finishTick - BigInt(currentTick)
            : 0n,
        )
      : 0;

    const placeRootEnabled = Boolean(
      selected &&
      myPlayer &&
      isNeutralTarget &&
      isUnreservedTarget &&
      !hasRoot &&
      inRange &&
      !rootRelocation,
    );
    const moveRootEnabled = Boolean(
      selected &&
      myPlayer &&
      isNeutralTarget &&
      isUnreservedTarget &&
      hasRoot &&
      inRange &&
      cooldownOk &&
      !rootRelocation,
    );

    const buildMode = this.selection.mode.kind === "buildLine";
    const destroyMode = this.selection.mode.kind === "destroyLine";
    const canSetLinePoint = Boolean(selected && buildMode);
    const mode = this.selection.mode;

    let hint = "";
    if (mode.kind === "buildLine") {
      hint =
        mode.step === "pickA"
          ? "Build mode: click generator A"
          : `Build mode: click generator B (A=${mode.aId ?? "?"})`;
    } else if (mode.kind === "destroyLine") {
      hint = "Destroy mode: click a line segment";
    } else if (!selected) {
      hint = "Select a generator to see available actions";
    } else if (selected.reservedByPlayerId !== "") {
      hint = `Generator reserved by ${selected.reservedByPlayerId}`;
    } else if (!inRange) {
      hint = "Selected generator is out of interact range";
    } else if (rootRelocation) {
      hint = "Root relocation in progress";
    }

    this.btnPlaceRoot.disabled = !placeRootEnabled;
    this.btnMoveRoot.disabled = !moveRootEnabled;
    this.btnCapture.disabled = !canCapture;
    this.btnCancelCapture.disabled = !canCancelCapture;
    this.btnToggleBuild.textContent = buildMode ? "Build: ON" : "Build Line";
    this.btnToggleDestroy.textContent = destroyMode
      ? "Destroy: ON"
      : "Destroy Line";
    this.btnSetA.disabled = !canSetLinePoint;
    this.btnSetB.disabled = !canSetLinePoint;
    this.btnCancelMode.disabled = this.selection.mode.kind === "default";

    this.actionsABEl.textContent = `A=${this.selection.lineA ?? "-"}, B=${this.selection.lineB ?? "-"}`;
    this.actionsHintEl.textContent = hint;

    if (activeCapture) {
      this.actionsCaptureEl.style.display = "";
      this.actionsCaptureEl.textContent =
        `capture: ${activeCapture.playerId} -> ${activeCapture.finishTick} (remaining ${remainingTicks} ticks)`;
    } else {
      this.actionsCaptureEl.style.display = "none";
      this.actionsCaptureEl.textContent = "";
    }

    if (rootRelocation) {
      this.actionsRelocationEl.style.display = "";
      this.actionsRelocationEl.textContent =
        `relocation: ${rootRelocation.fromGeneratorId} -> ${rootRelocation.toGeneratorId}`;
    } else {
      this.actionsRelocationEl.style.display = "none";
      this.actionsRelocationEl.textContent = "";
    }
  }

  private renderNetwork(snapshot: WorldSnapshot): void {
    const controlled = snapshot.generators.filter(
      (generator) =>
        snapshot.myPlayerId !== null &&
        generator.ownerPlayerId === snapshot.myPlayerId &&
        generator.state === "controlled",
    );
    const maxLines = getMaxLines(controlled.length);
    const myLines = snapshot.lines.filter(
      (line) => snapshot.myPlayerId !== null && line.ownerPlayerId === snapshot.myPlayerId,
    );
    const overheated = myLines.filter((line) => line.overheated).length;
    const cooling = myLines.filter((line) => !line.active && !line.overheated).length;

    this.networkEl.innerHTML = `
      <div><strong>Network</strong></div>
      <div>controlled generators: ${controlled.length}</div>
      <div>lines: ${myLines.length}/${maxLines}</div>
      <div>overheated lines: ${overheated}</div>
      <div>cooldown lines: ${cooling}</div>
    `;
  }

  private renderHoverTooltip(): void {
    const snapshot = this.lastSnapshot;
    const hover = this.hoverPayload;
    if (!snapshot || !hover) {
      this.hoverTooltipEl.style.display = "none";
      return;
    }

    const generator =
      snapshot.generators.find((item) => item.id === hover.generatorId) ?? null;
    if (!generator) {
      this.hoverTooltipEl.style.display = "none";
      return;
    }

    const myPlayer = snapshot.myPlayerId
      ? snapshot.players.find((player) => player.playerId === snapshot.myPlayerId) ?? null
      : null;
    const myCell = myPlayer ? playerCell(myPlayer) : null;
    const dist = myCell
      ? Math.hypot(generator.x - myCell.x, generator.y - myCell.y)
      : null;

    this.hoverTooltipEl.innerHTML = `
      <div><strong>${escapeHtml(generator.id)}</strong></div>
      <div>state: ${escapeHtml(generator.state)}</div>
      <div>owner: ${escapeHtml(generator.ownerPlayerId || "none")}</div>
      <div>reserved: ${escapeHtml(generator.reservedByPlayerId || "none")}</div>
      <div>connected: ${generator.isConnected}</div>
      <div>dist: ${dist === null ? "n/a" : dist.toFixed(2)}</div>
    `;
    this.hoverTooltipEl.style.display = "block";
    this.hoverTooltipEl.style.left = `${Math.round(hover.screenX + 14)}px`;
    this.hoverTooltipEl.style.top = `${Math.round(hover.screenY + 14)}px`;
  }

  private handleAction = async (action: string): Promise<void> => {
    this.errorEl.textContent = "";

    try {
      if (action === "place-root") {
        const generatorId = this.selection.selectedGeneratorId;
        if (!generatorId) return;
        await this.net.placeRoot(generatorId);
        return;
      }

      if (action === "move-root") {
        const generatorId = this.selection.selectedGeneratorId;
        if (!generatorId) return;
        await this.net.startMoveRoot(generatorId);
        return;
      }

      if (action === "capture") {
        const generatorId = this.selection.selectedGeneratorId;
        if (!generatorId) return;
        await this.net.startCaptureGenerator(generatorId);
        return;
      }

      if (action === "cancel-capture") {
        const generatorId = this.selection.selectedGeneratorId;
        if (!generatorId) return;
        await this.net.cancelCapture(generatorId);
        return;
      }

      if (action === "toggle-build-line") {
        this.selection.toggleBuildLineMode();
        return;
      }

      if (action === "toggle-destroy-line") {
        this.selection.toggleDestroyLineMode();
        return;
      }

      if (action === "cancel-mode") {
        this.selection.cancelMode();
        return;
      }

      if (action === "set-a") {
        const selectedId = this.selection.selectedGeneratorId;
        if (!selectedId) return;
        this.selection.setBuildLinePickB(selectedId);
        return;
      }

      if (action === "set-b") {
        const selectedId = this.selection.selectedGeneratorId;
        if (!selectedId) return;
        if (this.selection.mode.kind !== "buildLine") return;
        const aId = this.selection.mode.aId;
        if (!aId || aId === selectedId) return;
        await this.net.buildLine(aId, selectedId);
        this.selection.cancelMode();
        return;
      }
    } catch (error) {
      this.errorEl.textContent =
        error instanceof Error ? error.message : "Action failed";
    }
  };
}
