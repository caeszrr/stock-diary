// Targeted repair of ONE trading session across the TW stores.
//
// The gap this fills: repair-tw-gaps.js works at month granularity (it skips a
// symbol that has any data in the month), and the fetch scripts only ever chase
// the session they computed for themselves. Neither can be pointed at a single
// day that went missing — which is what 2026-08-05 needed, when TWSE's undated
// bulk snapshot served 2026-08-04 for a whole evening and the session was simply
// never collected.
//
// Uses the BY-DATE full-market endpoint, so one request repairs the whole 上市
// market and the watchlist subset together, instead of 67+ per-symbol calls.
//
//   node scripts/heal-session.js 2026-08-05
//   node scripts/heal-session.js 2026-08-05 --dry-run

import { fetchAllListedForDate, fetchTaiexHistoryDay } from './lib/twse.js';
import { upsertRecords, readMonthFile, readJson, writeJson, regenerateManifest } from './lib/jsonStore.js';
import { computeYearHighLow } from './lib/yearHighLow.js';
import { loadTickers, isFetchable } from './lib/tickers.js';
import { isoYear, isoMonth } from './lib/dates.js';

const session = process.argv[2];
const DRY_RUN = process.argv.includes('--dry-run');

if (!/^\d{4}-\d{2}-\d{2}$/.test(session || '')) {
  console.error('usage: node scripts/heal-session.js YYYY-MM-DD [--dry-run]');
  process.exit(2);
}

/** How many symbols in `store` hold a usable close for `session`. */
function coverageOf(store, session, symbols) {
  const data = readMonthFile(store, isoYear(session), isoMonth(session));
  const has = (s) => data[s] && data[s][session] && data[s][session].c !== undefined;
  return symbols ? symbols.filter(has).length : Object.keys(data).filter(has).length;
}

async function main() {
  const tickers = loadTickers().filter(isFetchable);
  const twseWatchlist = tickers.filter((t) => t.market === 'twse').map((t) => t.symbol);

  const before = {
    'tw-all': coverageOf('tw-all', session),
    'tw (上市 watchlist)': coverageOf('tw', session, twseWatchlist),
    'idx (TAIEX)': coverageOf('idx', session, ['TAIEX']),
  };
  console.log(`[heal] ${session} BEFORE:`, JSON.stringify(before));

  // ---- 上市 full market + watchlist subset (one request) ----
  const listed = await fetchAllListedForDate(session);
  if (!listed.ok) {
    console.error(`[heal] TWSE unreachable for ${session}: ${listed.error || listed.stat}`);
    console.error('[heal] this is an OUTAGE, not a closure — nothing written, exiting non-zero');
    process.exitCode = 1;
    return;
  }
  if (listed.empty) {
    // A definite "no session" from a by-date endpoint. Report it; do NOT write a
    // closure here — that verdict belongs to the evidence path, not a repair tool.
    console.log(`[heal] TWSE answered healthy with NO session for ${session} (stat: ${listed.stat || 'empty'})`);
  } else {
    console.log(`[heal] TWSE returned ${listed.records.length} listed instruments for ${session}`);
    if (!DRY_RUN) {
      upsertRecords('tw-all', listed.records, { pretty: false });
      const watchlistSet = new Set(twseWatchlist);
      const watchlistRecords = listed.records.filter((r) => watchlistSet.has(r.symbol));
      upsertRecords('tw', watchlistRecords, { pretty: false });

      // 52-week high/low, recomputed from stored history exactly as the pipeline does.
      const cache = new Map();
      const patches = [];
      for (const r of watchlistRecords) {
        const { yh, yl } = computeYearHighLow('tw', r.symbol, session, cache);
        if (yh !== undefined || yl !== undefined) patches.push({ symbol: r.symbol, date: session, yh, yl });
      }
      if (patches.length) upsertRecords('tw', patches, { pretty: false });

      // Keep the code -> name directory in step with any newly seen instrument.
      const symbols = readJson('tw-symbols.json', {});
      for (const [code, name] of Object.entries(listed.names)) {
        if (!symbols[code]) symbols[code] = { name, market: 'twse' };
      }
      writeJson('tw-symbols.json', symbols, { pretty: false });
    }
  }

  // ---- TAIEX ----
  const taiexPresent = coverageOf('idx', session, ['TAIEX']) > 0;
  if (!taiexPresent) {
    try {
      const rec = await fetchTaiexHistoryDay(session);
      if (rec && rec.c !== undefined) {
        if (!DRY_RUN) upsertRecords('idx', [rec], { pretty: false });
        console.log(`[heal] TAIEX ${session}: close ${rec.c} (prev ${rec.pc})`);
      } else {
        console.log(`[heal] TAIEX ${session}: source has no record`);
      }
    } catch (err) {
      console.error(`[heal] TAIEX ${session} FAILED: ${err.message}`);
      process.exitCode = 1;
    }
  }

  if (!DRY_RUN) regenerateManifest();

  const after = {
    'tw-all': coverageOf('tw-all', session),
    'tw (上市 watchlist)': coverageOf('tw', session, twseWatchlist),
    'idx (TAIEX)': coverageOf('idx', session, ['TAIEX']),
  };
  console.log(`[heal] ${session} AFTER: `, JSON.stringify(after));
  if (DRY_RUN) console.log('[heal] --dry-run: nothing was written');
}

main().catch((err) => {
  console.error('[heal] FAILED:', err);
  process.exitCode = 1;
});
