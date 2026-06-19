import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cap = require('../statusline/claude-capture.cjs') as {
  status: (home: string) => { installed: boolean; statusLineCommand: string | null; passthrough: string | null; capturedAt: string | null };
  install: (home: string, wrapperSrc: string) => ReturnType<typeof cap.status>;
  uninstall: (home: string) => ReturnType<typeof cap.status>;
};

const POWERLINE = 'npx -y @owloops/claude-powerline@latest';
let home: string;
let wrapperSrc: string;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'gage-home-'));
  mkdirSync(path.join(home, '.claude'), { recursive: true });
  wrapperSrc = path.join(home, 'wrapper-src.cjs');
  writeFileSync(wrapperSrc, '// fake wrapper');
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const writeSettings = (o: unknown) => writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify(o));
const readSettings = () => JSON.parse(readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'));

describe('claude-capture (shared install logic)', () => {
  it('status: reports not-installed for a powerline statusline', () => {
    writeSettings({ statusLine: { type: 'command', command: POWERLINE } });
    expect(cap.status(home).installed).toBe(false);
  });

  it('install captures passthrough, repoints statusLine, copies wrapper, backs up, preserves other keys', () => {
    writeSettings({ statusLine: { type: 'command', command: POWERLINE }, theme: 'x' });
    const s = cap.install(home, wrapperSrc);
    expect(s.installed).toBe(true);
    expect(s.passthrough).toBe(POWERLINE);
    expect(s.statusLineCommand).toContain('gage-statusline');
    expect(existsSync(path.join(home, '.claude', 'gage', 'gage-statusline.cjs'))).toBe(true);
    expect(existsSync(path.join(home, '.claude', 'settings.json.gage-bak'))).toBe(true);
    expect(readSettings().theme).toBe('x');
  });

  it('install is idempotent — re-run does not clobber the captured passthrough', () => {
    writeSettings({ statusLine: { type: 'command', command: POWERLINE } });
    cap.install(home, wrapperSrc);
    const s2 = cap.install(home, wrapperSrc);
    expect(s2.passthrough).toBe(POWERLINE);
  });

  it('uninstall restores the passthrough renderer', () => {
    writeSettings({ statusLine: { type: 'command', command: POWERLINE } });
    cap.install(home, wrapperSrc);
    const s = cap.uninstall(home);
    expect(s.installed).toBe(false);
    expect(readSettings().statusLine.command).toBe(POWERLINE);
  });

  it('no prior statusLine → passthrough null; uninstall removes statusLine', () => {
    writeSettings({});
    const s = cap.install(home, wrapperSrc);
    expect(s.passthrough).toBeNull();
    expect(s.installed).toBe(true);
    cap.uninstall(home);
    expect(readSettings().statusLine).toBeUndefined();
  });
});
