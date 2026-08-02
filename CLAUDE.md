# CLAUDE.md

Standing rules for working on this repo. Read `README.md` for current build
status and architecture decisions; read `claude-code-prompt-stock-diary.md`
for the full original product spec.

## Non-negotiable rules

- **Taiwan color convention everywhere, indices included: red = up, green =
  down.** No exceptions, no "but this chart library defaults to green up."
- **Never fabricate market data.** Missing days render blank (empty cell),
  never interpolated, zero-filled, or carried forward from a previous day.
- **User notes and quote data live in separate stores.** Quote data is
  `public/data/*.json` (pipeline-written, read-only from the frontend). User
  data (notes/profiles/pins/hidden/added tickers/settings) lives in
  `localStorage` behind `src/lib/userData.js` (see "Storage abstraction"
  below). A data refresh must never touch notes; a note edit must never
  touch quote data. If you're changing code that could blur this line, stop
  and re-check which store you're actually writing to.
- **All UI text is Traditional Chinese (zh-TW).** Dates support ROC (民國)
  display via the existing toggle — don't add English-only strings to
  user-facing UI.

## Data completeness & monitoring (standing rules)

Born from a silent partial-update failure (2026-07-24: a stale TWSE
`STOCK_DAY_ALL` snapshot left all 上市 symbols blank while the run stayed
green). These are non-negotiable:

- **Presence is not completeness.** "A file exists for this session" must
  never count as success. Success = every *expected* symbol has a record for
  the *expected trading day*. `ok`/`complete` come from the coverage check
  (`scripts/lib/coverage.js`), never from `count > 0`.
- **Never hardcode what "complete" means.** Derive the expectation at runtime
  (configured watchlist ∪ previous-session symbols; the exchange's own
  reported count where available). A hardcoded list goes stale the moment a
  stock delists or a user adds one.
- **Re-request only what's missing.** On a gap, targeted per-symbol re-fetch
  with backoff — never re-pull the whole market (re-triggers throttling).
- **Heal before alerting.** The watchdog repairs transient gaps first and only
  escalates (a GitHub Issue) what a repair cannot fix.
- **Never alarm when silence is correct.** Weekends, TWSE holidays (incl.
  ad-hoc typhoon closures discovered and recorded in
  `config/market-holidays.json` `twDiscovered`), and US market holidays are
  expected silence. Only judge sessions that should already be published
  (before the market's current day, or one the fetch already recorded).
- **A confirmed no-trade is a verdict, not a failure.** If a targeted re-fetch
  confirms the exchange has no record (zero volume/suspension/halt), mark it
  `no_trade`/`suspended`/`market_closed` and stop retrying — a legitimate empty
  cell, distinct from an unexplained gap.
- **Commit partial, never mark it complete.** If the source only gives part of
  a session, commit what there is with `complete:false`; do not fabricate the
  rest.

## Storage abstraction (future-proofing, do NOT build ahead of need)

All user-generated data goes through `src/lib/userData.js`, which is the only
module that talks to `src/lib/store.js` (localStorage today). Never call
`localStorage` directly from UI code. This exists so a future multi-user
platform can swap in a database-backed sync layer by rewriting `store.js`
alone. Do NOT design that database layer now — this is a placeholder
constraint, not a task.

If/when a real accounts/sync system is built later: it must be **passwordless
and email-free** — an anonymous device-link scheme (QR/sync code) or
passkeys only. The maintainer will not do password-reset support. The
export/import JSON backup (`src/lib/userData.js` `downloadBackup`/
`importBackupFromText`) is the permanent recovery path and must keep working
regardless of what sync layer is added on top.

## Workflow after each phase/significant change

1. Update `README.md`: current status + any architecture decision made along
   the way (not just "what" — the "why," especially for anything that
   deviates from the original spec or wasn't obvious).
2. Verify visually with Playwright (or the `run` skill) against `npm run
   dev`: screenshot desktop (~1400×900) and mobile (~390×844) viewports,
   confirm zero console errors (`page.on('console')` / `page.on('pageerror')`
   — check both, not just one).
3. Only then move to the next phase/task.

## Project structure quick reference

- `scripts/` — Node fetch/backfill pipeline (TWSE/TPEx/Yahoo Finance), writes
  `public/data/`. Run locally with `npm run fetch:all` / `npm run backfill`.
- `src/lib/` — pure logic: `store.js`/`userData.js` (persistence),
  `watchlist.js` (merges config + user data into what renders),
  `tickers.js` (raw `config/tickers.json` accessor, build-time bundled),
  `twSymbols.js`/`twAllHistory.js`/`userTickerData.js` (self-serve add-stock
  data sourcing), `loadMonth.js` (quote data fetch), `format.js`.
- `src/components/` — DOM-building UI modules, no framework.
- `.github/workflows/` — `fetch-tw.yml`, `fetch-us.yml` (cron + retry, build
  + deploy themselves), `backfill.yml` (`workflow_dispatch`), `deploy.yml`
  (plain push-to-main deploy for maintainer code changes).
- Live site: https://caeszrr.github.io/stock-diary/. Repo:
  https://github.com/caeszrr/stock-diary.
