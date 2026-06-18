# Design Spec — gage (multi-agent usage gauge, menu-bar)

- **Date:** 2026-06-14 · **Revised:** 2026-06-18 (local-only pivot)
- **Status:** approved design, pre-implementation
- **Platform:** macOS-first (Electron)
- **Owner:** Amit Tiwari
- **Name:** `gage` (final; codename `Headroom` retired).

> **2026-06-18 pivot.** Original design scraped six logged-in web sessions (cookies + hidden webviews). That is **gone**. gage now reads **only local files already written by tools on this machine** — zero web requests, zero auth, zero ToS risk. Consequence: only agents with a local usage artifact ship. An on-disk hunt (2026-06-18) confirmed exactly three: **Codex, Claude, Devin**. ChatGPT, Gemini, Antigravity have no local usage source and are dropped. Decisions traced in `.grills/2026-06-14-1710-gage-usage-gauge-deep.md`.

---

## 1. Problem

I use multiple AI coding/agent services. Each has its own usage limits and reset windows, scattered across separate UIs. Before handing out the next task I want **one glance** to see who has the most headroom left.

## 2. Goal & non-goals

**Goal:** A macOS menu-bar app. Click → popover lists each agent, sorted by remaining headroom, so the top row is "give the next task to this one."

**Non-goals (MVP):**
- Windows/Linux.
- Historical usage charts / trends.
- Alerts/notifications.
- Multiple accounts per agent.
- Auto-routing/dispatching — gage *informs*, the human acts.
- **Any network access.** gage reads local files only; it never calls a web or API endpoint. (Devin used to be an API call — now it is the local `sessions.db`.)
- Agents without a local usage artifact (ChatGPT, Gemini, Antigravity).

## 3. Glance metric (decided)

Per agent, sorted most-headroom-first:
- **headroom %** — primary sort key; the **binding (lowest) window** when an agent has several.
- **reset countdown** ("resets in 3h 12m") — of the binding window.
- **raw native numbers** verbatim, shown on the row and expanded on click.
- **status dot** — `ok / tight / blocked / noData / unknown`.

No fabricated normalization: where no honest % exists, show status + raw and sink the row.

## 4. Data sources (the whole product)

All three are local files, read-only. Verified present on this machine 2026-06-18.

| Agent | File | Shape | Headroom | Reset |
|-------|------|-------|----------|-------|
| **Codex** | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` — newest event carrying `rate_limits` | `rate_limits.{primary,secondary}.{used_percent, window_minutes, resets_at}`; `primary`=5h (300m), `secondary`=weekly (10080m); `plan_type` | **native**: `100 − used_percent` per window; binding = min of the two | **real** `resets_at` (epoch s) per window |
| **Claude** | `~/.claude/projects/**/*.jsonl` transcripts (same data `claude-powerline` parses) | per-assistant event `usage.{inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens}` + `model` + timestamp | active **5h rolling block** token/cost sum vs a **budget reused from `~/.claude/claude-powerline.json`** → `(cap − used)/cap` | **inferred**: block start + 5h |
| **Devin** | `~/.local/share/devin/cli/sessions.db` (SQLite) | `message_nodes.chat_message.metadata.committed_acu_cost` (+ `metrics.*_tokens`); attribution from `sessions` table | Σ `committed_acu_cost` over current monthly cycle vs **monthly ACU budget read from `~/.config/devin-token-monitor/config.json`** → `(acu − used)/acu` | **inferred**: cycle anchor (budget `start` date) + 1 month |

**Reader rules:**
- **Reimplemented natively** in gage — no shelling out to `devin-usage`/`ccusage`/powerline, no dependency on those tools being installed. gage owns its parsers.
- Read-only; never write to or lock these files. SQLite opened read-only (immutable/`mode=ro`).
- Codex: scan the newest session file(s) for the most recent `rate_limits` event; that snapshot is current state.
- Claude: the 5h "block" = ccusage-style rolling window anchored on first activity; the active block is the one containing now (or the last block if activity < 5h ago).

**Config reuse caveat (Claude):** `claude-powerline.json`'s `budget` keys are currently *warning thresholds* (`warningThreshold: 80`, a %), not an absolute cap. gage needs an absolute per-block budget. Spec requires reading an absolute amount key from that budget block (e.g. `budget.session.amount`); if absent, Claude reports `status: noData` with a one-line "set a session budget in claude-powerline.json" hint rather than fabricating a %. `warningThreshold` drives the tight/blocked colors.

## 5. Architecture

Electron, TypeScript, Vite (renderer). The webview/cookie/Keychain machinery is **deleted** — no `SessionContext`, no partitions, no `safeStorage`.

```
┌─ main process ───────────────────────────────────────┐
│  tray (menu bar)   watcher/refresh   store            │
│        │                 │             │              │
│        └──── adapter registry ────────┘              │
│         adapters/{codex, claude, devin}               │
└─────────────────────────────┬────────────────────────┘
                              │ IPC (UsageReport[])
