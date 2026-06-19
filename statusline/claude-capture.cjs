/*
 * Shared install/uninstall/status logic for gage's Claude statusline capture.
 * Plain CJS, zero deps — used by both the npm scripts and the Electron main
 * process (loaded at runtime via createRequire), so the logic lives in one place.
 */
const fs = require('node:fs');
const path = require('node:path');

function paths(homeDir) {
  const claudeDir = path.join(homeDir, '.claude');
  const gageDir = path.join(claudeDir, 'gage');
  return {
    settings: path.join(claudeDir, 'settings.json'),
    backup: path.join(claudeDir, 'settings.json.gage-bak'),
    gageDir,
    wrapperDst: path.join(gageDir, 'gage-statusline.cjs'),
    cfg: path.join(gageDir, 'statusline.json'),
    ratelimits: path.join(gageDir, 'ratelimits.json'),
  };
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function status(homeDir) {
  const p = paths(homeDir);
  const settings = readJson(p.settings) || {};
  const cmd = settings.statusLine && typeof settings.statusLine.command === 'string' ? settings.statusLine.command : null;
  const installed = !!cmd && cmd.includes('gage-statusline');
  const cfg = readJson(p.cfg) || {};
  const rl = readJson(p.ratelimits);
  return {
    installed,
    statusLineCommand: cmd,
    passthrough: cfg.passthrough || null,
    capturedAt: (rl && rl.capturedAt) || null,
  };
}

function install(homeDir, wrapperSrc) {
  const p = paths(homeDir);
  fs.mkdirSync(p.gageDir, { recursive: true });
  fs.copyFileSync(wrapperSrc, p.wrapperDst);

  const settings = readJson(p.settings) || {};
  const current = settings.statusLine && typeof settings.statusLine.command === 'string' ? settings.statusLine.command : null;
  const alreadyGage = !!current && current.includes('gage-statusline');

  // capture the passthrough renderer once; never clobber it with the gage wrapper
  if (!alreadyGage && current) {
    fs.writeFileSync(p.cfg, JSON.stringify({ passthrough: current }, null, 2) + '\n');
  } else if (!fs.existsSync(p.cfg)) {
    fs.writeFileSync(p.cfg, JSON.stringify({ passthrough: null }, null, 2) + '\n');
  }

  if (fs.existsSync(p.settings)) fs.copyFileSync(p.settings, p.backup);
  settings.statusLine = { type: 'command', command: `node ${p.wrapperDst}` };
  fs.writeFileSync(p.settings, JSON.stringify(settings, null, 2) + '\n');
  return status(homeDir);
}

function uninstall(homeDir) {
  const p = paths(homeDir);
  const settings = readJson(p.settings) || {};
  const cfg = readJson(p.cfg) || {};
  if (cfg.passthrough) {
    settings.statusLine = { type: 'command', command: cfg.passthrough };
  } else {
    delete settings.statusLine;
  }
  fs.writeFileSync(p.settings, JSON.stringify(settings, null, 2) + '\n');
  return status(homeDir);
}

module.exports = { paths, status, install, uninstall };
