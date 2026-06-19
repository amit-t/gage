# gage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `gage` — a macOS menu-bar Electron app that reads only local on-disk usage artifacts for Codex, Claude, and Devin and shows, at a glance, which agent has the most headroom for the next task.

**Architecture:** Electron main process owns a tray + popover `BrowserWindow`, an adapter registry (`codex`/`claude`/`devin`), a refresh engine (`fs.watch` + debounce + `Promise.allSettled`), and a last-known store. Each adapter reads its own local files, fails soft (never throws past the engine), and returns a normalized `UsageReport`. The renderer is a dependency-free TypeScript popover that lists agents sorted by binding (lowest-window) headroom %.

**Tech Stack:** Electron + TypeScript (strict) + Vite via **electron-vite**; **Vitest** for tests; **better-sqlite3** (read-only) for the Devin DB, rebuilt for Electron via **@electron/rebuild**; **electron-builder** for the unsigned `.app`. No renderer framework (vanilla DOM). npm. Node 20+.

---

## Ground truth (verified on-disk 2026-06-19 — do NOT re-discover)

These supersede any conflicting field names in the spec/kickoff. Verified against live files on this machine.

| Topic | Verified fact |
|-------|---------------|
| **Codex file** | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`. Each line is a JSON object. Rate-limit lines look like `{"timestamp":"…Z","type":"event_msg","payload":{"type":"token_count","rate_limits":{…}}}`. **`rate_limits` is nested at `payload.rate_limits`** (not top-level). |
| **Codex rate_limits shape** | `{ limit_id, primary:{used_percent, window_minutes:300, resets_at:<epoch SECONDS>}, secondary:{used_percent, window_minutes:10080, resets_at}, plan_type }`. Sample seen: primary 5.0% / secondary 11.0%, plan_type `"prolite"`. `resets_at` is epoch **seconds** (×1000 → ms). |
| **Codex robustness** | Newest session file may contain **no** rate_limits event. Scan rollout files newest-mtime-first; take the most recent `payload.rate_limits` found; cap the scan (e.g. 25 files). |
| **Claude file** | `~/.claude/projects/**/*.jsonl`. Assistant events: top-level `timestamp` (ISO), `message.model`, `message.usage`. |
| **Claude usage keys** | **snake_case** (spec wrongly wrote camelCase): `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`. |
| **Claude budget** | `~/.claude/claude-powerline.json` → `budget.session` is **`{warningThreshold:80}` only — NO absolute cap on this machine.** Convention to add: `budget.session.amount` (absolute **tokens**). Absent ⇒ Claude `status:noData` + hint. `warningThreshold` (%) drives the tight cutoff only. |
| **Devin DB** | `~/.local/share/devin/cli/sessions.db` (valid SQLite 3.x, ~1.3 GB, live-written). Opens read-only via the SQLite C lib / node bindings (`{readonly:true}`); the `sqlite3` **CLI** rejected it but python/node libs succeed. Tables incl. `sessions` (1184 rows) and `message_nodes` (252 536 rows). |
| **Devin schema** | `sessions(id TEXT, working_directory, backend_type, model, created_at INT, last_activity_at INT, hidden INT, …)`. `message_nodes(row_id, session_id, node_id, created_at INT, chat_message TEXT, metadata TEXT)`. `chat_message` is JSON; usage lives at `message.metadata.committed_acu_cost` (number) and `message.metadata.metrics.{input_tokens,output_tokens,cache_read_tokens}`. |
| **Devin time** | `message_nodes.created_at` is epoch, **ms or s** — normalize: `v > 1e12 ⇒ v/1000` (seconds). `created_at` is a real column ⇒ filter by cycle start in SQL for performance. |
| **Devin budget** | `~/.config/devin-token-monitor/config.json` → **`monthly_budget.{start_date:"YYYY-MM-DD", monthly_acu:<number>}`** (spec wrongly guessed `start`/`acu`). **File ABSENT on this machine** ⇒ Devin `status:noData` until set. The same config your Devin tooling uses — single source of truth. |
| **Devin cycle math** | Reference the reference reader's monthly-cycle math: anchor = `start_date`; step whole months (`add_months`, end-of-month clamped) to the cycle containing today; period `[start 00:00, nextStart 00:00)`; reset = `nextStart`. |
| **Reference impl** | `a local Devin usage reader` is the authoritative Devin reader to port (SQL join `message_nodes m JOIN sessions s ON s.id=m.session_id` with `WHERE s.hidden=0` when the column exists). |

**Decisions locked here (flagged for Amit in the kickoff reply):**
1. **Claude cap unit = tokens** for MVP (zero pricing-table dependency, fully local). `budget.session.amount` is a token count. Cost-based cap = documented stretch (needs a bundled per-model price map).
2. **Devin budget: gage reads the config; you (or your tooling) write it.** gage reads `monthly_budget` from the shared config; the settings pane links to `a local Devin reference reader budget --start … --acu …`. gage does not write that file in MVP.
3. **Renderer = vanilla TS** (no React) — small popover, keep it lean.
4. **better-sqlite3** opened `{ readonly:true, fileMustExist:true }`; lock/parse error ⇒ degraded `unknown` + last-known, retried on next fs event.

---

## File structure

```
gage/
  package.json
  electron.vite.config.ts
  tsconfig.json
  tsconfig.node.json
  vitest.config.ts
  electron-builder.yml
  .gitignore                      # extend existing
  build/                          # tray icon assets (trayTemplate.png @1x/@2x)
  src/
    main/
      main.ts                     # app lifecycle, tray, popover window, IPC, wiring
      tray.ts                     # Tray + popover BrowserWindow + title modes
      ipc.ts                      # IPC channel constants + handlers
    preload/
      preload.ts                  # contextBridge: window.gage.{onReports,refresh,getSettings,setSettings}
    core/
      types.ts                    # AgentAdapter, UsageReport, settings types
      normalize.ts                # binding window + status mapping
      blocks.ts                   # 5h rolling-block bucketing (Claude)
      cycles.ts                   # monthly cycle math (Devin)
      store.ts                    # last-known reports + settings persistence (userData)
      refresh.ts                  # fs.watch + debounce + allSettled cycle
      registry.ts                 # enabled adapters from settings
      paths.ts                    # home-relative source path helpers (overridable)
    adapters/
      config.ts                   # read claude-powerline.json + devin-token-monitor config
      codex.ts                    # newest payload.rate_limits event
      claude.ts                   # transcript usage → active 5h block vs budget
      devin.ts                    # sessions.db Σ committed_acu_cost vs budget
    renderer/
      index.html
      main.ts                     # popover render (rows, sort, expand, settings)
      styles.css
  test/
    fixtures/
      codex/rollout.jsonl
      codex/no-ratelimits.jsonl
      claude/transcript.jsonl
      devin/seed.ts               # builds a temp sqlite db in-test
    normalize.test.ts
    blocks.test.ts
    cycles.test.ts
    codex.test.ts
    claude.test.ts
    devin.test.ts
    config.test.ts
    refresh.test.ts
    store.test.ts
```

---

# M0 — Scaffold

**Deliverable:** Electron + TS + Vite app launches as a tray icon; clicking it toggles an empty popover; an IPC heartbeat round-trips main→renderer.

### Task 0.1: Git identity + gitignore (personal)

**Files:** Modify `.gitignore`

- [ ] **Step 1: Set personal identity (mandatory — personal repo)**

```bash
cd /Users/amittiwari/Projects/Tools-Utilities/gage
git config user.email tiwari.m.amit@gmail.com
git config user.name "Amit Tiwari"
gh auth switch -u amit-t || true
git config user.email   # expect: tiwari.m.amit@gmail.com
```

- [ ] **Step 2: Extend `.gitignore`** (append; keep existing lines)

```gitignore
# gage build + runtime
node_modules/
out/
dist/
release/
*.log
.DS_Store

# never commit real usage data or local config copies
test/fixtures/**/*.real.*
*.local.json
userData/
```

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore: gitignore for electron build + runtime"
```

### Task 0.2: package.json + toolchain

**Files:** Create `package.json`, `tsconfig.json`, `tsconfig.node.json`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "gage",
  "version": "0.1.0",
  "description": "Menu-bar gauge of remaining usage headroom across local AI agents",
  "author": "Amit Tiwari <tiwari.m.amit@gmail.com>",
  "license": "MIT",
  "private": true,
  "main": "./out/main/main.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "rebuild": "electron-rebuild -f -w better-sqlite3",
    "postinstall": "electron-rebuild -f -w better-sqlite3",
    "start": "electron-vite preview",
    "pack": "electron-vite build && electron-builder --dir",
    "dist": "electron-vite build && electron-builder",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.node.json"
  },
  "dependencies": {
    "better-sqlite3": "^11.8.1"
  },
  "devDependencies": {
    "@electron/rebuild": "^3.7.1",
    "@types/better-sqlite3": "^7.6.12",
    "@types/node": "^20.17.0",
    "electron": "^33.2.0",
    "electron-builder": "^25.1.8",
    "electron-vite": "^3.0.0",
    "typescript": "^5.7.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`** (renderer + shared)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["node"],
    "outDir": "out"
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create `tsconfig.node.json`** (main/preload)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "lib": ["ES2022"],
    "types": ["node", "electron"]
  },
  "include": ["src/main", "src/preload", "src/core", "src/adapters"]
}
```

- [ ] **Step 4: Install + rebuild native module**

```bash
npm install
```
Expected: installs cleanly; `postinstall` runs `electron-rebuild` and rebuilds `better-sqlite3` against Electron's ABI. If it fails, run `npm run rebuild` and confirm Xcode CLT installed (`xcode-select -p`).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.json tsconfig.node.json
git commit -m "chore: electron-vite + typescript + vitest toolchain"
```

### Task 0.3: electron-vite + Vitest config

**Files:** Create `electron.vite.config.ts`, `vitest.config.ts`

- [ ] **Step 1: Create `electron.vite.config.ts`**

```ts
import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve(__dirname, 'src/main/main.ts') } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve(__dirname, 'src/preload/preload.ts') } },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: { rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') } },
  },
});
```

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globals: false,
  },
});
```

- [ ] **Step 3: Smoke-check Vitest runs (no tests yet ⇒ passes with 0)**

```bash
npx vitest run --passWithNoTests
```
Expected: exit 0, "No test files found" or 0 tests.

- [ ] **Step 4: Commit**

```bash
git add electron.vite.config.ts vitest.config.ts
git commit -m "chore: electron-vite + vitest config"
```

### Task 0.4: Core settings/types + paths

**Files:** Create `src/core/types.ts`, `src/core/paths.ts`

- [ ] **Step 1: Create `src/core/types.ts`**

```ts
export type AgentId = 'codex' | 'claude' | 'devin';
export type UsageStatus = 'ok' | 'tight' | 'blocked' | 'noData' | 'unknown';

export interface RawMetric {
  label: string;
  value: string;
}

export interface UsageWindow {
  label: string;        // 'codex-5h' | 'codex-weekly' | 'claude-block' | 'devin-month'
  headroomPct: number;  // 0..100 (may be NaN before normalize filters it)
  resetAt?: string;     // ISO
}

export interface UsageReport {
  agent: AgentId;
  status: UsageStatus;
  headroomPct?: number;   // binding (lowest) window; omitted when not derivable
  bindingWindow?: string;
  windows: UsageWindow[];
  resetAt?: string;       // reset of the binding window
  raw: RawMetric[];
  fetchedAt: string;      // ISO
  source: string;         // file/dir read
  error?: string;         // reason when degraded
  hint?: string;          // user-facing fix, e.g. "set a session budget"
}

export interface AgentAdapter {
  id: AgentId;
  displayName: string;
  sources(): string[];           // file/dir globs read (display)
  watchPaths(): string[];        // dirs handed to fs.watch
  read(): Promise<UsageReport>;  // fail-soft; never throws past the refresh engine
}

export type TrayTitleMode = 'best' | 'count' | 'icon';

export interface Settings {
  enabled: Record<AgentId, boolean>;
  trayTitleMode: TrayTitleMode;
  sourceOverrides: Partial<Record<AgentId, string>>; // override base dir/file
  rescanIntervalMs: number;                          // fallback rescan; 0 = off
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: { codex: true, claude: true, devin: true },
  trayTitleMode: 'best',
  sourceOverrides: {},
  rescanIntervalMs: 5 * 60 * 1000,
};
```

- [ ] **Step 2: Create `src/core/paths.ts`**

```ts
import os from 'node:os';
import path from 'node:path';

const home = os.homedir();

