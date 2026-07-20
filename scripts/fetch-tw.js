import { fetchAllListed, fetchTaiex } from './lib/twse.js';
import { upsertRecords, readJson, writeJson, updateStatus, regenerateManifest } from './lib/jsonStore.js';
import { computeYearHighLow } from './lib/yearHighLow.js';
import { loadTickers, isFetchable } from './lib/tickers.js';
import { todayTaipei } from './lib/dates.js';

async function main() {
  const tickers = loadTickers().filter((t) => t.market === 'twse' && isFetchable(t));
  const watchlistSymbols = new Set(tickers.map((t) => t.symbol));

  console.log(`[fetch-tw] fetching TWSE full market snapshot...`);
  const { records: allRecords, names } = await fetchAllListed();
  console.log(`[fetch-tw] got ${allRecords.length} listed instruments`);

  // Full market archive (tw-all) — everything, minified, grows forward day by day.
  upsertRecords('tw-all', allRecords, { pretty: false });

  // Watchlist subset.
  const watchlistRecords = allRecords.filter((r) => watchlistSymbols.has(r.symbol));
  const writtenFiles = upsertRecords('tw', watchlistRecords, { pretty: false });

  // 52-week high/low for the latest date of each watchlist symbol, computed from stored history.
  const cache = new Map();
  const yhylPatches = [];
  for (const rec of watchlistRecords) {
    const { yh, yl } = computeYearHighLow('tw', rec.symbol, rec.date, cache);
    if (yh !== undefined || yl !== undefined) {
      yhylPatches.push({ symbol: rec.symbol, date: rec.date, yh, yl });
    }
  }
  if (yhylPatches.length) upsertRecords('tw', yhylPatches, { pretty: false });

  // TAIEX index.
  const taiexRecords = await fetchTaiex();
  upsertRecords('idx', taiexRecords, { pretty: false });

  // Symbol directory (code -> name/market), merged across TWSE + TPEx runs.
  const symbols = readJson('tw-symbols.json', {});
  for (const [code, name] of Object.entries(names)) {
    symbols[code] = { name, market: 'twse' };
  }
  writeJson('tw-symbols.json', symbols, { pretty: false });

  const latestDate = watchlistRecords.reduce((max, r) => (r.date > max ? r.date : max), '');
  updateStatus('tw', {
    lastRun: new Date().toISOString(),
    latestSessionDate: latestDate || null,
    watchlistCount: watchlistRecords.length,
    fullMarketCount: allRecords.length,
    ok: watchlistRecords.length > 0,
  });

  regenerateManifest();
  console.log(`[fetch-tw] wrote ${writtenFiles.length} watchlist month file(s), latest session ${latestDate || '(none)'}, checked at ${todayTaipei()} Asia/Taipei`);
}

main().catch((err) => {
  console.error('[fetch-tw] FAILED:', err);
  process.exitCode = 1;
});
