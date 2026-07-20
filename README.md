# 股票日記 Stock Diary

Static PWA that replaces a hand-typed Word-table daily stock diary. See
`claude-code-prompt-stock-diary.md` for the full product spec this was built
against. **Phases 1–5 are complete**: data pipeline, read-only matrix UI, the
annotation layer, add-stock + start modes, and GitHub Actions + Pages deploy.
PWA install and the docs/handoff pass are not built yet. See
"What's not built yet" below.

**Live site**: https://caeszrr.github.io/stock-diary/
**Repo**: https://github.com/caeszrr/stock-diary

## Architecture decisions made while building

- **Tooling**: Vite + vanilla JS, no framework, no TypeScript. Build output is
  plain static files (`npm run build` -> `dist/`).
- **GitHub Pages base path**: `vite.config.js` hardcodes `base: '/stock-diary/'`
  for a project page (`username.github.io/stock-diary/`). Change this one line
  if the repo is renamed or moved to a user/org page.
- **Data files live under `public/data/`**, not a top-level `data/`. Vite
  copies `public/` verbatim into `dist/` on build and serves it as-is in dev,
  so the same relative fetch paths (`data/tw/2026/07.json`, etc.) work
  identically in `npm run dev` and the deployed site with zero extra config.
  They are still plain committed JSON — nothing about them is bundled/processed.
- **`config/tickers.json`** stays at the repo root (not under `public/`) and is
  imported directly by the frontend (`src/lib/tickers.js`) via Vite's built-in
  JSON import — it's bundled into the JS at build time, since the watchlist
  only changes via a repo commit + rebuild, unlike quote data which updates
  daily without a rebuild.

## Data sources (verified against live endpoints)

| Need | Source |
|---|---|
| TW 上市 full-market daily OHLCV | `https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL` (today only, all listed stocks in one call) |
| TAIEX close + market turnover (recent days) | `https://openapi.twse.com.tw/v1/exchangeReport/FMTQIK` |
| TW 上市 per-symbol history (backfill) | `https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?date=YYYYMMDD&stockNo=CODE&response=json` (one month per call) |
| TAIEX history (backfill) | `https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=YYYYMMDD&type=IND&response=json` (one **day** per call — no monthly-range endpoint exists for indices) |
| TW 上櫃 full-market daily quotes | `https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes` (today only, all OTC instruments) |
| US stocks + indices | Yahoo Finance chart API: `https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range=...` or `&period1=...&period2=...` — no key, works for both equities and `^DJI`/`^IXIC`/`^GSPC`/`^SOX`. `meta.fiftyTwoWeekHigh/Low` comes free. |

### Deviation from the original spec: Stooq is not used

The spec suggested Stooq's CSV endpoint (`https://stooq.com/q/d/l/?s=...&i=d`)
as the primary US source. As of this build, **Stooq returns a JavaScript
proof-of-work anti-bot challenge page instead of CSV** — unusable from a plain
server-side `fetch()` in a GitHub Actions runner (no JS engine). Verified with
a real request before building. Yahoo Finance's chart API is used instead:
`query1.finance.yahoo.com` primary, `query2.finance.yahoo.com` as the
automatic-failover fallback host (same API shape). Revisit Stooq if their
bot-protection ever changes.

### Known gap: TPEx (上櫃) is not backfilled to 2026-01-01

No working public per-symbol historical endpoint could be found for TPEx
during implementation — their old `afterTrading/*.php` endpoints now ignore
`date`/`stkno` query params and just echo today's bulk listing regardless of
what's passed (verified with several URL variants; see `scripts/lib/tpex.js`
for what was tried and why). The daily bulk endpoint (all OTC stocks, today
only) works fine and is used for the daily cron.

**Consequence**: 上櫃 watchlist symbols (世界先進, 漢磊, 信驊, 群聯, 威剛, 雙鴻,
上詮, 波若威, 中光電, 昇達科, 華研, 達航科技, 國泰20年美債) only have history
starting from the first time `fetch-tpex.js` actually ran — earlier months
render as blank cells, same as any other missing date. This is surfaced in
`scripts/backfill.js`'s console output (`tpexSkipped` list, also written to
`status.json`'s `backfill` entry) — not silently dropped. If TPEx exposes a
working historical API in the future, `fetchOtcHistory` can be added to
`scripts/lib/tpex.js` and wired into `backfill.js`.

### Ticker config correction

