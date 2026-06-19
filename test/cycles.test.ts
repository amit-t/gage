import { describe, it, expect } from 'vitest';
import { toCalDate, addMonthsCal, compareCal, monthlyPeriod, calToDate } from '../src/core/cycles';

describe('addMonthsCal', () => {
  it('clamps end-of-month (Jan 31 +1 ⇒ Feb 28/29)', () => {
    expect(addMonthsCal({ y: 2026, m: 0, d: 31 }, 1)).toEqual({ y: 2026, m: 1, d: 28 });
    expect(addMonthsCal({ y: 2024, m: 0, d: 31 }, 1)).toEqual({ y: 2024, m: 1, d: 29 }); // leap
  });
  it('rolls years', () => {
    expect(addMonthsCal({ y: 2026, m: 11, d: 5 }, 1)).toEqual({ y: 2027, m: 0, d: 5 });
    expect(addMonthsCal({ y: 2026, m: 0, d: 5 }, -1)).toEqual({ y: 2025, m: 11, d: 5 });
  });
});

describe('monthlyPeriod', () => {
  it('finds the current cycle for an anchor in the past', () => {
    // anchor 2026-01-15, today 2026-06-19 ⇒ cycle [2026-06-15, 2026-07-15)
    const p = monthlyPeriod({ y: 2026, m: 0, d: 15 }, { y: 2026, m: 5, d: 19 });
    expect(p.start).toEqual({ y: 2026, m: 5, d: 15 });
    expect(p.endExclusive).toEqual({ y: 2026, m: 6, d: 15 });
  });
  it('handles an anchor in the future (steps back)', () => {
    const p = monthlyPeriod({ y: 2026, m: 11, d: 1 }, { y: 2026, m: 5, d: 19 });
    expect(p.start).toEqual({ y: 2026, m: 5, d: 1 });
    expect(p.endExclusive).toEqual({ y: 2026, m: 6, d: 1 });
  });
  it('compareCal orders dates', () => {
    expect(compareCal({ y: 2026, m: 5, d: 1 }, { y: 2026, m: 5, d: 2 })).toBeLessThan(0);
  });
  it('calToDate yields local midnight', () => {
    const d = calToDate({ y: 2026, m: 5, d: 15 });
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(5);
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(0);
  });
  it('round-trips a date through toCalDate', () => {
    expect(toCalDate(new Date(2026, 5, 19))).toEqual({ y: 2026, m: 5, d: 19 });
  });
});
