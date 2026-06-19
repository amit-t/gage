import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseUsageEvents, ClaudeAdapter } from '../src/adapters/claude';

const fx = readFileSync(path.join(__dirname, 'fixtures/claude/transcript.jsonl'), 'utf8');

describe('parseUsageEvents', () => {
  it('extracts assistant usage as {ts, tokens} summing all 4 snake_case counters', () => {
    const ev = parseUsageEvents(fx);
    expect(ev).toHaveLength(3); // 3 assistant events, user line ignored
    expect(ev[0]).toEqual({ ts: new Date('2026-06-19T03:05:00.000Z').getTime(), tokens: 1000 + 200 + 500 + 300 });
    expect(ev[1]!.tokens).toBe(2000 + 400 + 0 + 1000);
  });
  it('ignores malformed lines and lines without usage', () => {
    const ev = parseUsageEvents('not json\n{"type":"user","message":{}}\n');
    expect(ev).toEqual([]);
  });
});

function recentTranscript(): string {
  // two events in the last hour ⇒ a single active block
  const a = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const b = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  return [
    JSON.stringify({ type: 'assistant', timestamp: a, message: { model: 'claude-opus-4-8', usage: { input_tokens: 100000, output_tokens: 20000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }),
    JSON.stringify({ type: 'assistant', timestamp: b, message: { model: 'claude-opus-4-8', usage: { input_tokens: 50000, output_tokens: 10000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }),
  ].join('\n');
}

describe('ClaudeAdapter.read', () => {
  it('computes active-block headroom vs the configured token amount', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gage-claude-'));
    const proj = path.join(dir, 'projects', 'p1');
    mkdirSync(proj, { recursive: true });
    const f = path.join(proj, 's.jsonl');
    writeFileSync(f, recentTranscript());
    utimesSync(f, new Date(), new Date());
    const cfg = path.join(dir, 'claude-powerline.json');
    writeFileSync(cfg, JSON.stringify({ budget: { session: { warningThreshold: 80, amount: 1_000_000 } } }));

    const r = await new ClaudeAdapter(path.join(dir, 'projects'), cfg).read();
    rmSync(dir, { recursive: true, force: true });

    // used = 180_000 of 1_000_000 ⇒ 82% headroom ⇒ ok
    expect(r.status).toBe('ok');
    expect(r.headroomPct).toBe(82);
    expect(r.bindingWindow).toBe('claude-block');
  });

  it('reports noData + hint when no absolute amount is configured', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gage-claude-'));
    const proj = path.join(dir, 'projects', 'p1');
    mkdirSync(proj, { recursive: true });
    writeFileSync(path.join(proj, 's.jsonl'), recentTranscript());
    const cfg = path.join(dir, 'claude-powerline.json');
    writeFileSync(cfg, JSON.stringify({ budget: { session: { warningThreshold: 80 } } })); // no amount

    const r = await new ClaudeAdapter(path.join(dir, 'projects'), cfg).read();
    rmSync(dir, { recursive: true, force: true });
    expect(r.status).toBe('noData');
    expect(r.hint).toMatch(/budget/i);
  });
});
