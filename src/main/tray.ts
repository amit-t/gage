import { Tray, BrowserWindow, nativeImage, screen } from 'electron';
import path from 'node:path';
import type { UsageReport, TrayTitleMode } from '../core/types';

const ICON = path.join(__dirname, '../../resources/trayTemplate.png');

export class TrayController {
  private tray: Tray;
  private win: BrowserWindow;

  constructor(private onToggle: () => void) {
    const icon = nativeImage.createFromPath(ICON);
    icon.setTemplateImage(true);
    this.tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
    this.tray.setToolTip('gage');
    this.win = this.createWindow();
    this.tray.on('click', () => this.toggle());
  }

  private createWindow(): BrowserWindow {
    const win = new BrowserWindow({
      width: 340,
      height: 460,
      show: false,
      frame: false,
      resizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      webPreferences: {
        preload: path.join(__dirname, '../preload/preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    const devUrl = process.env['ELECTRON_RENDERER_URL'];
    if (devUrl) {
      void win.loadURL(devUrl);
    } else {
      void win.loadFile(path.join(__dirname, '../renderer/index.html'));
    }
    win.on('blur', () => win.hide());
    return win;
  }

  get window(): BrowserWindow {
    return this.win;
  }

  private toggle(): void {
    if (this.win.isVisible()) {
      this.win.hide();
      return;
    }
    this.position();
    this.win.show();
    this.win.focus();
    this.onToggle(); // triggers refresh-on-open
  }

  private position(): void {
    const trayBounds = this.tray.getBounds();
    const winBounds = this.win.getBounds();
    const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
    let x = Math.round(trayBounds.x + trayBounds.width / 2 - winBounds.width / 2);
    x = Math.max(
      display.workArea.x + 4,
      Math.min(x, display.workArea.x + display.workArea.width - winBounds.width - 4),
    );
    const y = Math.round(trayBounds.y + trayBounds.height + 4);
    this.win.setPosition(x, y, false);
  }

  setTitle(reports: UsageReport[], mode: TrayTitleMode): void {
    if (mode === 'icon') {
      this.tray.setTitle('');
      return;
    }
    if (mode === 'count') {
      const n = reports.filter((r) => r.status === 'ok' || r.status === 'tight').length;
      this.tray.setTitle(` ${n}`);
      return;
    }
    // 'best'
    const ranked = reports
      .filter((r) => typeof r.headroomPct === 'number')
      .sort((a, b) => (b.headroomPct ?? 0) - (a.headroomPct ?? 0));
    const best = ranked[0];
    this.tray.setTitle(best ? ` ${best.agent[0]!.toUpperCase()} ${Math.round(best.headroomPct!)}%` : '');
  }
}
