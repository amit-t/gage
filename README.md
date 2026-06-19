<img src="resources/mark.png" alt="gage" width="96" align="left" />

# gage

Menu-bar gauge of how much usage headroom is left across your local AI agents — **Codex, Claude, Devin** — sorted so the top row is "give the next task to this one." Reads only local files already on your machine. **Zero network calls.**

## What it reads (read-only, local)

| Agent | Source | Metric |
|-------|--------|--------|
| Codex | `~/.codex/sessions/**/rollout-*.jsonl` (newest `rate_limits`) | native `100 − used_percent`, binding min(5h, weekly); real reset |
| Claude | `~/.claude/projects/**/*.jsonl` transcripts | active 5h-block tokens vs `budget.session.amount`; inferred reset |
| Devin | `~/.local/share/devin/cli/sessions.db` (SQLite, read-only) | Σ `committed_acu_cost` this monthly cycle vs `monthly_acu` |

**Out of the box** Codex shows a real headroom % with no setup. Claude and Devin show `noData` + a one-line hint until you configure an absolute budget (below) — gage never fabricates a percentage.

## Run / build locally

```bash
npm install         # installs deps + rebuilds better-sqlite3 for Electron (postinstall)
npm run dev         # live dev (tray app)
npm test            # unit tests (51)
npm run typecheck   # tsc, both projects
npm run dist        # build the unsigned .app into release/
```

> The `dev`/`start` scripts clear `NODE_OPTIONS` so Electron launches even if your shell sets `--openssl-legacy-provider` (which Electron rejects).

## Gatekeeper bypass (unsigned app)

gage is unsigned (personal local run). First launch:

```bash
xattr -dr com.apple.quarantine "/Applications/gage.app"
```

or right-click the app → **Open** → **Open**.

## Budgets

- **Codex** needs no budget — it reports a native percentage out of the box.
- **Devin**: set a monthly ACU budget in `~/.config/devin-token-monitor/config.json`:
  ```json
  { "monthly_budget": { "start_date": "2026-06-01", "monthly_acu": 200 } }
  ```
  `start_date` anchors the monthly cycle; `monthly_acu` is your ACU allowance. Until set, Devin shows **noData**.
- **Claude**: add an absolute per-block token cap to `~/.claude/claude-powerline.json`:
  ```json
  { "budget": { "session": { "warningThreshold": 80, "amount": 2000000 } } }
  ```
  `amount` is a token count; `warningThreshold` (%) drives the tight color. Until `amount` is set, Claude shows **noData**.

## Add a new local-source adapter

1. Implement `AgentAdapter` (`src/adapters/<id>.ts`): `sources()`, `watchPaths()`, `read()`.
2. `read()` must **fail soft** — return `normalize({ … noData/unknown … })`, never throw.
3. Parse a local file only; no network. Add a fixture test in `test/`.
4. Register the adapter in `ALL_ADAPTERS` (`src/main/main.ts`) and add it to `Settings.enabled` defaults.

If your source is a large/native-bound DB (like Devin's SQLite), lazy-load the native module **inside `read()`** so the test runner (node ABI) never loads the Electron-ABI binary, and extract the parsing into pure, unit-tested functions.

## Privacy

No telemetry, no network. Source files are opened read-only; the SQLite DB is opened `{ readonly: true }`. Crash logs (if any) stay in `app.getPath('userData')`, never uploaded.
