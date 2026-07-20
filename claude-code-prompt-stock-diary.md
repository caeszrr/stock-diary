# Claude Code Build Prompt — 台美股每日紀錄 (Daily Stock Diary Web App) — v2

Copy everything below this line into Claude Code. Place the companion file `tickers.json` in the project root before starting.

---

## Context

I'm building a web app for an older Taiwanese retail investor who currently hand-types a daily stock diary into a Word table. Their system: rows = ~110 instruments (mixed Taiwan + US), columns = trading dates. Each cell contains that day's data (收盤/開盤/最高/最低/昨收/漲跌幅/漲跌/總量/振幅, sometimes 一年高/低) plus personal notes (chart-shape shorthand like 山丘震平, news, emphasis via bold/highlight). The first column is a per-stock profile: name, thesis tag, position ledger (進/出 entries with dates, average cost 均, remaining shares 剩), dividend info, milestone highs. The top row tracks indices (加權指數, 道瓊, 那斯達克, 標普500, 費城半導體) plus daily macro notes.

The app's job: **automate the number transcription completely, keep all personal annotation manual.** Never auto-generate notes, shape codes, or analysis — those are the user's own thinking.

## Users & constraints

- Primary user: non-technical, older, Traditional Chinese speaker, uses ROC (民國) dates. They receive one URL, open it, and immediately see this month with fresh data. They install it to their laptop desktop and phone home screen via the browser's PWA install. Zero configuration on their end.
- Maintainer: me. I manage the GitHub repo.
- Budget: $0. No paid APIs, no servers, no databases.
- The app is **end-of-day only**: each market's data appears after that market closes and official numbers are finalized. No realtime/intraday quotes anywhere.

## Architecture (build exactly this)

1. **Static single-page app** — vanilla JS or a lightweight Vite setup, your call; deployed output must be plain static files. Hosted on **GitHub Pages**.
2. **Data pipeline: GitHub Actions cron** fetches daily quotes and commits JSON to the repo; the frontend fetches only those repo files. No third-party API calls from the browser (avoids CORS and rate limits).
   - **Taiwan run**: 07:10 UTC (15:10 Taipei) Mon–Fri, with a retry run at 08:10 UTC that only acts if the first produced no data (GitHub cron can fire late or sources can lag). Taiwan market closes 13:30 Taipei; official TWSE/TPEx daily figures are available shortly after.
   - **US run**: 22:30 UTC (06:30 Taipei) Tue–Sat, retry at 23:30 UTC. Covers both US DST states (US close = 04:00–05:00 Taipei).
   - Also `workflow_dispatch` with date-range + optional symbol inputs for manual backfill.
   - Each run writes an update manifest (`data/status.json`) with per-market last-update timestamp and latest session date; the app header displays these as 最後更新 so the user always sees data freshness.
3. **Watchlist data files**: `data/{market}/{YYYY}/{MM}.json` (e.g. `data/tw/2026/07.json`, `data/us/2026/07.json`, `data/idx/2026/07.json`). Shape: `{ "symbol": { "YYYY-MM-DD": {o,h,l,c,pc,v,to,yh,yl}, ... } }` — open, high, low, close, prevClose, volume, turnover, yearHigh, yearLow. Omit unavailable fields. Frontend loads only the selected month.
4. **Full Taiwan market archive** (enables self-serve stock adding, see Features): the Taiwan run also stores the ENTIRE market's daily OHLCV — all 上市 + 上櫃 stocks — since TWSE/TPEx bulk endpoints return everything in one call anyway. Store as `data/tw-all/{YYYY}/{MM}.json`, minified. Size budget: ≤ ~1.5MB gzipped per month (GitHub Pages serves gzip); if exceeded, split per-day or shard alphabetically — engineer it, measure it, document it. Also emit `data/tw-symbols.json`: code → { name, market } directory for all TW stocks, refreshed daily, used by the add-stock search.
5. **Watchlist config**: `config/tickers.json` — I am providing this file with ~110 preloaded instruments extracted 1:1 from the user's Word file, including groups. Schema per entry: `{ symbol, market: "index"|"us"|"twse"|"tpex", name_zh, group, verify? }`.

