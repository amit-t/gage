#!/usr/bin/env node
/*
 * Install the gage capture-wrapper as Claude Code's statusline (CLI entry).
 * Logic lives in statusline/claude-capture.cjs (shared with the in-app toggle).
 * Reverse with: npm run teardown:claude
 */
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const cap = require(path.join(here, '..', 'statusline', 'claude-capture.cjs'));
const wrapperSrc = path.join(here, '..', 'statusline', 'gage-statusline.cjs');

const s = cap.install(os.homedir(), wrapperSrc);
console.log('• wrapper installed → ~/.claude/gage/gage-statusline.cjs');
console.log('• passthrough renderer →', s.passthrough || '(none — gage renders a minimal line)');
console.log('• statusLine.command →', s.statusLineCommand);
console.log('\nDone. Your statusline renders as before; gage captures Claude usage to');
console.log('  ~/.claude/gage/ratelimits.json');
console.log('Reverse anytime with: npm run teardown:claude');
