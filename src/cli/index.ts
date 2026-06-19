#!/usr/bin/env node
// Hide node:sqlite's ExperimentalWarning so CLI output stays clean.
const _emit = process.emitWarning.bind(process);
process.emitWarning = ((warning: unknown, ...rest: unknown[]) => {
  const name = warning && typeof warning === 'object' ? (warning as { name?: string }).name : (rest[0] as string);
  if (name === 'ExperimentalWarning') return;
  return (_emit as (...a: unknown[]) => void)(warning, ...rest);
}) as typeof process.emitWarning;

import { CodexAdapter } from '../adapters/codex';
import { DevinAdapter } from '../adapters/devin';
import { ClaudeAdapter } from '../adapters/claude';
import type { AgentAdapter, UsageReport, UsageStatus } from '../core/types';

const adapters: AgentAdapter[] = [new CodexAdapter(), new DevinAdapter(), new ClaudeAdapter()];

type CliReport = UsageReport & { displayName: string };

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
  cyan: '\x1b[36m',
};
const STATUS_COLOR: Record<UsageStatus, string> = {
  ok: C.green,
  tight: C.yellow,
  blocked: C.red,
  noData: C.gray,
  unknown: C.gray,
};
const DOT: Record<UsageStatus, string> = { ok: '●', tight: '●', blocked: '●', noData: '○', unknown: '⚠' };
const STATUS_ORDER: Record<UsageStatus, number> = { ok: 0, tight: 1, blocked: 2, noData: 3, unknown: 4 };

let useColor = process.stdout.isTTY && !process.env['NO_COLOR'];
const paint = (code: string, s: string): string => (useColor ? code + s + C.reset : s);

function bar(pct: number, width = 18): string {
  const f = Math.max(0, Math.min(width, Math.round((width * pct) / 100)));
  return '█'.repeat(f) + '░'.repeat(width - f);
}

function resetPhrase(iso?: string): string {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'resetting…';
  const m = Math.round(ms / 60000);
  if (m < 60) return `resets in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `resets in ${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `resets in ${d}d ${h % 24}h`;
}

const shortWindow = (w?: string): string => (w ? w.replace(/^(codex|claude|devin)-/, '') : '');
const pad = (s: string, n: number): string => (s.length >= n ? s : s + ' '.repeat(n - s.length));

function sortReports<T extends UsageReport>(reports: T[]): T[] {
  return [...reports].sort((a, b) => {
    const ah = a.headroomPct;
    const bh = b.headroomPct;
    if (ah !== undefined && bh !== undefined) return bh - ah;
    if (ah !== undefined) return -1;
    if (bh !== undefined) return 1;
    return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
  });
}

function render(reports: CliReport[], verbose: boolean): string {
  const sorted = sortReports(reports);
  const now = new Date().toLocaleTimeString();
  const lines: string[] = [];
  lines.push(paint(C.bold, 'gage') + paint(C.dim, '  agent headroom') + paint(C.dim, `                    ${now}`));
  lines.push('');
  for (const r of sorted) {
    const dot = paint(STATUS_COLOR[r.status], DOT[r.status]);
    const name = paint(C.bold, pad(r.displayName ?? cap(r.agent), 8));
    if (r.headroomPct === undefined) {
      const note = r.hint ?? r.error ?? r.status;
      lines.push(`  ${dot} ${name} ${pad('', 18)}   ${paint(C.gray, '—   ' + note)}`);
    } else {
      const pct = Math.round(r.headroomPct);
      const b = paint(STATUS_COLOR[r.status], bar(r.headroomPct));
      const pctStr = paint(STATUS_COLOR[r.status], pad(`${pct}%`, 4));
      const win = paint(C.dim, pad(shortWindow(r.bindingWindow), 7));
      const reset = r.resetAt ? paint(C.dim, resetPhrase(r.resetAt)) : '';
      lines.push(`  ${dot} ${name} ${b}  ${pctStr}  ${win} ${reset}`);
    }
    if (verbose) {
      for (const m of r.raw) lines.push(paint(C.dim, `        ${m.label}: ${m.value}`));
      lines.push(paint(C.dim, `        source: ${r.source}`));
    }
  }
  const best = sorted.find((r) => r.headroomPct !== undefined);
  lines.push('');
  lines.push(best ? paint(C.cyan, `  → give the next task to ${best.displayName ?? cap(best.agent)}`) : paint(C.gray, '  → no agent has a derivable headroom'));
  return lines.join('\n');
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

async function collect(): Promise<CliReport[]> {
  const settled = await Promise.allSettled(adapters.map((a) => a.read()));
  return settled.map((s, i): CliReport => {
    if (s.status === 'fulfilled') return { ...s.value, displayName: adapters[i]!.displayName };
    return {
      agent: adapters[i]!.id,
      displayName: adapters[i]!.displayName,
      status: 'unknown',
      windows: [],
      raw: [],
      fetchedAt: new Date().toISOString(),
      source: '',
      error: String((s as PromiseRejectedResult).reason),
    };
  });
}

const HELP = `gage — usage headroom across local AI agents (Codex, Devin, Claude)

Usage:
  gage              one-glance table, sorted by headroom
  gage --json       machine-readable JSON
  gage --verbose    include raw numbers + source per agent
  gage --watch[=s]  live refresh every s seconds (default 5)
  gage --no-color   disable ANSI color
  gage --help       this help
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(HELP);
    return;
  }
  if (args.includes('--no-color')) useColor = false;
  const verbose = args.includes('--verbose') || args.includes('-v');
  const json = args.includes('--json');
  const watchArg = args.find((a) => a === '--watch' || a.startsWith('--watch='));

  if (json) {
    process.stdout.write(JSON.stringify(await collect(), null, 2) + '\n');
    return;
  }

  if (watchArg) {
    const secs = watchArg.includes('=') ? Math.max(1, Number(watchArg.split('=')[1]) || 5) : 5;
    const tick = async (): Promise<void> => {
      const out = render(await collect(), verbose);
      process.stdout.write('\x1b[2J\x1b[H' + out + paint(C.dim, `\n\n  refreshing every ${secs}s · ctrl-c to exit\n`));
    };
    await tick();
    setInterval(() => void tick(), secs * 1000);
    return;
  }

  process.stdout.write(render(await collect(), verbose) + '\n');
}

void main();
