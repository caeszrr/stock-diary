import { fetchTwAllHistory } from './twAllHistory.js';

// Per-session cache so re-renders (tab switches, note edits) don't refetch the
// same user-added TW stock's full history every time.
const cache = new Map(); // symbol -> Promise<{date: rec}>

function primeHistory(symbol, manifest) {
  if (!cache.has(symbol)) cache.set(symbol, fetchTwAllHistory(symbol, manifest));
  return cache.get(symbol);
}

/** userTwTickers: user-added tickers with market twse/tpex. Returns { symbol: {date: rec} }. */
export async function loadUserTickerHistories(userTwTickers, manifest) {
  const entries = await Promise.all(
    userTwTickers.map(async (t) => [t.symbol, await primeHistory(t.symbol, manifest)]),
  );
  return Object.fromEntries(entries);
}