export const CODEX_SESSIONS_DIR = path.join(home, '.codex', 'sessions');
export const CLAUDE_PROJECTS_DIR = path.join(home, '.claude', 'projects');
export const CLAUDE_POWERLINE_CONFIG = path.join(home, '.claude', 'claude-powerline.json');
export const DEVIN_CLI_DIR = path.join(home, '.local', 'share', 'devin', 'cli');
export const DEVIN_DB = path.join(DEVIN_CLI_DIR, 'sessions.db');
export const DEVIN_BUDGET_CONFIG = path.join(home, '.config', 'devin-token-monitor', 'config.json');
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/core/types.ts src/core/paths.ts
git commit -m "feat: core types, settings, source paths"
```

### Task 0.5: Tray + popover window + IPC heartbeat

**Files:** Create `src/main/ipc.ts`, `src/main/tray.ts`, `src/main/main.ts`, `src/preload/preload.ts`, `src/renderer/index.html`, `src/renderer/main.ts`, `src/renderer/styles.css`, and a tray icon `build/trayTemplate.png` (+`@2x`).

- [ ] **Step 1: Create `src/main/ipc.ts`** (channel constants)

```ts
export const IPC = {
  reports: 'gage:reports',        // main → renderer (push UsageReport[])
  refresh: 'gage:refresh',        // renderer → main (force a cycle)
  getSettings: 'gage:getSettings',
  setSettings: 'gage:setSettings',
  ping: 'gage:ping',              // heartbeat (M0)
} as const;
```

- [ ] **Step 2: Create tray icon assets**

Generate a 16×16 (and 32×32 `@2x`) black template PNG named `build/trayTemplate.png` / `build/trayTemplate@2x.png` (template images are black + alpha; macOS recolors them).

```bash
mkdir -p build
# minimal placeholder gauge glyph; replace with a real icon in M5
printf '' # (designer asset added in M5; for M0 any 16x16 black PNG works)
```
If no asset tool is handy, create one in Node:

```bash
node -e "const{nativeImage}=require('electron');" 2>/dev/null || true
```
Acceptance for M0: any 16×16 black-on-transparent PNG at `build/trayTemplate.png`. (A real glyph lands in M5 Task 5.7.)

- [ ] **Step 3: Create `src/main/tray.ts`**

```ts
import { app, Tray, BrowserWindow, nativeImage, screen } from 'electron';
import path from 'node:path';
import type { UsageReport, TrayTitleMode } from '../core/types';

