// The only place in this repo where a market closure may be recorded, and the
// only place one may be revoked.
//
// WHY THIS MODULE EXISTS
//
// On 2026-08-03 and 2026-08-04 the watchdog invented two market holidays. Its
// reasoning was locally sound: every 上市 symbol was missing for the session it
// was judging, and TWSE's per-symbol endpoint answered normally without a row
// for that date — so the exchange must have been closed. Both times the session
// it was judging had not happened yet (the run fired just past Taipei midnight),
// and both times the real trading day was then skipped by every later run,
// because a "holiday" is excluded from the expected calendar. The system
// explained away its own outage and certified itself healthy for two days.
//
// The rule that follows, and that this module enforces:
//
//   "Market closed" may never be the default explanation for missing data.
//   Absence of data because OUR fetch failed is an outage and must be loud.
//   A closure requires positive evidence, and stays falsifiable.
//
// WHAT COUNTS AS POSITIVE EVIDENCE
//
//   1. The exchange's own published calendar lists the date (twPlanned), or
//   2. BOTH TWSE and TPEx answer a BY-DATE query for that date healthily
//      (HTTP 200, parseable, definite) and report no session,
//   AND in either case
//   3. the date's session has already closed and had time to publish, on the
//      market's own wall clock.
//
// Rule 3 is not redundant. Asked about a genuine holiday (2026-07-10) both
// exchanges answer "no data". Asked about a day that has not happened yet
// (2026-08-06, before the close) both exchanges answer "no data" — the exact
// same shape. Emptiness alone therefore proves nothing; only the clock
// separates "did not trade" from "has not traded yet".
//
// Anything else — a timeout, a non-200, a 307 throttle, an unparseable body, a
// stale undated snapshot — is an outage. It says nothing whatsoever about the
// date, and must never be resolved into a closure.

import fs from 'node:fs';
import path from 'node:path';
import { fetchAllListedForDate } from './twse.js';
import { fetchAllOtcForDate } from './tpex.js';
import { readMonthFile } from './jsonStore.js';
import { isoYear, isoMonth } from './dates.js';
import { publishCutoffPassed } from './coverage.js';

const HOLIDAYS_PATH = path.join(process.cwd(), 'config', 'market-holidays.json');

/** Stores that follow the Taiwan calendar — consulted for contradiction checks. */
const TW_STORES = ['tw', 'tw-all', 'idx'];
const TW_STORE_SYMBOL_FILTER = { idx: (s) => s === 'TAIEX' };

export function loadClosureFile() {
  try {
    return JSON.parse(fs.readFileSync(HOLIDAYS_PATH, 'utf8'));
  } catch {
    return { tw: [], us: [], twPlanned: [], twDiscovered: [] };
  }
}

export function saveClosureFile(json) {
  fs.writeFileSync(HOLIDAYS_PATH, `${JSON.stringify(json, null, 2)}\n`);
}

/** Normalises a twDiscovered entry to { date, evidence }. Legacy bare strings have no evidence. */
function asEntry(item) {
  if (typeof item === 'string') return { date: item, evidence: null };
  return { date: item.date, evidence: item.evidence || null, confirmedAt: item.confirmedAt };
}

/**
 * True only for evidence that positively establishes a closure. A legacy entry
 * (a bare date, recorded before evidence was required) does NOT qualify — it
 * must re-prove itself before it is allowed to render 休 again.
 */
export function isConfirmed(entry) {
  const e = entry.evidence;
  return !!e && e.wallClock === 'passed' && e.twse === 'healthy-empty' && e.tpex === 'healthy-empty';
}

/** Every TW date currently backed by positive evidence: the official calendar plus confirmed discoveries. */
export function confirmedTwClosures(json = loadClosureFile()) {
  const planned = json.twPlanned || [];
  const discovered = (json.twDiscovered || []).map(asEntry).filter(isConfirmed).map((e) => e.date);
  return [...new Set([...planned, ...discovered])].sort();
}

