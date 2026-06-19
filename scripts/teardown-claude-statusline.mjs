#!/usr/bin/env node
/*
 * Reverse the gage statusline install (CLI entry): restore the captured
 * passthrough (e.g. powerline). Logic lives in statusline/claude-capture.cjs.
 */
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const cap = require(path.join(here, '..', 'statusline', 'claude-capture.cjs'));

const s = cap.uninstall(os.homedir());
console.log('• statusLine restored →', s.statusLineCommand || '(removed — was a minimal gage line)');
console.log('Done. gage capture-wrapper detached.');
