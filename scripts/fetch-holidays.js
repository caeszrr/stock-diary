// Refreshes config/market-holidays.json — the calendar the pipeline + watchdog
// use to tell "expected silence" (weekends/holidays) from a real data gap.
//
// TW: fetched from TWSE's official holiday-schedule OpenAPI (authoritative, so
// we never guess Lunar New Year / make-up dates). On any fetch failure the
// existing tw list is kept and callers fall back to weekday-only logic.
// US: the NYSE holiday schedule is rule-based, so it is computed deterministically
// per year (not fetched, not guessed).

import fs from 'node:fs';
import path from 'node:path';
import { rocToISO } from './lib/dates.js';
import { rebuildTwCalendar } from './lib/closureEvidence.js';

const OUT = path.join(process.cwd(), 'config', 'market-holidays.json');
const TWSE_HOLIDAY_URL = 'https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule';

async function fetchTwHolidays() {
  const res = await fetch(TWSE_HOLIDAY_URL, { headers: { 'User-Agent': 'Mozilla/5.0 (stock-diary)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const rows = await res.json();
  const closed = [];
  for (const row of rows) {
    const name = row.Name || '';
    // Skip the informational "first/last trading day" markers — those are open days.
    if (name.includes('開始交易') || name.includes('最後交易')) continue;
    closed.push(rocToISO(row.Date));
  }
  return [...new Set(closed)].sort();
}

// --- NYSE holiday rules (deterministic, no fetch) ---

function iso(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function dow(y, m, d) {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
}
function nthWeekday(y, m, weekday, n) {
  let count = 0;
  for (let d = 1; d <= 31; d += 1) {
    if (new Date(Date.UTC(y, m - 1, d)).getUTCMonth() !== m - 1) break;
    if (dow(y, m, d) === weekday && ++count === n) return iso(y, m, d);
  }
  return null;
}
function lastWeekday(y, m, weekday) {
  for (let d = 31; d >= 1; d -= 1) {
    if (new Date(Date.UTC(y, m - 1, d)).getUTCMonth() !== m - 1) continue;
    if (dow(y, m, d) === weekday) return iso(y, m, d);
  }
  return null;
}
/** Fixed-date holiday with NYSE weekend-observance: Sat -> Fri before, Sun -> Mon after. */
function observed(y, m, d) {
  const wd = dow(y, m, d);
  const base = new Date(Date.UTC(y, m - 1, d));
  if (wd === 6) base.setUTCDate(base.getUTCDate() - 1);
  else if (wd === 0) base.setUTCDate(base.getUTCDate() + 1);
  return base.toISOString().slice(0, 10);
}
/** Anonymous Gregorian computus -> Easter Sunday; Good Friday is two days earlier. */
function goodFriday(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const mth = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * mth + 114) / 31);
  const day = ((h + l - 7 * mth + 114) % 31) + 1;
  const easter = new Date(Date.UTC(y, month - 1, day));
  easter.setUTCDate(easter.getUTCDate() - 2);
  return easter.toISOString().slice(0, 10);
}
function usNyseHolidays(y) {
  return [
    observed(y, 1, 1), // New Year's Day
    nthWeekday(y, 1, 1, 3), // MLK — 3rd Mon Jan
    nthWeekday(y, 2, 1, 3), // Presidents — 3rd Mon Feb
    goodFriday(y),
    lastWeekday(y, 5, 1), // Memorial — last Mon May
    observed(y, 6, 19), // Juneteenth
    observed(y, 7, 4), // Independence Day
    nthWeekday(y, 9, 1, 1), // Labor — 1st Mon Sep
    nthWeekday(y, 11, 4, 4), // Thanksgiving — 4th Thu Nov
    observed(y, 12, 25), // Christmas
  ].sort();
}

async function main() {
  const existing = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
  const years = [...new Set([new Date().getUTCFullYear(), new Date().getUTCFullYear() + 1])];

  // Ad-hoc closures (typhoon days etc.) are NOT in TWSE's planned-holiday feed.
  // The watchdog appends them to twDiscovered when a full-session re-fetch
  // confirms the exchange had no trading; they must survive every refresh.
  const twDiscovered = existing.twDiscovered || [];

  let twPlanned = existing.twPlanned || [];
  let twSource = 'kept-existing (TWSE fetch failed)';
  try {
    twPlanned = await fetchTwHolidays();
    twSource = 'twse-openapi';
  } catch (err) {
    console.error(`[holidays] TWSE fetch FAILED, keeping existing planned list: ${err.message}`);
  }

  const us = [...new Set(years.flatMap(usNyseHolidays))].sort();

  // `tw` is the rendered calendar — the list that decides whether a blank cell
  // says 休. Only CONFIRMED closures may enter it (lib/closureEvidence.js):
  // planned dates from TWSE's own schedule, plus discovered ones that carry
  // dual-exchange evidence. A discovered entry still awaiting proof stays on
  // file but out of this list, so an unproven gap renders as a delay.
  const out = {
    _meta: { updated: new Date().toISOString(), twSource, usSource: `nyse-rules ${years.join(',')}` },
    tw: [],
    us,
    twPlanned,
    twDiscovered,
  };
  rebuildTwCalendar(out);
  fs.writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
  const confirmedDiscovered = out.tw.filter((d) => !twPlanned.includes(d)).length;
  console.log(
    `[holidays] wrote ${out.tw.length} TW (${twPlanned.length} planned + ${confirmedDiscovered} confirmed discovered ` +
      `of ${twDiscovered.length} on file) + ${us.length} US holiday dates (tw: ${twSource})`
  );
}

main().catch((err) => {
  console.error('[holidays] FAILED:', err);
  process.exitCode = 1;
});
