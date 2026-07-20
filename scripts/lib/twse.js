import { fetchJson, parseNum } from './http.js';
import { rocToISO, isoToCompactAD } from './dates.js';

const STOCK_DAY_ALL = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL';
const FMTQIK = 'https://openapi.twse.com.tw/v1/exchangeReport/FMTQIK';
const STOCK_DAY_HISTORY = 'https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY';
const MI_INDEX = 'https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX';

/**
 * Fetches today's full 上市 market snapshot (all listed stocks, one call).
 * Returns { records: [{symbol,date,o,h,l,c,pc,v,to}], names: {code: name} }.
 */
export async function fetchAllListed() {
  const rows = await fetchJson(STOCK_DAY_ALL);
  const records = [];
  const names = {};
  for (const row of rows) {
    const date = rocToISO(row.Date);
    const c = parseNum(row.ClosingPrice);
    const change = parseNum(row.Change);
    records.push({
      symbol: row.Code,
      date,
      o: parseNum(row.OpeningPrice),
      h: parseNum(row.HighestPrice),
      l: parseNum(row.LowestPrice),
      c,
      pc: c !== undefined && change !== undefined ? Number((c - change).toFixed(4)) : undefined,
      v: parseNum(row.TradeVolume),
      to: parseNum(row.TradeValue),
    });
    names[row.Code] = row.Name;
  }
  return { records, names };
}

/** Fetches TAIEX close + market turnover for the last several trading days (no OHLC available from this endpoint). */
export async function fetchTaiex() {
  const rows = await fetchJson(FMTQIK);
  return rows.map((row) => {
    const c = parseNum(row.TAIEX);
    const change = parseNum(row.Change);
    return {
      symbol: 'TAIEX',
      date: rocToISO(row.Date),
      c,
      pc: c !== undefined && change !== undefined ? Number((c - change).toFixed(4)) : undefined,
      v: parseNum(row.TradeVolume),
      to: parseNum(row.TradeValue),
    };
  });
}

/**
 * Fetches TAIEX close for one specific day (for backfill — FMTQIK only exposes the
 * last ~7 trading days, so historical seeding needs a per-day call). `dateIso` is
 * "YYYY-MM-DD". Returns a single record or null if that date had no trading session.
 */
export async function fetchTaiexHistoryDay(dateIso) {
  const date = isoToCompactAD(dateIso);
  const url = `${MI_INDEX}?date=${date}&type=IND&response=json`;
  const json = await fetchJson(url);
  const row = json?.tables?.[0]?.data?.find((r) => r[0] === '發行量加權股價指數');
  if (!row) return null;
  const c = parseNum(row[1]);
  const magnitude = parseNum(row[3]);
  const pct = parseNum(row[4]);
  const change = magnitude !== undefined ? (pct !== undefined && pct < 0 ? -magnitude : magnitude) : undefined;
  return {
    symbol: 'TAIEX',
    date: dateIso,
    c,
    pc: c !== undefined && change !== undefined ? Number((c - change).toFixed(4)) : undefined,
  };
}

/** Fetches one month of daily history for a single 上市 stock (for backfill). `year`/`month` are AD. */
export async function fetchListedHistory(stockNo, year, month) {
  const date = isoToCompactAD(`${year}-${month}-01`);
  const url = `${STOCK_DAY_HISTORY}?date=${date}&stockNo=${stockNo}&response=json`;
  const json = await fetchJson(url);
  if (json.stat !== 'OK' || !Array.isArray(json.data)) return [];
  // fields: 日期,成交股數,成交金額,開盤價,最高價,最低價,收盤價,漲跌價差,成交筆數,註記
  return json.data.map((row) => {
    const [rocDate, volume, value, open, high, low, close, change] = row;
    const c = parseNum(close);
    const chg = parseNum(change);
    return {
      symbol: stockNo,
      date: rocToISO(rocDate),
      o: parseNum(open),
      h: parseNum(high),
      l: parseNum(low),
      c,
      pc: c !== undefined && chg !== undefined ? Number((c - chg).toFixed(4)) : undefined,
      v: parseNum(volume),
      to: parseNum(value),
    };
  });
}
