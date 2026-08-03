# 股票日記 Stock Diary

Static PWA that replaces a hand-typed Word-table daily stock diary. See
`claude-code-prompt-stock-diary.md` for the full product spec this was built
against. **All 7 planned phases are complete** (Phase 8 intentionally
skipped, see below): data pipeline, read-only matrix UI, the annotation
layer, add-stock + start modes, GitHub Actions + Pages deploy, PWA + mobile
polish, and this docs/handoff pass. A later hardening pass added **completeness
monitoring**: the pipeline verifies every session is complete (not merely
present), self-heals gaps, and a watchdog escalates only what it can't fix —
see "Self-monitoring: coverage records + watchdog" below. After the first month
rollover (2026-08-03) broke the 8月 tab while that watchdog stayed green, a
**synthetic check** was added that opens the deployed site and asserts what a
human sees — see "Synthetic site check" below.

**Live site**: https://caeszrr.github.io/stock-diary/
**Repo**: https://github.com/caeszrr/stock-diary

## V2 trading-day workflow (overnight build, 2026-07-27 — dryRun 驗收中)

An experimental **v2 app** lives entirely in `src/v2/`: a seven-step
trading-day pipeline (定案清單 → 交易計畫 → 盯盤 → 成交確認 → 連環下一筆 →
收盤儀式 → 結算) plus a manual-entry 金庫 (holdings vault). Reached via the
「✨ V2 新版」 header button or `#/v2`; the app still defaults to v1.

Key architecture decisions (full rationale in `DECISIONS.md`, design rules in
`src/v2/DESIGN.md`, build log in `OVERNIGHT_LOG.md`, acceptance guide in
`MORNING_REPORT.md`):

- **Why a hash-gated second app instead of a router refactor**: v1 stays
  byte-for-byte identical in behavior; the only existing file touched is
  `src/main.js` (+13 effective lines) which mounts `src/v2/main.js` when the
  hash starts with `#/v2`. Rollback surface is those 13 lines.
- **dryRun draft layer**: v2 writes go through `src/v2/lib/draftStore.js`;
  while `DRY_RUN = true` (`src/v2/lib/dryRun.js`) everything stays in memory
  with a full append-only payload log. Real persistence targets a *separate*
  localStorage key (`stockDiaryV2`, via `src/v2/lib/v2store.js`) — never v1's
  user data, keeping the "userData.js is the only localStorage writer" rule
  intact per store.
- **Fees are code + tests, not UI math**: `src/v2/lib/fees.js` (0.1353% both
  sides, 0.15%/0.3% sell tax, buy tax 0, floor rounding, no assumed NT$20
  minimum) locked by 10 vitest tests (`npm test`). Risk/reward < 1.5 is a
  hard gate in S2.
- **No realtime source is honestly no realtime**: all "current" prices are
  labeled 最近收盤 from the existing EOD pipeline (`public/data/`); Fugle/
  Telegram are declared not-connected stubs (`src/v2/lib/alerts.js`) rather
  than fabricated.

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

**Easiest way (no local setup needed, just a browser):**
1. On GitHub, open `config/tickers.json`, click the pencil (✏️ Edit) icon.
2. Add/remove an entry — schema: `{ symbol, market: "index"|"us"|"twse"|"tpex", name_zh, group, verify?, status? }`.
3. Commit directly to `main` (bottom of the page). This alone triggers
   `deploy.yml`, which rebuilds and redeploys the site with the new ticker
   showing up in the list (blank history until the next steps).
4. To fill in its history: repo → **Actions** tab → **Backfill historical
   data** (left sidebar) → **Run workflow** → fill in `symbols` with just the
   new ticker's code (e.g. `2891`) to keep it fast, leave the date range at
   the defaults → **Run workflow**. It commits and redeploys automatically
   when done (watch it under the Actions tab).

**With a local clone:** edit `config/tickers.json`, run `npm run validate` to
confirm it resolves, `npm run fetch:all` (or `npm run backfill` for history),
then commit + push — `npm run build` isn't needed locally, Actions builds on
push.

## Maintainer runbook: when a data source breaks

Check `data/status.json` on the live site first
(`https://caeszrr.github.io/stock-diary/data/status.json`) — each market's
`lastRun`/`latestSessionDate`/`ok` tells you which pipeline actually ran and
whether it got data. Then check the failing workflow's logs: repo → Actions
tab → click the red ✗ run → expand the failing step.

