# Design Handoff — gage popover UI redesign

> **Paste this whole file to Claude design.** It's self-contained: what gage is, the exact data the UI binds to, the current (weak) UI, every state to cover, brand, and what to deliver. Goal: replace the current popover with a polished, mac-native, glanceable design.

---

## 1. What gage is

`gage` is a **macOS menu-bar (tray) app**. Click the tray icon → a small **popover** drops down listing my AI coding agents — **Codex, Claude, Devin** — each with **how much usage headroom is left**, sorted so the **top row is "give the next task to this one."** It reads only local files; zero network.

The popover is the entire product surface. It must answer, in a glance: *who has the most room right now, and when do limits reset.*

## 2. Platform & tech constraints

- **Electron renderer.** The popover is an HTML/CSS/TS page in a frameless `BrowserWindow`.
- **Size:** currently **340 × 460 px**. Width can stay ~320–360; height can grow/shrink. It's a dropdown panel, not a full window.
- **Stack:** vanilla TypeScript + one `styles.css`. **No framework** today (prefer to keep it dependency-light; small additions OK if justified). Deliverable should drop into `src/renderer/`.
- **macOS-native feel:** system font (`-apple-system, system-ui`), supports **light & dark** (`color-scheme: light dark`), tabular numerals for figures. macOS **vibrancy/translucency** behind the popover is available if the design wants it.
- Renders frequently and on a 340px panel — keep it **dense, fast, legible**.

## 3. Data the UI binds to (exact shapes)

The renderer receives `UsageReport[]` (decorated) over IPC and renders them. Types:

```ts
type AgentId = 'codex' | 'claude' | 'devin';
type UsageStatus = 'ok' | 'tight' | 'blocked' | 'noData' | 'unknown';

interface RawMetric { label: string; value: string; }      // native numbers, e.g. {label:'5h used', value:'14%'}

interface UsageWindow {
  label: string;        // 'codex-5h' | 'codex-weekly' | 'claude-5h' | 'claude-weekly' | 'devin-month'
  headroomPct: number;  // 0..100
  resetAt?: string;     // ISO timestamp
}

interface UsageReport {
  agent: AgentId;
  displayName: string;        // 'Codex' | 'Claude' | 'Devin'
  status: UsageStatus;
  headroomPct?: number;       // binding (lowest) window; undefined when not derivable
  bindingWindow?: string;     // which window set headroomPct
  windows: UsageWindow[];     // all windows for the agent (expand view)
  resetAt?: string;           // reset of the binding window (ISO)
  raw: RawMetric[];           // native numbers verbatim (expand view)
  hint?: string;              // user-facing fix, e.g. 'set a Devin budget …'
  stale?: boolean;            // last-known data, source went quiet
  error?: string;             // present on status:'unknown'
  fetchedAt: string;          // ISO
  source: string;             // file/dir read (debug, expand view)
}
```

Representative live data (3 rows):

```jsonc
[
  { "agent":"codex","displayName":"Codex","status":"ok","headroomPct":86,
    "bindingWindow":"codex-5h","resetAt":"2026-06-19T11:46:00Z",
    "windows":[{"label":"codex-5h","headroomPct":86,"resetAt":"…"},{"label":"codex-weekly","headroomPct":87,"resetAt":"…"}],
    "raw":[{"label":"5h used","value":"14%"},{"label":"weekly used","value":"13%"},{"label":"plan_type","value":"prolite"}] },
  { "agent":"devin","displayName":"Devin","status":"ok","headroomPct":72,
    "bindingWindow":"devin-month","resetAt":"2026-06-30T18:30:00Z",
    "windows":[{"label":"devin-month","headroomPct":72,"resetAt":"…"}],
    "raw":[{"label":"used ACU","value":"55.1151"},{"label":"budget ACU","value":"200.0000"},{"label":"requests","value":"2859"}] },
  { "agent":"claude","displayName":"Claude","status":"ok","headroomPct":71,
    "bindingWindow":"claude-weekly","resetAt":"2026-06-21T15:00:00Z",
    "windows":[{"label":"claude-5h","headroomPct":77,"resetAt":"…"},{"label":"claude-weekly","headroomPct":71,"resetAt":"…"}],
    "raw":[{"label":"5h used","value":"23%"},{"label":"weekly used","value":"29%"}] }
]
```

**Sort rule (keep it):** by `headroomPct` descending; rows with no `headroomPct` (noData/unknown) sink to the bottom, grouped by status. The top row is the recommended next agent.

### Actions the UI can call (IPC, already wired)

```ts
window.gage.onReports(cb)                  // live push of UsageReport[] (fs.watch + refresh)
window.gage.refresh()                      // force a refresh cycle
window.gage.getSettings() / setSettings(p) // { enabled: {codex,claude,devin}, trayTitleMode: 'best'|'count'|'icon', … }
window.gage.getClaudeCapture() / setClaudeCapture(enable)  // {installed, passthrough, capturedAt}
```

## 4. Current UI — structure, CSS, and why it's weak

**Layout:** a vertical list of agent rows, then a footer (`Refresh` / `Settings` buttons), then a collapsible settings pane.

