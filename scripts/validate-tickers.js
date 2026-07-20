import { loadTickersConfig, saveTickersConfig } from './lib/tickers.js';
import { fetchAllListed, fetchTaiex } from './lib/twse.js';
import { fetchAllOtc } from './lib/tpex.js';
import { fetchDaily, INDEX_SYMBOL_MAP } from './lib/yahoo.js';
import { sleep } from './lib/dates.js';

async function validateOne(ticker, { twseNames, tpexNames }) {
  if (ticker.market === 'twse') {
    const name = twseNames[ticker.symbol];
    return { resolved: !!name, fetchedName: name };
  }
  if (ticker.market === 'tpex') {
    const name = tpexNames[ticker.symbol];
    return { resolved: !!name, fetchedName: name };
  }
  if (ticker.market === 'us') {
    try {
      const { name, records } = await fetchDaily(ticker.symbol, { range: '5d' });
      return { resolved: records.length > 0, fetchedName: name };
    } catch (err) {
      return { resolved: false, error: err.message };
    }
  }
  if (ticker.market === 'index') {
    if (ticker.symbol === 'TAIEX') {
      try {
        const rows = await fetchTaiex();
        return { resolved: rows.length > 0, fetchedName: '加權指數 (TWSE FMTQIK)' };
      } catch (err) {
        return { resolved: false, error: err.message };
      }
    }
    if (INDEX_SYMBOL_MAP[ticker.symbol]) {
      try {
        const { name, records } = await fetchDaily(ticker.symbol, { range: '5d' });
        return { resolved: records.length > 0, fetchedName: `${name} (Yahoo ${INDEX_SYMBOL_MAP[ticker.symbol]})` };
      } catch (err) {
        return { resolved: false, error: err.message };
      }
    }
    return { resolved: false, error: 'no index symbol mapping defined' };
  }
  return { resolved: false, error: `unknown market "${ticker.market}"` };
}

async function main() {
  console.log('[validate-tickers] fetching bulk TW listings for name resolution...');
  const [{ names: twseNames }, { names: tpexNames }] = await Promise.all([fetchAllListed(), fetchAllOtc()]);

  const config = loadTickersConfig();
  const results = [];
  for (const ticker of config.tickers) {
    const result = await validateOne(ticker, { twseNames, tpexNames });
    results.push({ ticker, ...result });
    if (ticker.market === 'us' || ticker.market === 'index') await sleep(250);
  }

  // Report, grouped by market, verify:true entries flagged.
  const byMarket = { index: [], twse: [], tpex: [], us: [] };
  for (const r of results) byMarket[r.ticker.market]?.push(r);

  console.log('\n=== Ticker validation report ===');
  let failCount = 0;
  let verifyFailCount = 0;
  for (const market of ['index', 'twse', 'tpex', 'us']) {
    if (!byMarket[market].length) continue;
    console.log(`\n-- ${market} --`);
    for (const r of byMarket[market]) {
      const mark = r.resolved ? '✓' : '✗';
      const verifyTag = r.ticker.verify ? ' [VERIFY]' : '';
      const detail = r.resolved ? (r.fetchedName || '') : `NOT RESOLVED — ${r.error || 'unknown error'}`;
      console.log(`${mark} ${r.ticker.symbol.padEnd(8)} ${r.ticker.name_zh.padEnd(16)}${verifyTag}  ${detail}`);
      if (!r.resolved) {
        failCount += 1;
        if (r.ticker.verify) verifyFailCount += 1;
      }
    }
  }
  console.log(
    `\n${results.length} ticker(s) checked, ${results.length - failCount} resolved, ${failCount} unresolved (${verifyFailCount} of those were flagged verify:true).`
  );

  // Write back status field: mark newly-failed as unresolved, clear status on newly-resolved.
  let changed = false;
  for (const r of results) {
    if (!r.resolved && r.ticker.status !== 'unresolved') {
      r.ticker.status = 'unresolved';
      changed = true;
    } else if (r.resolved && r.ticker.status === 'unresolved') {
      delete r.ticker.status;
      changed = true;
    }
  }
  if (changed) {
    saveTickersConfig(config);
    console.log('\n[validate-tickers] config/tickers.json updated with resolved/unresolved status (no entries were removed).');
  } else {
    console.log('\n[validate-tickers] no status changes needed.');
  }

  if (failCount > 0) {
    console.log(`\n⚠ ${failCount} ticker(s) unresolved — they remain in config/tickers.json (status:"unresolved") and are excluded from fetch until fixed. Never silently dropped.`);
  }
}

main().catch((err) => {
  console.error('[validate-tickers] FAILED:', err);
  process.exitCode = 1;
});
