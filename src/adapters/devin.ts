import { existsSync } from 'node:fs';
import { normalize, windowHeadroom } from '../core/normalize';
import { monthlyPeriod, toCalDate, calToDate } from '../core/cycles';
import { readDevinBudget, type DevinBudget } from './config';
import { DEVIN_DB, DEVIN_BUDGET_CONFIG, DEVIN_CLI_DIR } from '../core/paths';
import type { AgentAdapter, RawMetric, UsageReport, UsageWindow } from '../core/types';

/** One row of the message_nodes/sessions join: the raw chat_message JSON string. */
export interface DevinRow {
  cm: string;
}

export interface DevinTotals {
  usedAcu: number;
  requests: number;
  inputTokens: number;
  outputTokens: number;
}

/** epoch may be seconds or ms; return ms. */
export function normalizeDbMs(v: number): number {
  return v > 1e12 ? v : v * 1000;
}

/** Pure: parse chat_message JSON rows and sum the committed ACU + token metrics. */
export function sumAcuFromRows(rows: DevinRow[]): DevinTotals {
  let usedAcu = 0;
  let requests = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  for (const row of rows) {
    let msg: { metadata?: { committed_acu_cost?: unknown; metrics?: { input_tokens?: unknown; output_tokens?: unknown } } };
    try {
      msg = JSON.parse(row.cm);
    } catch {
      continue;
    }
    const md = msg.metadata ?? {};
    if (typeof md.committed_acu_cost === 'number') {
      usedAcu += md.committed_acu_cost;
      requests += 1;
    }
    const metrics = md.metrics ?? {};
    if (typeof metrics.input_tokens === 'number') inputTokens += metrics.input_tokens;
    if (typeof metrics.output_tokens === 'number') outputTokens += metrics.output_tokens;
  }
  return { usedAcu, requests, inputTokens, outputTokens };
}

/** Pure: assemble the UsageReport from summed totals + budget. */
export function buildDevinReport(args: {
  totals: DevinTotals;
  budget: DevinBudget | null;
  resetAt?: string;
  source: string;
  fetchedAt: string;
}): UsageReport {
  const { totals, budget, resetAt, source, fetchedAt } = args;
  const raw: RawMetric[] = [
    { label: 'used ACU', value: totals.usedAcu.toFixed(4) },
    { label: 'requests', value: String(totals.requests) },
    { label: 'input tokens', value: String(totals.inputTokens) },
    { label: 'output tokens', value: String(totals.outputTokens) },
  ];
  if (!budget) {
    return normalize({
      agent: 'devin',
      windows: [],
      raw,
      source,
      fetchedAt,
      noData: true,
      hint: 'set a Devin budget in ~/.config/devin-token-monitor/config.json (monthly_budget.monthly_acu)',
    });
  }
  raw.push({ label: 'budget ACU', value: budget.monthlyAcu.toFixed(4) });
  const headroomPct = windowHeadroom(budget.monthlyAcu - totals.usedAcu, budget.monthlyAcu);
  const windows: UsageWindow[] = [{ label: 'devin-month', headroomPct, resetAt }];
  return normalize({ agent: 'devin', windows, raw, source, fetchedAt });
}

interface MinimalStatement {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
}
interface MinimalDb {
  exec(sql: string): void;
  prepare(sql: string): MinimalStatement;
  close(): void;
}

/**
 * Open the Devin DB read-only with whichever SQLite backend fits the runtime:
 * - Electron (app): native better-sqlite3 (rebuilt for Electron's ABI).
 * - plain node (the `gage` CLI): built-in `node:sqlite` (no native module, no ABI clash).
 */
async function openDevinDb(dbPath: string): Promise<MinimalDb> {
  if (process.versions.electron) {
    const { default: Database } = await import('better-sqlite3');
    return new Database(dbPath, { readonly: true, fileMustExist: true }) as unknown as MinimalDb;
  }
  const { DatabaseSync } = await import('node:sqlite');
  return new DatabaseSync(dbPath, { readOnly: true }) as unknown as MinimalDb;
}

export class DevinAdapter implements AgentAdapter {
  readonly id = 'devin' as const;
  readonly displayName = 'Devin';

  constructor(
    private dbPath: string = DEVIN_DB,
    private configPath: string = DEVIN_BUDGET_CONFIG,
  ) {}

  sources(): string[] {
    return [this.dbPath];
  }
  watchPaths(): string[] {
    return [DEVIN_CLI_DIR];
  }

  async read(): Promise<UsageReport> {
    const fetchedAt = new Date().toISOString();
    if (!existsSync(this.dbPath)) {
      return normalize({
        agent: this.id,
        windows: [],
        raw: [],
        source: this.dbPath,
        fetchedAt,
        noData: true,
        hint: 'Devin CLI sessions.db not found',
      });
    }
    const budget = readDevinBudget(this.configPath);
    try {
      // Backend chosen by runtime (Electron → better-sqlite3, node → node:sqlite);
      // either way the native/Electron binary is only loaded when actually reading.
      const db = await openDevinDb(this.dbPath);
      try {
        db.exec('PRAGMA busy_timeout = 200');

        // Detect epoch scale (seconds vs ms) from the column.
        const maxRow = db.prepare('SELECT MAX(created_at) AS mx FROM message_nodes').get() as { mx: number | null };
        const scaleMs = (maxRow?.mx ?? 0) > 1e12;
        const hasHidden = (db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[]).some(
          (c) => c.name === 'hidden',
        );

        let cycleStartMs = 0;
        let resetAt: string | undefined;
        if (budget) {
          const anchor = toCalDate(new Date(`${budget.startDate}T00:00:00`));
          const period = monthlyPeriod(anchor, toCalDate(new Date()));
          cycleStartMs = calToDate(period.start).getTime();
          resetAt = calToDate(period.endExclusive).toISOString();
        }
        const threshold = scaleMs ? cycleStartMs : Math.floor(cycleStartMs / 1000);
        const hiddenFilter = hasHidden ? 'AND s.hidden = 0' : '';
        const rows = db
          .prepare(
            `SELECT m.chat_message AS cm FROM message_nodes m JOIN sessions s ON s.id = m.session_id WHERE m.created_at >= ? ${hiddenFilter}`,
          )
          .all(threshold) as DevinRow[];

        const totals = sumAcuFromRows(rows);
        return buildDevinReport({ totals, budget, resetAt, source: this.dbPath, fetchedAt });
      } finally {
        db.close();
      }
    } catch (err) {
      return normalize({
        agent: this.id,
        windows: [],
        raw: [],
        source: this.dbPath,
        fetchedAt,
        unknown: true,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
