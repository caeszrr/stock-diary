import { fetchDaily } from './lib/yahoo.js';
import { upsertRecords, updateStatus, regenerateManifest } from './lib/jsonStore.js';
import { loadTickers, isFetchable } from './lib/tickers.js';
import { sleep } from './lib/dates.js';

const US_INDEX_SYMBOLS = new Set(['DJI', 'IXIC', 'SPX', 'SOX']);
const DELAY_MS = 400;

async function main() {
  const tickers = loadTickers().filter(isFetchable);
  const usStocks = tickers.filter((t) => t.market === 'us').map((t) => t.symbol);
  const usIndices = tickers
    .filter((t) => t.market === 'index' && US_INDEX_SYMBOLS.has(t.symbol))
    .map((t) => t.symbol);

  const stockRecords = [];
  const failures = [];
  for (const symbol of usStocks) {
    try {
      const { records } = await fetchDaily(symbol, { range: '5d' });
      stockRecords.push(...records);
      console.log(`[fetch-us] ${symbol}: ${records.length} day(s)`);
    } catch (err) {
      failures.push({ symbol, error: err.message });
      console.error(`[fetch-us] ${symbol} FAILED: ${err.message}`);
    }
    await sleep(DELAY_MS);
  }
  const writtenFiles = upsertRecords('us', stockRecords, { pretty: false });

  const indexRecords = [];
  for (const symbol of usIndices) {
    try {
      const { records } = await fetchDaily(symbol, { range: '5d' });
      indexRecords.push(...records);
      console.log(`[fetch-us] index ${symbol}: ${records.length} day(s)`);
    } catch (err) {
      failures.push({ symbol, error: err.message });
      console.error(`[fetch-us] index ${symbol} FAILED: ${err.message}`);
    }
    await sleep(DELAY_MS);
  }
  upsertRecords('idx', indexRecords, { pretty: false });

  const latestDate = [...stockRecords, ...indexRecords].reduce((max, r) => (r.date > max ? r.date : max), '');
  updateStatus('us', {
    lastRun: new Date().toISOString(),
    latestSessionDate: latestDate || null,
    watchlistCount: stockRecords.length,
    indexCount: indexRecords.length,
    failures,
    ok: failures.length === 0 && stockRecords.length > 0,
  });

  regenerateManifest();
  console.log(`[fetch-us] wrote ${writtenFiles.length} month file(s), latest session ${latestDate || '(none)'}, ${failures.length} failure(s)`);
  if (failures.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('[fetch-us] FAILED:', err);
  process.exitCode = 1;
});
