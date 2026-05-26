export class AbortManager {
  private controllers = new Map<string, AbortController>();

  getSignal(key: string): AbortSignal {
    const existing = this.controllers.get(key);
    if (existing && !existing.signal.aborted) return existing.signal;
    const controller = new AbortController();
    this.controllers.set(key, controller);
    return controller.signal;
  }

  abort(key: string): void {
    this.controllers.get(key)?.abort();
    this.controllers.delete(key);
  }

  abortAll(): void {
    this.controllers.forEach(c => c.abort());
    this.controllers.clear();
  }

  isAborted(key: string): boolean {
    return this.controllers.get(key)?.signal.aborted ?? true;
  }
}
