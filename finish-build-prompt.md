# Stock Diary — Finish the Build (Phases 3–8)

## Context recovery (do this first)

1. Read `README.md`, `claude-code-prompt-stock-diary.md` (the full spec), `config/tickers.json`, and the phase-1/2 plan notes if present.
2. Phases 1–2 (data pipeline + matrix UI) are complete and verified. Do not rebuild them; touch that code only where a later phase requires integration.
3. Before writing any new code, report to me in one short list: (a) the 3 unresolved tickers from phase-1 validation — names, intended market, what was tried; (b) current data coverage per market (date ranges). Wait for my confirmation, then continue without stopping.

## Execute the remaining phases, in order

- **Phase 3 — Annotation layer**: per-cell notes (形態 / 筆記 / emphasis level), per-stock profile text, per-day 大盤筆記, pinned reference dates, localStorage persistence (namespaced + versioned), prominent 匯出備份 / 匯入備份, debounced autosave. Quote data and user notes are separate stores merged at render — a data refresh must never touch notes.
- **Phase 4 — Add stock + start modes**: TW self-serve (search 代號或名稱 against tw-symbols.json, instant row with history from the tw-all archive); US assisted (row appears as 資料待接入 + one-tap copyable request message for the maintainer, auto-merges once data lands). Preloaded tickers can be hidden, not deleted — in full mode. ALSO build a first-visit welcome screen with two clear choices: 「載入完整預設清單」 (loads the full 108-ticker preloaded watchlist — the default for my diary friend) and 「從空白開始」 (shows only the indices row plus a prominent 新增股票 button; the user builds their own watchlist and gets the identical diary features per stock). The choice is stored locally and can be switched later in settings without losing any notes. In blank mode, user-added stocks are fully removable. One site, one URL for everyone — the mode is only a per-device starting state, not a separate deployment.
- **Phase 5 — Deploy (GitHub Actions + Pages)**: crons with retry runs per the spec (TW 07:10/08:10 UTC weekdays; US 22:30/23:30 UTC Tue–Sat), commit-if-changed, backfill workflow_dispatch, `data/status.json` freshness stamps shown in the app header. **This is the only phase that needs me.** Walk me step-by-step through creating the GitHub repo and authorizing (`gh auth login`), assuming I have never used GitHub before. Pause and wait at every step that needs my input, then verify the live Pages URL cold-loads with real data.
- **Phase 6 — PWA + mobile polish**: manifest, icons, service worker (cache shell, network-first data); installability verified on desktop Chrome/Edge (real desktop icon, standalone window) and on a phone; mobile horizontal-scroll UX with sticky first column and comfortable touch targets.
- **Phase 7 — Docs + handoff**: maintainer `README.md` (add/remove ticker, backfill, what to check when a source breaks, how the retry crons behave) and in-app zh-TW 使用說明 (install steps + backup warning). ALSO create `handoff.txt`: a short, friendly Traditional Chinese message I can send my friend on LINE containing the live URL, three-step install instructions for laptop and for phone, one line explaining that numbers update automatically every day after each market closes, and one line noting that 上櫃 stocks build history from now on (no past backfill exists for them).
- **Phase 8 — Skip** the Cloudflare Worker; document it as future work in the README.

## Standing rules — write these into `CLAUDE.md` at project root so every future session inherits them

- Taiwan color convention everywhere, indices included: red = up, green = down.
- Never fabricate market data; missing days render blank.
- User notes and quote data live in separate stores; refreshes never overwrite notes.
- All UI text is Traditional Chinese; dates support ROC (民國) display.
- After each phase: update README (status + decisions) and verify visually with Playwright screenshots on desktop and mobile viewports, zero console errors, before moving on.
- Future direction (do NOT build now): this may later become a multi-user platform. Keep notes/watchlist storage behind a small abstraction layer so a database can replace localStorage later without a rewrite. Any future account/sync system must be passwordless and email-free — an anonymous device-link scheme (QR / sync code) or passkeys — because the maintainer will not do password-reset support; the export/import backup remains the permanent recovery path.

## Definition of done

Every item in the acceptance checklist of `claude-code-prompt-stock-diary.md`, verified on the LIVE GitHub Pages URL — including a cold load on a phone. Additionally verify blank-start mode end-to-end: a fresh browser choosing 「從空白開始」 sees only the indices row, adds a Taiwan stock, gets instant history for it, and notes work identically to full mode. Finish by giving me: the live URL, the contents of `handoff.txt`, and anything from the checklist that could not be verified yet because it requires the crons to run across real market days (list those as "verify tomorrow" items for me).