| Symptom | Likely cause | What to do |
|---|---|---|
| `tw`/`tpex` stale for >1 trading day, workflow shows green | TWSE/TPEx changed their API shape or started blocking the runner's IP | Check `scripts/lib/twse.js`/`scripts/lib/tpex.js` against the live endpoint URLs in "Data sources" above; a 200 response with unexpected JSON shape usually means a field got renamed |
| `us` stale, workflow shows green | Yahoo Finance chart API returned an unexpected shape, or rate-limited | `scripts/lib/yahoo.js` already fails over `query1` → `query2`; if both fail, check `usFailures` in `status.json`'s `backfill`/`us` entries for the exact symbols/errors |
| A whole workflow run is red (failed) | Node/npm error, not a data-source issue | Open the failing step's log directly — usually a stack trace pointing at the exact line |
| One symbol just stopped appearing | Delisted, or code changed | Re-run `npm run validate` (locally or by checking its report format) — it marks unresolved symbols `"status": "unresolved"` without deleting them, exactly like the 3 tickers noted in "Unresolved tickers" above |
| Retry run (08:10/23:30 UTC) always seems to do nothing | This is expected when the 07:10/22:30 run already succeeded — see "Phase 5" below for why the retry is a deliberate no-op in that case, not a sign anything is broken |

## Self-monitoring: coverage records + watchdog

The pipeline checks **completeness, not presence** — a stale/partial session
is detected instead of being silently accepted (this was added after a
2026-07-24 partial-update slipped through green). Key pieces:

- **Coverage record** — `data/status.json` has a `coverage` block per market:
  `sessionDate`, `expectedCount`, `actualCount`, `missingCodes`, `complete`,
  `stale`, a `health` verdict (`healthy`/`gap`/`resolved-empty`), any resolved
  per-symbol verdicts (`no_trade`/`suspended`/`market_closed`/`no_history`),
  and `anomalies`. Read it on the live site at
  `https://caeszrr.github.io/stock-diary/data/status.json`. The app surfaces it
  as the header coverage stamp (e.g. `上市 7/24 67/67`) and the 設定 → **系統狀態**
  panel.
- **Expectation is derived at runtime** (`scripts/lib/coverage.js`): configured
  watchlist ∪ previous-session symbols, against the calendar in
  `config/market-holidays.json` (TWSE official schedule + rule-computed NYSE
  holidays + `twDiscovered` ad-hoc closures like typhoon days). Refresh it with
  `npm run fetch:holidays` (the **Refresh market holiday calendar** workflow
  does this yearly/monthly).
- **Fetch self-heals**: after fetching, each `fetch:*` re-requests only the
  missing symbols with backoff, and exits non-zero if still incomplete so the
  retry cron re-fires on an *incomplete* (not just absent) session. Partial
  data is committed with `complete:false`, never marked complete.
- **Watchdog** (`.github/workflows/watchdog.yml`, `npm run watchdog` /
  `watchdog:sweep`): escalating passes after each market window + a daily
  14-session sweep. Its first action is cheap — read coverage and exit in
  seconds if complete (zero network on a healthy or non-trading day). On a gap
  it re-fetches only the missing symbols, reaches a verdict (a confirmed
  no-trade is not a failure), and writes the health verdict back.
- **A watchdog GitHub Issue** (titled `資料異常：<市場> <交易日>`) means an
  *unresolved* gap survived automatic repair — GitHub emails you on creation.
  It lists the still-missing codes and what was tried. The watchdog updates the
  same issue rather than duplicating it.
- **Manually force a repair**: Actions → **Data watchdog** → Run workflow
  (tick *sweep* to re-check the last 14 sessions), or for a specific
  symbol/date use **Backfill historical data** with `symbols` set. Locally:
  `npm run watchdog:sweep`, or `BACKFILL_SYMBOLS=2330 npm run backfill`.

## Synthetic site check: monitoring what a human actually sees

Added after **2026-08-03, the app's first ever month rollover**, when the 8月
tab rendered greyed out and unclickable for the whole evening while the data
watchdog reported green. That combination is the point: *completeness
monitoring is structurally unable to see a rendering failure.* The watchdog
checks the JSON on disk; nobody was checking the page.

### What actually happened (three separate faults)

1. **The pipeline never ran that day.** GitHub delivered the 07:10 UTC TW cron
   at **16:09 UTC — about 9 hours late**. This is not a one-off: this repo's
   scheduled workflows have been running hours behind for weeks (the US
   22:30 UTC cron has been landing ~07:40 UTC the next morning). 2026-08-03 was
   simply the day the drift pushed a TW run past **Taipei midnight**, by which
   time TWSE's bulk `STOCK_DAY_ALL` snapshot had rolled over, so 上市 and TAIEX
   missed the session entirely. **Cron delivery time is not something this repo
   controls, so nothing here should assume it.**
