import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseRateLimits, latestRateLimits, ratesToWindows, CodexAdapter } from '../src/adapters/codex';

const fx = (name: string) => readFileSync(path.join(__dirname, 'fixtures/codex', name), 'utf8');

describe('parseRateLimits', () => {
  it('reads nested payload.rate_limits', () => {
    const line = '{"type":"event_msg","payload":{"type":"token_count","rate_limits":{"primary":{"used_percent":5,"window_minutes":300,"resets_at":1781851618}}}}';
    expect(parseRateLimits(line)?.primary?.used_percent).toBe(5);
  });
  it('returns null for non-rate_limits lines', () => {
    expect(parseRateLimits('{"type":"response_item","payload":{}}')).toBeNull();
    expect(parseRateLimits('not json')).toBeNull();
  });
});

describe('latestRateLimits', () => {
  it('returns the last rate_limits event in the file', () => {
    const r = latestRateLimits(fx('rollout.jsonl'));
    expect(r?.rl.primary?.used_percent).toBe(5.0);
    expect(r?.rl.secondary?.used_percent).toBe(11.0);
    expect(r?.rl.plan_type).toBe('prolite');
  });
  it('returns null when no rate_limits present', () => {
    expect(latestRateLimits(fx('no-ratelimits.jsonl'))).toBeNull();
  });
});

describe('ratesToWindows', () => {
  it('maps used_percent→headroom and epoch-seconds→ISO', () => {
    const ws = ratesToWindows({
      primary: { used_percent: 5, window_minutes: 300, resets_at: 1781851618 },
      secondary: { used_percent: 11, window_minutes: 10080, resets_at: 1782348192 },
    });
    expect(ws).toEqual([
      { label: 'codex-5h', headroomPct: 95, resetAt: new Date(1781851618 * 1000).toISOString() },
      { label: 'codex-weekly', headroomPct: 89, resetAt: new Date(1782348192 * 1000).toISOString() },
    ]);
  });
});

describe('CodexAdapter.read', () => {
  it('reads the newest rollout with rate_limits and binds the lower window', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gage-codex-'));
    const day = path.join(dir, '2026', '06', '19');
    mkdirSync(day, { recursive: true });
    const older = path.join(day, 'rollout-2026-06-19T01-00-00-aaaa.jsonl');
    writeFileSync(older, fx('rollout.jsonl'));
    utimesSync(older, new Date('2026-06-19T01:00:00Z'), new Date('2026-06-19T01:00:00Z'));
    const newest = path.join(day, 'rollout-2026-06-19T03-00-00-bbbb.jsonl');
    writeFileSync(newest, fx('no-ratelimits.jsonl'));
    utimesSync(newest, new Date('2026-06-19T03:00:00Z'), new Date('2026-06-19T03:00:00Z'));

    const r = await new CodexAdapter(dir).read();
    rmSync(dir, { recursive: true, force: true });

    expect(r.status).toBe('ok');
    expect(r.bindingWindow).toBe('codex-weekly');
    expect(r.headroomPct).toBe(89);
    expect(r.windows).toHaveLength(2);
    expect(r.raw.some((m) => m.label === 'plan_type')).toBe(true);
  });

  it('reports noData when the sessions dir is absent', async () => {
    const r = await new CodexAdapter('/no/such/dir').read();
    expect(r.status).toBe('noData');
  });
});