const ICON = path.join(__dirname, '../../build/trayTemplate.png');

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
    if (process.env['ELECTRON_RENDERER_URL']) {
      win.loadURL(process.env['ELECTRON_RENDERER_URL']);
    } else {
      win.loadFile(path.join(__dirname, '../renderer/index.html'));
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
    x = Math.max(display.workArea.x + 4, Math.min(x, display.workArea.x + display.workArea.width - winBounds.width - 4));
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
```

- [ ] **Step 4: Create `src/preload/preload.ts`**

```ts
import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../main/ipc';
import type { UsageReport, Settings } from '../core/types';

contextBridge.exposeInMainWorld('gage', {
  onReports: (cb: (reports: UsageReport[]) => void) => {
    const handler = (_: unknown, reports: UsageReport[]) => cb(reports);
    ipcRenderer.on(IPC.reports, handler);
    return () => ipcRenderer.removeListener(IPC.reports, handler);
  },
  refresh: () => ipcRenderer.send(IPC.refresh),
  getSettings: (): Promise<Settings> => ipcRenderer.invoke(IPC.getSettings),
  setSettings: (s: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke(IPC.setSettings, s),
  ping: (): Promise<string> => ipcRenderer.invoke(IPC.ping),
});
```

- [ ] **Step 5: Create `src/renderer/index.html`**

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline';" />
    <link rel="stylesheet" href="./styles.css" />
    <title>gage</title>
  </head>
  <body>
    <div id="app"><div id="rows"></div></div>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

- [ ] **Step 6: Create `src/renderer/styles.css`** (minimal M0 styling; expanded M5)

```css
:root { color-scheme: light dark; font: 13px -apple-system, system-ui, sans-serif; }
body { margin: 0; padding: 8px; }
#heartbeat { opacity: 0.6; font-size: 11px; }
```

- [ ] **Step 7: Create `src/renderer/main.ts`** (M0: prove IPC heartbeat)

```ts
import type { UsageReport, Settings } from '../core/types';

declare global {
  interface Window {
    gage: {
      onReports: (cb: (reports: UsageReport[]) => void) => () => void;
      refresh: () => void;
      getSettings: () => Promise<Settings>;
      setSettings: (s: Partial<Settings>) => Promise<Settings>;
      ping: () => Promise<string>;
    };
  }
}

const rows = document.getElementById('rows')!;

window.gage.ping().then((pong) => {
  const el = document.createElement('div');
  el.id = 'heartbeat';
  el.textContent = `IPC: ${pong}`;
  rows.appendChild(el);
});

window.gage.onReports((reports) => {
  console.log('reports', reports);
});
```

- [ ] **Step 8: Create `src/main/main.ts`** (M0: wire tray + heartbeat handlers)

```ts
import { app, ipcMain } from 'electron';
import { TrayController } from './tray';
import { IPC } from './ipc';

let tray: TrayController | null = null;

app.on('ready', () => {
  if (process.platform === 'darwin') app.dock?.hide();
  tray = new TrayController(() => {
    /* refresh-on-open wired in M1 */
  });
  ipcMain.handle(IPC.ping, () => 'pong');
});

app.on('window-all-closed', (e: Electron.Event) => {
  e.preventDefault(); // tray app stays alive with no windows
});
```

- [ ] **Step 9: Run the app**

```bash
npm run dev
```
Expected: a tray icon appears in the menu bar; clicking it shows a 340×460 popover containing `IPC: pong`; clicking away hides it; no dock icon.

- [ ] **Step 10: Commit**

```bash
git add src build
git commit -m "feat(M0): tray + popover scaffold with IPC heartbeat"
```

---

# M1 — Core (TDD)

**Deliverable:** `normalize`, `store`, `refresh` engine, `registry` — all unit-tested. No real adapters yet; tests use a fake adapter.

### Task 1.1: `normalize` — binding window + status

**Files:** Create `src/core/normalize.ts`, `test/normalize.test.ts`

- [ ] **Step 1: Write the failing test** (`test/normalize.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { clampPct, windowHeadroom, statusFor, bindWindows, normalize } from '../src/core/normalize';
import type { UsageWindow } from '../src/core/types';

describe('clampPct', () => {
  it('clamps to 0..100 and maps NaN→0', () => {
    expect(clampPct(150)).toBe(100);
    expect(clampPct(-3)).toBe(0);
    expect(clampPct(42)).toBe(42);
    expect(clampPct(Number.NaN)).toBe(0);
  });
});

describe('windowHeadroom', () => {
  it('computes remaining/limit %, NaN when limit<=0', () => {
    expect(windowHeadroom(25, 100)).toBe(25);
    expect(windowHeadroom(200, 100)).toBe(100);
    expect(Number.isNaN(windowHeadroom(1, 0))).toBe(true);
  });
});

describe('statusFor', () => {
  it('maps thresholds', () => {
    expect(statusFor(50)).toBe('ok');
    expect(statusFor(25)).toBe('ok');
    expect(statusFor(24)).toBe('tight');
    expect(statusFor(5)).toBe('tight');
    expect(statusFor(4)).toBe('blocked');
  });
  it('honors a custom tight cutoff (powerline warningThreshold)', () => {
    // warningThreshold 80 ⇒ tight when headroom < 20
    expect(statusFor(30, 20)).toBe('ok');
    expect(statusFor(19, 20)).toBe('tight');
  });
});

describe('bindWindows', () => {
  it('picks the minimum-headroom window and follows its reset', () => {
    const ws: UsageWindow[] = [
      { label: 'codex-5h', headroomPct: 95, resetAt: 'A' },
      { label: 'codex-weekly', headroomPct: 12, resetAt: 'B' },
    ];
    expect(bindWindows(ws)).toEqual({ headroomPct: 12, bindingWindow: 'codex-weekly', resetAt: 'B' });
  });
  it('ignores NaN windows', () => {
    const ws: UsageWindow[] = [{ label: 'x', headroomPct: Number.NaN }];
    expect(bindWindows(ws)).toEqual({});
  });
});

describe('normalize', () => {
  const base = { source: '/f', fetchedAt: '2026-06-19T00:00:00.000Z', raw: [] };
  it('produces ok report from windows', () => {
    const r = normalize({ agent: 'codex', windows: [{ label: 'codex-5h', headroomPct: 88, resetAt: 'R' }], ...base });
    expect(r.status).toBe('ok');
    expect(r.headroomPct).toBe(88);
    expect(r.bindingWindow).toBe('codex-5h');
    expect(r.resetAt).toBe('R');
  });
  it('noData when explicitly flagged (budget missing)', () => {
    const r = normalize({ agent: 'claude', windows: [], noData: true, hint: 'set a budget', ...base });
    expect(r.status).toBe('noData');
    expect(r.headroomPct).toBeUndefined();
    expect(r.hint).toBe('set a budget');
  });
  it('noData when no derivable window', () => {
    const r = normalize({ agent: 'devin', windows: [{ label: 'devin-month', headroomPct: Number.NaN }], ...base });
    expect(r.status).toBe('noData');
  });
  it('unknown on parse failure', () => {
    const r = normalize({ agent: 'devin', windows: [], unknown: true, error: 'locked', ...base });
    expect(r.status).toBe('unknown');
    expect(r.error).toBe('locked');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run test/normalize.test.ts
```
Expected: FAIL — `normalize` etc. not exported.

- [ ] **Step 3: Implement `src/core/normalize.ts`**

```ts
import type { AgentId, RawMetric, UsageReport, UsageStatus, UsageWindow } from './types';

export function clampPct(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

export function windowHeadroom(remaining: number, limit: number): number {
  if (!(limit > 0)) return Number.NaN;
  return clampPct((100 * remaining) / limit);
}

export function statusFor(headroomPct: number, tightCutoff = 25): UsageStatus {
  if (headroomPct < 5) return 'blocked';
  if (headroomPct < tightCutoff) return 'tight';
  return 'ok';
}

export function bindWindows(windows: UsageWindow[]): {
  headroomPct?: number;
  bindingWindow?: string;
  resetAt?: string;
} {
  const valid = windows.filter((w) => Number.isFinite(w.headroomPct));
  if (valid.length === 0) return {};
  let min = valid[0]!;
  for (const w of valid) if (w.headroomPct < min.headroomPct) min = w;
  return { headroomPct: min.headroomPct, bindingWindow: min.label, resetAt: min.resetAt };
}

export interface ReportDraft {
  agent: AgentId;
  windows: UsageWindow[];
  raw: RawMetric[];
  source: string;
  fetchedAt: string;
  tightCutoff?: number;
  noData?: boolean;
  unknown?: boolean;
  error?: string;
  hint?: string;
}

export function normalize(d: ReportDraft): UsageReport {
  const base: UsageReport = {
    agent: d.agent,
    status: 'unknown',
    windows: d.windows,
    raw: d.raw,
    source: d.source,
    fetchedAt: d.fetchedAt,
    ...(d.error ? { error: d.error } : {}),
    ...(d.hint ? { hint: d.hint } : {}),
  };
  if (d.unknown) return { ...base, status: 'unknown' };
  if (d.noData) return { ...base, status: 'noData' };
  const b = bindWindows(d.windows);
  if (b.headroomPct === undefined) return { ...base, status: 'noData' };
  return {
    ...base,
    status: statusFor(b.headroomPct, d.tightCutoff),
    headroomPct: b.headroomPct,
    bindingWindow: b.bindingWindow,
    resetAt: b.resetAt,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run test/normalize.test.ts
```
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/core/normalize.ts test/normalize.test.ts
git commit -m "feat(M1): normalize — binding window + status mapping (TDD)"
```

### Task 1.2: `store` — last-known reports + settings persistence

**Files:** Create `src/core/store.ts`, `test/store.test.ts`

- [ ] **Step 1: Write the failing test** (`test/store.test.ts`)

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../src/core/store';
import type { UsageReport } from '../src/core/types';

const report = (agent: UsageReport['agent'], pct: number): UsageReport => ({
  agent,
  status: 'ok',
  headroomPct: pct,
  windows: [{ label: `${agent}-w`, headroomPct: pct }],
  raw: [],
  fetchedAt: '2026-06-19T00:00:00.000Z',
  source: '/f',
});

let dir: string;
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'gage-store-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('Store', () => {
  it('keeps last-known per agent and persists across instances', () => {
    const s = new Store(dir);
    s.setReport(report('codex', 90));
    s.setReport(report('codex', 80)); // newer overwrites
    s.setReport(report('claude', 50));
    expect(s.getReports().map((r) => `${r.agent}:${r.headroomPct}`).sort())
      .toEqual(['claude:50', 'codex:80']);

    const s2 = new Store(dir); // reload from disk
    expect(s2.getReports().find((r) => r.agent === 'codex')?.headroomPct).toBe(80);
  });

  it('persists settings merged with defaults', () => {
    const s = new Store(dir);
    const merged = s.setSettings({ trayTitleMode: 'count' });
    expect(merged.trayTitleMode).toBe('count');
    expect(merged.enabled.codex).toBe(true); // default preserved

    const s2 = new Store(dir);
    expect(s2.getSettings().trayTitleMode).toBe('count');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run test/store.test.ts
```
Expected: FAIL — `Store` not found.

- [ ] **Step 3: Implement `src/core/store.ts`**

```ts
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { AgentId, Settings, UsageReport } from './types';
import { DEFAULT_SETTINGS } from './types';

export class Store {
  private reports = new Map<AgentId, UsageReport>();
  private settings: Settings;
  private readonly reportsPath: string;
  private readonly settingsPath: string;

  constructor(private dir: string) {
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
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run test/store.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/store.ts test/store.test.ts
git commit -m "feat(M1): store — last-known reports + settings persistence (TDD)"
```

### Task 1.3: `refresh` engine — debounce + allSettled isolation

**Files:** Create `src/core/refresh.ts`, `test/refresh.test.ts`

- [ ] **Step 1: Write the failing test** (`test/refresh.test.ts`)

```ts
import { describe, it, expect, vi } from 'vitest';
import { RefreshEngine } from '../src/core/refresh';
import type { AgentAdapter, UsageReport } from '../src/core/types';

const ok = (agent: UsageReport['agent']): UsageReport => ({
  agent, status: 'ok', headroomPct: 70,
  windows: [{ label: 'w', headroomPct: 70 }], raw: [], fetchedAt: 'T', source: '/f',
});

function adapter(id: UsageReport['agent'], impl: () => Promise<UsageReport>): AgentAdapter {
  return { id, displayName: id, sources: () => [], watchPaths: () => [], read: impl };
}

describe('RefreshEngine', () => {
  it('runs all adapters via allSettled; one throwing does not block others', async () => {
    const updates: UsageReport[][] = [];
    const good = adapter('codex', () => Promise.resolve(ok('codex')));
    const bad = adapter('devin', () => Promise.reject(new Error('boom')));
    const engine = new RefreshEngine([good, bad], (rs) => updates.push(rs));

    await engine.refreshAll();

    const last = updates.at(-1)!;
    expect(last.find((r) => r.agent === 'codex')?.status).toBe('ok');
    const devin = last.find((r) => r.agent === 'devin');
    expect(devin?.status).toBe('unknown'); // synthesized degraded report
    expect(devin?.error).toContain('boom');
  });

  it('debounces bursts of fs events into a single cycle', async () => {
    vi.useFakeTimers();
    const reads = vi.fn(() => Promise.resolve(ok('codex')));
    const a = adapter('codex', reads);
    const engine = new RefreshEngine([a], () => {}, { debounceMs: 500 });

    engine.notifyChange('codex');
    engine.notifyChange('codex');
    engine.notifyChange('codex');
    await vi.advanceTimersByTimeAsync(499);
    expect(reads).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(reads).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run test/refresh.test.ts
```
Expected: FAIL — `RefreshEngine` not found.

- [ ] **Step 3: Implement `src/core/refresh.ts`**

```ts
import { watch, type FSWatcher } from 'node:fs';
import type { AgentAdapter, AgentId, UsageReport } from './types';

export interface RefreshOptions {
  debounceMs?: number;
  rescanIntervalMs?: number;
}

export class RefreshEngine {
  private watchers: FSWatcher[] = [];
  private debounceTimers = new Map<AgentId, NodeJS.Timeout>();
  private rescanTimer: NodeJS.Timeout | null = null;
  private readonly debounceMs: number;

  constructor(
    private adapters: AgentAdapter[],
    private onUpdate: (reports: UsageReport[]) => void,
    opts: RefreshOptions = {},
  ) {
    this.debounceMs = opts.debounceMs ?? 500;
    if (opts.rescanIntervalMs && opts.rescanIntervalMs > 0) {
      this.rescanTimer = setInterval(() => void this.refreshAll(), opts.rescanIntervalMs);
    }
  }

  start(): void {
    for (const a of this.adapters) {
      for (const dir of a.watchPaths()) {
        try {
          const w = watch(dir, { recursive: true }, () => this.notifyChange(a.id));
          this.watchers.push(w);
        } catch {
          /* missing dir ⇒ adapter will report noData; nothing to watch */
        }
      }
    }
  }

  notifyChange(id: AgentId): void {
    const existing = this.debounceTimers.get(id);
    if (existing) clearTimeout(existing);
    this.debounceTimers.set(
      id,
      setTimeout(() => {
        this.debounceTimers.delete(id);
        void this.refreshOne(id);
      }, this.debounceMs),
    );
  }

  private async safeRead(a: AgentAdapter): Promise<UsageReport> {
    try {
      return await a.read();
    } catch (err) {
      return {
        agent: a.id,
        status: 'unknown',
        windows: [],
        raw: [],
        fetchedAt: new Date().toISOString(),
        source: a.sources()[0] ?? '',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async refreshAll(): Promise<UsageReport[]> {
    const settled = await Promise.allSettled(this.adapters.map((a) => this.safeRead(a)));
    const reports = settled.map((s, i) =>
      s.status === 'fulfilled'
        ? s.value
        : {
            agent: this.adapters[i]!.id,
            status: 'unknown' as const,
            windows: [],
            raw: [],
            fetchedAt: new Date().toISOString(),
            source: '',
            error: String((s as PromiseRejectedResult).reason),
          },
    );
    this.onUpdate(reports);
    return reports;
  }

  private async refreshOne(id: AgentId): Promise<void> {
    const a = this.adapters.find((x) => x.id === id);
    if (!a) return;
    const report = await this.safeRead(a);
    this.onUpdate([report]);
  }

  dispose(): void {
    for (const w of this.watchers) w.close();
    this.watchers = [];
    for (const t of this.debounceTimers.values()) clearTimeout(t);
    this.debounceTimers.clear();
    if (this.rescanTimer) clearInterval(this.rescanTimer);
  }
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run test/refresh.test.ts
```
Expected: PASS (allSettled isolation + debounce).

- [ ] **Step 5: Commit**

```bash
git add src/core/refresh.ts test/refresh.test.ts
git commit -m "feat(M1): refresh engine — fs.watch debounce + allSettled isolation (TDD)"
```

### Task 1.4: `registry` + wire engine into main

**Files:** Create `src/core/registry.ts`; modify `src/main/main.ts`

- [ ] **Step 1: Create `src/core/registry.ts`**

```ts
import type { AgentAdapter, Settings } from './types';

export function enabledAdapters(all: AgentAdapter[], settings: Settings): AgentAdapter[] {
  return all.filter((a) => settings.enabled[a.id]);
}
```

- [ ] **Step 2: Modify `src/main/main.ts`** to wire store + engine + IPC (adapters added in M2–M4; start with an empty array so the app still runs)

```ts
import { app, ipcMain } from 'electron';
import { TrayController } from './tray';
import { IPC } from './ipc';
import { Store } from '../core/store';
import { RefreshEngine } from '../core/refresh';
import { enabledAdapters } from '../core/registry';
import type { AgentAdapter, UsageReport } from '../core/types';

let tray: TrayController | null = null;
let store: Store | null = null;
let engine: RefreshEngine | null = null;

// Adapters registered here in M2–M4:
const ALL_ADAPTERS: AgentAdapter[] = [];

function pushReports(reports: UsageReport[]): void {
  if (!store || !tray) return;
  for (const r of reports) store.setReport(r);
  const all = store.getReports();
  tray.window.webContents.send(IPC.reports, all);
  tray.setTitle(all, store.getSettings().trayTitleMode);
}

app.on('ready', () => {
  if (process.platform === 'darwin') app.dock?.hide();
  store = new Store(app.getPath('userData'));
  const settings = store.getSettings();
  const adapters = enabledAdapters(ALL_ADAPTERS, settings);
  engine = new RefreshEngine(adapters, pushReports, { rescanIntervalMs: settings.rescanIntervalMs });
  engine.start();

  tray = new TrayController(() => void engine?.refreshAll()); // refresh-on-open
  void engine.refreshAll();

  ipcMain.handle(IPC.ping, () => 'pong');
  ipcMain.on(IPC.refresh, () => void engine?.refreshAll());
  ipcMain.handle(IPC.getSettings, () => store!.getSettings());
  ipcMain.handle(IPC.setSettings, (_e, patch) => {
    const next = store!.setSettings(patch);
    tray!.setTitle(store!.getReports(), next.trayTitleMode);
    return next;
  });
});

app.on('window-all-closed', (e: Electron.Event) => e.preventDefault());
app.on('before-quit', () => engine?.dispose());
```

- [ ] **Step 3: Typecheck + run**

```bash
npm run typecheck && npm run dev
```
Expected: typecheck clean; app launches, popover still shows heartbeat; no reports yet (empty adapter list). No crash.

- [ ] **Step 4: Commit**

```bash
git add src/core/registry.ts src/main/main.ts
git commit -m "feat(M1): registry + wire store/engine/IPC into main"
```

---

# M2 — Codex adapter (first real number)

**Deliverable:** Codex shows native binding headroom (min of 5h/weekly) with a real reset. No budget config needed — ships first.

### Task 2.1: Codex fixtures

**Files:** Create `test/fixtures/codex/rollout.jsonl`, `test/fixtures/codex/no-ratelimits.jsonl`

- [ ] **Step 1: Create `test/fixtures/codex/rollout.jsonl`** (PII-free; two rate_limits events — the later one must win)

```jsonl
{"timestamp":"2026-06-19T01:00:00.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"total_tokens":1000}},"rate_limits":{"limit_id":"codex","primary":{"used_percent":40.0,"window_minutes":300,"resets_at":1781850000},"secondary":{"used_percent":8.0,"window_minutes":10080,"resets_at":1782348192},"plan_type":"prolite"}}}
{"timestamp":"2026-06-19T02:40:48.080Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"total_tokens":2000}},"rate_limits":{"limit_id":"codex","primary":{"used_percent":5.0,"window_minutes":300,"resets_at":1781851618},"secondary":{"used_percent":11.0,"window_minutes":10080,"resets_at":1782348192},"plan_type":"prolite"}}}
{"timestamp":"2026-06-19T02:41:00.000Z","type":"response_item","payload":{"type":"message","role":"assistant","content":"no rate limits here"}}
```

- [ ] **Step 2: Create `test/fixtures/codex/no-ratelimits.jsonl`** (a session with zero rate_limits events)

```jsonl
{"timestamp":"2026-06-19T03:00:00.000Z","type":"session_meta","payload":{"id":"abc"}}
{"timestamp":"2026-06-19T03:00:01.000Z","type":"response_item","payload":{"type":"message","role":"user","content":"hi"}}
```

- [ ] **Step 3: Commit**

```bash
git add test/fixtures/codex
git commit -m "test(M2): codex rollout fixtures (with + without rate_limits)"
```

### Task 2.2: Codex parse functions (TDD)

**Files:** Create `src/adapters/codex.ts` (parse helpers first), `test/codex.test.ts`

- [ ] **Step 1: Write the failing test** (`test/codex.test.ts`, parse-only section)

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseRateLimits, latestRateLimits, ratesToWindows } from '../src/adapters/codex';

const fx = (name: string) => readFileSync(path.join(__dirname, 'fixtures/codex', name), 'utf8');

describe('parseRateLimits', () => {
  it('reads nested payload.rate_limits', () => {
    const line = '{"type":"event_msg","payload":{"type":"token_count","rate_limits":{"primary":{"used_percent":5,"window_minutes":300,"resets_at":1781851618}}}}';
    expect(parseRateLimits(line)?.primary?.used_percent).toBe(5);
  });
  it('returns null for non-rate_limits lines', () => {
    expect(parseRateLimits('{"type":"response_item","payload":{}}')).toBeNull();
    expect(parseRateLimits('not json')).toBeNull();
  });
});

describe('latestRateLimits', () => {
  it('returns the last rate_limits event in the file', () => {
    const r = latestRateLimits(fx('rollout.jsonl'));
    expect(r?.rl.primary?.used_percent).toBe(5.0);     // the 02:40 event, not the 01:00 one
    expect(r?.rl.secondary?.used_percent).toBe(11.0);
    expect(r?.rl.plan_type).toBe('prolite');
  });
  it('returns null when no rate_limits present', () => {
    expect(latestRateLimits(fx('no-ratelimits.jsonl'))).toBeNull();
  });
});

describe('ratesToWindows', () => {
  it('maps used_percent→headroom and epoch-seconds→ISO', () => {
    const ws = ratesToWindows({
      primary: { used_percent: 5, window_minutes: 300, resets_at: 1781851618 },
      secondary: { used_percent: 11, window_minutes: 10080, resets_at: 1782348192 },
    });
    expect(ws).toEqual([
      { label: 'codex-5h', headroomPct: 95, resetAt: new Date(1781851618 * 1000).toISOString() },
      { label: 'codex-weekly', headroomPct: 89, resetAt: new Date(1782348192 * 1000).toISOString() },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run test/codex.test.ts
```
Expected: FAIL — exports missing.

- [ ] **Step 3: Implement parse helpers in `src/adapters/codex.ts`**

```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { clampPct, normalize } from '../core/normalize';
import { CODEX_SESSIONS_DIR } from '../core/paths';
import type { AgentAdapter, RawMetric, UsageReport, UsageWindow } from '../core/types';

interface RateWindow { used_percent: number; window_minutes?: number; resets_at?: number; }
export interface RateLimits {
  primary?: RateWindow;
  secondary?: RateWindow;
  plan_type?: string;
}

export function parseRateLimits(line: string): RateLimits | null {
  if (!line.includes('rate_limits')) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(line);
  } catch {
    return null;
  }
  const o = obj as { payload?: { rate_limits?: unknown }; rate_limits?: unknown };
  const rl = o.payload?.rate_limits ?? o.rate_limits;
  if (!rl || typeof rl !== 'object') return null;
  return rl as RateLimits;
}

export function latestRateLimits(text: string): { rl: RateLimits; ts?: string } | null {
  let found: { rl: RateLimits; ts?: string } | null = null;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const rl = parseRateLimits(line);
    if (rl) {
      let ts: string | undefined;
      try {
        ts = (JSON.parse(line) as { timestamp?: string }).timestamp;
      } catch {
        /* ignore */
      }
      found = { rl, ts }; // later lines overwrite ⇒ keeps the last
    }
  }
  return found;
}

const epochToIso = (s?: number): string | undefined =>
  typeof s === 'number' ? new Date(s * 1000).toISOString() : undefined;

export function ratesToWindows(rl: RateLimits): UsageWindow[] {
  const windows: UsageWindow[] = [];
  if (rl.primary) {
    windows.push({ label: 'codex-5h', headroomPct: clampPct(100 - rl.primary.used_percent), resetAt: epochToIso(rl.primary.resets_at) });
  }
  if (rl.secondary) {
    windows.push({ label: 'codex-weekly', headroomPct: clampPct(100 - rl.secondary.used_percent), resetAt: epochToIso(rl.secondary.resets_at) });
  }
  return windows;
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run test/codex.test.ts
```
Expected: PASS (parse + windows).

- [ ] **Step 5: Commit**

```bash
git add src/adapters/codex.ts test/codex.test.ts
git commit -m "feat(M2): codex parse helpers (nested rate_limits → windows) (TDD)"
```

### Task 2.3: Codex adapter `read()` + file scan (TDD)

**Files:** Modify `src/adapters/codex.ts`, `test/codex.test.ts`

- [ ] **Step 1: Add failing test for `read()`** (append to `test/codex.test.ts`)

```ts
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { CodexAdapter } from '../src/adapters/codex';

describe('CodexAdapter.read', () => {
  it('reads the newest rollout with rate_limits and binds the lower window', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gage-codex-'));
    const day = path.join(dir, '2026', '06', '19');
    mkdirSync(day, { recursive: true });
    // older file with a different (higher-headroom) state
    const older = path.join(day, 'rollout-2026-06-19T01-00-00-aaaa.jsonl');
    writeFileSync(older, fx('rollout.jsonl'));
    utimesSync(older, new Date('2026-06-19T01:00:00Z'), new Date('2026-06-19T01:00:00Z'));
    // newest file with NO rate_limits ⇒ adapter must fall back to the older one
    const newest = path.join(day, 'rollout-2026-06-19T03-00-00-bbbb.jsonl');
    writeFileSync(newest, fx('no-ratelimits.jsonl'));
    utimesSync(newest, new Date('2026-06-19T03:00:00Z'), new Date('2026-06-19T03:00:00Z'));

    const r = await new CodexAdapter(dir).read();
    rmSync(dir, { recursive: true, force: true });

    expect(r.status).toBe('ok');
    expect(r.bindingWindow).toBe('codex-5h');   // primary 5% used ⇒ 95% headroom vs weekly 89%
    expect(r.headroomPct).toBe(89);             // weekly is the binding (lower) window
    expect(r.windows).toHaveLength(2);
    expect(r.raw.some((m) => m.label === 'plan_type')).toBe(true);
  });

  it('reports noData when the sessions dir is absent', async () => {
    const r = await new CodexAdapter('/no/such/dir').read();
    expect(r.status).toBe('noData');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run test/codex.test.ts
```
Expected: FAIL — `CodexAdapter` not exported.

- [ ] **Step 3: Implement the adapter** (append to `src/adapters/codex.ts`)

```ts
async function findRolloutFiles(dir: string, cap = 25): Promise<{ file: string; mtimeMs: number }[]> {
  const out: { file: string; mtimeMs: number }[] = [];
  async function walk(d: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile() && e.name.startsWith('rollout-') && e.name.endsWith('.jsonl')) {
        try {
          const st = await fs.stat(p);
          out.push({ file: p, mtimeMs: st.mtimeMs });
        } catch {
          /* ignore */
        }
      }
    }
  }
  await walk(dir);
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, cap);
}

export class CodexAdapter implements AgentAdapter {
  readonly id = 'codex' as const;
  readonly displayName = 'Codex';

  constructor(private dir: string = CODEX_SESSIONS_DIR) {}

  sources(): string[] {
    return [path.join(this.dir, 'YYYY/MM/DD/rollout-*.jsonl')];
  }
  watchPaths(): string[] {
    return [this.dir];
  }

  async read(): Promise<UsageReport> {
    const fetchedAt = new Date().toISOString();
    const files = await findRolloutFiles(this.dir);
    if (files.length === 0) {
      return normalize({
        agent: this.id, windows: [], raw: [], source: this.dir, fetchedAt,
        noData: true, hint: 'no Codex sessions found in ~/.codex/sessions',
      });
    }
    for (const { file } of files) {
      let text: string;
      try {
        text = await fs.readFile(file, 'utf8');
      } catch {
        continue;
      }
      const latest = latestRateLimits(text);
      if (!latest) continue;
      const windows = ratesToWindows(latest.rl);
      const raw: RawMetric[] = [];
      if (latest.rl.primary) raw.push({ label: '5h used', value: `${latest.rl.primary.used_percent}%` });
      if (latest.rl.secondary) raw.push({ label: 'weekly used', value: `${latest.rl.secondary.used_percent}%` });
      if (latest.rl.plan_type) raw.push({ label: 'plan_type', value: latest.rl.plan_type });
      if (latest.ts) raw.push({ label: 'snapshot', value: latest.ts });
      return normalize({ agent: this.id, windows, raw, source: file, fetchedAt });
    }
    return normalize({
      agent: this.id, windows: [], raw: [], source: this.dir, fetchedAt,
      noData: true, hint: 'no rate_limits event found in recent Codex sessions',
    });
  }
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run test/codex.test.ts
```
Expected: PASS (newest-with-rate_limits selection, binding window, noData).

- [ ] **Step 5: Register Codex in main** (`src/main/main.ts`)

```ts
import { CodexAdapter } from '../adapters/codex';
// ...
const ALL_ADAPTERS: AgentAdapter[] = [new CodexAdapter()];
```

- [ ] **Step 6: Manual verify against the live machine**

```bash
npm run dev
```
Expected: popover (after M5 rows; for now check console/devtools) and tray title show Codex headroom. Cross-check the number: open the newest `~/.codex/sessions/.../rollout-*.jsonl`, find the last `rate_limits`, confirm `100 − used_percent` for the binding window matches gage.

- [ ] **Step 7: Commit**

```bash
git add src/adapters/codex.ts test/codex.test.ts src/main/main.ts
git commit -m "feat(M2): codex adapter end-to-end — first real headroom number (TDD)"
```

---

# M3 — Devin adapter

**Deliverable:** Devin shows ACU headroom vs the monthly budget (`monthly_budget` from `devin-token-monitor/config.json`); `noData` + hint when the budget is unset (the current machine state).

> **AS-BUILT (2026-06-19) — supersedes Task 3.3 below.** better-sqlite3 is **lazy-loaded inside `read()`** (`const { default: Database } = await import('better-sqlite3')`), not imported at module top level, because electron-rebuild compiles it for Electron's ABI and Vitest runs under node's ABI — a top-level import would crash every test that imports `devin.ts`. The fragile logic is extracted into **pure functions** `sumAcuFromRows(rows)` and `buildDevinReport({totals,budget,resetAt,...})`, unit-tested directly with row arrays (no in-test SQLite, so `seed.ts` is dropped). The real SQLite read (join + `hidden` filter + epoch-scale detect) is the thin I/O boundary, **integration-verified** by running the query under Electron's node (`ELECTRON_RUN_AS_NODE=1 npx electron …`) against the live DB and confirming the ACU total matches the reference Devin reader exactly (390.2605 ACU / 19 668 requests). **Perf:** better-sqlite3 is synchronous and blocks the Electron main thread; an all-time scan of 252 k rows took ~4.9 s, so production must keep the cycle-start `WHERE m.created_at >= ?` filter and should move the read to a `utilityProcess`/worker as a follow-up.

### Task 3.1: Cycle math (TDD) — port `monthly_period`

**Files:** Create `src/core/cycles.ts`, `test/cycles.test.ts`

- [ ] **Step 1: Write the failing test** (`test/cycles.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { toCalDate, addMonthsCal, compareCal, monthlyPeriod, calToDate } from '../src/core/cycles';

describe('addMonthsCal', () => {
  it('clamps end-of-month (Jan 31 +1 ⇒ Feb 28/29)', () => {
    expect(addMonthsCal({ y: 2026, m: 0, d: 31 }, 1)).toEqual({ y: 2026, m: 1, d: 28 });
    expect(addMonthsCal({ y: 2024, m: 0, d: 31 }, 1)).toEqual({ y: 2024, m: 1, d: 29 }); // leap
  });
  it('rolls years', () => {
    expect(addMonthsCal({ y: 2026, m: 11, d: 5 }, 1)).toEqual({ y: 2027, m: 0, d: 5 });
    expect(addMonthsCal({ y: 2026, m: 0, d: 5 }, -1)).toEqual({ y: 2025, m: 11, d: 5 });
  });
});

describe('monthlyPeriod', () => {
  it('finds the current cycle for an anchor in the past', () => {
    // anchor 2026-01-15, today 2026-06-19 ⇒ cycle [2026-06-15, 2026-07-15)
    const p = monthlyPeriod({ y: 2026, m: 0, d: 15 }, { y: 2026, m: 5, d: 19 });
    expect(p.start).toEqual({ y: 2026, m: 5, d: 15 });
    expect(p.endExclusive).toEqual({ y: 2026, m: 6, d: 15 });
  });
  it('handles an anchor in the future (steps back)', () => {
    const p = monthlyPeriod({ y: 2026, m: 11, d: 1 }, { y: 2026, m: 5, d: 19 });
    expect(p.start).toEqual({ y: 2026, m: 5, d: 1 });
    expect(p.endExclusive).toEqual({ y: 2026, m: 6, d: 1 });
  });
  it('compareCal orders dates', () => {
    expect(compareCal({ y: 2026, m: 5, d: 1 }, { y: 2026, m: 5, d: 2 })).toBeLessThan(0);
  });
  it('calToDate yields local midnight', () => {
    const d = calToDate({ y: 2026, m: 5, d: 15 });
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(5);
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run test/cycles.test.ts
```
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `src/core/cycles.ts`**

```ts
export interface CalDate {
  y: number;
  m: number; // 0-based month
  d: number;
}

export function toCalDate(date: Date): CalDate {
  return { y: date.getFullYear(), m: date.getMonth(), d: date.getDate() };
}

export function calToDate(c: CalDate): Date {
  return new Date(c.y, c.m, c.d, 0, 0, 0, 0);
}

function lastDayOfMonth(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate();
}

export function addMonthsCal(c: CalDate, months: number): CalDate {
  const idx = c.m + months;
  const y = c.y + Math.floor(idx / 12);
  const m = ((idx % 12) + 12) % 12;
  return { y, m, d: Math.min(c.d, lastDayOfMonth(y, m)) };
}

export function compareCal(a: CalDate, b: CalDate): number {
  return a.y - b.y || a.m - b.m || a.d - b.d;
}

export function monthlyPeriod(anchor: CalDate, today: CalDate): { start: CalDate; endExclusive: CalDate } {
  let cur = anchor;
  while (compareCal(cur, today) > 0) cur = addMonthsCal(cur, -1);
  while (compareCal(addMonthsCal(cur, 1), today) <= 0) cur = addMonthsCal(cur, 1);
  return { start: cur, endExclusive: addMonthsCal(cur, 1) };
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run test/cycles.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/cycles.ts test/cycles.test.ts
git commit -m "feat(M3): monthly cycle math ported from a local reference reader (TDD)"
```

### Task 3.2: Config readers (TDD)

**Files:** Create `src/adapters/config.ts`, `test/config.test.ts`

- [ ] **Step 1: Write the failing test** (`test/config.test.ts`)

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readClaudeBudget, readDevinBudget } from '../src/adapters/config';

let dir: string;
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'gage-cfg-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('readClaudeBudget', () => {
  it('returns warningThreshold but undefined amount when only threshold set', () => {
    const f = path.join(dir, 'claude-powerline.json');
    writeFileSync(f, JSON.stringify({ budget: { session: { warningThreshold: 80 } } }));
    expect(readClaudeBudget(f)).toEqual({ warningThreshold: 80, amountTokens: undefined });
  });
  it('reads an absolute amount when present', () => {
    const f = path.join(dir, 'claude-powerline.json');
    writeFileSync(f, JSON.stringify({ budget: { session: { warningThreshold: 75, amount: 2_000_000 } } }));
    expect(readClaudeBudget(f)).toEqual({ warningThreshold: 75, amountTokens: 2_000_000 });
  });
  it('returns null when the file is absent', () => {
    expect(readClaudeBudget(path.join(dir, 'nope.json'))).toBeNull();
  });
});

describe('readDevinBudget', () => {
  it('reads monthly_budget.start_date + monthly_acu', () => {
    const f = path.join(dir, 'config.json');
    writeFileSync(f, JSON.stringify({ monthly_budget: { start_date: '2026-06-01', monthly_acu: 100 } }));
    expect(readDevinBudget(f)).toEqual({ startDate: '2026-06-01', monthlyAcu: 100 });
  });
  it('returns null when file absent or budget unset', () => {
    expect(readDevinBudget(path.join(dir, 'nope.json'))).toBeNull();
    const f = path.join(dir, 'config.json');
    writeFileSync(f, JSON.stringify({}));
    expect(readDevinBudget(f)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run test/config.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `src/adapters/config.ts`**

```ts
import { readFileSync, existsSync } from 'node:fs';
import { CLAUDE_POWERLINE_CONFIG, DEVIN_BUDGET_CONFIG } from '../core/paths';

function readJson(file: string): unknown | null {
  if (!existsSync(file)) return null;
  try {
    const text = readFileSync(file, 'utf8');
    return text.trim() ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

export interface ClaudeBudget {
  amountTokens?: number;   // absolute per-block token cap; undefined ⇒ noData
  warningThreshold?: number; // %, drives tight cutoff
}

export function readClaudeBudget(file: string = CLAUDE_POWERLINE_CONFIG): ClaudeBudget | null {
  const data = readJson(file) as { budget?: { session?: { amount?: number; warningThreshold?: number } } } | null;
  if (!data) return null;
  const session = data.budget?.session;
  if (!session) return null;
  return {
    amountTokens: typeof session.amount === 'number' ? session.amount : undefined,
    warningThreshold: typeof session.warningThreshold === 'number' ? session.warningThreshold : undefined,
  };
}

export interface DevinBudget {
  startDate: string; // YYYY-MM-DD
  monthlyAcu: number;
}

export function readDevinBudget(file: string = DEVIN_BUDGET_CONFIG): DevinBudget | null {
  const data = readJson(file) as { monthly_budget?: { start_date?: string; monthly_acu?: number } } | null;
  const b = data?.monthly_budget;
  if (!b || typeof b.start_date !== 'string' || typeof b.monthly_acu !== 'number') return null;
  return { startDate: b.start_date, monthlyAcu: b.monthly_acu };
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run test/config.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/config.ts test/config.test.ts
git commit -m "feat(M3): config readers — claude amount + devin monthly_budget (TDD)"
```

### Task 3.3: Devin sqlite reader + adapter (TDD)

**Files:** Create `test/fixtures/devin/seed.ts`, `src/adapters/devin.ts`, `test/devin.test.ts`

- [ ] **Step 1: Create the in-test DB seeder** (`test/fixtures/devin/seed.ts`)

```ts
import Database from 'better-sqlite3';

export interface SeedNode {
  sessionId: string;
  createdAt: number; // epoch ms
  acu?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  hidden?: number;
  model?: string;
}

/** Build a minimal sessions.db matching the real Devin schema subset. */
export function seedDevinDb(file: string, nodes: SeedNode[]): void {
  const db = new Database(file);
  db.exec(`
    CREATE TABLE sessions (id TEXT PRIMARY KEY, working_directory TEXT, backend_type TEXT,
      model TEXT, created_at INTEGER, last_activity_at INTEGER, hidden INTEGER, metadata TEXT);
    CREATE TABLE message_nodes (row_id INTEGER PRIMARY KEY, session_id TEXT, node_id INTEGER,
      created_at INTEGER, chat_message TEXT, metadata TEXT);
  `);
  const sessions = new Map<string, { hidden: number; model: string }>();
  for (const n of nodes) {
    if (!sessions.has(n.sessionId)) sessions.set(n.sessionId, { hidden: n.hidden ?? 0, model: n.model ?? 'gpt-5-5-medium' });
  }
  const insS = db.prepare('INSERT INTO sessions (id, working_directory, backend_type, model, created_at, last_activity_at, hidden) VALUES (?,?,?,?,?,?,?)');
  for (const [id, s] of sessions) insS.run(id, '/proj', 'native', s.model, 0, 0, s.hidden);
  const insM = db.prepare('INSERT INTO message_nodes (session_id, node_id, created_at, chat_message) VALUES (?,?,?,?)');
  let nid = 0;
  for (const n of nodes) {
    const chat = JSON.stringify({
      metadata: {
        committed_acu_cost: n.acu,
        metrics: { input_tokens: n.inputTokens ?? 0, output_tokens: n.outputTokens ?? 0, cache_read_tokens: n.cacheReadTokens ?? 0 },
      },
    });
    insM.run(n.sessionId, nid++, n.createdAt, chat);
  }
  db.close();
}
```

- [ ] **Step 2: Write the failing test** (`test/devin.test.ts`)

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { seedDevinDb } from './fixtures/devin/seed';
import { DevinAdapter } from '../src/adapters/devin';

let dir: string;
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'gage-devin-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function isoToMs(d: string): number { return new Date(d).getTime(); }

describe('DevinAdapter', () => {
  it('sums committed_acu_cost within the current monthly cycle and derives headroom', async () => {
    const db = path.join(dir, 'sessions.db');
    // anchor 2026-06-01; "now" cycle = [2026-06-01, 2026-07-01)
    seedDevinDb(db, [
      { sessionId: 's1', createdAt: isoToMs('2026-05-20T00:00:00Z'), acu: 50 }, // before cycle ⇒ excluded
      { sessionId: 's1', createdAt: Date.now() - 1000, acu: 10 },               // in cycle
      { sessionId: 's2', createdAt: Date.now() - 2000, acu: 15, hidden: 1 },    // hidden ⇒ excluded
      { sessionId: 's3', createdAt: Date.now() - 500, acu: 5 },                 // in cycle
    ]);
    const cfg = path.join(dir, 'config.json');
    writeFileSync(cfg, JSON.stringify({ monthly_budget: { start_date: '2026-06-01', monthly_acu: 100 } }));

    const r = await new DevinAdapter(db, cfg).read();
    expect(r.status).toBe('ok');            // 15 used of 100 ⇒ 85% headroom
    expect(r.headroomPct).toBe(85);
    expect(r.bindingWindow).toBe('devin-month');
    expect(r.raw.find((m) => m.label === 'used ACU')?.value).toBe('15.0000');
  });

  it('reports noData (with raw usage) when the budget config is absent', async () => {
    const db = path.join(dir, 'sessions.db');
    seedDevinDb(db, [{ sessionId: 's1', createdAt: Date.now() - 1000, acu: 10 }]);
    const r = await new DevinAdapter(db, path.join(dir, 'missing.json')).read();
    expect(r.status).toBe('noData');
    expect(r.hint).toMatch(/budget/i);
  });

  it('reports noData when the db is absent', async () => {
    const r = await new DevinAdapter(path.join(dir, 'nope.db'), path.join(dir, 'nope.json')).read();
    expect(r.status).toBe('noData');
  });
});
```

- [ ] **Step 3: Run to verify it fails**

```bash
npx vitest run test/devin.test.ts
```
Expected: FAIL — `DevinAdapter` missing.

- [ ] **Step 4: Implement `src/adapters/devin.ts`**

```ts
import { existsSync } from 'node:fs';
import Database from 'better-sqlite3';
import { normalize, windowHeadroom } from '../core/normalize';
import { monthlyPeriod, toCalDate, calToDate } from '../core/cycles';
import { readDevinBudget } from './config';
import { DEVIN_DB, DEVIN_BUDGET_CONFIG, DEVIN_CLI_DIR } from '../core/paths';
import type { AgentAdapter, RawMetric, UsageReport, UsageWindow } from '../core/types';

function normalizeMs(v: number): number {
  return v > 1e12 ? v : v * 1000; // values may be seconds or ms; return ms
}

export class DevinAdapter implements AgentAdapter {
  readonly id = 'devin' as const;
  readonly displayName = 'Devin';

  constructor(private dbPath: string = DEVIN_DB, private configPath: string = DEVIN_BUDGET_CONFIG) {}

  sources(): string[] {
    return [this.dbPath];
  }
  watchPaths(): string[] {
    return [DEVIN_CLI_DIR];
  }

  async read(): Promise<UsageReport> {
    const fetchedAt = new Date().toISOString();
    if (!existsSync(this.dbPath)) {
      return normalize({ agent: this.id, windows: [], raw: [], source: this.dbPath, fetchedAt, noData: true, hint: 'Devin CLI sessions.db not found' });
    }
    const budget = readDevinBudget(this.configPath);
    let db: Database.Database | null = null;
    try {
      db = new Database(this.dbPath, { readonly: true, fileMustExist: true });
      db.pragma('busy_timeout = 200');

      // detect epoch scale (seconds vs ms) from the column
      const maxRow = db.prepare('SELECT MAX(created_at) AS mx FROM message_nodes').get() as { mx: number | null };
      const scaleMs = (maxRow.mx ?? 0) > 1e12;

      const hasHidden = (db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[]).some((c) => c.name === 'hidden');

      // budget present ⇒ bounded query by cycle; absent ⇒ all-time totals for raw only
      let cycleStartMs = 0;
      let resetAt: string | undefined;
      if (budget) {
        const anchor = toCalDate(new Date(`${budget.startDate}T00:00:00`));
        const period = monthlyPeriod(anchor, toCalDate(new Date()));
        cycleStartMs = calToDate(period.start).getTime();
        resetAt = calToDate(period.endExclusive).toISOString();
      }
      const threshold = scaleMs ? cycleStartMs : Math.floor(cycleStartMs / 1000);
      const hiddenFilter = hasHidden ? 'AND s.hidden = 0' : '';
      const rows = db
        .prepare(`SELECT m.chat_message AS cm FROM message_nodes m JOIN sessions s ON s.id = m.session_id WHERE m.created_at >= ? ${hiddenFilter}`)
        .all(threshold) as { cm: string }[];

      let usedAcu = 0;
      let inTok = 0;
      let outTok = 0;
      let requests = 0;
      for (const row of rows) {
        let msg: { metadata?: { committed_acu_cost?: number; metrics?: { input_tokens?: number; output_tokens?: number } } };
        try {
          msg = JSON.parse(row.cm);
        } catch {
          continue;
        }
        const md = msg.metadata ?? {};
        if (typeof md.committed_acu_cost === 'number') {
          usedAcu += md.committed_acu_cost;
          requests += 1;
        }
        inTok += md.metrics?.input_tokens ?? 0;
        outTok += md.metrics?.output_tokens ?? 0;
      }

      const raw: RawMetric[] = [
        { label: 'used ACU', value: usedAcu.toFixed(4) },
        { label: 'requests', value: String(requests) },
        { label: 'input tokens', value: String(inTok) },
        { label: 'output tokens', value: String(outTok) },
      ];

      if (!budget) {
        return normalize({
          agent: this.id, windows: [], raw, source: this.dbPath, fetchedAt,
          noData: true, hint: 'set a Devin budget: edit ~/.config/devin-token-monitor/config.json',
        });
      }
      raw.push({ label: 'budget ACU', value: budget.monthlyAcu.toFixed(4) });
      const headroomPct = windowHeadroom(budget.monthlyAcu - usedAcu, budget.monthlyAcu);
      const windows: UsageWindow[] = [{ label: 'devin-month', headroomPct, resetAt }];
      return normalize({ agent: this.id, windows, raw, source: this.dbPath, fetchedAt });
    } catch (err) {
      return normalize({
        agent: this.id, windows: [], raw: [], source: this.dbPath, fetchedAt,
        unknown: true, error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      db?.close();
    }
  }
}
```

- [ ] **Step 5: Run to verify it passes**

```bash
npx vitest run test/devin.test.ts
```
Expected: PASS (cycle sum, hidden filter, noData paths).

- [ ] **Step 6: Register Devin + manual cross-check against your reference Devin reader**

In `src/main/main.ts`:
```ts
import { DevinAdapter } from '../adapters/devin';
const ALL_ADAPTERS: AgentAdapter[] = [new CodexAdapter(), new DevinAdapter()];
```
Manual cross-check (only if a budget is configured):
```bash
python3 a local Devin usage reader gauge --json | python3 -c "import sys,json;d=json.load(sys.stdin);print('used',d['used_acu'],'assigned',d['assigned_acu'])"
```
Expected: gage's `used ACU` matches the reference reader `used_acu` for the same cycle (small drift OK if the DB changed between reads). On this machine the budget is **unset**, so gage shows Devin `noData` + the "set a Devin budget" hint — that is correct; to verify the % path, first run `add monthly_budget to ~/.config/devin-token-monitor/config.json` then re-open gage.

- [ ] **Step 7: Commit**

```bash
git add src/adapters/devin.ts test/devin.test.ts test/fixtures/devin/seed.ts src/main/main.ts
git commit -m "feat(M3): devin adapter — sessions.db ACU vs monthly budget (TDD)"
```

---

# M4 — Claude adapter

**Deliverable:** Claude shows active 5h-block tokens vs an absolute budget (`budget.session.amount` in `claude-powerline.json`); `noData` + hint when no absolute budget is set (current machine state). `warningThreshold` drives the tight cutoff.

### Task 4.1: 5h rolling-block math (TDD)

**Files:** Create `src/core/blocks.ts`, `test/blocks.test.ts`

- [ ] **Step 1: Write the failing test** (`test/blocks.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { buildBlocks, activeBlock, floorToHour, FIVE_HOURS_MS } from '../src/core/blocks';

const H = 60 * 60 * 1000;
const t = (iso: string) => new Date(iso).getTime();

describe('floorToHour', () => {
  it('floors to the top of the hour', () => {
    expect(floorToHour(t('2026-06-19T03:42:10.000Z'))).toBe(t('2026-06-19T03:00:00.000Z'));
  });
});

describe('buildBlocks', () => {
  it('groups events inside a 5h window into one block, splits across the boundary', () => {
    const events = [
      { ts: t('2026-06-19T03:10:00Z'), tokens: 100 },
      { ts: t('2026-06-19T05:00:00Z'), tokens: 200 }, // same block (within 5h of 03:00 anchor)
      { ts: t('2026-06-19T09:30:00Z'), tokens: 300 }, // new block (>5h after anchor 03:00 & >5h gap)
    ];
    const blocks = buildBlocks(events);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.tokens).toBe(300);
    expect(blocks[0]!.start).toBe(t('2026-06-19T03:00:00Z'));
    expect(blocks[1]!.tokens).toBe(300);
  });

  it('starts a new block after a >5h idle gap even within nominal window', () => {
    const events = [
      { ts: t('2026-06-19T03:00:00Z'), tokens: 50 },
      { ts: t('2026-06-19T09:10:00Z'), tokens: 60 }, // 6h10m gap ⇒ new block
    ];
    expect(buildBlocks(events)).toHaveLength(2);
  });
});

describe('activeBlock', () => {
  const events = [
    { ts: t('2026-06-19T03:10:00Z'), tokens: 100 },
    { ts: t('2026-06-19T04:00:00Z'), tokens: 200 },
  ];
  it('returns the block containing now', () => {
    const b = activeBlock(buildBlocks(events), t('2026-06-19T05:30:00Z'));
    expect(b?.tokens).toBe(300); // 05:30 within [03:00, 08:00)
  });
  it('returns the last block when activity was < 5h ago', () => {
    const b = activeBlock(buildBlocks(events), t('2026-06-19T08:30:00Z'));
    expect(b?.tokens).toBe(300); // past window end but last activity 04:00, 4h30m ago
  });
  it('returns undefined when the last activity is > 5h ago', () => {
    const b = activeBlock(buildBlocks(events), t('2026-06-19T10:30:00Z'));
    expect(b).toBeUndefined();
  });
  it('exposes FIVE_HOURS_MS', () => {
    expect(FIVE_HOURS_MS).toBe(5 * H);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run test/blocks.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `src/core/blocks.ts`**

```ts
export const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export interface UsageEvent {
  ts: number; // epoch ms
  tokens: number;
}

export interface Block {
  start: number;  // floored-to-hour anchor
  end: number;    // start + blockMs
  lastTs: number; // last event ts in the block
  tokens: number;
  count: number;
}

export function floorToHour(ts: number): number {
  return ts - (ts % HOUR_MS);
}

export function buildBlocks(events: UsageEvent[], blockMs = FIVE_HOURS_MS): Block[] {
  const sorted = [...events].sort((a, b) => a.ts - b.ts);
  const blocks: Block[] = [];
  let cur: Block | null = null;
  for (const e of sorted) {
    const withinWindow = cur !== null && e.ts < cur.start + blockMs;
    const withinGap = cur !== null && e.ts - cur.lastTs < blockMs;
    if (cur && withinWindow && withinGap) {
      cur.tokens += e.tokens;
      cur.count += 1;
      cur.lastTs = e.ts;
    } else {
      const start = floorToHour(e.ts);
      cur = { start, end: start + blockMs, lastTs: e.ts, tokens: e.tokens, count: 1 };
      blocks.push(cur);
    }
  }
  return blocks;
}

export function activeBlock(blocks: Block[], now: number, blockMs = FIVE_HOURS_MS): Block | undefined {
  for (const b of blocks) {
    if (now >= b.start && now < b.end) return b;
  }
  const last = blocks[blocks.length - 1];
  if (last && now - last.lastTs < blockMs) return last;
  return undefined;
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run test/blocks.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/blocks.ts test/blocks.test.ts
git commit -m "feat(M4): 5h rolling-block math (ccusage-style) (TDD)"
```

### Task 4.2: Claude transcript parse (TDD)

**Files:** Create `test/fixtures/claude/transcript.jsonl`, `src/adapters/claude.ts` (parse first), `test/claude.test.ts`

- [ ] **Step 1: Create `test/fixtures/claude/transcript.jsonl`** (snake_case usage, two events across a 5h boundary, plus a non-assistant line)

```jsonl
{"type":"user","timestamp":"2026-06-19T03:00:00.000Z","message":{"role":"user","content":"hi"}}
{"type":"assistant","timestamp":"2026-06-19T03:05:00.000Z","message":{"model":"claude-opus-4-8","usage":{"input_tokens":1000,"output_tokens":200,"cache_creation_input_tokens":500,"cache_read_input_tokens":300}}}
{"type":"assistant","timestamp":"2026-06-19T04:30:00.000Z","message":{"model":"claude-opus-4-8","usage":{"input_tokens":2000,"output_tokens":400,"cache_creation_input_tokens":0,"cache_read_input_tokens":1000}}}
{"type":"assistant","timestamp":"2026-06-19T11:00:00.000Z","message":{"model":"claude-opus-4-8","usage":{"input_tokens":100,"output_tokens":50,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}
```

- [ ] **Step 2: Write the failing test** (`test/claude.test.ts`, parse section)

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseUsageEvents } from '../src/adapters/claude';

const fx = readFileSync(path.join(__dirname, 'fixtures/claude/transcript.jsonl'), 'utf8');

describe('parseUsageEvents', () => {
  it('extracts assistant usage as {ts, tokens} summing all 4 snake_case counters', () => {
    const ev = parseUsageEvents(fx);
    expect(ev).toHaveLength(3);                 // 3 assistant events, user line ignored
    expect(ev[0]).toEqual({ ts: new Date('2026-06-19T03:05:00.000Z').getTime(), tokens: 1000 + 200 + 500 + 300 });
    expect(ev[1]!.tokens).toBe(2000 + 400 + 0 + 1000);
  });
  it('ignores malformed lines and lines without usage', () => {
    const ev = parseUsageEvents('not json\n{"type":"user","message":{}}\n');
    expect(ev).toEqual([]);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

```bash
npx vitest run test/claude.test.ts
```
Expected: FAIL.

- [ ] **Step 4: Implement parse in `src/adapters/claude.ts`**

```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { normalize, windowHeadroom } from '../core/normalize';
import { buildBlocks, activeBlock, type UsageEvent } from '../core/blocks';
import { readClaudeBudget } from './config';
import { CLAUDE_PROJECTS_DIR, CLAUDE_POWERLINE_CONFIG } from '../core/paths';
import type { AgentAdapter, RawMetric, UsageReport, UsageWindow } from '../core/types';

interface AssistantLine {
  timestamp?: string;
  message?: {
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
}

export function parseUsageEvents(text: string): UsageEvent[] {
  const out: UsageEvent[] = [];
  for (const line of text.split('\n')) {
    if (!line.includes('"usage"')) continue;
    let obj: AssistantLine;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const u = obj.message?.usage;
    if (!u || !obj.timestamp) continue;
    const tokens =
      (u.input_tokens ?? 0) +
      (u.output_tokens ?? 0) +
      (u.cache_creation_input_tokens ?? 0) +
      (u.cache_read_input_tokens ?? 0);
    if (tokens <= 0) continue;
    out.push({ ts: new Date(obj.timestamp).getTime(), tokens });
  }
  return out;
}
```

- [ ] **Step 5: Run to verify it passes**

```bash
npx vitest run test/claude.test.ts
```
Expected: PASS (parse).

- [ ] **Step 6: Commit**

```bash
git add test/fixtures/claude/transcript.jsonl src/adapters/claude.ts test/claude.test.ts
git commit -m "feat(M4): claude transcript usage parse (snake_case) (TDD)"
```

### Task 4.3: Claude adapter `read()` (TDD)

**Files:** Modify `src/adapters/claude.ts`, `test/claude.test.ts`

- [ ] **Step 1: Add failing test for `read()`** (append to `test/claude.test.ts`)

```ts
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { ClaudeAdapter } from '../src/adapters/claude';

function recentTranscript(): string {
  // two events in the last hour ⇒ a single active block
  const a = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const b = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  return [
    JSON.stringify({ type: 'assistant', timestamp: a, message: { model: 'claude-opus-4-8', usage: { input_tokens: 100000, output_tokens: 20000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }),
    JSON.stringify({ type: 'assistant', timestamp: b, message: { model: 'claude-opus-4-8', usage: { input_tokens: 50000, output_tokens: 10000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }),
  ].join('\n');
}

describe('ClaudeAdapter.read', () => {
  it('computes active-block headroom vs the configured token amount', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gage-claude-'));
    const proj = path.join(dir, 'projects', 'p1');
    mkdirSync(proj, { recursive: true });
    const f = path.join(proj, 's.jsonl');
    writeFileSync(f, recentTranscript());
    utimesSync(f, new Date(), new Date());
    const cfg = path.join(dir, 'claude-powerline.json');
    writeFileSync(cfg, JSON.stringify({ budget: { session: { warningThreshold: 80, amount: 1_000_000 } } }));

    const r = await new ClaudeAdapter(path.join(dir, 'projects'), cfg).read();
    rmSync(dir, { recursive: true, force: true });

    // used = 180_000 of 1_000_000 ⇒ 82% headroom ⇒ ok
    expect(r.status).toBe('ok');
    expect(r.headroomPct).toBe(82);
    expect(r.bindingWindow).toBe('claude-block');
  });

  it('reports noData + hint when no absolute amount is configured', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gage-claude-'));
    const proj = path.join(dir, 'projects', 'p1');
    mkdirSync(proj, { recursive: true });
    writeFileSync(path.join(proj, 's.jsonl'), recentTranscript());
    const cfg = path.join(dir, 'claude-powerline.json');
    writeFileSync(cfg, JSON.stringify({ budget: { session: { warningThreshold: 80 } } })); // no amount

    const r = await new ClaudeAdapter(path.join(dir, 'projects'), cfg).read();
    rmSync(dir, { recursive: true, force: true });
    expect(r.status).toBe('noData');
    expect(r.hint).toMatch(/budget/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run test/claude.test.ts
```
Expected: FAIL — `ClaudeAdapter` not exported.

- [ ] **Step 3: Implement the adapter** (append to `src/adapters/claude.ts`)

```ts
async function recentTranscripts(dir: string, sinceMs: number): Promise<string[]> {
  const files: string[] = [];
  async function walk(d: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile() && e.name.endsWith('.jsonl')) {
        try {
          const st = await fs.stat(p);
          if (st.mtimeMs >= sinceMs) files.push(p);
        } catch {
          /* ignore */
        }
      }
    }
  }
  await walk(dir);
  return files;
}

export class ClaudeAdapter implements AgentAdapter {
  readonly id = 'claude' as const;
  readonly displayName = 'Claude';

  constructor(private dir: string = CLAUDE_PROJECTS_DIR, private configPath: string = CLAUDE_POWERLINE_CONFIG) {}

  sources(): string[] {
    return [path.join(this.dir, '**/*.jsonl')];
  }
  watchPaths(): string[] {
    return [this.dir];
  }

  async read(): Promise<UsageReport> {
    const fetchedAt = new Date().toISOString();
    const now = Date.now();
    const budget = readClaudeBudget(this.configPath);
    const tightCutoff = budget?.warningThreshold ? 100 - budget.warningThreshold : 25;

    // only files touched within the last ~6h can hold the active block
    const files = await recentTranscripts(this.dir, now - 6 * 60 * 60 * 1000);
    const events: UsageEvent[] = [];
    for (const f of files) {
      try {
        events.push(...parseUsageEvents(await fs.readFile(f, 'utf8')));
      } catch {
        /* skip unreadable */
      }
    }

    const block = activeBlock(buildBlocks(events), now);
    const usedTokens = block?.tokens ?? 0;
    const resetAt = block ? new Date(block.end).toISOString() : undefined;
    const raw: RawMetric[] = [
      { label: 'block tokens', value: usedTokens.toLocaleString('en-US') },
      { label: 'events', value: String(block?.count ?? 0) },
    ];

    if (!budget || budget.amountTokens === undefined) {
      raw.push({ label: 'warn threshold', value: budget?.warningThreshold ? `${budget.warningThreshold}%` : 'unset' });
      return normalize({
        agent: this.id, windows: [], raw, source: this.configPath, fetchedAt,
        noData: true, hint: 'set budget.session.amount (tokens) in ~/.claude/claude-powerline.json',
      });
    }
    raw.push({ label: 'budget tokens', value: budget.amountTokens.toLocaleString('en-US') });
    const headroomPct = windowHeadroom(budget.amountTokens - usedTokens, budget.amountTokens);
    const windows: UsageWindow[] = [{ label: 'claude-block', headroomPct, resetAt }];
    return normalize({ agent: this.id, windows, raw, source: this.dir, fetchedAt, tightCutoff });
  }
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run test/claude.test.ts
```
Expected: PASS (block-vs-budget %, noData path).

- [ ] **Step 5: Register Claude + run full suite**

In `src/main/main.ts`:
```ts
import { ClaudeAdapter } from '../adapters/claude';
const ALL_ADAPTERS: AgentAdapter[] = [new CodexAdapter(), new DevinAdapter(), new ClaudeAdapter()];
```
```bash
npm test
```
Expected: all suites green.

- [ ] **Step 6: Manual verify**

```bash
npm run dev
```
On this machine Claude shows `noData` + "set budget.session.amount" (no absolute cap configured). To verify the % path: add `"amount": <tokens>` under `budget.session` in `~/.claude/claude-powerline.json`, reopen gage, confirm the active-block headroom is sensible vs your recent usage.

- [ ] **Step 7: Commit**

```bash
git add src/adapters/claude.ts test/claude.test.ts src/main/main.ts
git commit -m "feat(M4): claude adapter — 5h block vs powerline amount budget (TDD)"
```

---

# M5 — Polish

**Deliverable:** Full popover (sorted rows, expand, states), settings pane, tray modes, real tray icon, README, recorded fixtures, packaged `.app`.

### Task 5.1: Renderer rows + sort + expand

**Files:** Modify `src/renderer/main.ts`, `src/renderer/styles.css`

- [ ] **Step 1: Replace `src/renderer/main.ts`** with the full popover render

```ts
import type { UsageReport, UsageStatus, Settings } from '../core/types';

declare global {
  interface Window {
    gage: {
      onReports: (cb: (reports: UsageReport[]) => void) => () => void;
      refresh: () => void;
      getSettings: () => Promise<Settings>;
      setSettings: (s: Partial<Settings>) => Promise<Settings>;
      ping: () => Promise<string>;
    };
  }
}

const STATUS_ORDER: Record<UsageStatus, number> = { ok: 0, tight: 1, blocked: 2, noData: 3, unknown: 4 };
const DOT: Record<UsageStatus, string> = { ok: '🟢', tight: '🟡', blocked: '🔴', noData: '⚪', unknown: '⚠️' };

function sortReports(reports: UsageReport[]): UsageReport[] {
  return [...reports].sort((a, b) => {
    const ah = a.headroomPct, bh = b.headroomPct;
    if (ah !== undefined && bh !== undefined) return bh - ah;          // higher headroom first
    if (ah !== undefined) return -1;
    if (bh !== undefined) return 1;
    return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];            // both undefined ⇒ by status
  });
}

function fmtReset(iso?: string): string {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'resetting…';
  const m = Math.round(ms / 60000);
  if (m < 60) return `resets in ${m}m`;
  const h = Math.floor(m / 60);
  return `resets in ${h}h ${m % 60}m`;
}

function row(r: UsageReport): HTMLElement {
  const el = document.createElement('div');
  el.className = `row status-${r.status}`;
  const pct = r.headroomPct !== undefined ? `${Math.round(r.headroomPct)}%` : '—';
  const barW = r.headroomPct !== undefined ? Math.round(r.headroomPct) : 0;
  el.innerHTML = `
    <div class="row-head">
      <span class="dot">${DOT[r.status]}</span>
      <span class="name">${r.displayName ?? r.agent}</span>
      <span class="pct">${pct}</span>
    </div>
    <div class="bar"><div class="bar-fill" style="width:${barW}%"></div></div>
    <div class="sub">${fmtReset(r.resetAt)}${r.hint ? ` · ${r.hint}` : ''}</div>
    <div class="detail" hidden>
      ${r.windows.map((w) => `<div>${w.label}: ${Math.round(w.headroomPct)}% ${fmtReset(w.resetAt)}</div>`).join('')}
      ${r.raw.map((m) => `<div class="raw">${m.label}: ${m.value}</div>`).join('')}
      <div class="meta">source: ${r.source}</div>
      <div class="meta">fetched: ${new Date(r.fetchedAt).toLocaleTimeString()}</div>
      ${r.error ? `<div class="err">error: ${r.error}</div>` : ''}
    </div>`;
  el.querySelector('.row-head')!.addEventListener('click', () => {
    const d = el.querySelector('.detail') as HTMLElement;
    d.hidden = !d.hidden;
  });
  return el;
}

const rowsEl = document.getElementById('rows')!;

function render(reports: (UsageReport & { displayName?: string })[]): void {
  rowsEl.innerHTML = '';
  for (const r of sortReports(reports)) rowsEl.appendChild(row(r));
  if (reports.length === 0) rowsEl.innerHTML = '<div class="empty">No agents enabled.</div>';
}

window.gage.onReports(render);
window.gage.refresh();
```

- [ ] **Step 2: Replace `src/renderer/styles.css`**

```css
:root { color-scheme: light dark; font: 13px -apple-system, system-ui, sans-serif; }
body { margin: 0; padding: 6px; }
.row { padding: 8px; border-radius: 8px; }
.row + .row { margin-top: 4px; }
.row-head { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.name { flex: 1; font-weight: 600; }
.pct { font-variant-numeric: tabular-nums; }
.bar { height: 6px; background: color-mix(in srgb, currentColor 12%, transparent); border-radius: 3px; margin: 6px 0 2px; }
.bar-fill { height: 100%; border-radius: 3px; background: #36b37e; }
.status-tight .bar-fill { background: #ffab00; }
.status-blocked .bar-fill { background: #ff5630; }
.status-noData .bar-fill, .status-unknown .bar-fill { background: #8993a4; }
.sub { font-size: 11px; opacity: 0.7; }
.detail { margin-top: 6px; font-size: 11px; opacity: 0.85; }
.detail .raw, .detail .meta { opacity: 0.7; }
.detail .err { color: #ff5630; }
.empty { padding: 16px; text-align: center; opacity: 0.6; }
```

- [ ] **Step 3: Pass `displayName` through IPC** — in `src/main/main.ts::pushReports`, enrich reports with the adapter display name:

```ts
const NAME: Record<string, string> = { codex: 'Codex', claude: 'Claude', devin: 'Devin' };
function pushReports(reports: UsageReport[]): void {
  if (!store || !tray) return;
  for (const r of reports) store.setReport(r);
  const all = store.getReports().map((r) => ({ ...r, displayName: NAME[r.agent] ?? r.agent }));
  tray.window.webContents.send(IPC.reports, all);
  tray.setTitle(all, store.getSettings().trayTitleMode);
}
```

- [ ] **Step 4: Run + eyeball**

```bash
npm run dev
```
Expected: rows sorted with the highest-headroom agent on top; Codex shows a real %, Claude/Devin show `noData` + hint (until budgets set); clicking a row expands windows + raw + source.

- [ ] **Step 5: Commit**

```bash
git add src/renderer src/main/main.ts
git commit -m "feat(M5): popover rows, sort by binding headroom, expandable detail"
```

### Task 5.2: Settings pane + tray modes

**Files:** Modify `src/renderer/main.ts`, `src/renderer/index.html`, `src/renderer/styles.css`

- [ ] **Step 1: Add a settings section to `index.html`** (after `#rows`)

```html
    <div id="rows"></div>
    <div id="footer">
      <button id="refresh">Refresh</button>
      <button id="toggle-settings">Settings</button>
    </div>
    <div id="settings" hidden></div>
```

- [ ] **Step 2: Append settings logic to `src/renderer/main.ts`**

```ts
const settingsEl = document.getElementById('settings')!;
document.getElementById('refresh')!.addEventListener('click', () => window.gage.refresh());
document.getElementById('toggle-settings')!.addEventListener('click', async () => {
  settingsEl.hidden = !settingsEl.hidden;
  if (!settingsEl.hidden) renderSettings(await window.gage.getSettings());
});

function renderSettings(s: Settings): void {
  settingsEl.innerHTML = `
    <h4>Agents</h4>
    ${(['codex', 'claude', 'devin'] as const)
      .map((id) => `<label><input type="checkbox" data-agent="${id}" ${s.enabled[id] ? 'checked' : ''}/> ${id}</label>`)
      .join('')}
    <h4>Tray title</h4>
    <select id="tray-mode">
      ${(['best', 'count', 'icon'] as const).map((m) => `<option value="${m}" ${s.trayTitleMode === m ? 'selected' : ''}>${m}</option>`).join('')}
    </select>
    <p class="meta">Devin budget: <code>edit ~/.config/devin-token-monitor/config.json</code></p>
    <p class="meta">Claude budget: set <code>budget.session.amount</code> in ~/.claude/claude-powerline.json</p>`;
  settingsEl.querySelectorAll<HTMLInputElement>('input[data-agent]').forEach((cb) =>
    cb.addEventListener('change', () =>
      window.gage.setSettings({ enabled: { [cb.dataset.agent!]: cb.checked } as Settings['enabled'] }).then(() => window.gage.refresh()),
    ),
  );
  (settingsEl.querySelector('#tray-mode') as HTMLSelectElement).addEventListener('change', (e) =>
    window.gage.setSettings({ trayTitleMode: (e.target as HTMLSelectElement).value as Settings['trayTitleMode'] }),
  );
}
```

- [ ] **Step 3: Re-create the engine on agent toggle** — in `main.ts` `setSettings` handler, rebuild adapters so disabled agents stop watching/reading:

```ts
ipcMain.handle(IPC.setSettings, (_e, patch) => {
  const next = store!.setSettings(patch);
  engine?.dispose();
  const adapters = enabledAdapters(ALL_ADAPTERS, next);
  engine = new RefreshEngine(adapters, pushReports, { rescanIntervalMs: next.rescanIntervalMs });
  engine.start();
  void engine.refreshAll();
  tray!.setTitle(store!.getReports(), next.trayTitleMode);
  return next;
});
```

- [ ] **Step 4: Add footer/settings styles to `styles.css`**

```css
#footer { display: flex; gap: 8px; padding: 8px 4px 4px; }
#footer button { flex: 1; padding: 4px; }
#settings { padding: 8px 4px; border-top: 1px solid color-mix(in srgb, currentColor 12%, transparent); }
#settings label { display: block; margin: 2px 0; }
#settings .meta { font-size: 11px; opacity: 0.7; }
```

- [ ] **Step 5: Run + verify toggling + tray mode**

```bash
npm run dev
```
Expected: unchecking an agent removes its row and stops its watcher; switching tray mode updates the menu-bar title (`best`→"C 95%", `count`→" 1", `icon`→glyph only).

- [ ] **Step 6: Commit**

```bash
git add src/renderer src/main/main.ts
git commit -m "feat(M5): settings pane (agent toggles, tray modes) + engine rebuild"
```

### Task 5.3: Stale badge

**Files:** Modify `src/main/main.ts` (mark stale), `src/renderer/main.ts` (render badge)

- [ ] **Step 1: Tag stale last-known reports** — when a fresh read fails (`unknown`) but a prior good report exists, surface the old one with a `stale` flag. In `pushReports`, before sending, compute staleness:

```ts
const STALE_MS = 15 * 60 * 1000;
// inside pushReports, when mapping reports for the renderer:
const nowMs = Date.now();
const all = store.getReports().map((r) => ({
  ...r,
  displayName: NAME[r.agent] ?? r.agent,
  stale: nowMs - new Date(r.fetchedAt).getTime() > STALE_MS,
}));
```

- [ ] **Step 2: Render the badge** — in renderer `row()`, append to `.sub`:

```ts
// extend the .sub line:
`<div class="sub">${(r as any).stale ? '⏳ stale · ' : ''}${fmtReset(r.resetAt)}${r.hint ? ` · ${r.hint}` : ''}</div>`
```

- [ ] **Step 3: Run + verify** — rename the Codex sessions dir temporarily so a read degrades; confirm the row keeps the last-known number with a "stale" badge instead of blanking. Restore the dir.

```bash
npm run dev
```

- [ ] **Step 4: Commit**

```bash
git add src/main/main.ts src/renderer/main.ts
git commit -m "feat(M5): stale badge for last-known reports"
```

### Task 5.4: Recorded, scrubbed fixtures (manual-verify capture)

**Files:** Already have `test/fixtures/**`. Confirm none contain PII.

- [ ] **Step 1: Scrub check** — fixtures must contain no real prompts, paths with usernames beyond `~`, session ids tied to real work, or tokens. Scan:

```bash
grep -rIl . test/fixtures | xargs grep -niE "amittiwari|/Users/|cog_|sk-|ghp_|email|@gmail" || echo "clean"
```
Expected: `clean`. If any hit, replace with synthetic values.

- [ ] **Step 2: Commit (if changed)**

```bash
git add test/fixtures
git commit -m "test(M5): confirm PII-free recorded fixtures" || echo "no changes"
```

### Task 5.5: README

**Files:** Create `README.md`

- [ ] **Step 1: Create `README.md`**

```markdown
# gage

Menu-bar gauge of how much usage headroom is left across your local AI agents — **Codex, Claude, Devin** — sorted so the top row is "give the next task to this one." Reads only local files already on your machine. **Zero network calls.**

## What it reads (read-only, local)

| Agent | Source | Metric |
|-------|--------|--------|
| Codex | `~/.codex/sessions/**/rollout-*.jsonl` (newest `rate_limits`) | native `100 − used_percent`, binding min(5h, weekly); real reset |
| Claude | `~/.claude/projects/**/*.jsonl` transcripts | active 5h-block tokens vs `budget.session.amount`; inferred reset |
| Devin | `~/.local/share/devin/cli/sessions.db` (SQLite, read-only) | Σ `committed_acu_cost` this monthly cycle vs `monthly_acu` |

## Run / build locally

```bash
npm install         # rebuilds better-sqlite3 for Electron (postinstall)
npm run dev         # live dev
npm test            # unit tests
npm run dist        # build the unsigned .app into release/
```

## Gatekeeper bypass (unsigned app)

gage is unsigned (personal local run). First launch:

```bash
xattr -dr com.apple.quarantine "/Applications/gage.app"
```

or right-click the app → **Open** → **Open**.

## Budgets

- **Codex** needs no budget — it reports a native percentage out of the box.
- **Devin**: set a monthly ACU budget (shared with a local Devin reference reader):
  ```bash
  add monthly_budget to ~/.config/devin-token-monitor/config.json
  ```
  Writes `~/.config/devin-token-monitor/config.json` → `monthly_budget.{start_date, monthly_acu}`. Until set, Devin shows **noData**.
- **Claude**: add an absolute per-block token cap to `~/.claude/claude-powerline.json`:
  ```json
  { "budget": { "session": { "warningThreshold": 80, "amount": 2000000 } } }
  ```
  `amount` is a token count; `warningThreshold` (%) drives the tight color. Until `amount` is set, Claude shows **noData**.

## Add a new local-source adapter

1. Implement `AgentAdapter` (`src/adapters/<id>.ts`): `sources()`, `watchPaths()`, `read()`.
2. `read()` must **fail soft** — return `normalize({... noData/unknown ...})`, never throw.
3. Parse a local file only; no network. Add a fixture test in `test/`.
4. Register the adapter in `ALL_ADAPTERS` (`src/main/main.ts`) and add it to `Settings.enabled` defaults.

## Privacy

No telemetry, no network. Crash logs (if any) stay in `app.getPath('userData')`. Source files are opened read-only; the SQLite DB is opened `{ readonly: true }`.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(M5): README — what it reads, run/build, Gatekeeper, budgets, adapters"
```

### Task 5.6: electron-builder packaging

**Files:** Create `electron-builder.yml`

- [ ] **Step 1: Create `electron-builder.yml`**

```yaml
appId: me.amittiwari.gage
productName: gage
directories:
  output: release
  buildResources: build
files:
  - out/**
  - package.json
mac:
  category: public.app-category.developer-tools
  target:
    - dir            # unsigned local build; no dmg/notarization
  extendInfo:
    LSUIElement: 1   # menu-bar agent app, no dock icon
asarUnpack:
  - "**/*.node"      # keep better-sqlite3 native binary loadable
```

- [ ] **Step 2: Build the app**

```bash
npm run pack
```
Expected: `release/mac*/gage.app` is produced; launching it shows the tray icon and a working popover (Codex live).

- [ ] **Step 3: Verify the native module loads in the packaged app** — open the packaged app, confirm Devin row does not throw (shows noData or a number, not `unknown: cannot find module`). If it errors, confirm `asarUnpack` captured `better_sqlite3.node`.

- [ ] **Step 4: Commit**

```bash
git add electron-builder.yml
git commit -m "build(M5): electron-builder unsigned mac .app (LSUIElement agent)"
```

### Task 5.7: Real tray icon

**Files:** Replace `build/trayTemplate.png` (+`@2x`)

- [ ] **Step 1: Add a 16×16 (and 32×32 `@2x`) black-on-transparent gauge glyph** as `build/trayTemplate.png` / `build/trayTemplate@2x.png` (template image — black + alpha only).

- [ ] **Step 2: Run + confirm crisp rendering** in light and dark menu bars.

```bash
npm run dev
```

- [ ] **Step 3: Commit**

```bash
git add build/trayTemplate.png build/trayTemplate@2x.png
git commit -m "feat(M5): real tray template icon"
```

### Task 5.8: Full verification gate

- [ ] **Step 1: Full test + typecheck**

```bash
npm test && npm run typecheck
```
Expected: all suites green; no type errors.

- [ ] **Step 2: DoD walk-through (manual)** — launch dev build; confirm:
  - Codex shows a real binding headroom % + real reset countdown, sorted to the correct rank.
  - Devin: with a budget set, shows ACU headroom %; without, shows `noData` + the exact hint.
  - Claude: with `amount` set, shows block headroom %; without, shows `noData` + hint.
  - Editing a source file (e.g. a new Codex session write) updates the row live via `fs.watch`.
  - Refresh-on-open and the manual Refresh button both force a cycle.
  - Disabling one agent removes its row; a missing/locked source degrades to `noData`/`unknown` + stale, never crashes the cycle.

- [ ] **Step 3: Final commit / tag**

```bash
git commit --allow-empty -m "chore(M5): MVP DoD verified — three agents end-to-end"
```

---

## Self-review (run against the spec + kickoff)

**1. Spec coverage**

| Spec/kickoff requirement | Task |
|---|---|
| Local-only, zero network | architecture; no http client anywhere; README privacy |
| Three adapters, isolated, `Promise.allSettled`, fail-soft | 1.3 (engine), all adapters return `normalize(...)` not throws |
| Codex native % binding min(5h,weekly), real reset | 2.2, 2.3 |
| Devin Σ committed_acu_cost vs monthly budget, inferred reset | 3.1–3.3 |
| Claude 5h block vs powerline budget, `noData` path | 4.1–4.3 |
| `normalize` binding/clamp/status/missing-cap | 1.1 |
| Refresh: fs.watch + debounce + refresh-on-open + manual + optional rescan | 1.3, 1.4, 5.2 |
| Store last-known + settings persistence | 1.2 |
| Tray title modes (best/count/icon) | 0.5 `setTitle`, 5.2 |
| Popover sorted by binding headroom, expand, states, settings | 5.1, 5.2, 5.3 |
| Fixture tests (codex/claude/devin), normalize/blocks/cycles, refresh isolation | 2.1, 4.2, 3.3, 1.1, 4.1, 3.1, 1.3 |
| Unsigned `.app` + Gatekeeper doc + crash-logs-local | 5.5, 5.6 |
| `.gitignore` secrets/userData/fixtures; personal git identity | 0.1 |
| README (what/run/build/bypass/budgets/add-adapter) | 5.5 |

**2. Placeholder scan:** every code step ships complete code; commands have expected output. The only deferred artifact is the **tray icon asset** (binary PNG can't be inlined) — handled as M0 placeholder → M5 real glyph (Task 5.7), explicitly flagged, not a logic gap.

**3. Type consistency:** `UsageReport`/`UsageWindow`/`AgentAdapter`/`Settings` defined once in `core/types.ts`; `normalize`/`bindWindows`/`windowHeadroom`/`statusFor` signatures stable across M1–M4; `buildBlocks`/`activeBlock` consistent between `blocks.ts` and `claude.ts`; `monthlyPeriod`/`addMonthsCal`/`toCalDate`/`calToDate` consistent between `cycles.ts` and `devin.ts`; `readClaudeBudget`/`readDevinBudget` shapes match adapter usage.

---

## Flagged decisions (confirm with Amit; none block M0–M2)

1. **Claude cap unit = tokens** (not cost) for MVP — zero pricing-table dependency. Cost-based cap is a documented stretch. *(Spec §16 leaned cost; this trades fidelity-with-powerline for full-local simplicity.)*
2. **gage reads the config; you (or your tooling) write it** the Devin budget config — single source of truth. gage settings pane links the command rather than writing the file in MVP.
3. **Renderer = vanilla TS** (no React).
4. **better-sqlite3 `{readonly:true}`** with `electron-rebuild`; lock/parse error ⇒ `unknown` + last-known, retried next fs event. (Note: the `sqlite3` CLI failed to open the DB; node/python libs succeed — confirmed.)

## Corrections folded in (spec/kickoff were wrong; ground-truth verified)

- Devin budget keys: `monthly_budget.{start_date, monthly_acu}` (not `start`/`acu`).
- Claude usage keys: snake_case `input_tokens`/`output_tokens`/`cache_creation_input_tokens`/`cache_read_input_tokens` (not camelCase).
- Codex `rate_limits` is nested at `payload.rate_limits`.
- Both Claude and Devin budgets are **unset on this machine** → those two default to `noData`; only Codex ships a live % out-of-box. DoD's "all three show real numbers" requires configuring the two budgets first.
```
