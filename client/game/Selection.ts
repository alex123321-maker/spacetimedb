export type SelectionListener = () => void;

export class Selection {
  selectedGeneratorId: string | null = null;
  lineA: string | null = null;
  lineB: string | null = null;

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

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
