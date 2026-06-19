import { watch, type FSWatcher } from 'node:fs';
import type { AgentAdapter, AgentId, UsageReport } from './types';

export interface RefreshOptions {
  debounceMs?: number;
  rescanIntervalMs?: number;
}

export class RefreshEngine {
  private watchers: FSWatcher[] = [];
  private debounceTimers = new Map<AgentId, NodeJS.Timeout>();
  private rescanTimer: NodeJS.Timeout | null = null;
  private readonly debounceMs: number;

  constructor(
    private adapters: AgentAdapter[],
    private onUpdate: (reports: UsageReport[]) => void,
    opts: RefreshOptions = {},
  ) {
    this.debounceMs = opts.debounceMs ?? 500;
    if (opts.rescanIntervalMs && opts.rescanIntervalMs > 0) {
      this.rescanTimer = setInterval(() => void this.refreshAll(), opts.rescanIntervalMs);
    }
  }

  start(): void {
    for (const a of this.adapters) {
      for (const dir of a.watchPaths()) {
        try {
          const w = watch(dir, { recursive: true }, () => this.notifyChange(a.id));
          this.watchers.push(w);
        } catch {
          /* missing dir ⇒ adapter will report noData; nothing to watch */
        }
      }
    }
  }

  notifyChange(id: AgentId): void {
    const existing = this.debounceTimers.get(id);
    if (existing) clearTimeout(existing);
    this.debounceTimers.set(
      id,
      setTimeout(() => {
        this.debounceTimers.delete(id);
        void this.refreshOne(id);
      }, this.debounceMs),
    );
  }

  private async safeRead(a: AgentAdapter): Promise<UsageReport> {
    try {
      return await a.read();
    } catch (err) {
      return {
        agent: a.id,
        status: 'unknown',
        windows: [],
        raw: [],
        fetchedAt: new Date().toISOString(),
        source: a.sources()[0] ?? '',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async refreshAll(): Promise<UsageReport[]> {
    const settled = await Promise.allSettled(this.adapters.map((a) => this.safeRead(a)));
    const reports = settled.map((s, i) =>
      s.status === 'fulfilled'
        ? s.value
        : {
            agent: this.adapters[i]!.id,
            status: 'unknown' as const,
            windows: [],
            raw: [],
            fetchedAt: new Date().toISOString(),
            source: '',
            error: String((s as PromiseRejectedResult).reason),
          },
    );
    this.onUpdate(reports);
    return reports;
  }

  private async refreshOne(id: AgentId): Promise<void> {
    const a = this.adapters.find((x) => x.id === id);
    if (!a) return;
    const report = await this.safeRead(a);
    this.onUpdate([report]);
  }

  dispose(): void {
    for (const w of this.watchers) w.close();
    this.watchers = [];
    for (const t of this.debounceTimers.values()) clearTimeout(t);
    this.debounceTimers.clear();
    if (this.rescanTimer) clearInterval(this.rescanTimer);
  }
}
