import { describe, it, expect } from 'vitest';
import { buildBlocks, activeBlock, floorToHour, FIVE_HOURS_MS } from '../src/core/blocks';

const H = 60 * 60 * 1000;
const t = (iso: string) => new Date(iso).getTime();

describe('floorToHour', () => {
  it('floors to the top of the hour', () => {
    expect(floorToHour(t('2026-06-19T03:42:10.000Z'))).toBe(t('2026-06-19T03:00:00.000Z'));
  });
});

describe('buildBlocks', () => {
  it('groups events inside a 5h window into one block, splits across the boundary', () => {
    const events = [
      { ts: t('2026-06-19T03:10:00Z'), tokens: 100 },
      { ts: t('2026-06-19T05:00:00Z'), tokens: 200 }, // same block (within 5h of 03:00 anchor)
      { ts: t('2026-06-19T09:30:00Z'), tokens: 300 }, // new block (>5h after anchor 03:00 & >5h gap)
    ];
    const blocks = buildBlocks(events);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.tokens).toBe(300);
    expect(blocks[0]!.start).toBe(t('2026-06-19T03:00:00Z'));
    expect(blocks[1]!.tokens).toBe(300);
  });

  it('starts a new block after a >5h idle gap even within nominal window', () => {
    const events = [
      { ts: t('2026-06-19T03:00:00Z'), tokens: 50 },
      { ts: t('2026-06-19T09:10:00Z'), tokens: 60 }, // 6h10m gap ⇒ new block
    ];
    expect(buildBlocks(events)).toHaveLength(2);
  });
});

describe('activeBlock', () => {
  const events = [
    { ts: t('2026-06-19T03:10:00Z'), tokens: 100 },
    { ts: t('2026-06-19T04:00:00Z'), tokens: 200 },
  ];
  it('returns the block containing now', () => {
    const b = activeBlock(buildBlocks(events), t('2026-06-19T05:30:00Z'));
    expect(b?.tokens).toBe(300); // 05:30 within [03:00, 08:00)
  });
  it('returns the last block when activity was < 5h ago', () => {
    const b = activeBlock(buildBlocks(events), t('2026-06-19T08:30:00Z'));
    expect(b?.tokens).toBe(300); // past window end but last activity 04:00, 4h30m ago
  });
  it('returns undefined when the last activity is > 5h ago', () => {
    const b = activeBlock(buildBlocks(events), t('2026-06-19T10:30:00Z'));
    expect(b).toBeUndefined();
  });
  it('exposes FIVE_HOURS_MS', () => {
    expect(FIVE_HOURS_MS).toBe(5 * H);
  });
});
