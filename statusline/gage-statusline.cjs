#!/usr/bin/env node
/*
 * gage statusline capture-wrapper.
 *
 * Set as Claude Code's `statusLine.command`. On each render it:
 *   1. reads the hook JSON from stdin,
 *   2. captures `rate_limits` (five_hour + seven_day) → ~/.claude/gage/ratelimits.json
 *      (atomic; this is the only on-disk source of Claude's native usage %),
 *   3. renders the statusline by exec'ing the passthrough command (your previous
 *      statusline, e.g. powerline) so your statusline is unchanged.
 *
 * No hard dependency on any renderer: if no passthrough is configured or it fails,
 * gage prints its own minimal line. Every step is wrapped so a failure here can
 * never blank or break your statusline.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const GAGE_DIR = path.join(os.homedir(), '.claude', 'gage');
const RL_FILE = path.join(GAGE_DIR, 'ratelimits.json');
const CFG_FILE = path.join(GAGE_DIR, 'statusline.json');

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function captureRateLimits(hook) {
  try {
    const rl = hook && hook.rate_limits;
    if (!rl || (!rl.five_hour && !rl.seven_day)) return;
    fs.mkdirSync(GAGE_DIR, { recursive: true });
    const pick = (w) =>
      w && typeof w.used_percentage === 'number'
        ? { used_percentage: w.used_percentage, resets_at: w.resets_at }
        : null;
    const out = {
      five_hour: pick(rl.five_hour),
      seven_day: pick(rl.seven_day),
      capturedAt: new Date().toISOString(),
    };
    const tmp = RL_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(out));
    fs.renameSync(tmp, RL_FILE); // atomic swap
  } catch {
    /* never let capture break the statusline */
  }
}

function passthroughCommand() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8'));
    return typeof cfg.passthrough === 'string' && cfg.passthrough.trim() ? cfg.passthrough : null;
  } catch {
    return null;
  }
}

function fallbackLine(hook) {
  try {
    const parts = ['gage'];
    const m = hook.model && (hook.model.display_name || hook.model.id);
    if (m) parts.push(String(m));
    const rl = hook.rate_limits || {};
    if (rl.five_hour && typeof rl.five_hour.used_percentage === 'number')
      parts.push('5h ' + Math.round(100 - rl.five_hour.used_percentage) + '%');
    if (rl.seven_day && typeof rl.seven_day.used_percentage === 'number')
      parts.push('wk ' + Math.round(100 - rl.seven_day.used_percentage) + '%');
    return parts.join('  ·  ');
  } catch {
    return 'gage';
  }
}

function main() {
  const input = readStdin();
  let hook = {};
  try {
    hook = JSON.parse(input);
  } catch {
    /* keep hook = {} */
  }

  captureRateLimits(hook);

  const cmd = passthroughCommand();
  if (cmd) {
    try {
      const r = spawnSync(cmd, {
        shell: true,
        input,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
      });
      if (r.status === 0 && typeof r.stdout === 'string' && r.stdout.length > 0) {
        process.stdout.write(r.stdout);
        return;
      }
    } catch {
      /* fall through to fallback */
    }
  }
  process.stdout.write(fallbackLine(hook));
}

main();
