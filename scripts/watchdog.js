// Self-healing completeness watchdog. Two rules: never alarm when silence is
// correct (weekends/holidays), and heal before telling (repair transient gaps,
// escalate only what a repair cannot fix).
//
// First action is cheap: read the coverage record and, if the recent window is
// already complete, exit within seconds having made zero network calls. Only an
// actual gap triggers any traffic — that is what keeps frequent checks polite to
// TWSE/Yahoo.
//
// Modes:
//   (default)      check only the latest expected session per market.
//   --sweep        re-check the last 14 sessions and heal any incomplete one.
//
// Exit code 0 = healthy or fully healed; 1 = unresolved gaps remain (the
// workflow opens/updates a GitHub Issue). Verdicts (no_trade / suspended /
// market_closed / no_history) are written back into the coverage record so a
// confirmed empty cell is never retried forever and the UI can show why.

import fs from 'node:fs';
import path from 'node:path';
import { fetchListedHistory } from './lib/twse.js';
import { fetchDaily } from './lib/yahoo.js';
import { upsertRecords, readMonthFile, readJson, regenerateManifest } from './lib/jsonStore.js';
import { loadTickers, isFetchable } from './lib/tickers.js';
import { computeYearHighLow } from './lib/yearHighLow.js';
import { isoYear, isoMonth, sleep } from './lib/dates.js';
import {
  loadHolidays,
  recentTradingSessions,
  buildCoverage,
  writeCoverage,
} from './lib/coverage.js';

const SWEEP = process.env.WATCHDOG_SWEEP === '1' || process.argv.includes('--sweep');
const LOOKBACK = SWEEP ? 14 : 1;
const HOLIDAYS_PATH = path.join(process.cwd(), 'config', 'market-holidays.json');

const holidays = loadHolidays();
const tickers = loadTickers().filter(isFetchable);

// Each check group: which calendar drives it, which data store holds it, the
// expected symbols, and how (if at all) a missing symbol/month can be repaired.
const GROUPS = {
  tw: {
    label: '上市 (TWSE)',
    calendar: 'tw',
    store: 'tw',
    symbols: tickers.filter((t) => t.market === 'twse').map((t) => t.symbol),
    async fetchMonth(symbol, year, month) {
      const rows = await fetchListedHistory(symbol, year, month);
      return rows; // [{symbol,date,...}]
    },
  },
  tpex: {
    label: '上櫃 (TPEx)',
    calendar: 'tw',
    store: 'tw',
    symbols: tickers.filter((t) => t.market === 'tpex').map((t) => t.symbol),
    fetchMonth: null, // no working per-symbol historical endpoint (see scripts/lib/tpex.js)
  },
  us: {
    label: '美股 (US)',
    calendar: 'us',
    store: 'us',
    symbols: tickers.filter((t) => t.market === 'us').map((t) => t.symbol),
    async fetchMonth(symbol, year, month) {
      const y = Number(year);
      const m = Number(month);
      const period1 = Math.floor(Date.UTC(y, m - 1, 1) / 1000);
      const period2 = Math.floor(Date.UTC(y, m, 1) / 1000); // first of next month (captures the whole month)
      const { records } = await fetchDaily(symbol, { period1, period2 });
      return records;
    },
  },
};

function has(store, symbol, date) {
  return store[symbol] && store[symbol][date] && store[symbol][date].c !== undefined;
}

/** Reads which of `symbols` have `date` across the store's month file (cached per month). */
function presentForSession(monthCache, storeName, date, symbols) {
  const key = `${storeName}/${isoYear(date)}/${isoMonth(date)}`;
  if (!monthCache.has(key)) monthCache.set(key, readMonthFile(storeName, isoYear(date), isoMonth(date)));
  const store = monthCache.get(key);
  return symbols.filter((s) => has(store, s, date));
}

