import { readFileSync, existsSync } from 'node:fs';
import { CLAUDE_POWERLINE_CONFIG, DEVIN_BUDGET_CONFIG } from '../core/paths';

function readJson(file: string): unknown | null {
  if (!existsSync(file)) return null;
  try {
    const text = readFileSync(file, 'utf8');
    return text.trim() ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

export interface ClaudeBudget {
  amountTokens?: number; // absolute per-block token cap; undefined ⇒ noData
  warningThreshold?: number; // %, drives tight cutoff
}

export function readClaudeBudget(file: string = CLAUDE_POWERLINE_CONFIG): ClaudeBudget | null {
  const data = readJson(file) as {
    budget?: { session?: { amount?: number; warningThreshold?: number } };
  } | null;
  if (!data) return null;
  const session = data.budget?.session;
  if (!session) return null;
  return {
    amountTokens: typeof session.amount === 'number' ? session.amount : undefined,
    warningThreshold: typeof session.warningThreshold === 'number' ? session.warningThreshold : undefined,
  };
}

export interface DevinBudget {
  startDate: string; // YYYY-MM-DD
  monthlyAcu: number;
}

export function readDevinBudget(file: string = DEVIN_BUDGET_CONFIG): DevinBudget | null {
  const data = readJson(file) as {
    monthly_budget?: { start_date?: string; monthly_acu?: number };
  } | null;
  const b = data?.monthly_budget;
  if (!b || typeof b.start_date !== 'string' || typeof b.monthly_acu !== 'number') return null;
  return { startDate: b.start_date, monthlyAcu: b.monthly_acu };
}
