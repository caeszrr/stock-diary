// Completeness (not presence) helpers for the fetch pipeline and the watchdog.
//
// Core idea: "a file exists for this session" must never count as success. A
// session is complete only when every expected symbol has a record for the
// expected trading day. The expectation is derived at runtime (config watchlist
// ∪ symbols present in the previous session), never hardcoded, so it stays
// correct as stocks are added or delisted.

import fs from 'node:fs';
import path from 'node:path';
import { readMonthFile, readJson, writeJson } from './jsonStore.js';
import { isoYear, isoMonth, todayTaipei } from './dates.js';

const HOLIDAYS_PATH = path.join(process.cwd(), 'config', 'market-holidays.json');

/**
 * Loads the market holiday calendar ({ tw: [...isoDates], us: [...isoDates] }).
 * Missing/unparseable file falls back to weekday-only logic (no holidays) — the
 * watchdog refreshes this file on a yearly schedule (Phase D). Never throws.
 */
export function loadHolidays() {
  try {
    const json = JSON.parse(fs.readFileSync(HOLIDAYS_PATH, 'utf8'));
    return { tw: json.tw || [], us: json.us || [] };
  } catch {
    return { tw: [], us: [] };
  }
}

function holidayKey(market) {
  return market === 'us' ? 'us' : 'tw'; // tw + tpex share the TWSE/Taiwan calendar
}

function isWeekend(iso) {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

function previousDate(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** True if `iso` is a trading day for `market` (weekday and not a listed holiday). */
export function isTradingDay(market, iso, holidays = loadHolidays()) {
  if (isWeekend(iso)) return false;
  return !holidays[holidayKey(market)].includes(iso);
}

/** The trading day strictly before `iso` for `market`. */
export function previousTradingDate(iso, market, holidays = loadHolidays()) {
  let d = previousDate(iso);
  for (let i = 0; i < 400; i += 1) {
    if (isTradingDay(market, d, holidays)) return d;
    d = previousDate(d);
  }
  return d;
}

/** The last `n` trading sessions on/before the reference day, oldest-first. */
export function recentTradingSessions(market, n, { today, holidays = loadHolidays() } = {}) {
  const sessions = [];
  let d = expectedSessionDate(market, { today, holidays });
  for (let i = 0; i < n; i += 1) {
    sessions.push(d);
    d = previousTradingDate(d, market, holidays);
  }
  return sessions.reverse();
}

/** Walks back from `iso` (inclusive) to the most recent trading day for `market`. */
export function latestTradingDayOnOrBefore(market, iso, holidays = loadHolidays()) {
  let d = iso;
  for (let i = 0; i < 400; i += 1) {
    if (isTradingDay(market, d, holidays)) return d;
    d = previousDate(d);
  }
  return iso;
}

/**
 * The trading day this pipeline run should have produced. For tw/tpex the run
 * fires after the Taipei close, so the reference "today" is the Taipei date; for
 * us the run fires after the US close (evening UTC), so the UTC date is the US
 * session date. Callers may override `today` (used by tests and the watchdog).
 */
export function expectedSessionDate(market, { today, holidays = loadHolidays() } = {}) {
  const ref = today || (market === 'us' ? new Date().toISOString().slice(0, 10) : todayTaipei());
  return latestTradingDayOnOrBefore(market, ref, holidays);
}

/** The subset of `symbols` that has a usable close (`c` defined) for `sessionDate` in the given market's month file. */
export function presentSymbols(market, sessionDate, symbols) {
  const store = readMonthFile(market, isoYear(sessionDate), isoMonth(sessionDate));
  return symbols.filter((s) => store[s] && store[s][sessionDate] && store[s][sessionDate].c !== undefined);
}

/**
 * Builds the machine-readable coverage record for one market/session. `expected`
 * is the runtime-derived expected symbol set; `present` is who actually has data.
 * `verdicts` maps a symbol to a resolved reason (e.g. 'no_trade', 'suspended') —
 * those symbols count as legitimately-empty, not as gaps.
 */
export function buildCoverage({ market, sessionDate, expected, present, stale = false, verdicts = {}, fullMarket }) {
  const presentSet = new Set(present);
  const unresolvedMissing = expected.filter((s) => !presentSet.has(s) && !verdicts[s]);
  return {
    sessionDate,
    expectedCount: expected.length,
    actualCount: present.length,
    missingCodes: unresolvedMissing,
    resolved: verdicts,
    stale,
    complete: unresolvedMissing.length === 0,
    ...(fullMarket ? { fullMarket } : {}),
    lastSuccessfulWrite: new Date().toISOString(),
  };
}

/** Merges a coverage record for one market into status.json's top-level `coverage` map (never clobbers other markets). */
export function writeCoverage(market, record) {
  const status = readJson('status.json', {});
  status.coverage = { ...(status.coverage || {}), [market]: record };
  return writeJson('status.json', status, { pretty: true });
}

/**
 * Expected symbol set for a market's watchlist coverage: the configured
 * (fetchable) watchlist ∪ any symbol that had data in the previous session.
 * Reads previous-session presence off disk so a symbol that silently drops out
 * still counts as expected (and therefore as a gap) until a verdict resolves it.
 */
export function expectedWatchlistSymbols(market, configuredSymbols, sessionDate, holidays = loadHolidays()) {
  const set = new Set(configuredSymbols);
  const prev = latestTradingDayOnOrBefore(market, previousDate(sessionDate), holidays);
  const store = readMonthFile(market, isoYear(prev), isoMonth(prev));
  for (const [sym, days] of Object.entries(store)) {
    if (days[prev] && days[prev].c !== undefined && configuredSymbols.includes(sym)) set.add(sym);
  }
  return [...set];
}