Current row markup:
```html
<div class="row status-ok">
  <div class="row-head">
    <span class="dot">🟢</span><span class="name">Codex</span><span class="pct">86%</span>
  </div>
  <div class="bar"><div class="bar-fill" style="width:86%"></div></div>
  <div class="sub">resets in 4h 12m</div>
  <div class="detail" hidden> … windows · raw · source · fetched … </div>
</div>
```

Current CSS (the whole thing):
```css
:root { color-scheme: light dark; font: 13px -apple-system, system-ui, sans-serif; }
body { margin: 0; padding: 6px; }
.row { padding: 8px; border-radius: 8px; }
.row-head { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.name { flex: 1; font-weight: 600; }
.pct { font-variant-numeric: tabular-nums; }
.bar { height: 6px; background: color-mix(in srgb, currentColor 12%, transparent); border-radius: 3px; }
.bar-fill { height: 100%; border-radius: 3px; background: #36b37e; }
.status-tight  .bar-fill { background: #ffab00; }
.status-blocked .bar-fill { background: #ff5630; }
.status-noData .bar-fill, .status-unknown .bar-fill { background: #8993a4; }
.sub { font-size: 11px; opacity: 0.7; }
.detail { margin-top: 6px; font-size: 11px; opacity: 0.85; }
.empty { padding: 16px; text-align: center; opacity: 0.6; }
/* footer + settings: plain buttons, checkboxes, a <select>, <code> hints */
```

**Why it's poor (fix these):**
1. **No hierarchy.** Every row is visually flat; the all-important "top = next task" carries no weight. There's no hero/affordance for "→ give the next task to Codex."
2. **Emoji status dots** (🟢🟡🔴⚠️) look unpolished and render inconsistently. Replace with real shapes/tokens.
3. **Thin 6px bars, cramped 8px padding** — feels like a debug panel, not a product.
4. **No brand.** The gage mark/identity is absent (assets below).
5. **Numbers lack rhythm** — %, reset, and raw values aren't aligned or typographically deliberate.
6. **Expanded detail is a plain text dump** (windows/raw/source). Needs structure.
7. **Settings pane is raw HTML** (`<h4>`, bare checkboxes, a `<select>`, `<code>` hints) — visually disconnected from the rows.
8. **No translucency / depth / motion** — it doesn't feel like a mac menu-bar popover.

## 5. States to design (cover all)

**Per agent row:**
- `ok` (>25% headroom) — green family, bar + %.
- `tight` (5–25%) — amber.
- `blocked` (<5%) — red.
- `noData` — no %, show the `hint` (e.g. "set a Devin budget", "enable Claude capture"); visually de-emphasised, sunk to bottom.
- `unknown` — parse/read error; show `error` on expand.
- `stale` — overlay/badge on any of the above (data is last-known; source went quiet).
- **Expanded** (row click) — all `windows` (each: label, headroom%, reset), all `raw` metrics, `source`, `fetchedAt`.

**Panel-level:**
- **Hero / "next" affordance** — make the top (most-headroom) agent the obvious pick.
- **Reset countdown** — "resets in 4h 12m" / "11d 9h" / "resetting…"; design how it reads per row.
- **Empty** — no agents enabled.
- **Refresh** — manual refresh control + a subtle "updated <time>" / refreshing indicator.
- **Settings pane** — redesign: agent on/off toggles (Codex/Claude/Devin), **Claude usage capture** toggle (shows passthrough renderer + last-capture time), **tray title mode** (best / count / icon), and a Devin-budget hint line. Should feel part of the same system.

**Tray title** (text next to the menu-bar icon) has 3 modes to keep: best agent's short code + % (e.g. "C 86%"), count of agents with headroom, or icon-only.

## 6. Brand

Assets live in `ai/export/`:
- `ai/export/mark/Gage-Mark.svg` (+512 png) — the gage mark/logo.
- `ai/export/app-icon/Gage-AppIcon.svg` (+16–1024 png) — app icon.
- `ai/export/menu-bar/Gage-Template*.png` — monochrome menu-bar glyphs.

Current status palette (evolve as needed, keep semantic meaning): ok `#36b37e`, tight `#ffab00`, blocked `#ff5630`, muted `#8993a4`. Pull accent/brand color from the mark. Light + dark required.

## 7. Deliverables

1. **High-fidelity mockups** of the popover — light **and** dark — covering: the default 3-agent list (with the "next" affordance), an expanded row, a `noData` row, a `stale` badge, the empty state, and the settings pane.
2. **Production-ready `index.html` + `styles.css`** (and minimal markup notes) that drop into `src/renderer/`, bound to the data model in §3 and the class/structure pattern the TS render uses (status class on the row, `data-*` hooks where helpful). Vanilla CSS preferred; CSS custom-properties for the color tokens.
3. **Design tokens** — color (light/dark), spacing, radius, type scale, the status ramp, bar styling.
4. Notes on any **motion** (popover open, bar fill, refresh) and **accessibility** (contrast, focus, VoiceOver labels).

## 8. Out of scope

Data layer (adapters/parsers), networking (there is none), adding agents, packaging. Don't change the IPC API or the `UsageReport` shape — design **to** it. Keep it a fast, single-panel mac popover.

---

**Repo:** `github.com/amit-t/gage` · renderer at `src/renderer/{index.html,main.ts,styles.css}` · brand at `ai/export/`.
