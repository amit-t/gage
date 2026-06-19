import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../src/core/store';
import type { UsageReport } from '../src/core/types';

const report = (agent: UsageReport['agent'], pct: number): UsageReport => ({
  agent,
  status: 'ok',
  headroomPct: pct,
  windows: [{ label: `${agent}-w`, headroomPct: pct }],
  raw: [],
  fetchedAt: '2026-06-19T00:00:00.000Z',
  source: '/f',
});

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'gage-store-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('Store', () => {
  it('keeps last-known per agent and persists across instances', () => {
    const s = new Store(dir);
    s.setReport(report('codex', 90));
    s.setReport(report('codex', 80)); // newer overwrites
    s.setReport(report('claude', 50));
    expect(s.getReports().map((r) => `${r.agent}:${r.headroomPct}`).sort()).toEqual(['claude:50', 'codex:80']);

    const s2 = new Store(dir); // reload from disk
    expect(s2.getReports().find((r) => r.agent === 'codex')?.headroomPct).toBe(80);
  });

  it('persists settings merged with defaults', () => {
    const s = new Store(dir);
    const merged = s.setSettings({ trayTitleMode: 'count' });
    expect(merged.trayTitleMode).toBe('count');
    expect(merged.enabled.codex).toBe(true); // default preserved

    const s2 = new Store(dir);
    expect(s2.getSettings().trayTitleMode).toBe('count');
  });
});