`validate-tickers.js`'s first run found `00687B` (國泰20年美債) was configured
`market: "twse"` but is actually listed on **TPEx**, not TWSE — confirmed by
looking it up in both bulk listings. Corrected in `config/tickers.json` with a
`note` field documenting the change (not one of the `verify:true` entries —
this was a plain misclassification, not an uncertain listing).

### Unresolved tickers (as of the first validation run)

Run `npm run validate` to regenerate this report. As of writing, 4 of 108
configured tickers did not resolve against their bulk source and are marked
`"status": "unresolved"` in `config/tickers.json` (kept in the file, excluded
from fetch, never deleted):

- `00687B` 國泰20年美債 — **fixed**, see above (market corrected, no longer unresolved)
- `3694` 海華 (tpex) — not found by code or name in today's TPEx bulk listing. Not previously flagged `verify:true` — worth the maintainer double-checking whether this code changed or the stock delisted.
- `5222` 全訊 (tpex, already flagged `verify:true`) — not found.
- `6919` 康霈 (tpex, already flagged `verify:true`) — not found.

## Running the pipeline

```bash
npm install
npm run validate       # resolves every config/tickers.json entry, prints a report, marks unresolved ones
npm run fetch:tw       # today's TWSE 上市 snapshot -> data/tw, data/tw-all, data/idx (TAIEX), tw-symbols.json
npm run fetch:tpex     # today's TPEx 上櫃 snapshot -> data/tw, data/tw-all, tw-symbols.json
npm run fetch:us       # last 5 US trading days -> data/us, data/idx (DJI/IXIC/SPX/SOX)
npm run backfill       # one-time: 2026-01-01 -> today for watchlist symbols only (see BACKFILL_START/BACKFILL_END env vars)
npm run repair:tw-gaps # one-time: re-fetches any TWSE symbol/month left empty by backfill's rate-limit gaps (see below)
```

`npm run fetch:all` runs `fetch:tw` + `fetch:tpex` + `fetch:us` in sequence.

### TWSE per-symbol history is rate-limited (the 307 issue)

