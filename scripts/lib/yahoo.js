import { fetchJson } from './http.js';

const HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];

// TW config uses index symbols DJI/IXIC/SPX/SOX; Yahoo's own notation differs.
export const INDEX_SYMBOL_MAP = {
  DJI: '^DJI',
  IXIC: '^IXIC',
  SPX: '^GSPC',
  SOX: '^SOX',
};

function toYahooSymbol(symbol) {
  return INDEX_SYMBOL_MAP[symbol] ?? symbol;
}

function tradingDateISO(timestampSec, timeZone) {
  const d = new Date(timestampSec * 1000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone || 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

async function fetchChart(symbol, params) {
  const qs = new URLSearchParams({ interval: '1d', ...params });
  let lastErr;
  for (const host of HOSTS) {
    try {
      const url = `${host}/v8/finance/chart/${encodeURIComponent(symbol)}?${qs}`;
      const json = await fetchJson(url, { retries: 1 });
      const result = json?.chart?.result?.[0];
      if (!result) throw new Error(json?.chart?.error?.description || 'empty chart result');
      return result;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`Yahoo fetch failed for ${symbol} on all hosts: ${lastErr.message}`);
}

/**
 * Fetches daily OHLCV for a symbol (stock or, via INDEX_SYMBOL_MAP, an index) over a
 * date range. `outSymbol` is the code we store under (e.g. "SPX" even though Yahoo's
 * notation is "^GSPC"). Pass either `range` (e.g. "5d") for the recent-days daily job,
 * or `period1`/`period2` (unix seconds) for exact-range backfill.
 * Returns { records: [{symbol,date,o,h,l,c,pc,v,yh,yl}], name }.
 */
export async function fetchDaily(outSymbol, { range, period1, period2 } = { range: '5d' }) {
  const yahooSymbol = toYahooSymbol(outSymbol);
  const params = period1 && period2 ? { period1, period2 } : { range: range || '5d' };
  const result = await fetchChart(yahooSymbol, params);
  const tz = result.meta.exchangeTimezoneName;
  const timestamps = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};
  const { open = [], high = [], low = [], close = [], volume = [] } = quote;

  const round2 = (n) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 100) / 100 : undefined);

  const records = [];
  let prevClose = result.meta.chartPreviousClose;
  for (let i = 0; i < timestamps.length; i += 1) {
    const c = close[i];
    if (c === null || c === undefined) {
      // No session that day (market holiday within the range window); skip, never fabricate.
      continue;
    }
    records.push({
      symbol: outSymbol,
      date: tradingDateISO(timestamps[i], tz),
      o: round2(open[i]),
      h: round2(high[i]),
      l: round2(low[i]),
      c: round2(c),
      pc: round2(prevClose),
      v: volume[i] ?? undefined,
    });
    prevClose = c;
  }
  // meta.fiftyTwoWeekHigh/Low reflect the *current* trailing 52 weeks as of the request,
  // not a historical-as-of-that-date value — only valid to attach to the most recent record.
  if (records.length > 0) {
    records[records.length - 1].yh = round2(result.meta.fiftyTwoWeekHigh);
    records[records.length - 1].yl = round2(result.meta.fiftyTwoWeekLow);
  }
  return { records, name: result.meta.longName || result.meta.shortName || outSymbol };
}
