import { fetchAllOtc } from './lib/tpex.js';
import { upsertRecords, readJson, writeJson, updateStatus, regenerateManifest } from './lib/jsonStore.js';
import { computeYearHighLow } from './lib/yearHighLow.js';
import { loadTickers, isFetchable } from './lib/tickers.js';

async function main() {
  const tickers = loadTickers().filter((t) => t.market === 'tpex' && isFetchable(t));
  const watchlistSymbols = new Set(tickers.map((t) => t.symbol));

  console.log(`[fetch-tpex] fetching TPEx full market snapshot...`);
  const { records: allRecords, names } = await fetchAllOtc();
  console.log(`[fetch-tpex] got ${allRecords.length} OTC instruments`);

  // Full market archive (tw-all) — merges alongside TWSE's listed-stock records for the same month.
  upsertRecords('tw-all', allRecords, { pretty: false });

  const watchlistRecords = allRecords.filter((r) => watchlistSymbols.has(r.symbol));
  const writtenFiles = upsertRecords('tw', watchlistRecords, { pretty: false });

  const cache = new Map();
  const yhylPatches = [];
  for (const rec of watchlistRecords) {
    const { yh, yl } = computeYearHighLow('tw', rec.symbol, rec.date, cache);
    if (yh !== undefined || yl !== undefined) {
      yhylPatches.push({ symbol: rec.symbol, date: rec.date, yh, yl });
    }
  }
  if (yhylPatches.length) upsertRecords('tw', yhylPatches, { pretty: false });

  const symbols = readJson('tw-symbols.json', {});
  for (const [code, name] of Object.entries(names)) {
    symbols[code] = { name, market: 'tpex' };
  }
  writeJson('tw-symbols.json', symbols, { pretty: false });

  const latestDate = watchlistRecords.reduce((max, r) => (r.date > max ? r.date : max), '');
  updateStatus('tpex', {
    lastRun: new Date().toISOString(),
    latestSessionDate: latestDate || null,
    watchlistCount: watchlistRecords.length,
    fullMarketCount: allRecords.length,
    ok: watchlistRecords.length > 0,
  });

  regenerateManifest();
  console.log(`[fetch-tpex] wrote ${writtenFiles.length} watchlist month file(s), latest session ${latestDate || '(none)'}`);
}

main().catch((err) => {
  console.error('[fetch-tpex] FAILED:', err);
  process.exitCode = 1;
});
