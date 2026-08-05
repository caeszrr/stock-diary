// End-to-end demonstrations of the closure-evidence rules.
//
// Each scenario copies config/ + public/data/ into a scratch directory, doctors
// the copy, and runs the REAL scripts/watchdog.js there with cwd set to the
// scratch tree and a simulated network (scripts/demo/net-sim.cjs). Nothing in
// the repo's own data is touched, and the watchdog under test is the shipped
// one, not a stand-in.
//
//   node scripts/demo/run.mjs
//
// Exit 0 = every scenario behaved as specified.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WATCHDOG = path.join(REPO, 'scripts', 'watchdog.js');
const NET_SIM = path.join(REPO, 'scripts', 'demo', 'net-sim.cjs');

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

/**
 * A scratch copy of the real config + data.
 *
 * The watchlist is trimmed to a few tickers per market. Every rule under test
 * is decided per SESSION, not per symbol, so the outcome is identical — but the
 * outage scenario re-requests each missing symbol with retry backoff, and at
 * the full 67 上市 symbols that alone takes ~6 minutes per scenario. Trimming
 * keeps the demo runnable in seconds; scripts/lib/*.test.js cover the same
 * logic exhaustively.
 */
function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-demo-'));
  fs.cpSync(path.join(REPO, 'config'), path.join(dir, 'config'), { recursive: true });
  fs.cpSync(path.join(REPO, 'public', 'data'), path.join(dir, 'public', 'data'), { recursive: true });

  const tickersPath = path.join(dir, 'config', 'tickers.json');
  const tickers = JSON.parse(fs.readFileSync(tickersPath, 'utf8'));
  const list = Array.isArray(tickers) ? tickers : tickers.tickers;
  const keep = ['2330', '2317', '3163', 'TAIEX', 'NVDA'];
  const trimmed = list.filter((t) => keep.includes(t.symbol));
  fs.writeFileSync(tickersPath, JSON.stringify(Array.isArray(tickers) ? trimmed : { ...tickers, tickers: trimmed }, null, 2));
  return dir;
}

function runWatchdog(dir, mode) {
  let stdout = '';
  let code = 0;
  try {
    stdout = execFileSync(process.execPath, ['--require', NET_SIM, WATCHDOG], {
      cwd: dir,
      env: { ...process.env, DEMO_MODE: mode },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    stdout = `${err.stdout || ''}${err.stderr || ''}`;
    code = err.status ?? 1;
  }
  const reportPath = path.join(dir, 'watchdog-report.json');
  const report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : null;
  const calendar = JSON.parse(fs.readFileSync(path.join(dir, 'config', 'market-holidays.json'), 'utf8'));
  return { stdout, code, report, calendar };
}

/** Removes every record for `dates` from a month store, simulating sessions that never arrived. */
function deleteSessions(dir, store, dates) {
  for (const date of dates) {
    const file = path.join(dir, 'public', 'data', store, date.slice(0, 4), `${date.slice(5, 7)}.json`);
    if (!fs.existsSync(file)) continue;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const sym of Object.keys(data)) delete data[sym][date];
    fs.writeFileSync(file, JSON.stringify(data));
  }
}

// ---------------------------------------------------------------------------
console.log('\n=== 1. Simulated TWSE/TPEx outage over two sessions ===');
console.log('    (the shape of the real 2026-08-05 failure: sources unreachable)');
{
  const dir = scratch();
  deleteSessions(dir, 'tw', ['2026-08-04', '2026-08-05']);
  deleteSessions(dir, 'idx', ['2026-08-04', '2026-08-05']);
  const { code, report, calendar, stdout } = runWatchdog(dir, 'outage');

  const discovered = (calendar.twDiscovered || []).map((e) => (typeof e === 'string' ? e : e.date));
  check('no closure recorded for either session', !discovered.includes('2026-08-04') && !discovered.includes('2026-08-05'), `twDiscovered = [${discovered}]`);
  check('neither date entered the rendered 休 calendar', !calendar.tw.includes('2026-08-04') && !calendar.tw.includes('2026-08-05'));
  check('gaps left UNRESOLVED (loud), not explained away', (report?.unresolved || []).length > 0, `${(report?.unresolved || []).length} unresolved group/session(s)`);
  check('escalated at the two-session threshold', (report?.escalations || []).some((e) => e.streak >= 2), JSON.stringify((report?.escalations || []).map((e) => `${e.label}:${e.streak}`)));
  check('exited non-zero so the workflow opens an Issue', code === 1, `exit ${code}`);
  check('log names it an outage, not a holiday', /not confirmed|outage|UNRESOLVED/i.test(stdout));
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
console.log('\n=== 2. Simulated GENUINE closure (both exchanges healthy but empty) ===');
{
  const dir = scratch();
  deleteSessions(dir, 'tw', ['2026-08-05']);
  deleteSessions(dir, 'idx', ['2026-08-05']);
  const { calendar, report } = runWatchdog(dir, 'closed');

  const entries = (calendar.twDiscovered || []).map((e) => (typeof e === 'string' ? { date: e } : e));
  const rec = entries.find((e) => e.date === '2026-08-05');
  check('closure CONFIRMED and recorded', !!rec, rec ? `evidence: twse=${rec.evidence?.twse} tpex=${rec.evidence?.tpex}` : 'not recorded');
  check('evidence names both exchanges and the wall clock', rec?.evidence?.twse === 'healthy-empty' && rec?.evidence?.tpex === 'healthy-empty' && rec?.evidence?.wallClock === 'passed');
  check('entered the rendered calendar, so the UI may show 休', calendar.tw.includes('2026-08-05'));
  check('reported as a discovered closure', (report?.discoveredClosures || []).some((d) => d.session === '2026-08-05'));
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
console.log('\n=== 3. Contradiction auto-revoke (data planted on a "closed" date) ===');
{
  const dir = scratch();
  // Mark a real trading day closed, exactly as the incident did...
  const calFile = path.join(dir, 'config', 'market-holidays.json');
  const cal = JSON.parse(fs.readFileSync(calFile, 'utf8'));
  cal.twDiscovered.push({
    date: '2026-08-05',
    confirmedAt: '2026-08-04T16:26:00.000Z',
    evidence: { wallClock: 'passed', twse: 'healthy-empty', tpex: 'healthy-empty' },
  });
  cal.tw = [...new Set([...cal.tw, '2026-08-05'])].sort();
  fs.writeFileSync(calFile, JSON.stringify(cal, null, 2));
  // ...while the stores still hold that session's records (they do: we healed it).
  const { calendar, stdout } = runWatchdog(dir, 'outage');

  const discovered = (calendar.twDiscovered || []).map((e) => (typeof e === 'string' ? e : e.date));
  check('closure revoked despite carrying full evidence', !discovered.includes('2026-08-05'), `twDiscovered = [${discovered}]`);
  check('removed from the rendered calendar', !calendar.tw.includes('2026-08-05'));
  check('the revocation is logged with its reason', /REVOKED 2026-08-05 — contradicted/.test(stdout), (stdout.match(/REVOKED.*/) || [''])[0].trim());
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${failures === 0 ? 'ALL SCENARIOS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exitCode = failures === 0 ? 0 : 1;
