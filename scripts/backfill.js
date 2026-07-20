import { loadTickers, isFetchable } from './lib/tickers.js';
import { fetchListedHistory, fetchTaiexHistoryDay } from './lib/twse.js';
import { fetchDaily, INDEX_SYMBOL_MAP } from './lib/yahoo.js';
import { upsertRecords, updateStatus, regenerateManifest } from './lib/jsonStore.js';
import { computeYearHighLow } from './lib/yearHighLow.js';
import { monthsBetween, weekdaysBetween, todayTaipei, sleep } from './lib/dates.js';

const START = process.env.BACKFILL_START || '2026-01-01';
const END = process.env.BACKFILL_END || todayTaipei();
// Optional comma-separated symbol filter for manual/targeted backfills (e.g. after adding one
// new ticker). Unset/empty means "every fetchable watchlist ticker", same as before.
const SYMBOL_FILTER = (process.env.BACKFILL_SYMBOLS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const US_INDEX_SYMBOLS = new Set(Object.keys(INDEX_SYMBOL_MAP));

async function backfillTwse(tickers) {
  const symbols = tickers.filter((t) => t.market === 'twse').map((t) => t.symbol);
  const months = monthsBetween(START, END);
  const records = [];
  for (const symbol of symbols) {
    let count = 0;
    for (const { year, month } of months) {
      try {
        const rows = await fetchListedHistory(symbol, year, month);
        records.push(...rows);
        count += rows.length;
      } catch (err) {
        console.error(`[backfill] TWSE ${symbol} ${year}-${month} FAILED: ${err.message}`);
      }
      await sleep(200);
    }
    console.log(`[backfill] TWSE ${symbol}: ${count} day(s)`);
  }
  const written = upsertRecords('tw', records, { pretty: false });
  console.log(`[backfill] TWSE watchlist: ${records.length} record(s) across ${written.length} month file(s)`);
  return records;
}

async function backfillTaiex() {
  const days = weekdaysBetween(START, END);
  const records = [];
  for (const day of days) {
    try {
      const rec = await fetchTaiexHistoryDay(day);
      if (rec) records.push(rec);
    } catch (err) {
      console.error(`[backfill] TAIEX ${day} FAILED: ${err.message}`);
    }
    await sleep(150);
  }
  upsertRecords('idx', records, { pretty: false });
  console.log(`[backfill] TAIEX: ${records.length} day(s) out of ${days.length} weekdays checked`);
  return records;
}

async function backfillUs(tickers) {
  const period1 = Math.floor(new Date(`${START}T00:00:00Z`).getTime() / 1000);
  const period2 = Math.floor(new Date(`${END}T23:59:59Z`).getTime() / 1000);
  const usSymbols = tickers.filter((t) => t.market === 'us').map((t) => t.symbol);
  const idxSymbols = tickers.filter((t) => t.market === 'index' && US_INDEX_SYMBOLS.has(t.symbol)).map((t) => t.symbol);

  const stockRecords = [];
  const failures = [];
  for (const symbol of usSymbols) {
    try {
      const { records } = await fetchDaily(symbol, { period1, period2 });
      stockRecords.push(...records);
      console.log(`[backfill] US ${symbol}: ${records.length} day(s)`);
    } catch (err) {
      failures.push({ symbol, error: err.message });
      console.error(`[backfill] US ${symbol} FAILED: ${err.message}`);
    }
    await sleep(250);
  }
  upsertRecords('us', stockRecords, { pretty: false });

  const indexRecords = [];
  for (const symbol of idxSymbols) {
    try {
      const { records } = await fetchDaily(symbol, { period1, period2 });
      indexRecords.push(...records);
      console.log(`[backfill] US index ${symbol}: ${records.length} day(s)`);
    } catch (err) {
      failures.push({ symbol, error: err.message });
      console.error(`[backfill] US index ${symbol} FAILED: ${err.message}`);
    }
    await sleep(250);
  }
  upsertRecords('idx', indexRecords, { pretty: false });

  console.log(`[backfill] US: ${stockRecords.length} stock record(s), ${indexRecords.length} index record(s), ${failures.length} failure(s)`);
  return { stockRecords, indexRecords, failures };
}

function backfillTpexSkipNote(tickers) {
  const symbols = tickers.filter((t) => t.market === 'tpex').map((t) => t.symbol);
  console.warn(
    `[backfill] TPEx (上櫃) SKIPPED for ${symbols.length} watchlist symbol(s): ${symbols.join(', ')} — ` +
      'no working public per-symbol historical endpoint was found (see scripts/lib/tpex.js for what was tried). ' +
      'History for these accumulates from the first daily pipeline run forward instead. See README for details.'
  );
  return symbols;
}

async function recomputeYearHighLow(market, records) {
  const cache = new Map();
  const bySymbolLatest = new Map();
  for (const rec of records) {
    const prev = bySymbolLatest.get(rec.symbol);
    if (!prev || rec.date > prev) bySymbolLatest.set(rec.symbol, rec.date);
  }
  const patches = [];
  for (const [symbol, date] of bySymbolLatest) {
    const { yh, yl } = computeYearHighLow(market, symbol, date, cache);
    if (yh !== undefined || yl !== undefined) patches.push({ symbol, date, yh, yl });
  }
  if (patches.length) upsertRecords(market, patches, { pretty: false });
}

async function main() {
  console.log(`[backfill] range ${START} -> ${END}`);
  let tickers = loadTickers().filter(isFetchable);
  if (SYMBOL_FILTER.length) {
    const wanted = new Set(SYMBOL_FILTER);
    tickers = tickers.filter((t) => wanted.has(t.symbol));
    console.log(`[backfill] symbol filter active: ${tickers.map((t) => t.symbol).join(', ') || '(none matched)'}`);
  }

  const twseRecords = await backfillTwse(tickers);
  const taiexRecords = await backfillTaiex();
  const { stockRecords: usRecords, failures } = await backfillUs(tickers);
  const tpexSkipped = backfillTpexSkipNote(tickers);

  await recomputeYearHighLow('tw', twseRecords);
  await recomputeYearHighLow('idx', taiexRecords);
  await recomputeYearHighLow('us', usRecords);

  updateStatus('backfill', {
    lastRun: new Date().toISOString(),
    range: { start: START, end: END },
    twseRecordCount: twseRecords.length,
    taiexRecordCount: taiexRecords.length,
    usRecordCount: usRecords.length,
    tpexSkipped,
    usFailures: failures,
  });

  regenerateManifest();
  console.log('[backfill] done.');
  if (failures.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('[backfill] FAILED:', err);
  process.exitCode = 1;
});
