import holidays from '../../config/market-holidays.json';

// Bundled at build time (like the ticker config). The pipeline commits any
// discovered ad-hoc closure into this file, which triggers a rebuild+deploy, so
// the frontend calendar stays in step with the pipeline's.
//
// `tw` holds CONFIRMED closures only — dates from TWSE's published schedule, or
// ones proven closed by both exchanges' by-date records (scripts/lib/
// closureEvidence.js). A suspected-but-unproven gap is deliberately absent from
// this list, so it can never render as 休. That distinction is the whole point:
// on 2026-08-04 and 2026-08-05 this file said "holiday" about two ordinary
// trading days, and every cell in the app repeated it.
const H = { tw: holidays.tw || [], us: holidays.us || [] };

// When each market's session is closed AND published, on its own clock. Mirrors
// PUBLISH_CUTOFF in scripts/lib/coverage.js — keep the two in step.
const PUBLISH_CUTOFF = {
  tw: { tz: 'Asia/Taipei', hour: 15 },
  us: { tz: 'America/New_York', hour: 17 },
};

function isWeekend(iso) {
  const d = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return d === 0 || d === 6;
}

/** calMarket is 'tw' (TWSE/TPEx share the Taiwan calendar) or 'us'. */
export function isTradingDay(calMarket, iso) {
  if (isWeekend(iso)) return false;
  return !(H[calMarket] || []).includes(iso);
}

function previousDate(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

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

/** Walks back from `iso` (inclusive) to the most recent trading day. */
export function latestTradingDayOnOrBefore(calMarket, iso) {
  let d = iso;
  for (let i = 0; i < 400; i += 1) {
    if (isTradingDay(calMarket, d)) return d;
    d = previousDate(d);
  }
  return iso;
}

/**
 * The most recent session the calendar says should exist by now — the yardstick
 * the freshness banner is measured against.
 *
 * Confirmed closures are skipped (they are not expected to produce data);
 * unconfirmed gaps are NOT, so a day we merely failed to fetch still counts as
 * a session we owe the user, and the banner has to admit it.
 */
export function expectedSessionDate(calMarket, now = new Date()) {
  const cutoff = PUBLISH_CUTOFF[calMarket] || PUBLISH_CUTOFF.tw;
  const here = nowInZone(cutoff.tz, now);
  const ref = here.hour >= cutoff.hour ? here.date : previousDate(here.date);
  return latestTradingDayOnOrBefore(calMarket, ref);
}

/** The next trading day strictly after `iso`. */
export function nextTradingDay(calMarket, iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  for (let i = 0; i < 400; i += 1) {
    d.setUTCDate(d.getUTCDate() + 1);
    const next = d.toISOString().slice(0, 10);
    if (isTradingDay(calMarket, next)) return next;
  }
  return iso;
}

/** Every trading day of `year`-`month` (1-12), oldest first — the spine of the month grid. */
export function tradingDaysInMonth(calMarket, year, month) {
  const days = [];
  const mm = String(month).padStart(2, '0');
  const last = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  for (let d = 1; d <= last; d += 1) {
    const iso = `${year}-${mm}-${String(d).padStart(2, '0')}`;
    if (isTradingDay(calMarket, iso)) days.push(iso);
  }
  return days;
}

/** Maps a ticker's market to the coverage-record key and the calendar it follows. */
export function marketKeysFor(ticker) {
  const m = ticker.market;
  if (m === 'twse') return { cov: 'tw', cal: 'tw' };
  if (m === 'tpex') return { cov: 'tpex', cal: 'tw' };
  if (m === 'us') return { cov: 'us', cal: 'us' };
  if (m === 'index') return ticker.symbol === 'TAIEX' ? { cov: 'tw', cal: 'tw' } : { cov: 'us', cal: 'us' };
  return { cov: null, cal: 'us' };
}
