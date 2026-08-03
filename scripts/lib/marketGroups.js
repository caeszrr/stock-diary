// The single definition of "what we monitor and how a missing record is repaired",
// shared by the watchdog and by every fetch script's recent-session sweep.
//
// It lives here because it used to live only inside scripts/watchdog.js, and the
// copy there had no `idx` entry — so index gaps (TAIEX above all) could never
// self-heal, which is issue #3 and is exactly what left TAIEX blank for
// 2026-08-03. One definition means adding a store fixes every consumer at once.
//
// A group is: which calendar decides its trading days, which store file holds it,
// which symbols are expected, and how to re-request one symbol's session.
// `fetchRows` returns an array of records covering at least `session`; a group
// with `fetchRows: null` has no per-symbol repair path at all.

import { fetchListedHistory, fetchTaiexHistoryDay } from './twse.js';
import { fetchDaily } from './yahoo.js';
import { loadTickers, isFetchable } from './tickers.js';
import { isoYear, isoMonth } from './dates.js';

/** Yahoo wants a whole month window; ask for the session's month and let the caller pick the day. */
async function yahooMonthRows(symbol, session) {
  const y = Number(isoYear(session));
  const m = Number(isoMonth(session));
  const period1 = Math.floor(Date.UTC(y, m - 1, 1) / 1000);
  const period2 = Math.floor(Date.UTC(y, m, 1) / 1000); // first of next month, captures the whole month
  const { records } = await fetchDaily(symbol, { period1, period2 });
  return records;
}

/**
 * Builds the group map. `tickers` may be injected (tests); otherwise the
 * configured, fetchable watchlist is used.
 */
export function buildGroups(tickers = loadTickers().filter(isFetchable)) {
  const bySymbol = (market) => tickers.filter((t) => t.market === market).map((t) => t.symbol);
  const indices = tickers.filter((t) => t.market === 'index').map((t) => t.symbol);

  return {
    tw: {
      label: '上市 (TWSE)',
      calendar: 'tw',
      store: 'tw',
      symbols: bySymbol('twse'),
      fetchRows: (symbol, session) => fetchListedHistory(symbol, isoYear(session), isoMonth(session)),
    },
    tpex: {
      label: '上櫃 (TPEx)',
      calendar: 'tw',
      store: 'tw',
      symbols: bySymbol('tpex'),
      // No working per-symbol historical endpoint (see scripts/lib/tpex.js), so a
      // missing 上櫃 session can only be reported, never repaired.
      fetchRows: null,
    },
    us: {
      label: '美股 (US)',
      calendar: 'us',
      store: 'us',
      symbols: bySymbol('us'),
      fetchRows: yahooMonthRows,
    },
    // ---- Indices (store `idx`) — previously monitored by nothing at all. ----
    // Split by calendar, not lumped together: TAIEX trades on the Taiwan calendar
    // and the US indices on the US one, so a single group would mark every US
    // index missing on a Taiwan holiday and vice versa.
    idxTw: {
      label: '加權指數 (TAIEX)',
      calendar: 'tw',
      store: 'idx',
      symbols: indices.filter((s) => s === 'TAIEX'),
      fetchRows: async (symbol, session) => {
        const rec = await fetchTaiexHistoryDay(session);
        return rec ? [rec] : [];
      },
    },
    idxUs: {
      label: '美股指數 (US indices)',
      calendar: 'us',
      store: 'idx',
      symbols: indices.filter((s) => s !== 'TAIEX'),
      fetchRows: yahooMonthRows,
    },
  };
}

/** The group keys a given fetch script is responsible for sweeping. */
export const GROUPS_FOR_FETCH = {
  tw: ['tw', 'idxTw'],
  tpex: ['tpex'],
  us: ['us', 'idxUs'],
};