┌─ renderer (popover) ────────▼────────────────────────┐
│  agent rows · headroom bars · reset countdown          │
│  settings pane                                         │
└───────────────────────────────────────────────────────┘
```

**Isolation:** each adapter is self-contained and reads its own files. One adapter failing never blocks the others (`Promise.allSettled` per cycle). `read()` **fails soft** — returns a degraded `UsageReport`, never throws past the refresh engine.

## 6. Core interfaces

```ts
type AgentId = 'codex' | 'claude' | 'devin';
type UsageStatus = 'ok' | 'tight' | 'blocked' | 'noData' | 'unknown';

interface RawMetric { label: string; value: string; }

interface UsageWindow {
  label: string;          // 'codex-5h' | 'codex-weekly' | 'claude-block' | 'devin-month'
  headroomPct: number;    // 0..100
  resetAt?: string;       // ISO; real (codex) or inferred (claude/devin)
}

interface UsageReport {
  agent: AgentId;
  status: UsageStatus;
  headroomPct?: number;    // binding (lowest) window; omitted when not derivable
  bindingWindow?: string;  // which window set headroomPct
  windows: UsageWindow[];  // all windows for the agent
  resetAt?: string;        // reset of the binding window
  raw: RawMetric[];        // native numbers verbatim
  fetchedAt: string;       // ISO
  source: string;          // file path read
  error?: string;          // reason when degraded
}

interface AgentAdapter {
  id: AgentId;
  displayName: string;
  sources(): string[];                 // file/dir globs read (for display + watch)
  watchPaths(): string[];              // dirs handed to fs.watch
  read(): Promise<UsageReport>;        // fail-soft; never throws past refresh engine
}
```

## 7. Normalization (`core/normalize.ts`)

- `headroomPct = clamp(0, 100, 100 * remaining / limit)` per window.
- Report `headroomPct` = **min over windows** (binding); `bindingWindow` + `resetAt` follow it.
- Status: `>25% → ok`, `5–25% → tight`, `<5% → blocked`, source missing/empty → `noData`, parse failure → `unknown`. (Claude `warningThreshold` overrides the tight cutoff when set.)
- Missing cap/limit → omit `headroomPct`, keep `raw`, `status: noData`.

## 8. Refresh engine (`core/refresh.ts`)

- **`fs.watch`** on each adapter's `watchPaths()` → on write, debounce (~500 ms) → re-`read()` that adapter → push `UsageReport[]` to renderer via IPC.
- **Refresh-on-open** + **manual refresh** force an immediate full cycle.
- Each cycle: `Promise.allSettled(adapters.map(a => a.read()))` → store → IPC.
- No polling timer, no jitter, no backoff — there is nothing remote to rate-limit. (A slow fallback re-scan timer, e.g. 5 min, is optional insurance against missed fs events.)

## 9. UI (renderer)

- **Tray:** template icon; title mode — (a) best agent's short code + %, (b) count of agents with headroom, (c) icon-only.
- **Popover:** rows sorted by `headroomPct` desc (undefined sinks, grouped by status). Row: agent icon · headroom bar + % · "resets in …" · raw · status dot. Click → expand all `windows` + `raw` + `fetchedAt` + `source` + any error.
- **States:** `noData` → inline hint (e.g. Claude budget unset, Devin budget unset); stale → stale badge; `unknown` → parse error on expand.
- **Settings pane:** toggle agents, tray mode, override source paths, link to where each budget is configured.

## 10. Error handling

- Errors caught inside `read()`; worst case reaching the engine is a degraded `UsageReport`.
- Store keeps **last-known** per agent; UI shows it with a stale badge rather than blanking.
- Missing/locked file → `noData`/`unknown`, never a crash.

## 11. Testing strategy

Parsers are the fragile core → **fixture-driven**:
- **Adapter unit tests:** feed saved fixtures to each parser; assert `UsageReport`.
  - `adapters/__fixtures__/codex/rollout.jsonl` (with `rate_limits` events).
  - `adapters/__fixtures__/claude/transcript.jsonl` (assistant `usage` events across a 5h boundary).
  - `adapters/__fixtures__/devin/sessions.sql` → built into a temp SQLite db in-test.
- **`normalize()` tests:** binding-window selection, clamping, thresholds, missing-cap → `noData`.
- **Refresh-engine tests:** fake fs events → debounced single re-read; `allSettled` isolation (one adapter throws, others still reported).
- **Block-math tests (Claude):** 5h rolling window bucketing, active-block selection.
- **Cycle-math tests (Devin):** monthly cycle from an arbitrary anchor date.
- **Store/IPC tests.**
- **Manual verify (per agent):** open popover, confirm headroom %/raw matches the native tool's own report; record a scrubbed fixture.

## 12. Build & packaging

- Electron + electron-builder; TypeScript everywhere; Vite for renderer.
- macOS `.app`. **Unsigned** — personal local run. README documents the one-time Gatekeeper bypass (`xattr -dr com.apple.quarantine <app>` or right-click → Open). Notarization/auto-update out of scope.
- **Local crash logs only** → file in `app.getPath('userData')`, never uploaded. No telemetry, no network of any kind.

## 13. File layout

```
src/
  main.ts                  # wires tray + IPC + refresh engine
  core/
    refresh.ts             # fs.watch + debounce + allSettled cycle
    store.ts               # last-known reports + settings persistence
    normalize.ts           # binding window + status mapping
    registry.ts            # enabled adapters
    blocks.ts              # 5h rolling-block bucketing (Claude)
    cycles.ts              # monthly cycle math (Devin)
  adapters/
    types.ts               # AgentAdapter, UsageReport
    codex.ts               # newest rate_limits event from session jsonl
    claude.ts              # transcript usage → active 5h block vs powerline budget
    devin.ts               # sessions.db Σ committed_acu_cost vs devin budget
    config.ts              # read claude-powerline.json + devin-token-monitor config
    __fixtures__/
  ui/
    panel/                 # popover renderer (rows, settings)
    tray/
