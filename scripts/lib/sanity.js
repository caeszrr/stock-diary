// Sanity checks beyond presence: data can exist and still be wrong. These are
// cheap, conservative heuristics (tuned to not fire on normal end-of-day data)
// that flag likely-bad records so the watchdog can re-fetch and the UI can warn.

import { readMonthFile } from './jsonStore.js';
import { isoYear, isoMonth } from './dates.js';

/** Prior sessions' values for one field of one symbol, most-recent first, up to `n`. */
function priorValues(store, symbol, sessionDate, field, n) {
  const days = store[symbol] ? Object.keys(store[symbol]).filter((d) => d < sessionDate).sort().reverse().slice(0, n) : [];
  return days.map((d) => store[symbol][d][field]).filter((v) => v !== undefined && v !== null);
}

function median(nums) {
  if (!nums.length) return undefined;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * A session volume far below the symbol's recent median AND far below the prior
 * session is the fingerprint of a mid-session capture (partial day) rather than
 * an official close. The prior-session condition avoids false-flagging a genuine
 * multi-day low-volume trend (where the previous day is already thin too).
 */
export function lowVolumeSymbols(store, symbols, sessionDate) {
  const flagged = [];
  for (const s of symbols) {
    const v = store[s]?.[sessionDate]?.v;
    if (v === undefined || v === null) continue;
    const prior = priorValues(store, s, sessionDate, 'v', 10);
    if (prior.length < 5) continue;
    const med = median(prior);
    const prev = prior[0];
    if (med && v < med * 0.12 && prev && v < prev * 0.25) flagged.push(s);
  }
  return flagged;
}

/**
 * Many symbols whose OHLC exactly equals the previous session's is the
 * fingerprint of a repeated/stale snapshot written twice. One symbol matching is
 * coincidence; a large fraction at once is not.
 */
export function repeatedSnapshotSymbols(store, symbols, sessionDate, prevDate) {
  if (!prevDate) return [];
  const same = [];
  for (const s of symbols) {
    const a = store[s]?.[sessionDate];
    const b = store[s]?.[prevDate];
    if (!a || !b) continue;
    if (['o', 'h', 'l', 'c'].every((k) => a[k] !== undefined && a[k] === b[k])) same.push(s);
  }
  // Only meaningful as a mass event.
  return same.length >= Math.max(5, Math.ceil(symbols.length * 0.4)) ? same : [];
}

/** Reads a session's store for a market and runs both per-session checks. */
export function scanSanity(marketStore, symbols, sessionDate, prevDate) {
  const store = readMonthFile(marketStore, isoYear(sessionDate), isoMonth(sessionDate));
  const prevStore = prevDate && isoMonth(prevDate) !== isoMonth(sessionDate)
    ? { ...readMonthFile(marketStore, isoYear(prevDate), isoMonth(prevDate)), ...store }
    : store;
  // repeatedSnapshot needs both dates visible in one object:
  const merged = prevDate ? mergeStores(prevStore, store) : store;
  return {
    lowVolume: lowVolumeSymbols(store, symbols, sessionDate),
    repeatedSnapshot: repeatedSnapshotSymbols(merged, symbols, sessionDate, prevDate),
  };
}

function mergeStores(a, b) {
  const out = { ...a };
  for (const [sym, days] of Object.entries(b)) out[sym] = { ...out[sym], ...days };
  return out;
}

/**
 * Cross-market drift: TW and US latest sessions should never diverge by more
 * than a couple of calendar days (each market's own holidays aside). A larger
 * gap means one side is stuck.
 */
export function crossMarketDrift(twSession, usSession, maxDays = 4) {
  if (!twSession || !usSession) return null;
  const diff = Math.abs((new Date(twSession) - new Date(usSession)) / 86400000);
  return diff > maxDays ? { twSession, usSession, days: diff } : null;
}