async function main() {
  const monthCache = new Map();
  const report = { mode: SWEEP ? 'sweep' : 'latest', lookback: LOOKBACK, markets: {}, unresolved: [], healed: [], discoveredClosures: [] };
  let networkCalls = 0;

  for (const [market, g] of Object.entries(GROUPS)) {
    if (!g.symbols.length) continue;
    const sessions = recentTradingSessions(g.calendar, LOOKBACK, { holidays });
    const marketReport = { label: g.label, sessions: {} };

    for (const session of sessions) {
      let present = presentForSession(monthCache, g.store, session, g.symbols);
      let missing = g.symbols.filter((s) => !present.includes(s));
      marketReport.sessions[session] = { expected: g.symbols.length, present: present.length, missing: [...missing] };
      if (!missing.length) continue;

      // ---- Heal: re-fetch only the missing symbols for this session's month ----
      const monthKey = `${g.store}/${isoYear(session)}/${isoMonth(session)}`;
      const fetchOutcome = new Map(); // symbol -> 'filled' | 'source-empty' | 'fetch-error' | 'no-repair-path'
      if (g.fetchMonth) {
        for (const symbol of missing) {
          try {
            const rows = await g.fetchMonth(symbol, isoYear(session), isoMonth(session));
            networkCalls += 1;
            const rec = rows.find((r) => r.date === session && r.c !== undefined);
            if (rec) {
              upsertRecords(g.store, [rec], { pretty: false });
              // Recompute the 52-week high/low from stored history, same as the pipeline does.
              const { yh, yl } = computeYearHighLow(g.store, symbol, session, new Map());
              if (yh !== undefined || yl !== undefined) upsertRecords(g.store, [{ symbol, date: session, yh, yl }], { pretty: false });
              fetchOutcome.set(symbol, 'filled');
            } else {
              fetchOutcome.set(symbol, 'source-empty'); // source responded, but this symbol had no trade that day
            }
          } catch (err) {
            fetchOutcome.set(symbol, 'fetch-error');
            console.error(`[watchdog] ${market} ${symbol} ${session} repair FAILED: ${err.message}`);
          }
          await sleep(300);
        }
      } else {
        missing.forEach((s) => fetchOutcome.set(s, 'no-repair-path'));
      }

      // Re-read after healing.
      monthCache.delete(monthKey);
      present = presentForSession(monthCache, g.store, session, g.symbols);
      missing = g.symbols.filter((s) => !present.includes(s));
      marketReport.sessions[session].present = present.length;
      marketReport.sessions[session].missing = [...missing];
      const healedNow = [...fetchOutcome].filter(([, o]) => o === 'filled').map(([s]) => s);
      if (healedNow.length) report.healed.push({ market, session, symbols: healedNow });

      // ---- Reach a verdict for whatever is still missing ----
      const verdicts = {};
      const anySourceEmpty = missing.some((s) => fetchOutcome.get(s) === 'source-empty');
      const anyFetchError = missing.some((s) => fetchOutcome.get(s) === 'fetch-error');

      if (present.length === 0 && anySourceEmpty && !anyFetchError && g.fetchMonth) {
        // Whole market absent AND the source confirms no session for the ones we
        // checked, with no network errors → a genuine market closure the planned
        // calendar didn't list (typhoon day etc.). Record it and stop retrying.
        recordDiscoveredClosure(g.calendar, session);
        report.discoveredClosures.push({ market: g.calendar, session });
        missing.forEach((s) => (verdicts[s] = 'market_closed'));
      } else {
        for (const s of missing) {
          const o = fetchOutcome.get(s);
          if (o === 'source-empty') verdicts[s] = 'no_trade'; // source confirms this symbol did not trade
          else if (o === 'no-repair-path') verdicts[s] = 'no_history'; // TPEx historical caveat, documented
          else verdicts[s] = 'unresolved'; // fetch-error or still missing for an unknown reason
        }
      }

      const unresolvedSyms = Object.entries(verdicts).filter(([, v]) => v === 'unresolved').map(([s]) => s);
      if (unresolvedSyms.length) report.unresolved.push({ market, label: g.label, session, symbols: unresolvedSyms });

      marketReport.sessions[session].verdicts = verdicts;

      // Persist a DETERMINISTIC coverage record for the latest session (verdicts
      // folded in). No per-run timestamp is added, so an unchanged state produces
      // byte-identical output → no git diff → no commit churn on healthy polls.
      if (session === sessions[sessions.length - 1]) {
        const resolved = Object.fromEntries(Object.entries(verdicts).filter(([, v]) => v !== 'unresolved'));
        const record = buildCoverage({ market, sessionDate: session, expected: g.symbols, present, verdicts: resolved });
        record.health = unresolvedSyms.length ? 'gap' : missing.length ? 'resolved-empty' : 'healthy';
        persistCoverage(market, record);
      }
    }
    report.markets[market] = marketReport;
  }

  // Ensure every already-complete market carries a 'healthy' verdict (set once, then stable — no churn).
  for (const [market, g] of Object.entries(GROUPS)) {
    if (!g.symbols.length) continue;
    const cov = readJson('status.json', {}).coverage?.[market];
    if (cov && cov.complete && !cov.health) {
      cov.health = 'healthy';
      writeCoverage(market, cov);
    }
  }

  if (networkCalls > 0 || report.healed.length || report.discoveredClosures.length) regenerateManifest();
  // Report goes to the repo root (NOT public/data), so it is never committed/deployed — it is a run artifact.
  fs.writeFileSync(
    path.join(process.cwd(), 'watchdog-report.json'),
    `${JSON.stringify({ ...report, generatedAt: new Date().toISOString(), networkCalls }, null, 2)}\n`
  );

  const totalUnresolved = report.unresolved.reduce((n, r) => n + r.symbols.length, 0);
  console.log(
    `[watchdog] mode=${report.mode} networkCalls=${networkCalls} healed=${report.healed.length} ` +
      `discoveredClosures=${report.discoveredClosures.length} unresolved=${totalUnresolved}`
  );
  for (const u of report.unresolved) console.log(`[watchdog]   UNRESOLVED ${u.label} ${u.session}: ${u.symbols.join(', ')}`);

  if (totalUnresolved > 0) process.exitCode = 1;
}

