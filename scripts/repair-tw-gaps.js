// One-off repair pass: TWSE's per-symbol history endpoint throttles hard under the
// backfill's request volume (bare 307s), leaving some symbol/month combos empty even
// after backfill.js's own retries. This re-checks every TWSE watchlist symbol/month in
// range and re-fetches only the ones still missing, with a much more conservative delay.
import { loadTickers, isFetchable } from './lib/tickers.js';
import { fetchListedHistory, fetchTaiexHistoryDay } from './lib/twse.js';
import { readMonthFile, upsertRecords, regenerateManifest } from './lib/jsonStore.js';
import { computeYearHighLow } from './lib/yearHighLow.js';
import { monthsBetween, weekdaysBetween, todayTaipei, sleep } from './lib/dates.js';

const START = process.env.BACKFILL_START || '2026-01-01';
const END = process.env.BACKFILL_END || todayTaipei();
const DELAY_MS = Number(process.env.REPAIR_DELAY_MS || 900);

function symbolHasAnyDataInMonth(market, symbol, year, month) {
  const data = readMonthFile(market, year, month);
  return !!(data[symbol] && Object.keys(data[symbol]).length > 0);
}

async function repairTwse() {
  const symbols = loadTickers()
    .filter((t) => t.market === 'twse' && isFetchable(t))
    .map((t) => t.symbol);
  const months = monthsBetween(START, END);

  const gaps = [];
  for (const symbol of symbols) {
    for (const { year, month } of months) {
      if (!symbolHasAnyDataInMonth('tw', symbol, year, month)) gaps.push({ symbol, year, month });
    }
  }
  console.log(`[repair] TWSE: ${gaps.length} symbol/month gap(s) to re-check across ${symbols.length} symbols`);

  const records = [];
  let stillMissing = 0;
  for (const { symbol, year, month } of gaps) {
    try {
      const rows = await fetchListedHistory(symbol, year, month);
      records.push(...rows);
      console.log(`[repair] TWSE ${symbol} ${year}-${month}: ${rows.length} day(s)${rows.length === 0 ? ' (likely genuinely no trading that month)' : ''}`);
      if (rows.length === 0) stillMissing += 1;
    } catch (err) {
      stillMissing += 1;
      console.error(`[repair] TWSE ${symbol} ${year}-${month} STILL FAILING: ${err.message}`);
    }
    await sleep(DELAY_MS);
  }

  upsertRecords('tw', records, { pretty: false });
  console.log(`[repair] TWSE: wrote ${records.length} record(s), ${stillMissing} gap(s) remain (genuine no-data or repeated failure)`);

  const cache = new Map();
  const bySymbolLatest = new Map();
  for (const rec of records) {
    const prev = bySymbolLatest.get(rec.symbol);
    if (!prev || rec.date > prev) bySymbolLatest.set(rec.symbol, rec.date);
  }
  const patches = [];
  for (const [symbol, date] of bySymbolLatest) {
    const { yh, yl } = computeYearHighLow('tw', symbol, date, cache);
    if (yh !== undefined || yl !== undefined) patches.push({ symbol, date, yh, yl });
  }
  if (patches.length) upsertRecords('tw', patches, { pretty: false });
}

async function repairTaiex() {
  const weekdays = weekdaysBetween(START, END);
  // Check per-day (not per-month like repairTwse) since a month file can have SOME
  // TAIEX days present but be missing others.
  const monthsPresent = new Set();
  for (const day of weekdays) monthsPresent.add(`${day.slice(0, 4)}/${day.slice(5, 7)}`);
  const existingDates = new Set();
  for (const key of monthsPresent) {
    const [year, month] = key.split('/');
    const data = readMonthFile('idx', year, month);
    for (const date of Object.keys(data.TAIEX || {})) existingDates.add(date);
  }
  const gaps = weekdays.filter((day) => !existingDates.has(day));
  console.log(`[repair] TAIEX: ${gaps.length} weekday(s) to re-check out of ${weekdays.length}`);

  const records = [];
  for (const day of gaps) {
    try {
      const rec = await fetchTaiexHistoryDay(day);
      if (rec) records.push(rec);
    } catch (err) {
      console.error(`[repair] TAIEX ${day} STILL FAILING: ${err.message}`);
    }
    await sleep(DELAY_MS * 0.6);
  }
  upsertRecords('idx', records, { pretty: false });
  console.log(`[repair] TAIEX: recovered ${records.length} of ${gaps.length} re-checked weekday(s)`);
}

async function main() {
  await repairTwse();
  await repairTaiex();
  regenerateManifest();
  console.log('[repair] done.');
}

main().catch((err) => {
  console.error('[repair] FAILED:', err);
  process.exitCode = 1;
});