2. **The UI treated "no data yet" as "this month does not exist."** The month
   tab list was built from `manifest.json` alone, which `regenerateManifest()`
   produces by scanning `public/data/` — data, never calendar. So a month
   before its first successful run had no entry and the tab was hard-disabled,
   and `main.js` silently fell back to July.
3. **`expectedSessionDate()` assumed a run lands before local midnight.** The
   late run therefore demanded a 2026-08-04 session that had not traded and
   declared all 67 上市 + 13 上櫃 symbols missing — a false alarm primed to
   become a watchdog Issue.

### The rules that came out of it

- **Month list = calendar ∪ data, never data alone** (`src/lib/monthTabs.js`).
  The **current month and current year are always clickable**, data or not. A
  month the pipeline missed entirely still renders rather than vanishing;
  future months stay disabled because they cannot have data.
- **A valid-but-empty month is a normal state with an explanation**, not a
  blank grid: 本月尚無資料，今日收盤後更新 / 本月尚未開始交易 / 週末休市，本月尚無資料.
- **The default view is the current Taipei month, always.** The one case that
  can still degrade — a manifest that failed to load — says so on screen
  instead of silently showing an older month.
- **Session expectation comes from the market's own clock**, via a publish
  cutoff (15:00 Taipei / 17:00 New York) rather than "today or earlier". A late
  run still judges the session it was meant to judge. This also fixed the US
  expectation on the watchdog's 00:00/01:30 UTC passes, which were reading the
  rolled-over UTC date as a US session.

### The check itself

`scripts/synthetic-check.js` (`npm run synthetic`,
`.github/workflows/synthetic-check.yml`) opens the **deployed** site headlessly
at 1400×900 and 390×844 and asserts:

- the current month tab exists, is **enabled**, and is **selected by default**;
  the current year tab exists and is enabled
- **2330** and **TAIEX** show a real close for the latest expected trading
  session
- the service worker has taken control and the page is running the build that
  is actually deployed (`window.__STOCK_DIARY_BUILD__` vs a cache-busted
  `version.json`) — not a frozen copy
- **zero console errors**, via both `page.on('console')` and
  `page.on('pageerror')`

Scheduled after each market's update window plus once daily. **Green does
nothing at all** — no Issue, no comment, no commit, no email; the job has
`contents: read` only, so it cannot churn a data commit. On failure it opens
**one** issue (`網站異常：使用者看到的畫面檢查未通過`, label `site-down`) and
*comments* on it thereafter rather than duplicating, naming the failed
assertions and linking the screenshot artifact.

Two deliberate trade-offs worth knowing:

- **Freshness has a grace window** (`SYNTHETIC_GRACE_HOURS`, default 6). Given
  the cron drift above, demanding the newest session the instant its publish
  cutoff passes would alarm on a merely-late-but-working pipeline. Beyond the
  grace window, a missing session is a real failure. Lower it if the drift ever
  goes away.
- **A recovered check does not close its issue.** "Silent when green" was an
  explicit requirement, and closing an issue emails you too. The cost is that a
  resolved issue stays open until closed by hand — the same convention the data
  watchdog already follows.

`workflow_dispatch` takes **`use_branch_build`**, which builds and serves the
checked-out branch locally and checks that instead of the live site — so a
change can be verified *before* it is merged.

### Rollover is covered by CI now

`.github/workflows/ci.yml` runs `npm test` + `npm run build` on every push/PR.
`src/lib/monthTabs.test.js` and `scripts/lib/coverage.test.js` **simulate the
clock** on the first calendar day and the first trading day of a new month
(including a Saturday 1st, a year rollover, consecutive holidays, and a run
delivered after Taipei midnight), so 2026-09-01 is verified here rather than in
production.

> `jsdom` is pinned to `^26` deliberately: `jsdom@30` requires Node 22, and
> this project targets Node 20 everywhere. Under Node 20 the entire DOM test
> file failed to *start* while the suite still printed "24 passed" — a test
> that cannot start is not a test.

## Future work (Phase 8 — skipped)

The spec's optional Phase 8 (a Cloudflare Worker queue making US stock
additions fully self-serve, so requests wouldn't need a manual
`config/tickers.json` edit) was intentionally skipped to stay inside the
$0/no-server constraint with the simplest possible setup. The current US
"assisted add" flow (in-app pending row + copyable request message, see
Phase 4 below) covers the same need with one manual step from the
maintainer. If this is worth automating later: the Worker would receive add
requests, store them (e.g. KV), and the `fetch-us.yml`/`backfill.yml`
workflows would read pending requests from it before running — no other
architecture change needed.

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

