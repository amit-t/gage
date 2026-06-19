import { promises as fs } from 'node:fs';
import path from 'node:path';
import { normalize, windowHeadroom } from '../core/normalize';
import { buildBlocks, activeBlock, type UsageEvent } from '../core/blocks';
import { readClaudeBudget } from './config';
import { CLAUDE_PROJECTS_DIR, CLAUDE_POWERLINE_CONFIG } from '../core/paths';
import type { AgentAdapter, RawMetric, UsageReport, UsageWindow } from '../core/types';

interface AssistantLine {
  timestamp?: string;
  message?: {
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
}

export function parseUsageEvents(text: string): UsageEvent[] {
  const out: UsageEvent[] = [];
  for (const line of text.split('\n')) {
    if (!line.includes('"usage"')) continue;
    let obj: AssistantLine;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const u = obj.message?.usage;
    if (!u || !obj.timestamp) continue;
    const tokens =
      (u.input_tokens ?? 0) +
      (u.output_tokens ?? 0) +
      (u.cache_creation_input_tokens ?? 0) +
      (u.cache_read_input_tokens ?? 0);
    if (tokens <= 0) continue;
    out.push({ ts: new Date(obj.timestamp).getTime(), tokens });
  }
  return out;
}

async function recentTranscripts(dir: string, sinceMs: number): Promise<string[]> {
  const files: string[] = [];
  async function walk(d: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile() && e.name.endsWith('.jsonl')) {
        try {
          const st = await fs.stat(p);
          if (st.mtimeMs >= sinceMs) files.push(p);
        } catch {
          /* ignore */
        }
      }
    }
  }
  await walk(dir);
  return files;
}

export class ClaudeAdapter implements AgentAdapter {
  readonly id = 'claude' as const;
  readonly displayName = 'Claude';

  constructor(private dir: string = CLAUDE_PROJECTS_DIR, private configPath: string = CLAUDE_POWERLINE_CONFIG) {}

  sources(): string[] {
    return [path.join(this.dir, '**/*.jsonl')];
  }
  watchPaths(): string[] {
    return [this.dir];
  }

  async read(): Promise<UsageReport> {
    const fetchedAt = new Date().toISOString();
    const now = Date.now();
    const budget = readClaudeBudget(this.configPath);
    const tightCutoff = budget?.warningThreshold ? 100 - budget.warningThreshold : 25;

    // only files touched within the last ~6h can hold the active block
    const files = await recentTranscripts(this.dir, now - 6 * 60 * 60 * 1000);
    const events: UsageEvent[] = [];
    for (const f of files) {
      try {
        events.push(...parseUsageEvents(await fs.readFile(f, 'utf8')));
      } catch {
        /* skip unreadable */
      }
    }

    const block = activeBlock(buildBlocks(events), now);
    const usedTokens = block?.tokens ?? 0;
    const resetAt = block ? new Date(block.end).toISOString() : undefined;
    const raw: RawMetric[] = [
      { label: 'block tokens', value: usedTokens.toLocaleString('en-US') },
      { label: 'events', value: String(block?.count ?? 0) },
    ];

    if (!budget || budget.amountTokens === undefined) {
      raw.push({ label: 'warn threshold', value: budget?.warningThreshold ? `${budget.warningThreshold}%` : 'unset' });
      return normalize({
        agent: this.id,
        windows: [],
        raw,
        source: this.configPath,
        fetchedAt,
        noData: true,
        hint: 'set budget.session.amount (tokens) in ~/.claude/claude-powerline.json',
      });
    }
    raw.push({ label: 'budget tokens', value: budget.amountTokens.toLocaleString('en-US') });
    const headroomPct = windowHeadroom(budget.amountTokens - usedTokens, budget.amountTokens);
    const windows: UsageWindow[] = [{ label: 'claude-block', headroomPct, resetAt }];
    return normalize({ agent: this.id, windows, raw, source: this.dir, fetchedAt, tightCutoff });
  }
}
