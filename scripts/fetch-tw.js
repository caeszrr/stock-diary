import { fetchAllListed, fetchTaiex, fetchListedHistory, fetchTaiexHistoryDay } from './lib/twse.js';
import { upsertRecords, readJson, writeJson, updateStatus, regenerateManifest } from './lib/jsonStore.js';
import { computeYearHighLow } from './lib/yearHighLow.js';
import { loadTickers, isFetchable } from './lib/tickers.js';
import { todayTaipei, isoYear, isoMonth, sleep } from './lib/dates.js';
import {
  loadHolidays,
  expectedSessionDate,
  expectedWatchlistSymbols,
  presentSymbols,
  buildCoverage,
  writeCoverage,
} from './lib/coverage.js';

/**
 * Targeted, missing-only repair: when the bulk STOCK_DAY_ALL snapshot is stale
 * or a few symbols are absent, re-request just those symbols from the per-symbol
 * history endpoint (which is often fresh when the bulk one lags). Never re-pulls
 * the whole market. fetchListedHistory already backs off on 307/429 throttling.
 */
async function repairMissingTwse(missing, sessionDate) {
  const year = isoYear(sessionDate);
  const month = isoMonth(sessionDate);
  const repaired = [];
  for (const symbol of missing) {
    try {
      const rows = await fetchListedHistory(symbol, year, month);
      const rec = rows.find((r) => r.date === sessionDate);
      if (rec && rec.c !== undefined) repaired.push(rec);
    } catch (err) {
      console.error(`[fetch-tw] targeted repair ${symbol} FAILED: ${err.message}`);
    }
    await sleep(300);
  }
  if (repaired.length) upsertRecords('tw', repaired, { pretty: false });
  return repaired;
}

async function main() {
  const tickers = loadTickers().filter((t) => t.market === 'twse' && isFetchable(t));
  const configured = tickers.map((t) => t.symbol);
  const watchlistSymbols = new Set(configured);
  const holidays = loadHolidays();

  console.log(`[fetch-tw] fetching TWSE full market snapshot...`);
  const { records: allRecords, names } = await fetchAllListed();
  console.log(`[fetch-tw] got ${allRecords.length} listed instruments`);

  // Full market archive (tw-all) — everything, minified, grows forward day by day.
  upsertRecords('tw-all', allRecords, { pretty: false });

  // Watchlist subset.
  const watchlistRecords = allRecords.filter((r) => watchlistSymbols.has(r.symbol));
  const writtenFiles = upsertRecords('tw', watchlistRecords, { pretty: false });

  // ---- Completeness (not presence) ----
  const expectedDate = expectedSessionDate('tw', { holidays });
  const snapshotMax = allRecords.reduce((max, r) => (r.date > max ? r.date : max), '');
  const bulkStale = snapshotMax !== '' && snapshotMax < expectedDate;
  const expected = expectedWatchlistSymbols('tw', configured, expectedDate, holidays);

  let present = presentSymbols('tw', expectedDate, expected);
  let missing = expected.filter((s) => !present.includes(s));
  if (missing.length) {
    console.warn(
      `[fetch-tw] ${missing.length}/${expected.length} watchlist symbol(s) missing ${expectedDate}` +
        `${bulkStale ? ` (bulk snapshot stale at ${snapshotMax})` : ''}; targeted per-symbol repair...`
    );
    await repairMissingTwse(missing, expectedDate);
    present = presentSymbols('tw', expectedDate, expected);
    missing = expected.filter((s) => !present.includes(s));
  }

  // 52-week high/low for every watchlist symbol that now has the expected session (bulk + repaired).
  const cache = new Map();
  const yhylPatches = [];
  for (const symbol of present) {
    const { yh, yl } = computeYearHighLow('tw', symbol, expectedDate, cache);
    if (yh !== undefined || yl !== undefined) yhylPatches.push({ symbol, date: expectedDate, yh, yl });
  }
  if (yhylPatches.length) upsertRecords('tw', yhylPatches, { pretty: false });

  // TAIEX index — same completeness check, repaired per-day if the recent-days feed is stale.
  const taiexRecords = await fetchTaiex();
  upsertRecords('idx', taiexRecords, { pretty: false });
  let taiexHasSession = taiexRecords.some((r) => r.date === expectedDate && r.c !== undefined);
  if (!taiexHasSession) {
    try {
      const rec = await fetchTaiexHistoryDay(expectedDate);
      if (rec && rec.c !== undefined) {
        upsertRecords('idx', [rec], { pretty: false });
        taiexHasSession = true;
      }
    } catch (err) {
      console.error(`[fetch-tw] TAIEX targeted repair FAILED: ${err.message}`);
    }
  }

  // Symbol directory (code -> name/market), merged across TWSE + TPEx runs.
  const symbols = readJson('tw-symbols.json', {});
  for (const [code, name] of Object.entries(names)) {
    symbols[code] = { name, market: 'twse' };
  }
  writeJson('tw-symbols.json', symbols, { pretty: false });

  const coverage = buildCoverage({
    market: 'tw',
    sessionDate: expectedDate,
    expected,
    present,
    stale: present.length === 0 && bulkStale,
    fullMarket: { count: allRecords.length, snapshotDate: snapshotMax, taiex: taiexHasSession },
  });
  writeCoverage('tw', coverage);

  updateStatus('tw', {
    lastRun: new Date().toISOString(),
    latestSessionDate: present.length ? expectedDate : snapshotMax || null,
    watchlistCount: present.length,
    fullMarketCount: allRecords.length,
    complete: coverage.complete,
    ok: coverage.complete,
  });

  regenerateManifest();
  const verdict = coverage.complete ? 'COMPLETE' : `INCOMPLETE (${missing.length} missing${present.length === 0 && bulkStale ? ', bulk stale' : ''})`;
  console.log(
    `[fetch-tw] wrote ${writtenFiles.length} watchlist month file(s), session ${expectedDate}: ${verdict}, ` +
      `${present.length}/${expected.length} 上市 + TAIEX ${taiexHasSession ? 'ok' : 'MISSING'}, checked at ${todayTaipei()} Asia/Taipei`
  );
  if (!coverage.complete) process.exitCode = 1;
}

main().catch((err) => {
  console.error('[fetch-tw] FAILED:', err);
  process.exitCode = 1;
});
