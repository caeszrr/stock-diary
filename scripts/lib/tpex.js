import { fetchJson, parseNum } from './http.js';
import { rocToISO } from './dates.js';

const MAINBOARD_DAILY = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes';
const DAILY_QUOTES = 'https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes';

/**
 * Fetches the full 上櫃 market for ONE SPECIFIC DATE.
 *
 * The openapi endpoint above is undated — it serves "today", so it cannot be
 * asked about a past session and cannot be told apart from a stale snapshot.
 * This one takes a date, which makes it usable both as a repair path for a
 * named session and as evidence about whether a session existed at all
 * (see lib/closureEvidence.js).
 *
 * This is also the historical endpoint the original implementation looked for
 * and did not find (see the note on fetchAllOtc), so 上櫃 is no longer
 * unrepairable — though history before the first pipeline run is still absent.
 *
 * Returns { ok, empty, records, names }. ok:false means the source could not be
 * reached or parsed and says NOTHING about the date.
 */
export async function fetchAllOtcForDate(dateIso) {
  const [y, m, d] = dateIso.split('-');
  const url = `${DAILY_QUOTES}?date=${encodeURIComponent(`${y}/${m}/${d}`)}&type=EW&response=json`;
  let json;
  try {
    json = await fetchJson(url);
  } catch (err) {
    return { ok: false, empty: false, records: [], names: {}, error: err.message };
  }
  const table = json?.tables?.[0];
  if (String(json?.stat).toLowerCase() !== 'ok' || !table || !Array.isArray(table.data)) {
    return { ok: false, empty: false, records: [], names: {}, stat: json?.stat };
  }

  const records = [];
  const names = {};
  for (const row of table.data) {
    const [code, name, close, change, open, high, low, , volume, value] = row;
    const c = parseNum(close);
    const chg = parseNum(change); // already signed, e.g. "+65.00" / "-3.50"
    records.push({
      symbol: code,
      date: dateIso,
      o: parseNum(open),
      h: parseNum(high),
      l: parseNum(low),
      c,
      pc: c !== undefined && chg !== undefined ? Number((c - chg).toFixed(4)) : undefined,
      v: parseNum(volume),
      to: parseNum(value),
    });
    names[code] = name;
  }
  // A non-session date answers stat:ok with zero rows — a healthy, definite
  // "no session", which is exactly the shape closure evidence needs.
  return { ok: true, empty: records.length === 0, records, names };
}

/**
 * Fetches today's full 上櫃 market snapshot (all OTC instruments, one call).
 * Returns { records: [{symbol,date,o,h,l,c,pc,v,to}], names: {code: name} }.
 *
 * NOTE: no working per-symbol historical endpoint was found for TPEx during
 * implementation (their old afterTrading/legacy .php endpoints now ignore
 * date/stkno params and just echo today's bulk listing; the openapi doc page
 * is JS-rendered and lists no historical route). So 上櫃 watchlist symbols
 * are NOT backfilled to 2026-01-01 — history for them starts accumulating
 * from the first time this script runs. This is surfaced in the backfill
 * report and README, not silently swallowed.
 */
export async function fetchAllOtc() {
  const rows = await fetchJson(MAINBOARD_DAILY);
  const records = [];
  const names = {};
  for (const row of rows) {
    const date = rocToISO(row.Date);
    const c = parseNum(row.Close);
    const change = parseNum(row.Change);
    records.push({
      symbol: row.SecuritiesCompanyCode,
      date,
      o: parseNum(row.Open),
      h: parseNum(row.High),
      l: parseNum(row.Low),
      c,
      pc: c !== undefined && change !== undefined ? Number((c - change).toFixed(4)) : undefined,
      v: parseNum(row.TradingShares),
      to: parseNum(row.TransactionAmount),
    });
    names[row.SecuritiesCompanyCode] = row.CompanyName;
  }
  return { records, names };
}
