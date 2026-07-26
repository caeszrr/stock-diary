import holidays from '../../config/market-holidays.json';

// Bundled at build time (like the ticker config). The watchdog commits any
// discovered ad-hoc closure (e.g. a typhoon day) into this file, which triggers
// a rebuild+deploy, so the frontend calendar stays in step with the pipeline's.
const H = { tw: holidays.tw || [], us: holidays.us || [] };

function isWeekend(iso) {
  const d = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return d === 0 || d === 6;
}

/** calMarket is 'tw' (TWSE/TPEx share the Taiwan calendar) or 'us'. */
export function isTradingDay(calMarket, iso) {
  if (isWeekend(iso)) return false;
  return !(H[calMarket] || []).includes(iso);
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
