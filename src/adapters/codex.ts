import { promises as fs } from 'node:fs';
import path from 'node:path';
import { clampPct, normalize } from '../core/normalize';
import { CODEX_SESSIONS_DIR } from '../core/paths';
import type { AgentAdapter, RawMetric, UsageReport, UsageWindow } from '../core/types';

interface RateWindow { used_percent: number; window_minutes?: number; resets_at?: number; }
export interface RateLimits {
  primary?: RateWindow;
  secondary?: RateWindow;
  plan_type?: string;
}

export function parseRateLimits(line: string): RateLimits | null {
  if (!line.includes('rate_limits')) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(line);
  } catch {
    return null;
  }
  const o = obj as { payload?: { rate_limits?: unknown }; rate_limits?: unknown };
  const rl = o.payload?.rate_limits ?? o.rate_limits;
  if (!rl || typeof rl !== 'object') return null;
  return rl as RateLimits;
}

export function latestRateLimits(text: string): { rl: RateLimits; ts?: string } | null {
  let found: { rl: RateLimits; ts?: string } | null = null;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const rl = parseRateLimits(line);
    if (rl) {
      let ts: string | undefined;
      try {
        ts = (JSON.parse(line) as { timestamp?: string }).timestamp;
      } catch {
        /* ignore */
      }
      found = { rl, ts };
    }
  }
  return found;
}

const epochToIso = (s?: number): string | undefined =>
  typeof s === 'number' ? new Date(s * 1000).toISOString() : undefined;

export function ratesToWindows(rl: RateLimits): UsageWindow[] {
  const windows: UsageWindow[] = [];
  if (rl.primary) {
    windows.push({ label: 'codex-5h', headroomPct: clampPct(100 - rl.primary.used_percent), resetAt: epochToIso(rl.primary.resets_at) });
  }
  if (rl.secondary) {
    windows.push({ label: 'codex-weekly', headroomPct: clampPct(100 - rl.secondary.used_percent), resetAt: epochToIso(rl.secondary.resets_at) });
  }
  return windows;
}

async function findRolloutFiles(dir: string, cap = 25): Promise<{ file: string; mtimeMs: number }[]> {
  const out: { file: string; mtimeMs: number }[] = [];
  async function walk(d: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile() && e.name.startsWith('rollout-') && e.name.endsWith('.jsonl')) {
        try {
          const st = await fs.stat(p);
          out.push({ file: p, mtimeMs: st.mtimeMs });
        } catch {
          /* ignore */
        }
      }
    }
  }
  await walk(dir);
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, cap);
}

export class CodexAdapter implements AgentAdapter {
  readonly id = 'codex' as const;
  readonly displayName = 'Codex';

  constructor(private dir: string = CODEX_SESSIONS_DIR) {}

  sources(): string[] {
    return [path.join(this.dir, 'YYYY/MM/DD/rollout-*.jsonl')];
  }
  watchPaths(): string[] {
    return [this.dir];
  }

  async read(): Promise<UsageReport> {
    const fetchedAt = new Date().toISOString();
    const files = await findRolloutFiles(this.dir);
    if (files.length === 0) {
      return normalize({
        agent: this.id, windows: [], raw: [], source: this.dir, fetchedAt,
        noData: true, hint: 'no Codex sessions found in ~/.codex/sessions',
      });
    }
    for (const { file } of files) {
      let text: string;
      try {
        text = await fs.readFile(file, 'utf8');
      } catch {
        continue;
      }
      const latest = latestRateLimits(text);
      if (!latest) continue;
      const windows = ratesToWindows(latest.rl);
      const raw: RawMetric[] = [];
      if (latest.rl.primary) raw.push({ label: '5h used', value: `${latest.rl.primary.used_percent}%` });
      if (latest.rl.secondary) raw.push({ label: 'weekly used', value: `${latest.rl.secondary.used_percent}%` });
      if (latest.rl.plan_type) raw.push({ label: 'plan_type', value: latest.rl.plan_type });
      if (latest.ts) raw.push({ label: 'snapshot', value: latest.ts });
      return normalize({ agent: this.id, windows, raw, source: file, fetchedAt });
    }
    return normalize({
      agent: this.id, windows: [], raw: [], source: this.dir, fetchedAt,
      noData: true, hint: 'no rate_limits event found in recent Codex sessions',
    });
  }
}
