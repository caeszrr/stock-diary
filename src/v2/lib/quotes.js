/**
 * v2 報價薄轉接層 — 重用 v1 的 EOD 資料服務(src/lib/loadMonth.js)。
 * 唯一合法報價源 = public/data/(禁止捏造;「現價」一律標示「最近收盤」)。
 */
import { loadMonth, loadStatus } from '../../lib/loadMonth.js';
import { getTwSymbolInfo, searchTwSymbols } from '../../lib/twSymbols.js';
import { prevDayIso } from './dates.js';

export { loadStatus, getTwSymbolInfo, searchTwSymbols };

const monthCache = new Map(); // "YYYY-MM" -> Promise<dataMap>
function loadMonthCached(year, month) {
  const key = `${year}-${month}`;
  if (!monthCache.has(key)) monthCache.set(key, loadMonth(year, month));
  return monthCache.get(key);
}

function prevMonthOf(year, month) {
  const y = Number(year); const m = Number(month);
  return m === 1 ? [String(y - 1), '12'] : [String(y), String(m - 1).padStart(2, '0')];
}

/**
 * 取一檔股票在 asOfIso(含)以前的最近一筆日資料。
 * 先找 asOf 當月,不足再往前一個月;找不到回傳 null(誠實空狀態)。
 */
export async function latestQuote(symbol, asOfIso) {
  const [y, m] = asOfIso.split('-');
  const months = [[y, m], prevMonthOf(y, m)];
  for (const [yy, mm] of months) {
    const dataMap = await loadMonthCached(yy, mm);
    const byDate = dataMap[symbol];
    if (!byDate) continue;
    const dates = Object.keys(byDate).filter((d) => d <= asOfIso && byDate[d]?.c !== undefined).sort();
    if (dates.length) {
      const date = dates[dates.length - 1];
      return { date, ...byDate[date] };
    }
  }
  return null;
}

/** 多檔一次取(共用月份快取)。回傳 { symbol: quote|null } */
export async function latestQuotes(symbols, asOfIso) {
  const out = {};
  await Promise.all(symbols.map(async (s) => { out[s] = await latestQuote(s, asOfIso); }));
  return out;
}
