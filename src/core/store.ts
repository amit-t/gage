import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { AgentId, Settings, UsageReport } from './types';
import { DEFAULT_SETTINGS } from './types';

export class Store {
  private reports = new Map<AgentId, UsageReport>();
  private settings: Settings;
  private readonly reportsPath: string;
  private readonly settingsPath: string;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.reportsPath = path.join(dir, 'reports.json');
    this.settingsPath = path.join(dir, 'settings.json');
    this.settings = this.loadSettings();
    this.loadReports();
  }

  private loadReports(): void {
    if (!existsSync(this.reportsPath)) return;
    try {
      const arr = JSON.parse(readFileSync(this.reportsPath, 'utf8')) as UsageReport[];
      for (const r of arr) this.reports.set(r.agent, r);
    } catch {
      /* corrupt cache ⇒ start empty */
    }
  }

  private loadSettings(): Settings {
    if (!existsSync(this.settingsPath)) return { ...DEFAULT_SETTINGS };
    try {
      const raw = JSON.parse(readFileSync(this.settingsPath, 'utf8')) as Partial<Settings>;
      return { ...DEFAULT_SETTINGS, ...raw, enabled: { ...DEFAULT_SETTINGS.enabled, ...raw.enabled } };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  getReports(): UsageReport[] {
    return [...this.reports.values()];
  }

  setReport(r: UsageReport): void {
    this.reports.set(r.agent, r);
    writeFileSync(this.reportsPath, JSON.stringify(this.getReports(), null, 2));
  }

  getSettings(): Settings {
    return this.settings;
  }

  setSettings(patch: Partial<Settings>): Settings {
    this.settings = {
      ...this.settings,
      ...patch,
      enabled: { ...this.settings.enabled, ...patch.enabled },
      sourceOverrides: { ...this.settings.sourceOverrides, ...patch.sourceOverrides },
    };
    writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2));
    return this.settings;
  }
}
