import { fetchJson, parseNum } from './http.js';
import { rocToISO } from './dates.js';

const MAINBOARD_DAILY = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes';

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