/** Rewrites the merged `tw` array so it contains confirmed closures ONLY — it is what renders 休. */
export function rebuildTwCalendar(json) {
  json.tw = confirmedTwClosures(json);
  return json;
}

/**
 * Asks both Taiwan exchanges, by date, whether a session exists.
 * Returns { twse, tpex, traded, reachable } where each exchange is one of
 * 'has-session' | 'healthy-empty' | 'unreachable'.
 *
 *   traded === true   at least one exchange has rows -> definitely a trading day
 *   traded === false  both healthy and empty        -> no session at either
 *   traded === null   something was unreachable     -> we simply do not know
 */
export async function probeTwSession(dateIso) {
  const [twse, tpex] = await Promise.all([fetchAllListedForDate(dateIso), fetchAllOtcForDate(dateIso)]);
  const state = (r) => (!r.ok ? 'unreachable' : r.empty ? 'healthy-empty' : 'has-session');
  const s = { twse: state(twse), tpex: state(tpex) };
  const reachable = s.twse !== 'unreachable' && s.tpex !== 'unreachable';
  let traded = null;
  if (s.twse === 'has-session' || s.tpex === 'has-session') traded = true;
  else if (reachable) traded = false;
  return { ...s, traded, reachable, rows: { twse: twse.records.length, tpex: tpex.records.length } };
}

/**
 * Decides whether `dateIso` may be recorded as a TW market closure.
 * Never throws; a failed probe yields confirmed:false with an outage reason.
 */
export async function confirmTwClosure(dateIso, { now = new Date(), json = loadClosureFile() } = {}) {
  // Rule 3 first, and cheaply: if the session has not closed yet on Taipei's own
  // clock, no amount of source emptiness may be read as a closure. This check
  // consults nothing but the clock and the date — no coverage record can talk
  // past it, which is the whole point.
  if (!publishCutoffPassed('tw', dateIso, now)) {
    return { confirmed: false, reason: 'session-not-closed-yet', evidence: { wallClock: 'not-passed' } };
  }

  // The exchange's own published calendar is positive evidence by itself.
  if ((json.twPlanned || []).includes(dateIso)) {
    return {
      confirmed: true,
      reason: 'official-calendar',
      evidence: { wallClock: 'passed', source: 'twPlanned', twse: 'healthy-empty', tpex: 'healthy-empty' },
    };
  }

  const probe = await probeTwSession(dateIso);
  if (probe.traded === true) {
    return { confirmed: false, reason: 'session-exists', evidence: { wallClock: 'passed', ...probe } };
  }
  if (probe.traded === null) {
    return { confirmed: false, reason: 'source-unreachable', evidence: { wallClock: 'passed', ...probe } };
  }
  return {
    confirmed: true,
    reason: 'both-exchanges-healthy-and-empty',
    evidence: { wallClock: 'passed', twse: probe.twse, tpex: probe.tpex, confirmedAt: new Date().toISOString() },
  };
}

/** Records a confirmed closure with the evidence that justified it. Idempotent. */
export function recordConfirmedClosure(dateIso, evidence, { log = console.log } = {}) {
  const json = loadClosureFile();
  const entries = (json.twDiscovered || []).map(asEntry).filter((e) => e.date !== dateIso);
  entries.push({ date: dateIso, confirmedAt: evidence.confirmedAt || new Date().toISOString(), evidence });
  json.twDiscovered = entries.sort((a, b) => a.date.localeCompare(b.date));
  saveClosureFile(rebuildTwCalendar(json));
  log(`[closure] CONFIRMED ${dateIso} — twse:${evidence.twse} tpex:${evidence.tpex} (wall clock passed)`);
}

