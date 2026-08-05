// Scan a window of recent trading sessions, repair what is missing, reach a
// verdict on the rest. Extracted from scripts/watchdog.js so the fetch scripts
// can take the same posture instead of trusting the clock.
//
// Why the fetch scripts need this at all: the pipeline used to compute "today's
// session" and fetch exactly that. That is only correct if the run fires when it
// was scheduled to. GitHub delivers this repo's crons hours late as a matter of
// routine — on 2026-08-03 the 07:10 UTC TW cron arrived at 16:09 UTC, i.e. past
// Taipei midnight, by which point TWSE's bulk snapshot had rolled over and the
// session was simply lost. A run that instead asks "which of the last N sessions
// is missing or incomplete?" produces the right result whenever it happens to
// run, which is the only property that survives a scheduler we do not control.
//
// Cost on a healthy day is zero network calls: the scan reads month files off
// disk, finds nothing missing, and returns. Traffic happens only where there is
// an actual gap — the same politeness the watchdog already had.

import { upsertRecords, readMonthFile } from './jsonStore.js';
import { computeYearHighLow } from './yearHighLow.js';
import { isoYear, isoMonth, sleep } from './dates.js';
import { loadHolidays, recentTradingSessions } from './coverage.js';

const REPAIR_DELAY_MS = 300;

function has(store, symbol, date) {
  return store[symbol] && store[symbol][date] && store[symbol][date].c !== undefined;
}

/** Which of `symbols` have a usable close for `date`, reading each month file once. */
export function presentForSession(monthCache, storeName, date, symbols) {
  const key = `${storeName}/${isoYear(date)}/${isoMonth(date)}`;
  if (!monthCache.has(key)) monthCache.set(key, readMonthFile(storeName, isoYear(date), isoMonth(date)));
  return symbols.filter((s) => has(monthCache.get(key), s, date));
}

/**
 * The sessions worth judging for a group: the last `lookback` trading days that
 * should already be PUBLISHED, newest last.
 *
 * That "already published" property comes entirely from expectedSessionDate's
 * per-market publish cutoff (coverage.js) — before 15:00 Taipei / 17:00 New York
 * today is simply not a candidate, so a run can never declare a session it was
 * too early to see a gap, nor a market closure.
 *
 * This deliberately does NOT also exclude "today". An earlier version carried
 * over the watchdog's `session < marketToday` guard, which predates the publish
 * cutoff and duplicates it badly: with the cutoff in place, that guard threw
 * away the very session an on-time run had just fetched, so a 15:10 Taipei run
 * swept only the three days BEFORE the one it was there to fetch. The cutoff is
 * now the single source of truth for "has this session happened yet".
 */
export function judgeableSessions(group, { lookback, holidays = loadHolidays(), now }) {
  return recentTradingSessions(group.calendar, lookback, { holidays, now });
}

/**
 * Repairs one session for one group. Returns { present, missing, outcomes },
 * where outcomes maps symbol -> 'filled' | 'source-empty' | 'fetch-error' |
 * 'no-repair-path'. Only the missing symbols are ever re-requested — a gap never
 * triggers a whole-market re-pull, which would re-trigger throttling.
 *
 * `skip` is the set of symbols already carrying a resolved verdict
 * (no_trade/suspended/market_closed/no_history). Re-requesting those forever is
 * how a monitor turns a legitimate empty cell into permanent traffic, so they
 * are counted as settled and left alone.
 */
export async function healSession(group, session, { monthCache, skip = new Set(), onNetworkCall } = {}) {
  const cache = monthCache || new Map();
  let present = presentForSession(cache, group.store, session, group.symbols);
  let missing = group.symbols.filter((s) => !present.includes(s) && !skip.has(s));
  const outcomes = new Map();

  if (!missing.length) return { present, missing: [], outcomes, repaired: [] };

  if (!group.fetchRows) {
    missing.forEach((s) => outcomes.set(s, 'no-repair-path'));
  } else {
    for (const symbol of missing) {
      try {
        const rows = await group.fetchRows(symbol, session);
        if (onNetworkCall) onNetworkCall();
        const rec = rows.find((r) => r.date === session && r.c !== undefined);
        if (rec) {
          upsertRecords(group.store, [rec], { pretty: false });
          // Recompute the 52-week high/low from stored history, as the pipeline does.
          const { yh, yl } = computeYearHighLow(group.store, symbol, session, new Map());
          if (yh !== undefined || yl !== undefined) {
            upsertRecords(group.store, [{ symbol, date: session, yh, yl }], { pretty: false });
          }
          outcomes.set(symbol, 'filled');
        } else {
          outcomes.set(symbol, 'source-empty'); // source answered; this symbol had no trade that day
        }
      } catch (err) {
        outcomes.set(symbol, 'fetch-error');
        console.error(`[sweep] ${group.label} ${symbol} ${session} repair FAILED: ${err.message}`);
      }
      await sleep(REPAIR_DELAY_MS);
    }
  }

  // Re-read after healing so callers see the post-repair truth.
  cache.delete(`${group.store}/${isoYear(session)}/${isoMonth(session)}`);
  present = presentForSession(cache, group.store, session, group.symbols);
  missing = group.symbols.filter((s) => !present.includes(s) && !skip.has(s));
  const repaired = [...outcomes].filter(([, o]) => o === 'filled').map(([s]) => s);
  return { present, missing, outcomes, repaired };
}

/**
 * Turns per-symbol fetch outcomes into verdicts. A confirmed no-trade is a
 * verdict, not a failure — only 'unresolved' is worth waking a human for.
 *
 * Returns { verdicts, suspectedClosure }.
 *
 * NOTE what this deliberately no longer does. It used to conclude, on its own,
 * that a whole-market absence plus source-empty responses meant the market had
 * been closed, and write that straight into the holiday calendar. That is how
 * two ordinary trading days became permanent holidays: a per-symbol endpoint
 * has no rows for a day that has not happened yet, which is indistinguishable
 * here from a day that did not trade.
 *
 * So this function may only ever raise a SUSPICION. Until that suspicion is
 * confirmed against positive evidence (lib/closureEvidence.js), every missing
 * symbol stays 'unresolved' — i.e. loud, escalating, and visible as a delay
 * rather than as 休. Failing to confirm leaves the gap noisy, which is the
 * correct direction to fail in.
 */
export function judgeSession(group, { present, missing, outcomes }) {
  const anySourceEmpty = missing.some((s) => outcomes.get(s) === 'source-empty');
  const anyFetchError = missing.some((s) => outcomes.get(s) === 'fetch-error');
  const verdicts = {};

  for (const s of missing) {
    const o = outcomes.get(s);
    if (o === 'source-empty') verdicts[s] = 'no_trade';
    else if (o === 'no-repair-path') verdicts[s] = 'no_history';
    else verdicts[s] = 'unresolved';
  }

  // Whole group absent, sources answered, nothing errored: this MIGHT be a
  // closure. The caller must prove it before anyone is allowed to say so.
  const suspectedClosure = present.length === 0 && anySourceEmpty && !anyFetchError && !!group.fetchRows;
  if (suspectedClosure) missing.forEach((s) => (verdicts[s] = 'unresolved'));
  return { verdicts, suspectedClosure };
}

/** The symbols a stored coverage record already settled, so a sweep won't re-request them forever. */
export function resolvedSymbols(coverageRecord) {
  const resolved = coverageRecord?.resolved || {};
  return new Set(Object.keys(resolved).filter((s) => resolved[s] && resolved[s] !== 'unresolved'));
}
