import tickersConfig from '../../config/tickers.json';

// Bundled at build time — the watchlist itself only changes via a repo commit + rebuild,
// unlike the daily quote data which is fetched at runtime from public/data/.
const ALL = tickersConfig.tickers.filter((t) => t.status !== 'unresolved');

const PINNED_INDEX_ORDER = ['TAIEX', 'DJI', 'IXIC', 'SPX', 'SOX'];

export function pinnedIndices() {
  const bySymbol = Object.fromEntries(ALL.filter((t) => t.market === 'index').map((t) => [t.symbol, t]));
  return PINNED_INDEX_ORDER.map((s) => bySymbol[s]).filter(Boolean);
}

/** Returns [{ group, tickers: [...] }] for every non-index instrument, in tickers.json order. */
export function groupedWatchlist() {
  const rows = ALL.filter((t) => t.market !== 'index');
  const groups = [];
  const byGroup = new Map();
  for (const t of rows) {
    if (!byGroup.has(t.group)) {
      const g = { group: t.group, tickers: [] };
      byGroup.set(t.group, g);
      groups.push(g);
    }
    byGroup.get(t.group).tickers.push(t);
  }
  return groups;
}

export function allTickers() {
  return ALL;
}
