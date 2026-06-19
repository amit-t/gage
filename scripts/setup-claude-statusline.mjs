#!/usr/bin/env node
/*
 * Install the gage capture-wrapper as Claude Code's statusline.
 *
 * - copies statusline/gage-statusline.cjs → ~/.claude/gage/gage-statusline.cjs
 * - captures the CURRENT statusLine.command as the passthrough renderer
 *   (so your existing statusline, e.g. powerline, keeps rendering)
 * - backs up ~/.claude/settings.json → settings.json.gage-bak
 * - points statusLine.command at the gage wrapper
 *
 * Reverse with: npm run teardown:claude
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const home = os.homedir();
const settingsPath = path.join(home, '.claude', 'settings.json');
const gageDir = path.join(home, '.claude', 'gage');
const wrapperDst = path.join(gageDir, 'gage-statusline.cjs');
const cfgPath = path.join(gageDir, 'statusline.json');
const here = path.dirname(fileURLToPath(import.meta.url));
const wrapperSrc = path.join(here, '..', 'statusline', 'gage-statusline.cjs');

fs.mkdirSync(gageDir, { recursive: true });
fs.copyFileSync(wrapperSrc, wrapperDst);
console.log('• wrapper installed →', wrapperDst);

const wrapperCmd = `node ${wrapperDst}`;

let settings = {};
if (fs.existsSync(settingsPath)) {
  settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
}
const current = settings.statusLine;
const currentCmd = current && typeof current.command === 'string' ? current.command : null;
const alreadyGage = currentCmd ? currentCmd.includes('gage-statusline') : false;

// Capture the passthrough renderer once (don't clobber it with the gage wrapper).
if (!alreadyGage && currentCmd) {
  fs.writeFileSync(cfgPath, JSON.stringify({ passthrough: currentCmd }, null, 2) + '\n');
  console.log('• passthrough renderer captured →', currentCmd);
} else if (!fs.existsSync(cfgPath)) {
  fs.writeFileSync(cfgPath, JSON.stringify({ passthrough: null }, null, 2) + '\n');
  console.log('• no prior statusline — gage will render a minimal line');
} else {
  console.log('• passthrough already configured (kept):', JSON.parse(fs.readFileSync(cfgPath, 'utf8')).passthrough);
}

if (fs.existsSync(settingsPath)) {
  fs.copyFileSync(settingsPath, settingsPath + '.gage-bak');
  console.log('• settings backed up →', settingsPath + '.gage-bak');
}
settings.statusLine = { type: 'command', command: wrapperCmd };
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
console.log('• statusLine.command →', wrapperCmd);
console.log('\nDone. Your statusline renders as before; gage now captures Claude usage to');
console.log('  ' + path.join(gageDir, 'ratelimits.json'));
console.log('Reverse anytime with: npm run teardown:claude');
