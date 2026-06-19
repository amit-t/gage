import { app, ipcMain } from 'electron';
import { TrayController } from './tray';
import { IPC } from './ipc';
import { Store } from '../core/store';
import { RefreshEngine } from '../core/refresh';
import { enabledAdapters } from '../core/registry';
import type { AgentAdapter, AgentId, UsageReport } from '../core/types';

let tray: TrayController | null = null;
let store: Store | null = null;
let engine: RefreshEngine | null = null;

// Adapters registered here in M2–M4:
const ALL_ADAPTERS: AgentAdapter[] = [];

const NAME: Record<AgentId, string> = { codex: 'Codex', claude: 'Claude', devin: 'Devin' };
const STALE_MS = 15 * 60 * 1000;

function decorate(reports: UsageReport[]): (UsageReport & { displayName: string; stale: boolean })[] {
  const now = Date.now();
  return reports.map((r) => ({
    ...r,
    displayName: NAME[r.agent],
    stale: now - new Date(r.fetchedAt).getTime() > STALE_MS,
  }));
}

function pushReports(reports: UsageReport[]): void {
  if (!store || !tray) return;
  for (const r of reports) store.setReport(r);
  const all = store.getReports();
  tray.window.webContents.send(IPC.reports, decorate(all));
  tray.setTitle(all, store.getSettings().trayTitleMode);
}

function buildEngine(): void {
  if (!store) return;
  const settings = store.getSettings();
  engine?.dispose();
  const adapters = enabledAdapters(ALL_ADAPTERS, settings);
  engine = new RefreshEngine(adapters, pushReports, { rescanIntervalMs: settings.rescanIntervalMs });
  engine.start();
  void engine.refreshAll();
}

app.on('ready', () => {
  if (process.platform === 'darwin') app.dock?.hide();
  store = new Store(app.getPath('userData'));

  tray = new TrayController(() => void engine?.refreshAll()); // refresh-on-open
  buildEngine();

  ipcMain.handle(IPC.ping, () => 'pong');
  ipcMain.on(IPC.refresh, () => void engine?.refreshAll());
  ipcMain.handle(IPC.getSettings, () => store!.getSettings());
  ipcMain.handle(IPC.setSettings, (_e, patch) => {
    const next = store!.setSettings(patch);
    buildEngine(); // rebuild so toggled agents start/stop watching
    tray!.setTitle(store!.getReports(), next.trayTitleMode);
    return next;
  });
});

app.on('window-all-closed', () => {
  /* menu-bar app — stay alive with no windows */
});
app.on('before-quit', () => engine?.dispose());
