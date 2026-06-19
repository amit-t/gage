import type { AgentId, RawMetric, UsageReport, UsageStatus, UsageWindow } from './types';

export function clampPct(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

export function windowHeadroom(remaining: number, limit: number): number {
  if (!(limit > 0)) return Number.NaN;
  return clampPct((100 * remaining) / limit);
}

export function statusFor(headroomPct: number, tightCutoff = 25): UsageStatus {
  if (headroomPct < 5) return 'blocked';
  if (headroomPct < tightCutoff) return 'tight';
  return 'ok';
}

export function bindWindows(windows: UsageWindow[]): {
  headroomPct?: number;
  bindingWindow?: string;
  resetAt?: string;
} {
  const valid = windows.filter((w) => Number.isFinite(w.headroomPct));
  if (valid.length === 0) return {};
  let min = valid[0]!;
  for (const w of valid) if (w.headroomPct < min.headroomPct) min = w;
  return { headroomPct: min.headroomPct, bindingWindow: min.label, resetAt: min.resetAt };
}

export interface ReportDraft {
  agent: AgentId;
  windows: UsageWindow[];
  raw: RawMetric[];
  source: string;
  fetchedAt: string;
  tightCutoff?: number;
  noData?: boolean;
  unknown?: boolean;
  error?: string;
  hint?: string;
}

export function normalize(d: ReportDraft): UsageReport {
  const base: UsageReport = {
    agent: d.agent,
    status: 'unknown',
    windows: d.windows,
    raw: d.raw,
    source: d.source,
    fetchedAt: d.fetchedAt,
    ...(d.error ? { error: d.error } : {}),
    ...(d.hint ? { hint: d.hint } : {}),
  };
  if (d.unknown) return { ...base, status: 'unknown' };
  if (d.noData) return { ...base, status: 'noData' };
  const b = bindWindows(d.windows);
  if (b.headroomPct === undefined) return { ...base, status: 'noData' };
  return {
    ...base,
    status: statusFor(b.headroomPct, d.tightCutoff),
    headroomPct: b.headroomPct,
    bindingWindow: b.bindingWindow,
    resetAt: b.resetAt,
  };
}