## Preloaded watchlist — validation is mandatory

- Use the provided `tickers.json` as-is for initial state.
- **First pipeline run must validate every symbol** against its data source (TW codes against the bulk endpoints; US tickers against the US source; indices against their mapped symbols). Produce a clear validation report: resolved ✓ / failed ✗ with the fetched name next to each TW code so I can confirm code↔name matches. Entries flagged `"verify": true` are newer/uncertain listings (e.g. SPCX, DRAM, GOOP, 6209 今國光, 4585 達明, 00997A, 009821) — pay special attention; if a symbol fails, keep it in config, mark it `"status": "unresolved"`, exclude from fetch, and list it in the report. Never silently drop a ticker.
- Index symbol mapping: TAIEX from TWSE index endpoints; DJI/IXIC/SPX/SOX map to the US source's notation (e.g. Stooq `^dji`, `^ndq`, `^spx`, `^sox` — verify actual notation against the chosen source).

## Data sources — verify with real requests before building

- **Taiwan 上市**: TWSE OpenAPI, e.g. `https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL` (all listed stocks daily OHLCV) and MI_INDEX / FMTQIK for TAIEX OHLC + market turnover. Docs: https://openapi.twse.com.tw
- **Taiwan 上櫃**: TPEx OpenAPI daily close quotes for all OTC stocks (https://www.tpex.org.tw/openapi/).
- **US stocks & indices**: Stooq daily CSV (`https://stooq.com/q/d/l/?s=nvda.us&i=d`, no key) or `yahoo-finance2` npm inside the Action. Test both; pick the more reliable as primary, implement the other as a documented fallback with automatic failover.
- 52-week high/low: compute from stored history; seed via backfill.
- **Backfill**: on first setup, backfill 2026-01-01 → today for every configured ticker (US sources provide history directly; TWSE per-stock monthly history via `/rwd/zh/afterTrading/STOCK_DAY?stockNo=&date=`; TPEx equivalent). Rate-limit politely (sequential with delays) — this is a one-time job.
- TW and US holidays differ: a date may have data for one market only. Render blank sub-cells; never fabricate values. All date logic in `Asia/Taipei`; US sessions keyed to the US trading date.

## Core UI (Traditional Chinese, zh-TW)

**Top navigation**: year tabs (earliest data year → current), month tabs 1–12 beneath. **Default view = current year + current month.** Months without data are disabled.

**Main view — the matrix**: rows = instruments under collapsible group headers (order from `tickers.json`); columns = trading days of the selected month, chronological, auto-scrolled to the latest day. Sticky date header (format `7/1（三）` with weekday character; toggle for ROC 民國 display) and sticky first column.

- **Pinned indices row**: 加權, 道瓊, 那指, 標普, 費半 compact, plus an editable per-day 大盤筆記 (macro/market note).
- **First column per stock**: name + code + group tag, plus an editable profile area (position ledger, milestone highs, dividend notes — freeform, preserve line breaks).
- **Daily cell**: compact by default — close price large, 漲跌幅 beneath. **Taiwan color convention: red = up, green = down. Everywhere. Non-negotiable.** Click/tap expands a detail panel: 開盤/最高/最低/昨收/漲跌/總量/成交金額/振幅/一年高低 + the note editor.
- **Per-cell note editor**: 形態 (short shape code), 筆記 (freeform), emphasis level (無/粗體/重點) styling the cell like the user's Word bold/yellow-highlight. Auto-assist: |漲跌幅| ≥ 3% renders the change figure bold automatically (visual only; never writes into user notes).
- **Pinned reference dates**: user can pin any past date; pinned columns render to the right after a separator regardless of selected month. Persisted.
- **新增股票 (add stock) — required feature**:
  - **Taiwan (self-serve, instant)**: dialog with search by 代號或名稱 against `tw-symbols.json`; on add, the row appears immediately with full history pulled from the `tw-all` archive (lazy-loaded). User picks or creates a group. Stored in localStorage as user-added; removable the same way. Preloaded (repo) tickers cannot be deleted by the user, only hidden.
  - **US (assisted)**: dialog accepts a ticker; the row appears immediately flagged 資料待接入, and the app generates a one-tap copyable request message (「請幫我新增美股 XXXX」) to send to the maintainer. I add one line to `tickers.json`; the next backfill/daily run populates it, and the app then auto-merges the pending row with real data. Explain this difference to the user in one friendly zh-TW sentence inside the dialog.
- **Search/filter** by name/code; group collapse state persisted.

**User-data persistence**: all user content (cell notes, profiles, market notes, pins, user-added stocks, hidden rows, group order) in `localStorage`, namespaced + versioned. Prominent 匯出備份 / 匯入備份 (single JSON download/upload) in settings, with a plain-language zh-TW warning that notes live on this device until backed up. Debounced autosave. Quote data and user notes are separate stores merged at render — a data refresh must never touch notes.

**Install & share**: PWA done properly — manifest, icons, service worker (cache app shell; network-first for data). Must pass installability on desktop Chrome/Edge (real desktop icon + standalone window) and mobile. Settings panel includes step-by-step zh-TW 安裝到電腦 / 安裝到手機 instructions. Sharing the app = sharing the URL; state that in the README.

## Non-goals (do not build)

No realtime quotes, no trading/broker integration, no accounts/auth/server, no automated news scraping, no AI commentary or auto-analysis in the diary.

## Build phases — verify each before proceeding

1. **Pipeline**: Node fetch scripts for TWSE, TPEx, US + indices; run locally against real endpoints; produce monthly JSON incl. the tw-all archive and tw-symbols directory; run full-watchlist **symbol validation** and print the report; backfill 2026-01-01 → today; sanity-check sample values against real closing prices (e.g. 2330, NVDA, TAIEX) before continuing.
2. **Matrix UI** on local JSON: year/month tabs defaulting to current month, sticky header/first column, groups, compact cells, detail panel, TW red/green, zh-TW labels, indices row.
3. **Annotation layer**: notes, shapes, emphasis, profiles, market notes, pins, localStorage, export/import.
4. **Add-stock feature**: TW self-serve flow end-to-end (search → instant row with history), US assisted flow with pending state + request message + auto-merge once data lands.
5. **GitHub Actions + Pages**: cron schedules above with retry logic and commit-if-changed; backfill dispatch; status.json freshness stamps surfaced in the header; deploy; verify the live URL cold-load shows current month.
6. **PWA + mobile polish**: desktop + mobile install verified, offline shell, horizontal scroll UX with sticky first column, touch targets.
7. **Docs**: `README.md` for the maintainer (add/remove ticker, trigger backfill, what to check when a source breaks, how the retry crons behave) + a short zh-TW 使用說明 in the settings panel (including install steps and the backup warning).
8. **Optional, only if time permits and it stays free**: a Cloudflare Worker "US add request" queue the Action reads, making US additions fully self-serve. If skipped, document as future work.

## Acceptance checklist

- Cold-opening the URL shows the current month with real data, correct 最後更新 stamps per market, and no setup.
- Symbol validation report exists; every unresolved ticker is visibly listed, none silently dropped.
- Friend-side add: any 上市/上櫃 stock added in-app shows full history instantly with no repo change; a US add shows the pending row + request message, and populates automatically after I add one config line.
- After the TW cron window, today's Taiwan close is live; after the US cron window, last night's US close is live — verified on the deployed site across at least two real market days.
- A cell note survives reload; export → wipe localStorage → import restores everything, including user-added stocks.
- Red = up / green = down everywhere, indices included.
- A TW-holiday/US-trading-day (and the reverse) renders correctly with blanks, not fabricated data.
- Installs as a desktop app (Chrome/Edge) and phone PWA; monthly watchlist data files stay small enough that the current-month view loads fast on mobile.
- No console errors.

Ask clarifying questions only if a decision would change the architecture; otherwise make sensible choices and record them in the README.
