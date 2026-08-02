import { fetchAllOtc } from './lib/tpex.js';
import { upsertRecords, readJson, writeJson, updateStatus, regenerateManifest } from './lib/jsonStore.js';
import { computeYearHighLow } from './lib/yearHighLow.js';
import { loadTickers, isFetchable } from './lib/tickers.js';
import {
  loadHolidays,
  expectedSessionDate,
  expectedWatchlistSymbols,
  presentSymbols,
  buildCoverage,
  writeCoverage,
} from './lib/coverage.js';

async function main() {
  const tickers = loadTickers().filter((t) => t.market === 'tpex' && isFetchable(t));
  const configured = tickers.map((t) => t.symbol);
  const watchlistSymbols = new Set(configured);
  const holidays = loadHolidays();

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

  // ---- Completeness (not presence) ----
  // TPEx has no working per-symbol historical endpoint (see scripts/lib/tpex.js),
  // so there is no targeted-repair fallback: a short bulk snapshot is recorded as
  // incomplete for the watchdog to escalate, never silently accepted.
  const expectedDate = expectedSessionDate('tpex', { holidays });
  const snapshotMax = allRecords.reduce((max, r) => (r.date > max ? r.date : max), '');
  const bulkStale = snapshotMax !== '' && snapshotMax < expectedDate;
  const expected = expectedWatchlistSymbols('tpex', configured, expectedDate, holidays);
  const present = presentSymbols('tw', expectedDate, expected);
  const missing = expected.filter((s) => !present.includes(s));

  const coverage = buildCoverage({
    market: 'tpex',
    sessionDate: expectedDate,
    expected,
    present,
    stale: present.length === 0 && bulkStale,
    fullMarket: { count: allRecords.length, snapshotDate: snapshotMax },
  });
  writeCoverage('tpex', coverage);

  updateStatus('tpex', {
    lastRun: new Date().toISOString(),
    latestSessionDate: present.length ? expectedDate : snapshotMax || null,
    watchlistCount: present.length,
    fullMarketCount: allRecords.length,
    complete: coverage.complete,
    ok: coverage.complete,
  });

  regenerateManifest();
  const verdict = coverage.complete ? 'COMPLETE' : `INCOMPLETE (${missing.length} missing${bulkStale ? ', bulk stale' : ''})`;
  console.log(`[fetch-tpex] wrote ${writtenFiles.length} watchlist month file(s), session ${expectedDate}: ${verdict}, ${present.length}/${expected.length} 上櫃`);
  if (!coverage.complete) process.exitCode = 1;
}

main().catch((err) => {
  console.error('[fetch-tpex] FAILED:', err);
  process.exitCode = 1;
});
