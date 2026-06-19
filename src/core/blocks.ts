export const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export interface UsageEvent {
  ts: number; // epoch ms
  tokens: number;
}

export interface Block {
  start: number; // floored-to-hour anchor
  end: number; // start + blockMs
  lastTs: number; // last event ts in the block
  tokens: number;
  count: number;
}

export function floorToHour(ts: number): number {
  return ts - (ts % HOUR_MS);
}

export function buildBlocks(events: UsageEvent[], blockMs = FIVE_HOURS_MS): Block[] {
  const sorted = [...events].sort((a, b) => a.ts - b.ts);
  const blocks: Block[] = [];
  let cur: Block | null = null;
  for (const e of sorted) {
    const withinWindow = cur !== null && e.ts < cur.start + blockMs;
    const withinGap = cur !== null && e.ts - cur.lastTs < blockMs;
    if (cur && withinWindow && withinGap) {
      cur.tokens += e.tokens;
      cur.count += 1;
      cur.lastTs = e.ts;
    } else {
      const start = floorToHour(e.ts);
      cur = { start, end: start + blockMs, lastTs: e.ts, tokens: e.tokens, count: 1 };
      blocks.push(cur);
    }
  }
  return blocks;
}

export function activeBlock(blocks: Block[], now: number, blockMs = FIVE_HOURS_MS): Block | undefined {
  for (const b of blocks) {
    if (now >= b.start && now < b.end) return b;
  }
  const last = blocks[blocks.length - 1];
  if (last && now - last.lastTs < blockMs) return last;
  return undefined;
}
