// Network simulator for the end-to-end closure demos (scripts/demo/run.sh).
//
// Preloaded with `node --require`, so the REAL watchdog binary runs unmodified
// against a controlled network. Nothing in scripts/ or src/ knows this exists —
// the seam is global fetch, not a test hook wired into production code.
//
//   DEMO_MODE=outage  every TWSE/TPEx request fails, the way a timeout, a block
//                     or a 307 throttle fails. The sources say NOTHING.
//   DEMO_MODE=closed  every TWSE/TPEx request succeeds and reports no session,
//                     the way a genuine holiday reads.

const MODE = process.env.DEMO_MODE || 'outage';
const realFetch = globalThis.fetch;

const json = (body) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (!/twse\.com\.tw|tpex\.org\.tw/.test(u)) return realFetch(url, init);

  if (MODE === 'outage') {
    throw new Error('SIMULATED OUTAGE: connect ETIMEDOUT');
  }

  // MODE=closed — healthy responses that definitively contain no session.
  if (/tpex\.org\.tw/.test(u)) {
    return json({ stat: 'ok', date: '', tables: [{ title: '上櫃股票行情', fields: [], data: [] }] });
  }
  if (/MI_INDEX/.test(u)) {
    // TWSE's real answer for a non-session date: a stat string and no tables.
    return json({ stat: '很抱歉，沒有符合條件的資料!' });
  }
  if (/STOCK_DAY/.test(u)) {
    return json({ stat: 'OK', data: [] });
  }
  return json([]);
};

console.log(`[net-sim] active — DEMO_MODE=${MODE} (TWSE/TPEx intercepted)`);
