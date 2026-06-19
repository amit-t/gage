import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../main/ipc';
import type { UsageReport, Settings, ClaudeCaptureStatus } from '../core/types';

contextBridge.exposeInMainWorld('gage', {
  onReports: (cb: (reports: UsageReport[]) => void) => {
    const handler = (_: unknown, reports: UsageReport[]) => cb(reports);
    ipcRenderer.on(IPC.reports, handler);
    return () => ipcRenderer.removeListener(IPC.reports, handler);
  },
  refresh: () => ipcRenderer.send(IPC.refresh),
  getSettings: (): Promise<Settings> => ipcRenderer.invoke(IPC.getSettings),
  setSettings: (s: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke(IPC.setSettings, s),
  getClaudeCapture: (): Promise<ClaudeCaptureStatus> => ipcRenderer.invoke(IPC.getClaudeCapture),
  setClaudeCapture: (enable: boolean): Promise<ClaudeCaptureStatus> => ipcRenderer.invoke(IPC.setClaudeCapture, enable),
  ping: (): Promise<string> => ipcRenderer.invoke(IPC.ping),
});
