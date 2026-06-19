export type AgentId = 'codex' | 'claude' | 'devin';
export type UsageStatus = 'ok' | 'tight' | 'blocked' | 'noData' | 'unknown';

export interface RawMetric {
  label: string;
  value: string;
}

export interface UsageWindow {
  label: string; // 'codex-5h' | 'codex-weekly' | 'claude-block' | 'devin-month'
  headroomPct: number; // 0..100 (may be NaN before normalize filters it)
  resetAt?: string; // ISO
}

export interface UsageReport {
  agent: AgentId;
  status: UsageStatus;
  headroomPct?: number; // binding (lowest) window; omitted when not derivable
  bindingWindow?: string;
  windows: UsageWindow[];
  resetAt?: string; // reset of the binding window
  raw: RawMetric[];
  fetchedAt: string; // ISO
  source: string; // file/dir read
  error?: string; // reason when degraded
  hint?: string; // user-facing fix, e.g. "set a session budget"
}

export interface AgentAdapter {
  id: AgentId;
  displayName: string;
  sources(): string[]; // file/dir globs read (display)
  watchPaths(): string[]; // dirs handed to fs.watch
  read(): Promise<UsageReport>; // fail-soft; never throws past the refresh engine
}

export type TrayTitleMode = 'best' | 'count' | 'icon';

export interface Settings {
  enabled: Record<AgentId, boolean>;
  trayTitleMode: TrayTitleMode;
  sourceOverrides: Partial<Record<AgentId, string>>; // override base dir/file
  rescanIntervalMs: number; // fallback rescan; 0 = off
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: { codex: true, claude: true, devin: true },
  trayTitleMode: 'best',
  sourceOverrides: {},
  rescanIntervalMs: 5 * 60 * 1000,
};