/** Removes a closure verdict and says why. */
export function revokeClosure(dateIso, reason, { log = console.log } = {}) {
  const json = loadClosureFile();
  const before = (json.twDiscovered || []).length;
  json.twDiscovered = (json.twDiscovered || []).map(asEntry).filter((e) => e.date !== dateIso);
  if (json.twDiscovered.length === before) return false;
  saveClosureFile(rebuildTwCalendar(json));
  log(`[closure] REVOKED ${dateIso} — ${reason}`);
  return true;
}

/** Dates marked closed for which some store nevertheless holds a real record. */
export function contradictedClosures(json = loadClosureFile()) {
  const out = [];
  for (const entry of (json.twDiscovered || []).map(asEntry)) {
    const holders = [];
    for (const store of TW_STORES) {
      const data = readMonthFile(store, isoYear(entry.date), isoMonth(entry.date));
      const filter = TW_STORE_SYMBOL_FILTER[store];
      const n = Object.entries(data).filter(
        ([sym, days]) => (!filter || filter(sym)) && days[entry.date] && days[entry.date].c !== undefined
      ).length;
      if (n > 0) holders.push(`${store}:${n}`);
    }
    if (holders.length) out.push({ date: entry.date, holders });
  }
  return out;
}

/**
 * The falsifiability pass. Run it on every successful fetch — it costs zero
 * network calls when every verdict is sound.
 *
 *   1. Contradiction auto-revoke (local, free): a date marked closed for which
 *      any store holds data revokes itself immediately. Data on disk outranks a
 *      verdict about that date, always.
 *   2. Re-proof (network, only when needed): any verdict not backed by full
 *      dual-exchange evidence — every legacy entry, and anything written before
 *      this rule existed — must re-prove itself now or be revoked.
 *
 * Verdicts already carrying healthy-empty evidence from both exchanges are not
 * re-probed: that evidence is not failure-shaped, and re-asking daily forever
 * would be exactly the impolite traffic this repo avoids.
 *
 * Returns { revoked: [...], reproved: [...], stillUnproven: [...] }.
 */
export async function reviewClosures({ now = new Date(), log = console.log } = {}) {
  const result = { revoked: [], reproved: [], stillUnproven: [] };

  for (const { date, holders } of contradictedClosures()) {
    revokeClosure(date, `contradicted — data present in ${holders.join(', ')}`, { log });
    result.revoked.push({ date, reason: 'contradicted', holders });
  }

  const pending = (loadClosureFile().twDiscovered || []).map(asEntry).filter((e) => !isConfirmed(e));
  for (const entry of pending) {
    const outcome = await confirmTwClosure(entry.date, { now });
    if (outcome.confirmed) {
      recordConfirmedClosure(entry.date, outcome.evidence, { log });
      result.reproved.push(entry.date);
    } else if (outcome.reason === 'session-exists') {
      revokeClosure(entry.date, 'a session exists at the exchange for this date', { log });
      result.revoked.push({ date: entry.date, reason: 'session-exists' });
    } else {
      // Could not prove it either way. It stays on file but, lacking evidence,
      // it is NOT in the `tw` calendar — so it renders as a delay, not as 休.
      result.stillUnproven.push({ date: entry.date, reason: outcome.reason });
      log(`[closure] UNPROVEN ${entry.date} — ${outcome.reason}; not treated as a closure`);
    }
  }

  // Keep the rendered calendar in step with whatever survived.
  saveClosureFile(rebuildTwCalendar(loadClosureFile()));
  return result;
}

/**
 * Sessions that should already be published but are neither complete nor
 * explained by a confirmed closure, newest first. Two or more in a row is the
 * escalation trigger: a real ad-hoc closure practically never surprises anyone
 * on two consecutive days without an announcement, so a run of them is an
 * outage wearing a calendar's clothes.
 */
export function unexplainedSessions(sessions, isComplete, { json = loadClosureFile() } = {}) {
  const confirmed = new Set(confirmedTwClosures(json));
  return [...sessions].reverse().filter((s) => !confirmed.has(s) && !isComplete(s));
}
