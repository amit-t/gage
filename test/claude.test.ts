import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { epochToIso, captureToWindows, ClaudeAdapter } from '../src/adapters/claude';

describe('epochToIso', () => {
  it('handles epoch seconds and ms, undefined passthrough', () => {
    expect(epochToIso(1781851618)).toBe(new Date(1781851618 * 1000).toISOString());
    expect(epochToIso(1781851618000)).toBe(new Date(1781851618000).toISOString());
    expect(epochToIso(undefined)).toBeUndefined();
  });
});

describe('captureToWindows', () => {
  it('maps used_percentage→headroom for both windows', () => {
    const w = captureToWindows({
      five_hour: { used_percentage: 23, resets_at: 1781851618 },
      seven_day: { used_percentage: 24, resets_at: 1782348192 },
    });
    expect(w).toEqual([
      { label: 'claude-5h', headroomPct: 77, resetAt: new Date(1781851618 * 1000).toISOString() },
      { label: 'claude-weekly', headroomPct: 76, resetAt: new Date(1782348192 * 1000).toISOString() },
    ]);
  });
  it('skips windows without a numeric used_percentage', () => {
    expect(captureToWindows({ five_hour: null, seven_day: undefined })).toEqual([]);
  });
});

describe('ClaudeAdapter', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'gage-claude-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads captured rate limits → binds the lower (weekly) window, native %', async () => {
    const f = path.join(dir, 'ratelimits.json');
    writeFileSync(
      f,
      JSON.stringify({
        five_hour: { used_percentage: 23, resets_at: 1781851618 },
        seven_day: { used_percentage: 24, resets_at: 1782348192 },
        capturedAt: new Date().toISOString(),
      }),
    );
    const r = await new ClaudeAdapter(f).read();
    expect(r.status).toBe('ok');
    expect(r.bindingWindow).toBe('claude-weekly'); // 76 < 77
    expect(r.headroomPct).toBe(76);
    expect(r.windows).toHaveLength(2);
    expect(r.raw.some((m) => m.label === 'captured')).toBe(true);
  });

  it('noData + hint when the capture file is absent', async () => {
    const r = await new ClaudeAdapter(path.join(dir, 'nope.json')).read();
    expect(r.status).toBe('noData');
    expect(r.hint).toMatch(/statusline|capture/i);
  });

  it('flags stale data when capturedAt is old', async () => {
    const f = path.join(dir, 'ratelimits.json');
    writeFileSync(
      f,
      JSON.stringify({
        five_hour: { used_percentage: 10, resets_at: 1781851618 },
        capturedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      }),
    );
    const r = await new ClaudeAdapter(f).read();
    expect(r.status).toBe('ok');
    expect(r.hint).toMatch(/stale/i);
  });

  it('unknown on malformed capture file', async () => {
    const f = path.join(dir, 'ratelimits.json');
    writeFileSync(f, 'not json');
    const r = await new ClaudeAdapter(f).read();
    expect(r.status).toBe('unknown');
  });
});
