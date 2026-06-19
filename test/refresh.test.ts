import { describe, it, expect, vi } from 'vitest';
import { RefreshEngine } from '../src/core/refresh';
import type { AgentAdapter, UsageReport } from '../src/core/types';

const ok = (agent: UsageReport['agent']): UsageReport => ({
  agent,
  status: 'ok',
  headroomPct: 70,
  windows: [{ label: 'w', headroomPct: 70 }],
  raw: [],
  fetchedAt: 'T',
  source: '/f',
});

function adapter(id: UsageReport['agent'], impl: () => Promise<UsageReport>): AgentAdapter {
  return { id, displayName: id, sources: () => [], watchPaths: () => [], read: impl };
}

describe('RefreshEngine', () => {
  it('runs all adapters via allSettled; one throwing does not block others', async () => {
    const updates: UsageReport[][] = [];
    const good = adapter('codex', () => Promise.resolve(ok('codex')));
    const bad = adapter('devin', () => Promise.reject(new Error('boom')));
    const engine = new RefreshEngine([good, bad], (rs) => updates.push(rs));

    await engine.refreshAll();

    const last = updates.at(-1)!;
    expect(last.find((r) => r.agent === 'codex')?.status).toBe('ok');
    const devin = last.find((r) => r.agent === 'devin');
    expect(devin?.status).toBe('unknown'); // synthesized degraded report
    expect(devin?.error).toContain('boom');
  });

  it('debounces bursts of fs events into a single cycle', async () => {
    vi.useFakeTimers();
    const reads = vi.fn(() => Promise.resolve(ok('codex')));
    const a = adapter('codex', reads);
    const engine = new RefreshEngine([a], () => {}, { debounceMs: 500 });

    engine.notifyChange('codex');
    engine.notifyChange('codex');
    engine.notifyChange('codex');
    await vi.advanceTimersByTimeAsync(499);
    expect(reads).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(reads).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
