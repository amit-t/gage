#!/usr/bin/env node
/*
 * Reverse the gage statusline install: restore your previous statusLine.command
 * (the captured passthrough, e.g. powerline). Leaves the captured ratelimits.json
 * in place (harmless); the tray simply stops getting fresh Claude data.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = os.homedir();
const settingsPath = path.join(home, '.claude', 'settings.json');
const cfgPath = path.join(home, '.claude', 'gage', 'statusline.json');

if (!fs.existsSync(settingsPath)) {
  console.error('No ~/.claude/settings.json found; nothing to restore.');
  process.exit(1);
}
const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));

let passthrough = null;
try {
  passthrough = JSON.parse(fs.readFileSync(cfgPath, 'utf8')).passthrough;
} catch {
  /* no captured passthrough */
}

if (passthrough) {
  settings.statusLine = { type: 'command', command: passthrough };
  console.log('• statusLine.command restored →', passthrough);
} else {
  delete settings.statusLine;
  console.log('• no captured passthrough — removed statusLine (was minimal gage line)');
}
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
console.log('Done. gage capture-wrapper detached.');
