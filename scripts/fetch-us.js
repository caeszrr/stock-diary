import { fetchDaily } from './lib/yahoo.js';
import { upsertRecords, updateStatus, regenerateManifest } from './lib/jsonStore.js';
import { loadTickers, isFetchable } from './lib/tickers.js';
import { sleep } from './lib/dates.js';
import { sweepRecentSessions } from './lib/recentSweep.js';
import {
  loadHolidays,
  expectedSessionDate,
  presentSymbols,
  buildCoverage,
  writeCoverage,
} from './lib/coverage.js';

const US_INDEX_SYMBOLS = new Set(['DJI', 'IXIC', 'SPX', 'SOX']);
const DELAY_MS = 400;

async function fetchList(symbols, opts, label) {
  const records = [];
  const failures = [];
  for (const symbol of symbols) {
    try {
      const { records: recs } = await fetchDaily(symbol, opts);
      records.push(...recs);
      console.log(`[fetch-us] ${label}${symbol}: ${recs.length} day(s)`);
    } catch (err) {
      failures.push({ symbol, error: err.message });
      console.error(`[fetch-us] ${label}${symbol} FAILED: ${err.message}`);
    }
    await sleep(DELAY_MS);
  }
  return { records, failures };
}

async function main() {
  const tickers = loadTickers().filter(isFetchable);
  const usStocks = tickers.filter((t) => t.market === 'us').map((t) => t.symbol);
  const usIndices = tickers
    .filter((t) => t.market === 'index' && US_INDEX_SYMBOLS.has(t.symbol))
    .map((t) => t.symbol);
  const holidays = loadHolidays();

  const { records: stockRecords, failures } = await fetchList(usStocks, { range: '5d' }, '');
  upsertRecords('us', stockRecords, { pretty: false });

  const { records: indexRecords, failures: idxFailures } = await fetchList(usIndices, { range: '5d' }, 'index ');
  upsertRecords('idx', indexRecords, { pretty: false });
  failures.push(...idxFailures);

  // ---- Completeness (not presence) ----
  // The source reports the same freshest trading day for every symbol, so the
  // consensus max date is the session that must be complete. A calendar check
  // flags drift (source lagging behind the expected trading day).
  const consensusMax = stockRecords.reduce((max, r) => (r.date > max ? r.date : max), '');
  const calendarExpected = expectedSessionDate('us', { holidays });
  const sessionDate = consensusMax || calendarExpected;

  let present = presentSymbols('us', sessionDate, usStocks);
  let missing = usStocks.filter((s) => !present.includes(s));
  if (missing.length && consensusMax) {
    console.warn(`[fetch-us] ${missing.length}/${usStocks.length} missing ${sessionDate}; targeted repair (1mo range)...`);
    const { records: repaired } = await fetchList(missing, { range: '1mo' }, 'repair ');
    upsertRecords('us', repaired, { pretty: false });
    present = presentSymbols('us', sessionDate, usStocks);
    missing = usStocks.filter((s) => !present.includes(s));
  }

  // Indices: repair any lacking the consensus session too (kept out of the 檔 count, tracked separately).
  let idxPresent = presentSymbols('idx', sessionDate, usIndices);
  if (idxPresent.length < usIndices.length && consensusMax) {
    const idxMissing = usIndices.filter((s) => !idxPresent.includes(s));
    const { records: repaired } = await fetchList(idxMissing, { range: '1mo' }, 'repair index ');
    upsertRecords('idx', repaired, { pretty: false });
    idxPresent = presentSymbols('idx', sessionDate, usIndices);
  }

  // Delivery-time independence (see lib/recentSweep.js): repair any of the last
  // few sessions still missing, so a run that fires hours late — or a day whose
  // run never fired — self-corrects instead of only ever judging "today".
  await sweepRecentSessions('us', { holidays, logPrefix: 'fetch-us' });
  present = presentSymbols('us', sessionDate, usStocks);
  missing = usStocks.filter((s) => !present.includes(s));
  idxPresent = presentSymbols('idx', sessionDate, usIndices);

  const stale = consensusMax !== '' && consensusMax < calendarExpected;
  const coverage = buildCoverage({
    market: 'us',
    sessionDate,
    expected: usStocks,
    present,
    stale,
    fullMarket: { indices: `${idxPresent.length}/${usIndices.length}`, calendarExpected },
  });
  writeCoverage('us', coverage);

  updateStatus('us', {
    lastRun: new Date().toISOString(),
    latestSessionDate: present.length ? sessionDate : consensusMax || null,
    watchlistCount: present.length,
    indexCount: idxPresent.length,
    failures,
    complete: coverage.complete,
    ok: coverage.complete && failures.length === 0,
  });

  regenerateManifest();
  const verdict = coverage.complete ? 'COMPLETE' : `INCOMPLETE (${missing.length} missing${stale ? ', source lagging' : ''})`;
  console.log(`[fetch-us] session ${sessionDate}: ${verdict}, ${present.length}/${usStocks.length} stocks + ${idxPresent.length}/${usIndices.length} indices, ${failures.length} fetch failure(s)`);
  if (!coverage.complete || failures.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('[fetch-us] FAILED:', err);
  process.exitCode = 1;
});
