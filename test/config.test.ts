import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readClaudeBudget, readDevinBudget } from '../src/adapters/config';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'gage-cfg-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('readClaudeBudget', () => {
  it('returns warningThreshold but undefined amount when only threshold set', () => {
    const f = path.join(dir, 'claude-powerline.json');
    writeFileSync(f, JSON.stringify({ budget: { session: { warningThreshold: 80 } } }));
    expect(readClaudeBudget(f)).toEqual({ warningThreshold: 80, amountTokens: undefined });
  });
  it('reads an absolute amount when present', () => {
    const f = path.join(dir, 'claude-powerline.json');
    writeFileSync(f, JSON.stringify({ budget: { session: { warningThreshold: 75, amount: 2_000_000 } } }));
    expect(readClaudeBudget(f)).toEqual({ warningThreshold: 75, amountTokens: 2_000_000 });
  });
  it('returns null when the file is absent', () => {
    expect(readClaudeBudget(path.join(dir, 'nope.json'))).toBeNull();
  });
});

describe('readDevinBudget', () => {
  it('reads monthly_budget.start_date + monthly_acu', () => {
    const f = path.join(dir, 'config.json');
    writeFileSync(f, JSON.stringify({ monthly_budget: { start_date: '2026-06-01', monthly_acu: 100 } }));
    expect(readDevinBudget(f)).toEqual({ startDate: '2026-06-01', monthlyAcu: 100 });
  });
  it('returns null when file absent or budget unset', () => {
    expect(readDevinBudget(path.join(dir, 'nope.json'))).toBeNull();
    const f = path.join(dir, 'config.json');
    writeFileSync(f, JSON.stringify({}));
    expect(readDevinBudget(f)).toBeNull();
  });
});