Under `backfill.js`'s request volume, TWSE's per-symbol history endpoint
(`afterTrading/STOCK_DAY`) starts answering a bare 307 (no `Location` header,
so `fetch` can't auto-follow it) for a growing fraction of requests — this
reads as a soft rate-limit signal, not a real redirect. `scripts/lib/http.js`
treats 307/429 as throttle signals and backs off exponentially, but at
`backfill.js`'s ~67-symbol × ~7-month volume some requests still fail after
retries. **`npm run repair:tw-gaps` fixes this**: it scans every TWSE
watchlist symbol/month (and every TAIEX weekday) already on disk, finds the
ones with zero recorded days, and re-fetches just those with a much slower
default delay (`REPAIR_DELAY_MS`, default 900ms). It's idempotent and safe to
re-run — running it 2-3 times in a row converges as TWSE's rate limiter cools
down between runs.

In this build's actual backfill run: `backfill.js` alone left 122 TWSE
symbol/month gaps and 51 missing TAIEX weekdays out of 137. One
`repair:tw-gaps` pass recovered all but 8 TWSE gaps (all in two newly-listed
funds — `00997A`/`009821` — that genuinely had no trading yet in those
months, confirmed `verify:true` in the config) and all but 14 TAIEX weekdays
(a second repair pass recovered zero more of those — they turned out to be
genuine TWSE market holidays, not rate-limit failures: 137 weekdays − 14
holidays = 123 trading days, which matches every fully-backfilled TWSE
symbol's day count exactly).

### The full Taiwan market archive (`data/tw-all/`)

Only accumulates forward from the first time `fetch-tw.js`/`fetch-tpex.js`
run — it's built from the *bulk* (today-only) endpoints, so there's no
practical way to backfill all ~1700+ 上市+上櫃 instruments to January. Only
the ~110-symbol watchlist gets historical backfill.

## Adding/removing a ticker

Edit `config/tickers.json` (schema: `{ symbol, market: "index"|"us"|"twse"|"tpex", name_zh, group, verify?, status? }`),
then run `npm run validate` to confirm it resolves, then `npm run fetch:all`
(and `npm run backfill` if you want its history filled in too). The frontend
picks up the new entry on the next `npm run build` (it's bundled at build
time, see "Architecture decisions" above).

## Phase 3 — Annotation layer (decisions made while building)

- **Storage abstraction**: all user-generated data (cell notes, profiles,
  market notes, pins, hidden/added tickers, settings) goes through
  `src/lib/userData.js`, which in turn only talks to `src/lib/store.js`.
  Nothing else in the app touches `localStorage` directly. This is the "small
  abstraction layer" called for in the spec's future-direction note — a
  database-backed sync layer can replace `store.js` later without touching
  any UI code. The public API in `userData.js` is deliberately synchronous
  (matches the current zero-server reality); if a future backend needs to be
  async, that's a `userData.js`-only change.
- **Storage shape**: one namespaced+versioned localStorage key
  (`stock-diary:userdata`, `version: 1`) holding `cellNotes`, `profiles`,
  `marketNotes`, `pinnedDates`, `hiddenTickers`, `userTickers`,
  `collapsedGroups`, `startMode`. `store.js` has a `migrate()` hook for future
  schema-version bumps.
- **Debounced autosave**: writes to `localStorage` are debounced 400ms after
  the last edit (per note field / per profile / per market note), plus a
  `beforeunload`/`visibilitychange` flush so nothing is lost on tab close.
  Quote data (`public/data/`) and this store are completely separate —
  `loadMonth.js` never reads or writes user data, and `userData.js` never
  reads or writes quote JSON.
- **Emphasis styling**: 無/粗體/重點 apply directly to the compact cell
  (`.note-bold` underlines+weights the close price, `.note-highlight` tints
  the cell background), matching the Word bold/yellow-highlight the user
  already uses. A small dot indicator (`.has-note`) marks any cell with a
  freeform 筆記 even when no emphasis is set, so notes aren't invisible when
  collapsed.
- **Pinned reference dates**: clicking the 📍 in a date header pins it; pinned
  columns render after a visual separator at the right edge of the table,
  regardless of the selected month. Pinning a date outside the current month
  triggers an on-demand fetch of that month's JSON (cached in memory per
  session) — see `loadPinnedDataMap` in `src/main.js`.
- **Per-stock profile**: an inline expandable textarea in the sticky name
  cell (`+ 個股筆記` toggle), freeform, line breaks preserved via
  `white-space: pre-wrap`.
- **大盤筆記**: one editable textarea per date column in a dedicated row
  under the pinned indices, same debounce/persistence path as cell notes.
- **Backup**: 設定 (settings) panel has 匯出備份 (downloads
  `stock-diary-backup-YYYY-MM-DD.json`) and 匯入備份 (validates the file is a
  real backup before replacing local state, then reloads). The panel also
  hosts the 顯示模式 (start mode) switch wired up in Phase 4.
- Verified with Playwright against `npm run dev`: note/profile/market-note
  entry + reload persistence, emphasis rendering, pin add, export download,
  and settings modal — desktop (1400×900) and mobile (390×844) viewports,
  zero console errors.

## Phase 4 — Add-stock + start modes (decisions made while building)

- **Watchlist merge layer**: `src/lib/watchlist.js` is the single place that
  combines the build-time config watchlist (`tickers.js`) with runtime user
  data (`userData.js`: hidden tickers, user-added tickers, start mode) into
  what actually renders. `main.js`/`matrix.js` never touch `tickers.js` or
  `userData.js` directly for ticker lists — only `watchlist.js`.
- **Auto-merge / dedup**: a user-added ticker (TW or pending US) is filtered
  out of the rendered list if its symbol already exists in
  `config/tickers.json` — this is the whole "auto-merge" mechanism for
  US-assisted adds. Once the maintainer adds the symbol to config and
  redeploys, the localStorage `userTickers` entry is simply superseded at
  render time (never deleted, harmless leftover, costs nothing).
- **TW self-serve history source**: `src/lib/twAllHistory.js` fetches the
  symbol's records out of every `data/tw-all/{year}/{month}.json` present in
  the manifest (404s on months tw-all hasn't accumulated yet are treated as
  empty, never fabricated). `src/lib/userTickerData.js` caches this per
  symbol per session so tab switches don't refetch. In `main.js`, the
  current month's slice merges into the main `dataMap`; the full multi-month
  result merges into `pinnedDataMap` so pinning an out-of-month date works
  for user-added TW stocks too, the same as preloaded ones.
- **Group placement**: both add flows let the user type a group name
  (datalist-suggested from existing groups); typing an existing group name
  appends the new stock to that group instead of creating a duplicate.
- **Hide vs. remove**: preloaded (config) tickers get a 隱藏 button — hidden
  symbols are listed in 設定 → 已隱藏股票 with a 取消隱藏 action, never
  deleted. User-added tickers (both modes) get a 移除 button instead —
  removal is permanent (with a zh-TW confirm dialog) since they're not part
  of the repo config to begin with.
- **Welcome screen**: shown when `getStartMode()` is `null` (first visit on
  that device). A full-screen overlay over the already-mounted app shell;
  choosing either option calls `setStartMode` and renders straight into the
  matrix — no reload needed. Switchable later from 設定 → 顯示模式 with a
  confirm dialog explaining notes are unaffected.
- Verified with Playwright: welcome screen, blank-mode empty state +
  self-serve TW add with instant history + US assisted add showing the
  pending badge and copyable request message + persistence across reload +
  removal; full-mode hide/unhide via settings; mode switch. Desktop and
  mobile viewports, zero console errors. (Caught and fixed one real bug in
  this pass: `.hidden` was toggled by class on several dialog elements with
  no matching CSS rule, so `display: none` never actually applied — added a
  generic `.hidden { display: none !important; }` utility.)

## Phase 5 — GitHub Actions + Pages deploy (decisions made while building)

- **Four workflows**, each self-contained (no reusable/`workflow_call` chain)
  so a beginner reading Actions logs can follow one file top to bottom:
  - `fetch-tw.yml` — cron `10 7 * * 1-5` + retry `10 8 * * 1-5` (UTC). Runs
    `fetch:tw` + `fetch:tpex`.
  - `fetch-us.yml` — cron `30 22 * * 2-6` + retry `30 23 * * 2-6` (UTC). Runs
    `fetch:us`.
  - `backfill.yml` — `workflow_dispatch` only, inputs `start_date`,
    `end_date`, optional `symbols` (comma-separated — added
    `BACKFILL_SYMBOLS` env var support to `scripts/backfill.js` for this),
    and a `repair_tw_gaps` checkbox.
  - `deploy.yml` — plain `on: push` to `main`, for ordinary code/config
    changes (e.g. editing `config/tickers.json`) pushed by the maintainer.
- **Retry-only-if-needed, without extra state**: the retry cron just re-runs
  the same fetch. If the first run already got the data, the second run
  fetches the identical thing, the `git diff` against `public/data/` is
  empty, and the commit/build/deploy steps (all gated on
  `steps.git-check.outputs.changed == 'true'`) are skipped — a true no-op.
  This reuses the existing "no data → no diff" behavior already in
  `fetch-tw.js`/`fetch-us.js`/`jsonStore.js` from Phase 1, no new logic
  needed there.
- **Why fetch/backfill workflows build+deploy themselves** instead of
  triggering `deploy.yml`: pushes made with the default `GITHUB_TOKEN` inside
  a workflow do **not** re-trigger other `on: push` workflows (GitHub's
  loop-prevention). So each data workflow does its own
  build → `upload-pages-artifact` → `deploy-pages` right after committing.
  `deploy.yml`'s `on: push` only ever fires from the maintainer's own
  (human-authenticated) pushes, so there's no double-deploy.
- **Pages source**: set to "GitHub Actions" via
  `gh api -X POST repos/OWNER/REPO/pages -f build_type=workflow` (one-time,
  done during setup) rather than the Settings UI — same effect, one command.
- **Repo**: `caeszrr/stock-diary`, public (required for free GitHub Pages).
  Git commit identity for both the maintainer's own commits and the
  workflows' bot commits: `caeszrr` /
  `caeszrr@users.noreply.github.com`.
- **Verified live**, not just locally: cold-loaded the deployed URL with
  Playwright (desktop + mobile, zero console errors, real prices rendered),
  then manually dispatched all four workflows once each via
  `gh workflow run` and watched them through to a successful
  fetch → commit → build → deploy, confirming `data/status.json` on the live
  site updated with fresh timestamps.

## What's not built yet

Per the full spec in `claude-code-prompt-stock-diary.md`, phases 6-8 are not
implemented in this repo yet: PWA (manifest/service worker/install) and the
maintainer/user docs + handoff pass.

## Local development

```bash
npm install
npm run fetch:all   # or npm run backfill for fuller history — populates public/data/
npm run dev          # http://localhost:5173/stock-diary/
```
