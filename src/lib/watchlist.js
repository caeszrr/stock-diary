// Merges the build-time config watchlist with runtime user data (hidden/added
// tickers, start mode) into what the matrix actually renders. tickers.js stays
// the raw config accessor; this is the only place that combines it with
// userData.js so main.js/matrix.js don't need to know the merge rules.

import { allTickers as configAllTickers, pinnedIndices as configPinnedIndices } from './tickers.js';
import { getUserTickers, getHiddenTickers, getStartMode } from './userData.js';

export function pinnedIndices() {
  return configPinnedIndices();
}

/**
 * Returns [{ group, tickers: [...] }]. In "blank" start mode, preloaded
 * (config) non-index tickers are entirely omitted — only user-added ones show.
 * In "full" mode, hidden preloaded tickers are omitted but user-added ones
 * still show on top. A user-added ticker whose symbol has since been added to
 * config/tickers.json by the maintainer (US "assisted add" resolved) is
 * de-duplicated in favor of the config entry — this is the auto-merge.
 */
export function groupedTickers() {
  const mode = getStartMode();
  const hidden = new Set(getHiddenTickers());
  const config = configAllTickers().filter((t) => t.market !== 'index');
  const configSymbols = new Set(config.map((t) => t.symbol));

  const visibleConfig = mode === 'blank' ? [] : config.filter((t) => !hidden.has(t.symbol));
  const userTickers = getUserTickers()
    .filter((t) => !configSymbols.has(t.symbol))
    .map((t) => ({ ...t, isUserAdded: true }));

  const groups = [];
  const byGroup = new Map();
  const push = (t) => {
    if (!byGroup.has(t.group)) {
      const g = { group: t.group, tickers: [] };
      byGroup.set(t.group, g);
      groups.push(g);
    }
    byGroup.get(t.group).tickers.push(t);
  };
  for (const t of visibleConfig) push(t);
  for (const t of userTickers) push(t);
  return groups;
}

export function hiddenConfigTickers() {
  const hidden = new Set(getHiddenTickers());
  return configAllTickers().filter((t) => t.market !== 'index' && hidden.has(t.symbol));
}

export function isPreloadedSymbol(symbol) {
  return configAllTickers().some((t) => t.symbol === symbol);
}
