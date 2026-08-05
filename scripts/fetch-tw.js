import { fetchAllListed, fetchTaiex, fetchListedHistory, fetchTaiexHistoryDay, fetchAllListedForDate } from './lib/twse.js';
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
import { sweepRecentSessions } from './lib/recentSweep.js';
import { reviewClosures } from './lib/closureEvidence.js';

/**
 * Targeted, missing-only repair.
 *
 * Step 1 is one BY-DATE full-market request. The usual reason a whole watchlist
 * is missing is that the undated STOCK_DAY_ALL snapshot lagged a session (it
 * served 2026-08-04 for the whole of 2026-08-05, HTTP 200 throughout). Asking
 * the dated endpoint for the exact session settles that in a single call
 * instead of 67, and cannot itself be stale.
 *
 * Step 2 falls back to per-symbol history for whatever is still missing — the
 * case where the market did trade but individual symbols are absent. Only the
 * missing ones are ever re-requested; the whole market is never re-pulled per
 * symbol. fetchListedHistory already backs off on 307/429 throttling.
 */
async function repairMissingTwse(missing, sessionDate) {
  const repaired = [];
  const wanted = new Set(missing);

  const byDate = await fetchAllListedForDate(sessionDate);
  if (byDate.ok && !byDate.empty) {
    const hits = byDate.records.filter((r) => wanted.has(r.symbol) && r.c !== undefined);
    if (hits.length) {
      upsertRecords('tw', hits, { pretty: false });
      // The dated call returns the whole market, so bank the full-market rows too.
      upsertRecords('tw-all', byDate.records, { pretty: false });
      hits.forEach((r) => wanted.delete(r.symbol));
      repaired.push(...hits);
      console.log(`[fetch-tw] by-date repair recovered ${hits.length} symbol(s) for ${sessionDate} in one request`);
    }
  } else if (!byDate.ok) {
    console.error(`[fetch-tw] by-date repair unavailable for ${sessionDate}: ${byDate.error || byDate.stat}`);
  }

  const year = isoYear(sessionDate);
  const month = isoMonth(sessionDate);
  const perSymbol = [];
  for (const symbol of wanted) {
    try {
      const rows = await fetchListedHistory(symbol, year, month);
      const rec = rows.find((r) => r.date === sessionDate);
      if (rec && rec.c !== undefined) perSymbol.push(rec);
    } catch (err) {
      console.error(`[fetch-tw] targeted repair ${symbol} FAILED: ${err.message}`);
    }
    await sleep(300);
  }
  if (perSymbol.length) upsertRecords('tw', perSymbol, { pretty: false });
  return [...repaired, ...perSymbol];
}

async function main() {
  const tickers = loadTickers().filter((t) => t.market === 'twse' && isFetchable(t));
  const configured = tickers.map((t) => t.symbol);
  const watchlistSymbols = new Set(configured);

  // Closure verdicts are falsifiable, and this is where they get re-tested: a
  // verdict contradicted by stored data is revoked outright, and one that never
  // carried evidence must re-prove itself now. Costs zero network calls when
  // every verdict on file is sound. It runs BEFORE the calendar is read, since
  // a stale "holiday" would otherwise decide which session this run expects —
  // the loop that hid two live trading days.
  await reviewClosures({ log: (m) => console.log(`[fetch-tw] ${m}`) });
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

  // ---- Delivery-time independence ----
  // Everything above targets the session this run was scheduled for. That is
  // only correct if the run fired near its cron time, which is not something
  // this repo controls (see lib/recentSweep.js). So before reporting, repair any
  // of the last few sessions that is missing — including TAIEX in the idx store,
  // which nothing used to heal. Zero network calls when there is nothing to fix.
  await sweepRecentSessions('tw', { holidays, logPrefix: 'fetch-tw' });

  // Re-read presence after the sweep so the verdict reflects any repair it made.
  present = presentSymbols('tw', expectedDate, expected);
  missing = expected.filter((s) => !present.includes(s));
  taiexHasSession = presentSymbols('idx', expectedDate, ['TAIEX']).length > 0;

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