## Phase 6 — PWA + mobile polish (decisions made while building)

- **Icons**: generated with Playwright (not an image-editing tool/library) —
  `icon.html` in a scratch dir renders a styled 股 glyph on the app's accent
  gradient, screenshotted at each required size/viewport
  (192/512/512-maskable/180-apple-touch/32-favicon). Simple and dependency-free;
  regenerate the same way if the design ever needs to change.
- **Manifest** (`public/manifest.webmanifest`): `display: standalone`,
  `theme_color`/`background_color` matching the app's light palette,
  `start_url`/`scope` at the site root. Referenced from `index.html` via
  **unprefixed** root paths (`/manifest.webmanifest`, `/icons/...`) — Vite
  rewrites these to include `base` (`/stock-diary/...`) automatically in both
  `npm run dev` and `npm run build`. Hardcoding the `/stock-diary/` prefix
  manually was tried first and broke in dev only: Vite's dev-server HTML
  transform prepends `base` unconditionally, so an already-prefixed literal
  got doubled to `/stock-diary/stock-diary/...` (build output was fine
  either way, since it doesn't re-prepend an already-resolved path — the dev
  and build code paths disagree here, unprefixed is the one that works in
  both). If the repo is ever renamed, update `vite.config.js`'s `BASE_PATH`
  only — these paths don't need to change since they're base-relative.
- **Service worker** (`public/sw.js`): no build-time precache manifest (Vite
  output filenames are content-hashed and change every deploy). Instead:
  cache-first + stale-while-revalidate for everything except `/data/` paths,
  network-first-with-cache-fallback for `/data/` (quote JSON). Registered
  from `main.js` on `window.load`, scoped to the app automatically since
  `sw.js` lives at the site root under `base`.
- **First-visit vs. later-visit caching**: the very first page load's own
  shell requests happen before the newly-registering service worker can
  control the page (standard SW lifecycle — `clients.claim()` only affects
  requests from the next navigation onward). The shell becomes available
  offline starting from the visitor's second visit/reload; this is normal
  PWA behavior, not a bug, and doesn't affect quote data (which is
  network-first regardless and only needs the cache fallback once it's been
  fetched at least once).
- **Mobile header**: the status line ("TW上市 最後更新：…") was wrapping
  character-by-character on narrow screens because it shared a flex row with
  the title and action buttons. Fixed with `order`/`flex-basis: 100%` in the
  `max-width: 640px` media query so title+buttons stay on one row and the
  status line gets its own full-width row below. Also bumped action buttons
  to a 40px minimum touch target on mobile.
- **Verified**: manifest fetches with zero errors from Chrome's own
  `Page.getAppManifest` (CDP) parser; service worker reaches `activated`
  state; a real offline reload (`context.setOffline(true)`, second visit)
  renders the full matrix with real cached data and zero errors — confirms
  both the shell cache and the data cache-fallback actually work, not just
  that the code compiles. **Not verified by me** (needs a real device, not
  headless automation): the actual "Install" button/desktop icon + standalone
  window in a real Chrome/Edge window, and "加入主畫面" on a real phone — see
  the note left for you in the final handoff.

## Phase 7 — Docs + handoff (decisions made while building)

- **In-app 使用說明**: added as the first section in 設定 (settings), ahead
  of backup — install steps for desktop (Chrome/Edge) and phone
  (Android/iPhone), plus a repeated backup warning right where the user is
  already looking at 匯出備份/匯入備份.
- **Maintainer runbook**: added a GitHub-web-only path for adding/removing a
  ticker (edit `config/tickers.json` in the GitHub UI → commit → optionally
  run the "Backfill historical data" Action with just the new symbol) so the
  maintainer never strictly needs a local clone for routine changes. Added a
  symptom → cause → fix table for when a data source breaks, pointing at
  `data/status.json` and the Actions logs first.
- **`handoff.txt`**: a friendly zh-TW message (LINE-ready) with the live URL,
  3-step install for laptop and phone, the daily auto-update behavior, the
  上櫃 no-backfill caveat, and a backup reminder — see the file itself.

## What's not built yet

Nothing from the required phases (1–7). Phase 8 (Cloudflare Worker for
fully-self-serve US adds) was optional and is intentionally skipped — see
"Future work (Phase 8 — skipped)" above for what it would take to add later.

## Local development

```bash
npm install
npm run fetch:all   # or npm run backfill for fuller history — populates public/data/
npm run dev          # http://localhost:5173/stock-diary/
```
