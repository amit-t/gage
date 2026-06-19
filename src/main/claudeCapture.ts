import { app } from 'electron';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { ClaudeCaptureStatus } from '../core/types';

interface CaptureModule {
  status(homeDir: string): ClaudeCaptureStatus;
  install(homeDir: string, wrapperSrc: string): ClaudeCaptureStatus;
  uninstall(homeDir: string): ClaudeCaptureStatus;
}

/** statusline/ ships in the repo (dev) and in the .app Resources (packaged). */
function statuslineDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'statusline')
    : path.join(__dirname, '../../statusline');
}

/** Load the shared zero-dep logic at runtime (not bundled), from the resolved dir. */
function loadModule(): CaptureModule {
  const req = createRequire(__filename);
  return req(path.join(statuslineDir(), 'claude-capture.cjs')) as CaptureModule;
}

export function getClaudeCaptureStatus(): ClaudeCaptureStatus {
  return loadModule().status(os.homedir());
}

export function setClaudeCapture(enable: boolean): ClaudeCaptureStatus {
  const cap = loadModule();
  return enable
    ? cap.install(os.homedir(), path.join(statuslineDir(), 'gage-statusline.cjs'))
    : cap.uninstall(os.homedir());
}
