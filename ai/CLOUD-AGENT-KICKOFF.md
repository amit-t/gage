# Cloud-Agent Kickoff — gage (multi-agent usage gauge, menu-bar)

Paste this as the first task to the cloud agent **inside the `gage` repo**. The full design is in `ai/docs/specs/2026-06-14-multi-agent-usage-menubar-design.md` — read it first; this brief is the executive layer. Decision trail: `.grills/2026-06-14-1710-gage-usage-gauge-deep.md`.

---

## Mission

Build a macOS menu-bar (tray) Electron app, **`gage`**, that shows in one glance **how much usage headroom is left across each AI agent**, sorted so the top row is "give the next task to this one." It reads **only local files already on the machine** — no web requests, no auth, no scraping.

## Locked decisions (do not re-litigate)

- **Local files only.** gage makes **zero network calls**. It parses usage artifacts already written on disk by the agents' own tools. No cookies, no webviews, no API keys, no ToS risk.
- **Three agents — and only three** (the only ones with a local usage source, verified on-disk 2026-06-18): **Codex, Claude, Devin**. ChatGPT, Gemini, Antigravity have no local artifact → **dropped**, not stubbed.
- **Native readers.** Reimplement the parsers inside gage. Do **not** shell out to `devin-usage`, `ccusage`, or powerline; do not depend on them being installed.
- **Platform:** macOS-first. **Stack:** Electron + TypeScript + Vite (renderer).
- **Glance metric:** binding (lowest-window) headroom % + reset countdown as the sort key, **plus** raw native numbers per row / on expand.
- **Refresh:** `fs.watch` the source dirs (debounced) + refresh-on-open + manual. No polling/backoff (nothing remote to rate-limit).
- **Isolation:** one adapter per agent; `Promise.allSettled` per cycle; `read()` fails soft (returns a degraded `UsageReport`, never throws).

## Data sources (the whole product)

| Agent | File (read-only) | Headroom | Reset |
|-------|------------------|----------|-------|
| **Codex** | `~/.codex/sessions/**/rollout-*.jsonl`, newest `rate_limits` event | native `100 − used_percent`; binding = min(primary 5h, secondary weekly) | real `resets_at` |
| **Devin** | `~/.local/share/devin/cli/sessions.db` (SQLite, read-only) | Σ `committed_acu_cost` this monthly cycle vs ACU budget from `~/.config/devin-token-monitor/config.json` | cycle anchor + 1 month |
| **Claude** | `~/.claude/projects/**/*.jsonl` transcripts | active 5h block tokens/cost vs budget from `~/.claude/claude-powerline.json` | block start + 5h |

Honest-only: where no absolute budget is configured (Claude/Devin), report `status: noData` with a "set a budget" hint — never fabricate a %. Codex needs no budget.

## How to proceed

1. **Read** the design spec in full.
2. **Run the `writing-plans` skill** (or equivalent) to turn milestones **M0–M5** into a detailed, ordered plan with per-task verification. Do **not** code before the plan exists.
3. Execute milestone by milestone. **TDD the fragile core:** write the fixture test before each parser (`codex.parse`, Claude 5h-block math, Devin sqlite read) and before `normalize`/`blocks`/`cycles`.
4. After each milestone: run tests, verify, commit scoped work, push.

## Milestones

- **M0** Scaffold: Electron+TS+Vite, tray icon, empty popover, IPC heartbeat.
- **M1** Core: `AgentAdapter`, store, `normalize`, refresh engine (fs.watch + allSettled) — with tests.
- **M2** **Codex** adapter end-to-end → first real number (only native %, no budget config; ship first).
- **M3** **Devin** adapter: sessions.db reader + monthly-cycle math + budget from devin-token-monitor config.
- **M4** **Claude** adapter: transcript → 5h block math + budget from claude-powerline.json (incl. `noData` path).
- **M5** Polish: settings pane, tray modes, stale/`noData`/error states, manual-verify + recorded fixtures, README.

## Definition of done (MVP)

- Tray app launches; popover lists the three agents sorted by binding headroom %.
- **All three show real numbers end-to-end:** Codex native %, Devin ACU %, Claude block-vs-budget %.
- fs.watch-live updates; refresh-on-open + manual refresh work.
- Missing source or unset budget → `noData` + inline hint; locked/malformed file → last-known + stale badge. **Never crashes a cycle.**
- Unit tests green (parsers via fixtures, normalize, blocks, cycles, refresh isolation); per-agent manual-verify recorded with PII-scrubbed fixtures.
- README: what it is, how to run/build locally, the Gatekeeper bypass, how each budget is configured, how to add a new local-source adapter.

## Constraints

- **Read-only of my own local usage files.** Never write to or lock the source files. SQLite opened read-only. No network, ever.
- **No telemetry.** Local crash logs only → `userData`, never uploaded.
- **Never commit secrets** or any copied session/usage blobs. `.gitignore` excludes `userData`, local config, fixtures with real data, and OS cruft.
- **Git identity = personal:** `user.email=tiwari.m.amit@gmail.com`, GitHub `amit-t`. Personal repo — do not use the company identity.
- Code-signing/notarization **out of scope** (unsigned local run; document the quarantine bypass).

## Out of scope (MVP)

Windows/Linux · historical charts · notifications/alerts · multiple accounts per agent · auto task-routing · any agent without a local usage file (ChatGPT/Gemini/Antigravity) · any network call.

## First reply I want from the cloud agent

1. Confirmation it read the spec.
2. The M0–M5 implementation plan (from `writing-plans`).
3. Any blocking unknowns (e.g. exact absolute-budget key in `claude-powerline.json`, Devin config field names) flagged with how it'll discover them — not as a reason to stall M0–M2.
