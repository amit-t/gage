import { describe, it, expect } from 'vitest';
import { sumAcuFromRows, buildDevinReport, normalizeDbMs, type DevinRow } from '../src/adapters/devin';
import { monthlyPeriod, toCalDate, calToDate } from '../src/core/cycles';

const node = (acu: number | undefined, input = 0, output = 0): DevinRow => ({
  cm: JSON.stringify({
    metadata: { committed_acu_cost: acu, metrics: { input_tokens: input, output_tokens: output } },
  }),
});

describe('normalizeDbMs', () => {
  it('passes ms through, scales seconds to ms', () => {
    expect(normalizeDbMs(1_750_000_000_000)).toBe(1_750_000_000_000);
    expect(normalizeDbMs(1_750_000_000)).toBe(1_750_000_000_000);
  });
});

describe('sumAcuFromRows', () => {
  it('sums committed_acu_cost, counts requests, sums tokens', () => {
    const t = sumAcuFromRows([node(10, 100, 20), node(5, 50, 10), node(undefined, 1, 1)]);
    expect(t.usedAcu).toBe(15);
    expect(t.requests).toBe(2); // only rows with numeric acu count as requests
    expect(t.inputTokens).toBe(151);
    expect(t.outputTokens).toBe(31);
  });
  it('skips malformed JSON rows', () => {
    expect(sumAcuFromRows([{ cm: 'not json' }, node(3)]).usedAcu).toBe(3);
  });
});

describe('buildDevinReport', () => {
  const base = { source: '/db', fetchedAt: '2026-06-19T00:00:00.000Z' };
  it('ok status + headroom when budget present', () => {
    const r = buildDevinReport({
      totals: { usedAcu: 15, requests: 2, inputTokens: 0, outputTokens: 0 },
      budget: { startDate: '2026-06-01', monthlyAcu: 100 },
      resetAt: '2026-07-01T00:00:00.000Z',
      ...base,
    });
    expect(r.status).toBe('ok'); // 15 of 100 ⇒ 85% headroom
    expect(r.headroomPct).toBe(85);
    expect(r.bindingWindow).toBe('devin-month');
    expect(r.resetAt).toBe('2026-07-01T00:00:00.000Z');
    expect(r.raw.find((m) => m.label === 'used ACU')?.value).toBe('15.0000');
  });
  it('noData + hint when budget absent', () => {
    const r = buildDevinReport({
      totals: { usedAcu: 10, requests: 1, inputTokens: 0, outputTokens: 0 },
      budget: null,
      ...base,
    });
    expect(r.status).toBe('noData');
    expect(r.hint).toMatch(/budget/i);
    expect(r.headroomPct).toBeUndefined();
  });
  it('blocked when over 95% used', () => {
    const r = buildDevinReport({
      totals: { usedAcu: 98, requests: 1, inputTokens: 0, outputTokens: 0 },
      budget: { startDate: '2026-06-01', monthlyAcu: 100 },
      ...base,
    });
    expect(r.status).toBe('blocked'); // 2% headroom
  });
});

describe('cycle integration', () => {
  it('derives reset = next cycle start from anchor', () => {
    const period = monthlyPeriod(toCalDate(new Date(2026, 0, 15)), toCalDate(new Date(2026, 5, 19)));
    const reset = calToDate(period.endExclusive);
    expect(reset.getMonth()).toBe(6); // July
    expect(reset.getDate()).toBe(15);
  });
});
