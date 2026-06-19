import { describe, it, expect } from 'vitest';
import { clampPct, windowHeadroom, statusFor, bindWindows, normalize } from '../src/core/normalize';
import type { UsageWindow } from '../src/core/types';

describe('clampPct', () => {
  it('clamps to 0..100 and maps NaN→0', () => {
    expect(clampPct(150)).toBe(100);
    expect(clampPct(-3)).toBe(0);
    expect(clampPct(42)).toBe(42);
    expect(clampPct(Number.NaN)).toBe(0);
  });
});

describe('windowHeadroom', () => {
  it('computes remaining/limit %, NaN when limit<=0', () => {
    expect(windowHeadroom(25, 100)).toBe(25);
    expect(windowHeadroom(200, 100)).toBe(100);
    expect(Number.isNaN(windowHeadroom(1, 0))).toBe(true);
  });
});

describe('statusFor', () => {
  it('maps thresholds', () => {
    expect(statusFor(50)).toBe('ok');
    expect(statusFor(25)).toBe('ok');
    expect(statusFor(24)).toBe('tight');
    expect(statusFor(5)).toBe('tight');
    expect(statusFor(4)).toBe('blocked');
  });
  it('honors a custom tight cutoff (powerline warningThreshold)', () => {
    expect(statusFor(30, 20)).toBe('ok');
    expect(statusFor(19, 20)).toBe('tight');
  });
});

describe('bindWindows', () => {
  it('picks the minimum-headroom window and follows its reset', () => {
    const ws: UsageWindow[] = [
      { label: 'codex-5h', headroomPct: 95, resetAt: 'A' },
      { label: 'codex-weekly', headroomPct: 12, resetAt: 'B' },
    ];
    expect(bindWindows(ws)).toEqual({ headroomPct: 12, bindingWindow: 'codex-weekly', resetAt: 'B' });
  });
  it('ignores NaN windows', () => {
    const ws: UsageWindow[] = [{ label: 'x', headroomPct: Number.NaN }];
    expect(bindWindows(ws)).toEqual({});
  });
});

describe('normalize', () => {
  const base = { source: '/f', fetchedAt: '2026-06-19T00:00:00.000Z', raw: [] };
  it('produces ok report from windows', () => {
    const r = normalize({ agent: 'codex', windows: [{ label: 'codex-5h', headroomPct: 88, resetAt: 'R' }], ...base });
    expect(r.status).toBe('ok');
    expect(r.headroomPct).toBe(88);
    expect(r.bindingWindow).toBe('codex-5h');
    expect(r.resetAt).toBe('R');
  });
  it('noData when explicitly flagged (budget missing)', () => {
    const r = normalize({ agent: 'claude', windows: [], noData: true, hint: 'set a budget', ...base });
    expect(r.status).toBe('noData');
    expect(r.headroomPct).toBeUndefined();
    expect(r.hint).toBe('set a budget');
  });
  it('noData when no derivable window', () => {
    const r = normalize({ agent: 'devin', windows: [{ label: 'devin-month', headroomPct: Number.NaN }], ...base });
    expect(r.status).toBe('noData');
  });
  it('unknown on parse failure', () => {
    const r = normalize({ agent: 'devin', windows: [], unknown: true, error: 'locked', ...base });
    expect(r.status).toBe('unknown');
    expect(r.error).toBe('locked');
  });
});