/**
 * Merges the watchdog's verdict fields onto the existing coverage record,
 * preserving the fetch pipeline's lastSuccessfulWrite so a healthy poll doesn't
 * churn the timestamp (and therefore doesn't produce a needless commit).
 */
function persistCoverage(market, record) {
  const existing = readJson('status.json', {}).coverage?.[market] || {};
  writeCoverage(market, { ...existing, ...record, lastSuccessfulWrite: existing.lastSuccessfulWrite || record.lastSuccessfulWrite });
}

/** Appends a confirmed ad-hoc closure to the holiday calendar's twDiscovered (idempotent). */
function recordDiscoveredClosure(calendar, session) {
  if (calendar !== 'tw') return; // us surprise closures are rare; handled as unresolved for a human to confirm
  const j = fs.existsSync(HOLIDAYS_PATH) ? JSON.parse(fs.readFileSync(HOLIDAYS_PATH, 'utf8')) : { tw: [], us: [], twPlanned: [], twDiscovered: [] };
  j.twDiscovered = [...new Set([...(j.twDiscovered || []), session])].sort();
  j.tw = [...new Set([...(j.twPlanned || j.tw || []), ...j.twDiscovered])].sort();
  fs.writeFileSync(HOLIDAYS_PATH, `${JSON.stringify(j, null, 2)}\n`);
  console.log(`[watchdog]   discovered market closure ${session} → added to twDiscovered`);
}

main().catch((err) => {
  console.error('[watchdog] FAILED:', err);
  process.exitCode = 1;
});
