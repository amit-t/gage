import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clampPct, normalize } from '../core/normalize';
import type { AgentAdapter, RawMetric, UsageReport, UsageWindow } from '../core/types';

const GAGE_DIR = path.join(os.homedir(), '.claude', 'gage');
const RATELIMITS_FILE = path.join(GAGE_DIR, 'ratelimits.json');
const STALE_MS = 60 * 60 * 1000;

interface RlWindow {
  used_percentage: number;
  resets_at?: number;
}
interface Captured {
  five_hour?: RlWindow | null;
  seven_day?: RlWindow | null;
  capturedAt?: string;
}

/** epoch (seconds or ms) → ISO. */
export function epochToIso(v?: number): string | undefined {
  if (typeof v !== 'number') return undefined;
  const ms = v > 1e12 ? v : v * 1000;
  return new Date(ms).toISOString();
}

export function captureToWindows(c: Captured): UsageWindow[] {
  const w: UsageWindow[] = [];
  if (c.five_hour && typeof c.five_hour.used_percentage === 'number') {
    w.push({ label: 'claude-5h', headroomPct: clampPct(100 - c.five_hour.used_percentage), resetAt: epochToIso(c.five_hour.resets_at) });
  }
  if (c.seven_day && typeof c.seven_day.used_percentage === 'number') {
    w.push({ label: 'claude-weekly', headroomPct: clampPct(100 - c.seven_day.used_percentage), resetAt: epochToIso(c.seven_day.resets_at) });
  }
  return w;
}

export class ClaudeAdapter implements AgentAdapter {
  readonly id = 'claude' as const;
  readonly displayName = 'Claude';

  constructor(private file: string = RATELIMITS_FILE) {}

  sources(): string[] {
    return [this.file];
  }
  watchPaths(): string[] {
    return [path.dirname(this.file)];
  }

  async read(): Promise<UsageReport> {
    const fetchedAt = new Date().toISOString();
    if (!existsSync(this.file)) {
      return normalize({
        agent: this.id,
        windows: [],
        raw: [],
        source: this.file,
        fetchedAt,
        noData: true,
        hint: "enable gage's Claude statusline capture: npm run setup:claude",
      });
    }
    let c: Captured;
    try {
      c = JSON.parse(readFileSync(this.file, 'utf8')) as Captured;
    } catch (err) {
      return normalize({
        agent: this.id,
        windows: [],
        raw: [],
        source: this.file,
        fetchedAt,
        unknown: true,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const windows = captureToWindows(c);
    const raw: RawMetric[] = [];
    if (c.five_hour && typeof c.five_hour.used_percentage === 'number') raw.push({ label: '5h used', value: `${Math.round(c.five_hour.used_percentage)}%` });
    if (c.seven_day && typeof c.seven_day.used_percentage === 'number') raw.push({ label: 'weekly used', value: `${Math.round(c.seven_day.used_percentage)}%` });
    if (c.capturedAt) raw.push({ label: 'captured', value: c.capturedAt });

    if (windows.length === 0) {
      return normalize({
        agent: this.id,
        windows: [],
        raw,
        source: this.file,
        fetchedAt,
        noData: true,
        hint: 'no Claude rate-limit data captured yet (use Claude Code so the statusline renders)',
      });
    }

    let hint: string | undefined;
    if (c.capturedAt && Date.now() - new Date(c.capturedAt).getTime() > STALE_MS) {
      hint = 'Claude usage may be stale (Claude Code idle)';
    }
    return normalize({ agent: this.id, windows, raw, source: this.file, fetchedAt, hint });
  }
}
