export type SelectionListener = () => void;

export type Mode =
  | { kind: "default" }
  | { kind: "buildLine"; step: "pickA" | "pickB"; aId?: string }
  | { kind: "destroyLine" };

export class Selection {
  selectedGeneratorId: string | null = null;
  lineA: string | null = null;
  lineB: string | null = null;
  mode: Mode = { kind: "default" };

  private listeners = new Set<SelectionListener>();

  onChange(listener: SelectionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setSelectedGenerator(generatorId: string | null): void {
    if (this.selectedGeneratorId === generatorId) return;
    this.selectedGeneratorId = generatorId;
    this.emit();
  }

  setLineA(generatorId: string | null): void {
    if (this.lineA === generatorId) return;
    this.lineA = generatorId;
    this.emit();
  }

  setLineB(generatorId: string | null): void {
    if (this.lineB === generatorId) return;
    this.lineB = generatorId;
    this.emit();
  }

  clearLineSelection(): void {
    if (!this.lineA && !this.lineB) return;
    this.lineA = null;
    this.lineB = null;
    this.emit();
  }

  setMode(mode: Mode): void {
    if (this.isSameMode(this.mode, mode)) return;
    this.mode = mode;
    this.emit();
  }

  cancelMode(): void {
    const hadMode = this.mode.kind !== "default";
    const hadLineSelection = Boolean(this.lineA || this.lineB);
    if (!hadMode && !hadLineSelection) return;
    this.mode = { kind: "default" };
    this.lineA = null;
    this.lineB = null;
    this.emit();
  }

  toggleBuildLineMode(): void {
    if (this.mode.kind === "buildLine") {
      this.cancelMode();
      return;
    }
    this.mode = { kind: "buildLine", step: "pickA" };
    this.lineA = null;
    this.lineB = null;
    this.emit();
  }

  toggleDestroyLineMode(): void {
    if (this.mode.kind === "destroyLine") {
      this.cancelMode();
      return;
    }
    this.mode = { kind: "destroyLine" };
    this.lineA = null;
    this.lineB = null;
    this.emit();
  }

  setBuildLinePickA(): void {
    this.mode = { kind: "buildLine", step: "pickA" };
    this.lineA = null;
    this.lineB = null;
    this.emit();
  }

  setBuildLinePickB(aId: string): void {
    this.mode = { kind: "buildLine", step: "pickB", aId };
    this.lineA = aId;
    this.lineB = null;
    this.emit();
  }

  private isSameMode(a: Mode, b: Mode): boolean {
    if (a.kind !== b.kind) return false;
    if (a.kind === "default" && b.kind === "default") return true;
    if (a.kind === "destroyLine" && b.kind === "destroyLine") return true;
    if (a.kind === "buildLine" && b.kind === "buildLine") {
      return a.step === b.step && a.aId === b.aId;
    }
    return false;
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
