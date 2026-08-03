// The fetch scripts' recent-session sweep: "which of the last N trading sessions
// is missing or incomplete?" instead of "what is today's session?".
//
// This is the fix for the 2026-08-03 failure, and it replaces trusting the clock
// with something that does not depend on when the run happens. GitHub delivers
// this repo's crons hours late as a matter of routine — the 07:10 UTC TW cron
// arrived at 16:09 UTC that day, past Taipei midnight, by which point TWSE's
// bulk snapshot had rolled over and Monday's session was simply never captured.
// A publish-cutoff guard (see coverage.js) stops such a run reporting a false
// gap, but only this stops it *losing the session*.
//
// Cost is zero network calls on a healthy day: the scan reads month files off
// disk and returns. Traffic happens only where a session is genuinely missing.
// The deep 14-session sweep stays with the watchdog; this is the shallow pass
// every fetch run makes, so a single late or skipped run self-corrects on the
// next one rather than waiting for the daily watchdog.

import { readJson } from './jsonStore.js';
import { buildGroups, GROUPS_FOR_FETCH } from './marketGroups.js';
import { judgeableSessions, healSession, judgeSession, resolvedSymbols } from './sessionSweep.js';

/**
 * Three trading sessions: enough to cover a long weekend plus one dead run, and
 * small enough that a gap costs a bounded number of requests to the rate-limited
 * per-symbol history endpoints. Anything longer is the watchdog's daily sweep.
 */
export const SWEEP_LOOKBACK = 3;

/**
 * Sweeps the groups a fetch script owns (see GROUPS_FOR_FETCH). Returns a
 * summary per group: which sessions were checked, what was repaired, and what is
 * still unresolved. Never throws — a sweep failure must not fail the primary
 * fetch that already succeeded.
 */
export async function sweepRecentSessions(fetchKey, { holidays, lookback = SWEEP_LOOKBACK, logPrefix = fetchKey } = {}) {
  const groups = buildGroups();
  const status = readJson('status.json', {});
  const summaries = [];

  for (const key of GROUPS_FOR_FETCH[fetchKey] || []) {
    const g = groups[key];
    if (!g || !g.symbols.length) continue;

    // Symbols already carrying a verdict (no_trade/suspended/market_closed/
    // no_history) are settled — a confirmed empty cell must never become
    // permanent retry traffic.
    const skip = resolvedSymbols(status.coverage?.[key]);
    const sessions = judgeableSessions(g, { lookback, holidays });

    const repaired = [];
    const unresolved = [];
    for (const session of sessions) {
      try {
        const healed = await healSession(g, session, { skip });
        if (healed.repaired.length) repaired.push({ session, symbols: healed.repaired });
        if (healed.missing.length) {
          const { verdicts } = judgeSession(g, { ...healed, outcomes: healed.outcomes });
          const stuck = Object.keys(verdicts).filter((s) => verdicts[s] === 'unresolved');
          if (stuck.length) unresolved.push({ session, symbols: stuck });
        }
      } catch (err) {
        console.error(`[${logPrefix}] sweep ${key} ${session} FAILED: ${err.message}`);
      }
    }

    summaries.push({ key, label: g.label, sessions, repaired, unresolved });
    if (repaired.length) {
      for (const r of repaired) {
        console.log(`[${logPrefix}] sweep healed ${g.label} ${r.session}: ${r.symbols.join(', ')}`);
      }
    }
  }

  const totalRepaired = summaries.reduce((n, s) => n + s.repaired.reduce((m, r) => m + r.symbols.length, 0), 0);
  const window = summaries[0]?.sessions || [];
  console.log(
    `[${logPrefix}] sweep: last ${lookback} session(s) ${window.length ? `${window[0]}..${window[window.length - 1]}` : '(none judgeable)'}` +
      `, healed ${totalRepaired}`
  );
  return summaries;
}
