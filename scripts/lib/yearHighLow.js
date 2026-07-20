import { readMonthFile } from './jsonStore.js';

const WINDOW_DAYS = 365;

function isoAddDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function monthsBack(iso, count) {
  const [y, m] = iso.split('-').map(Number);
  const out = [];
  let year = y;
  let month = m;
  for (let i = 0; i < count; i += 1) {
    out.push({ year: String(year), month: String(month).padStart(2, '0') });
    month -= 1;
    if (month < 1) {
      month = 12;
      year -= 1;
    }
  }
  return out;
}

/**
 * Computes the trailing 365-day high/low for one symbol as of `uptoIso`, by
 * scanning already-written month files (never fabricates — only reflects
 * data actually on disk, so a freshly backfilled symbol's early dates will
 * have a narrower window until more history accumulates).
 * `cache` is an optional Map for reuse across many calls within one run.
 */
export function computeYearHighLow(market, symbol, uptoIso, cache = new Map()) {
  const windowStart = isoAddDays(uptoIso, -WINDOW_DAYS);
  let yh;
  let yl;
  for (const { year, month } of monthsBack(uptoIso, 13)) {
    const key = `${market}/${year}/${month}`;
    if (!cache.has(key)) cache.set(key, readMonthFile(market, year, month));
    const monthData = cache.get(key)[symbol];
    if (!monthData) continue;
    for (const [date, rec] of Object.entries(monthData)) {
      if (date < windowStart || date > uptoIso) continue;
      if (typeof rec.h === 'number' && (yh === undefined || rec.h > yh)) yh = rec.h;
      if (typeof rec.l === 'number' && (yl === undefined || rec.l < yl)) yl = rec.l;
    }
  }
  return { yh, yl };
}
