<img src="resources/mark.png" alt="gage" width="96" align="left" />

# gage

Menu-bar gauge of how much usage headroom is left across your local AI agents — **Codex, Claude, Devin** — sorted so the top row is "give the next task to this one." Reads only local files already on your machine. **Zero network calls.**

## What it reads (read-only, local)

| Agent | Source | Metric |
|-------|--------|--------|
| Codex | `~/.codex/sessions/**/rollout-*.jsonl` (newest `rate_limits`) | native `100 − used_percent`, binding min(5h, weekly); real reset |
| Claude | `~/.claude/gage/ratelimits.json` (captured by gage's statusline hook) | native `100 − used_percentage`, binding min(5h, weekly); real reset |
| Devin | `~/.local/share/devin/cli/sessions.db` (SQLite, read-only) | Σ `committed_acu_cost` this monthly cycle vs `monthly_acu` |

**Out of the box** Codex shows a real headroom % with no setup. Claude needs a one-time statusline hook (below) to capture its native %. Devin needs a monthly ACU budget. Until configured, those rows show `noData` + a one-line hint — gage never fabricates a percentage.

## Run / build locally

```bash
npm install         # installs deps + rebuilds better-sqlite3 for Electron (postinstall)
npm run dev         # live dev (tray app)
npm test            # unit tests (47)
npm run typecheck   # tsc, both projects
npm run dist        # build the unsigned .app into release/
```

> The `dev`/`start` scripts clear `NODE_OPTIONS` so Electron launches even if your shell sets `--openssl-legacy-provider` (which Electron rejects).

## Terminal CLI

The same headroom view in your terminal — `gage`:

```bash
npm run build:cli && npm link   # installs the `gage` command globally
gage                            # sorted one-glance table
gage --json                     # machine-readable
gage --verbose                  # raw numbers + source per agent
gage --watch[=10]               # live refresh every N seconds (default 5)
gage --no-color                 # plain text
```

```
gage  agent headroom

  ● Codex    ███████████████░░░  86%   5h      resetting…
  ● Devin    █████████████░░░░░  72%   month   resets in 11d 9h
  ● Claude   █████████████░░░░░  71%   weekly  resets in 2d 13h

  → give the next task to Codex
```

The CLI reuses the same adapters as the app. Devin reads through Node's built-in `node:sqlite` (no native module / no Electron-ABI rebuild); the app uses `better-sqlite3` — the adapter picks the backend by runtime.

## Gatekeeper bypass (unsigned app)

gage is unsigned (personal local run). First launch:

```bash
xattr -dr com.apple.quarantine "/Applications/gage.app"
```

or right-click the app → **Open** → **Open**.

## Setup

- **Codex** needs nothing — native percentage out of the box.
- **Claude**: Claude's native 5h + weekly usage % exists *only* in the data Claude Code pipes to its statusline. gage captures it with a tiny wrapper — enable it either way:
  - **In the app:** Settings → **Claude usage capture** (toggle on). The wrapper ships inside the `.app`.
  - **CLI:** `npm run setup:claude` (reverse: `npm run teardown:claude`).

  Either points Claude Code's `statusLine.command` at `~/.claude/gage/gage-statusline.cjs`, which writes `rate_limits` to `~/.claude/gage/ratelimits.json` and then **execs your previous statusline** (e.g. powerline) so your statusline looks identical. No dependency on any statusline tool — if none was configured, gage prints its own minimal line. Until enabled, Claude shows **noData**.
- **Devin**: set a monthly ACU budget in `~/.config/devin-token-monitor/config.json`:
  ```json
  { "monthly_budget": { "start_date": "2026-06-01", "monthly_acu": 200 } }
  ```
  `start_date` anchors the monthly cycle; `monthly_acu` is your ACU allowance. Until set, Devin shows **noData**.

## Add a new local-source adapter

1. Implement `AgentAdapter` (`src/adapters/<id>.ts`): `sources()`, `watchPaths()`, `read()`.
2. `read()` must **fail soft** — return `normalize({ … noData/unknown … })`, never throw.
3. Parse a local file only; no network. Add a fixture test in `test/`.
4. Register the adapter in `ALL_ADAPTERS` (`src/main/main.ts`) and add it to `Settings.enabled` defaults.

If your source is a large/native-bound DB (like Devin's SQLite), lazy-load the native module **inside `read()`** so the test runner (node ABI) never loads the Electron-ABI binary, and extract the parsing into pure, unit-tested functions.

## Privacy

No telemetry, no network. Source files are opened read-only; the SQLite DB is opened `{ readonly: true }`. Crash logs (if any) stay in `app.getPath('userData')`, never uploaded.
