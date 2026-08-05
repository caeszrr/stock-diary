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
import { isoYear, isoMonth } from './dates.js';

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
export function recentTradingSessions(market, n, { today, holidays = loadHolidays(), now } = {}) {
  const sessions = [];
  let d = expectedSessionDate(market, { today, holidays, now });
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
 * The wall-clock hour in a market's own timezone by which that day's session is
 * both closed and published by the source. Before the cutoff, "today" is not yet
 * an expected session.
 *
 * tw: 13:30 close, STOCK_DAY_ALL lands ~14:00-15:00 (the 15:10 Taipei cron).
 * us: 16:00 ET close, Yahoo settles shortly after (the 22:30 UTC cron).
 */
const PUBLISH_CUTOFF = {
  tw: { tz: 'Asia/Taipei', hour: 15 },
  us: { tz: 'America/New_York', hour: 17 },
};

/** The calendar date and 0-23 hour right now in `tz`. */
function nowInZone(tz, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const m = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return { date: `${m.year}-${m.month}-${m.day}`, hour: Number(m.hour) };
}

/**
 * The trading day this pipeline run should have produced — derived from the
 * market's own clock, never from UTC or from the runner's assumption about when
 * it fired.
 *
 * Anchoring on "today or earlier" silently assumed every run lands between the
 * close and local midnight. GitHub's scheduler regularly delivers this repo's
 * crons hours late (see README); on 2026-08-03 the 07:10 UTC TW cron landed at
 * 16:09 UTC = 00:09 Taipei the NEXT day, so the run demanded a 2026-08-04
 * session that had not traded and declared all 67 上市 symbols missing. Below
 * the publish cutoff we expect the previous trading day instead, so a late run
 * still judges the session it was meant to judge.
 *
 * Callers may override `today` (the watchdog and tests do) or `now` (tests).
 */
export function expectedSessionDate(market, { today, holidays = loadHolidays(), now } = {}) {
  if (today) return latestTradingDayOnOrBefore(market, today, holidays);
  const cutoff = PUBLISH_CUTOFF[holidayKey(market)];
  const here = nowInZone(cutoff.tz, now);
  const ref = here.hour >= cutoff.hour ? here.date : previousDate(here.date);
  return latestTradingDayOnOrBefore(market, ref, holidays);
}

/**
 * Has `dateIso`'s session finished and had time to publish, judged on the
 * MARKET'S OWN clock right now?
 *
 * This is the hard floor under every verdict about a date. On 2026-08-03 and
 * 2026-08-04 the watchdog declared the NEXT day a market closure at 00:44 and
 * 00:26 Taipei — hours before those markets opened — because a per-symbol
 * history endpoint understandably had no rows for a day that had not happened.
 * "No data yet" and "no trading that day" look identical from the source; only
 * the clock can separate them, so the clock gets the final say.
 *
 * Deliberately independent of expectedSessionDate and of any stored coverage
 * record: those are derived state and were themselves poisoned by the false
 * verdicts. A closure check must not be able to talk itself past this.
 */
export function publishCutoffPassed(market, dateIso, now = new Date()) {
  const cutoff = PUBLISH_CUTOFF[holidayKey(market)];
  const here = nowInZone(cutoff.tz, now);
  if (here.date !== dateIso) return here.date > dateIso;
  return here.hour >= cutoff.hour;
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