test/                      # unit + integration
```

## 14. Milestones

| M | Deliverable |
|---|-------------|
| **M0** | Scaffold: Electron+TS+Vite, tray icon, empty popover, IPC heartbeat. |
| **M1** | Core: `AgentAdapter`, store, `normalize`, refresh engine (fs.watch + allSettled) — **with tests**. |
| **M2** | **Codex** adapter end-to-end → first real headroom number (native `used_percent`, binding min(5h,weekly), real reset). Codex first: only native %, no budget config needed. |
| **M3** | **Devin** adapter: `sessions.db` reader + monthly-cycle math + budget from devin-token-monitor config. |
| **M4** | **Claude** adapter: transcript → 5h block math + budget from claude-powerline.json (incl. `noData` when no absolute budget set). |
| **M5** | Polish: settings pane, tray modes, stale/`noData`/error states, sort/grouping, full manual-verify pass + recorded fixtures, README. |

**TDD the fragile core:** write the fixture test before each parser (`codex.parse`, `claude` block math, `devin` sqlite read), and before `normalize`/`blocks`/`cycles`.

**DoD (MVP):** all three agents show real numbers end-to-end — Codex native %, Devin ACU %, Claude block-vs-budget % — sorted by binding headroom in the tray popover, fs.watch-live, degrading to `noData`/stale (never crashing) when a source or budget is absent. Unit tests green; per-agent manual verify recorded.

## 15. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Local file schema drift (codex jsonl, devin sqlite, claude transcript) | Adapters isolated + fixture-tested; fail-soft to last-known + stale badge; `source` shown in UI for debugging. |
| Claude has no native % | Honest budget-relative % from reused powerline budget; `noData` + hint when no absolute budget configured — never fabricated. |
| Devin/Claude budgets unset | `noData` with inline "set a budget" hint; Codex still works (no budget needed). |
| Devin sqlite locked/WAL mid-write | Open read-only/immutable; on lock error → last-known + `unknown`, retry next fs event. |
| Tools not installed (no `~/.codex`, no devin cli dir) | Agent simply reports `noData`; gage never assumes a tool is present. |

## 16. Open items for implementation

- Confirm the exact key for an **absolute** Claude per-block budget in `claude-powerline.json` (add `budget.session.amount` convention if none exists upstream).
- Confirm `devin-token-monitor/config.json` field names (`start`, `acu`) against a live config before wiring the cycle math.
- Decide Claude block metric: **tokens** vs **costUSD** for the cap (cost aligns with powerline's existing budget unit — lean cost).
- Optional fallback re-scan interval as insurance against missed `fs.watch` events on some macOS setups.
