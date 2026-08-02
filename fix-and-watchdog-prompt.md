# Stock Diary — Partial-Update Bug + Self-Monitoring Watchdog

## Context

The live site (caeszrr.github.io/stock-diary/) is in daily use. A user reported that Friday 2026-07-24's Taiwan close is **partially** missing: most watchlist stocks updated, a handful did not. This is worse than a total failure because it is silent — the app renders a missing cell and a market holiday identically, so nobody noticed until a human did.

Two jobs, in order: find and fix the actual cause, then make the system detect and repair this class of failure by itself.

**Do not ask me which symbols are missing, and do not accept any hint about it.** Finding them is part of the diagnosis, and the same detection logic has to work unattended forever.

---

## PHASE A — Diagnosis only. NO code changes. Report and stop.

Read `CLAUDE.md` and `README.md` first. Then investigate and report:

1. **The missing set.** For TW session 2026-07-24, which configured watchlist symbols have no record? List them with code + name.
2. **The pattern.** Does the missing set cluster? Check against: config group, code-number range, position in whatever order the fetch script iterates, 上市 vs 上櫃, symbols added later vs original, and anything else the code makes plausible. Truncation, throttling, and a per-group bug each leave different fingerprints — say which fingerprint this matches and why.
3. **History.** Run the same coverage check for every TW and US session in the last 3 weeks. Is 7/24 unique, or has this been happening quietly? Report a per-session coverage table (session date, symbols with data / symbols expected, missing codes).
4. **The full-market archive.** For the same session, is `data/tw-all/` also short, or does it hold records the watchlist file is missing? If the archive has them and the watchlist file doesn't, the bug is in the write/merge step, not the fetch.
5. **Run history.** Use `gh run list` to check whether the scheduled TW/US runs actually fired on their own clock on 7/22, 7/23, 7/24, and whether the retry runs fired. Report exit statuses and timing, not narrative.
6. **The retry guard.** Read the retry logic and state plainly: does the retry re-run when a session exists but is INCOMPLETE, or only when it is entirely absent? (I believe it is presence-only — confirm from the code.)
7. **Root cause + proposed fix**, with the specific file and function.

**Stop here and wait for my confirmation before changing any code.**

---

## PHASE B — Repair the real hole

Backfill the missing records identified in Phase A (targeted — only the missing symbols/sessions, not a full re-pull). Verify against the raw source that the values are official closes, not mid-session snapshots. Show before/after for a few of the repaired symbols.

---

## PHASE C — The pipeline verifies its own completeness

Governing rule for everything below: **replace every presence check with a completeness check.** "A file exists for this session" must never again count as success.

- **Never hardcode what "complete" means.** Derive the expectation at runtime: the symbol set present in the previous trading session, plus the configured watchlist, plus (where the source provides it) the record count the exchange itself reports for that session. A hardcoded list goes stale the moment a stock delists or a user adds one.
- After fetching and before committing, compute coverage. If short, immediately re-request **only the missing symbols** with exponential backoff — targeted, so it does not re-trigger source throttling. Never re-pull everything to fix a few.
- Write a machine-readable coverage record per market per session into `status.json` (or a sibling file): session date, expected count, actual count, missing codes, whether the session is complete, and the timestamp of the last successful write. Both the app and the watchdog read this.
- **Fix the retry guard** so a retry fires when the session is missing OR incomplete.
- Commit partial data if that is all the source will give, but never mark it complete.

---

## PHASE D — Watchdog workflow (self-healing before alerting)

New scheduled workflow. Two principles it must obey:

**1. Never alarm when silence is correct.** Weekends, TWSE holidays, and US market holidays are expected silence. Build calendar awareness: fetch TWSE's official holiday calendar into a small annual data file (refresh it on a yearly schedule and tolerate failure by falling back to weekday logic), plus a US market holiday list. A monitor that cries wolf every Saturday gets ignored, which is worse than no monitor.

**2. Heal first, tell second.** Most failures are transient. The watchdog repairs, and only escalates if the repair fails.

Behaviour:

- Runs in escalating passes concentrated in the windows where data should land — roughly +30min, +90min, +3h after each market's fetch window — plus one daily sweep that re-checks the **last 14 sessions** and heals any incomplete one it finds. No runs on non-trading days.
- **First action of every run is to read the coverage record and exit within seconds if everything is complete.** Only an actual gap causes any network traffic. This is what keeps frequent checks cheap and polite to the data sources.
- On a gap: dispatch a targeted repair for the missing symbols only, with backoff.
- **Reach a verdict, don't loop.** If a targeted re-fetch confirms the exchange genuinely has no record for that symbol/session (zero volume, suspension, halt), mark it `no_trade` / `suspended` and stop retrying it — that is a legitimate empty cell, not a failure. Only *unexplained* gaps escalate.
- If repair fails: open (or update, never duplicate) a GitHub Issue titled with the market and session date, containing the missing codes and what was tried. GitHub emails the repo owner on issue creation — that is the alert channel, no external service, no cost.
- Write the health verdict back into the coverage record so the UI can show it.

Note the repo is public, so Actions minutes are unlimited and free — frequency is limited by politeness to TWSE/Yahoo and by commit churn, not by budget. Do not add uniform hourly polling.

---

## PHASE E — Make the UI stop lying by omission

- A blank cell currently means three different things. Render them distinctly: **休市** (calendar says closed), **資料補抓中** (expected, not yet arrived, repair in progress), **無成交/停牌** (source confirms no record), and genuinely-unknown.
- The header stamp becomes a **coverage stamp**: e.g. `7/24 收盤 · 108/108 檔`. A partial session must be visible at a glance instead of invisible.
- Add a **系統狀態** panel in settings: last successful fetch per market, next expected update, last watchdog verdict, and any open gaps.
- Banner states in zh-TW: 資料為最新 / 今日休市（正常，最新資料為 X） / 資料延遲中，系統正在重試 / 資料異常，已通知維護者.
- **Cache-busting:** always fetch the coverage/status file fresh with no-store, version data URLs, and auto-reload when the deployed version differs from the running one. Add one large obvious 重新整理資料 button. A user seeing a frozen service-worker copy makes all server-side monitoring useless — assume this is happening to at least one real user on a phone right now and prove it can't.

---

## PHASE F — Sanity checks beyond presence

Data can exist and still be wrong (this project already shipped a mid-session US snapshot once). Add cheap checks to the pipeline and watchdog:

- Volume implausibly low versus the symbol's recent average → likely a mid-session capture → re-fetch after the close.
- OHLC identical to the previous session across many symbols at once → likely a repeated/stale snapshot.
- Cross-market drift: TW and US latest session dates diverging further than the calendar allows.

Flag these into the coverage record; treat them as gaps for repair purposes.

---

## Docs + rules

Update `CLAUDE.md` with the standing rules: never hardcode a completeness expectation; presence is not completeness; heal before alerting; never alarm on non-trading days; a confirmed no-trade is a verdict, not a failure. Update `README.md` with how the watchdog works, how to read the coverage record, what a GitHub Issue from the watchdog means, and how to manually force a repair.

## Definition of done

- Phase A report delivered and confirmed by me before any code changed.
- Friday's hole repaired and verified against source values.
- A deliberately induced gap (e.g. delete one symbol's record for a recent session in a test branch or scratch copy) is detected and auto-repaired by the watchdog without human action — demonstrate this end-to-end, don't assert it.
- The watchdog produces **zero** noise on a weekend/holiday run.
- Live site shows the coverage stamp and correct distinct states; verified with a fresh session, zero console errors.
