// Self-healing completeness watchdog. Two rules: never alarm when silence is
// correct (weekends/holidays), and heal before telling (repair transient gaps,
// escalate only what a repair cannot fix).
//
// First action is cheap: read the coverage record and, if the recent window is
// already complete, exit within seconds having made zero network calls. Only an
// actual gap triggers any traffic — that is what keeps frequent checks polite to
// TWSE/Yahoo.
//
// Modes:
//   (default)      check only the latest expected session per market.
//   --sweep        re-check the last 14 sessions and heal any incomplete one.
//
// Exit code 0 = healthy or fully healed; 1 = unresolved gaps remain (the
// workflow opens/updates a GitHub Issue). Verdicts (no_trade / suspended /
// market_closed / no_history) are written back into the coverage record so a
// confirmed empty cell is never retried forever and the UI can show why.

import fs from 'node:fs';
import path from 'node:path';
import { readMonthFile, readJson, upsertRecords, regenerateManifest } from './lib/jsonStore.js';
import { isoYear, isoMonth, sleep } from './lib/dates.js';
import {
  loadHolidays,
  previousTradingDate,
  buildCoverage,
  writeCoverage,
} from './lib/coverage.js';
import { buildGroups } from './lib/marketGroups.js';
import { presentForSession, judgeableSessions, healSession, judgeSession, resolvedSymbols } from './lib/sessionSweep.js';
import { scanSanity, crossMarketDrift } from './lib/sanity.js';
import { confirmTwClosure, recordConfirmedClosure, reviewClosures, unexplainedSessions } from './lib/closureEvidence.js';

const SWEEP = process.env.WATCHDOG_SWEEP === '1' || process.argv.includes('--sweep');
const LOOKBACK = SWEEP ? 14 : 1;

// Group definitions (including the idx stores the watchdog previously ignored —
// issue #3) live in lib/marketGroups.js, shared with every fetch script's sweep.
const GROUPS = buildGroups();

async function main() {
  const monthCache = new Map();
  const report = {
    mode: SWEEP ? 'sweep' : 'latest',
    lookback: LOOKBACK,
    markets: {},
    unresolved: [],
    healed: [],
    discoveredClosures: [],
    closureChecks: [],
    escalations: [],
  };
  let networkCalls = 0;

  // Existing closure verdicts are re-tested BEFORE anything is judged against
  // them, because every downstream expectation reads the calendar. A verdict
  // that is contradicted by stored data, or that was never backed by evidence,
  // must not be allowed to shape this run's idea of which sessions to expect —
  // that feedback loop is exactly what kept 8/4 and 8/5 invisible for two days.
  report.closureReview = await reviewClosures({ log: (m) => console.log(`[watchdog] ${m}`) });
  const holidays = loadHolidays(); // reload: the review may have changed the calendar

  const statusNow = readJson('status.json', {});
  for (const [market, g] of Object.entries(GROUPS)) {
    if (!g.symbols.length) continue;
    // Only judge sessions that should already be PUBLISHED — enforced by the
    // publish cutoff inside expectedSessionDate (see lib/sessionSweep.js), so a
    // run can never declare today's not-yet-fetched session a gap or a closure.
    const sessions = judgeableSessions(g, { lookback: LOOKBACK, holidays });
    const marketReport = { label: g.label, sessions: {} };

    for (const session of sessions) {
      const before = presentForSession(monthCache, g.store, session, g.symbols);
      const missingBefore = g.symbols.filter((s) => !before.includes(s));
      marketReport.sessions[session] = { expected: g.symbols.length, present: before.length, missing: [...missingBefore] };
      const isLatest = session === sessions[sessions.length - 1];

      let present = before;
      let missing = missingBefore;
      let verdicts = {};

      if (missingBefore.length) {
        // ---- Heal: re-fetch only the missing symbols for this session ----
        const healed = await healSession(g, session, {
          monthCache,
          onNetworkCall: () => { networkCalls += 1; },
        });
        present = healed.present;
        missing = healed.missing;
        marketReport.sessions[session].present = present.length;
        marketReport.sessions[session].missing = [...missing];
        if (healed.repaired.length) report.healed.push({ market, session, symbols: healed.repaired });

        // ---- Reach a verdict for whatever is still missing ----
        const judged = judgeSession(g, { present, missing, outcomes: healed.outcomes });
        verdicts = judged.verdicts;

        // A suspected closure is only ever a question. Answering it requires
        // positive evidence: the exchanges' own by-date records, and a wall
        // clock that says the session has actually finished. If the answer is
        // anything other than a confirmed closure, the symbols stay
        // 'unresolved' — loud — which is how an outage is supposed to behave.
        if (judged.suspectedClosure && g.calendar === 'tw') {
          const outcome = await confirmTwClosure(session);
          networkCalls += 2;
          report.closureChecks.push({ session, confirmed: outcome.confirmed, reason: outcome.reason });
          if (outcome.confirmed) {
            recordConfirmedClosure(session, outcome.evidence, { log: (m) => console.log(`[watchdog] ${m}`) });
            missing.forEach((s) => (verdicts[s] = 'market_closed'));
            report.discoveredClosures.push({ market: g.calendar, session, evidence: outcome.evidence });
          } else {
            console.log(
              `[watchdog]   suspected closure ${session} NOT confirmed (${outcome.reason}) — ` +
                'treating as an outage, not a holiday'
            );
          }
        } else if (judged.suspectedClosure) {
          // Non-TW calendars have no by-date evidence path here; a human confirms.
          console.log(`[watchdog]   suspected ${g.label} closure ${session} — left unresolved for a human`);
        }

        const unresolvedSyms = Object.keys(verdicts).filter((s) => verdicts[s] === 'unresolved');
        if (unresolvedSyms.length) report.unresolved.push({ market, label: g.label, session, symbols: unresolvedSyms });
        marketReport.sessions[session].verdicts = verdicts;
      }

      // Persist a DETERMINISTIC coverage record for the latest session (verdicts
      // folded in). No per-run timestamp is added, so an unchanged state produces
      // byte-identical output → no git diff → no commit churn on healthy polls.
      //
      // This runs even when nothing was missing. It used to sit behind an early
      // `continue` that skipped complete sessions, so a market that was healthy
      // all along never got a record at all and the UI showed it as "—" —
      // indistinguishable from "never checked" (issue #2). That is the mirror
      // image of "presence is not completeness": absence of a record must not be
      // the only evidence of health.
      if (isLatest) {
        const unresolvedSyms = Object.keys(verdicts).filter((s) => verdicts[s] === 'unresolved');
        const resolved = Object.fromEntries(Object.entries(verdicts).filter(([, v]) => v !== 'unresolved'));
        const record = buildCoverage({ market, sessionDate: session, expected: g.symbols, present, verdicts: resolved });
        record.health = unresolvedSyms.length ? 'gap' : missing.length ? 'resolved-empty' : 'healthy';
        persistCoverage(market, record);
      }
    }
    report.markets[market] = marketReport;
  }

  // ---- Phase F: sanity checks beyond presence (data can exist and still be wrong) ----
  const covNow = readJson('status.json', {}).coverage || {};
  const drift = crossMarketDrift(covNow.tw?.sessionDate, covNow.us?.sessionDate);
  if (drift) report.anomalies = [...(report.anomalies || []), { type: 'cross_market_drift', ...drift }];
  for (const [market, g] of Object.entries(GROUPS)) {
    if (!g.symbols.length || !g.fetchRows) continue; // tpex can't be re-verified per-symbol
    const session = covNow[market]?.sessionDate;
    if (!session) continue;
    const prev = previousTradingDate(session, g.calendar, holidays);
    const scan = scanSanity(g.store, g.symbols, session, prev);
    const suspects = [...new Set([...scan.lowVolume, ...scan.repeatedSnapshot])];
    // Re-verify suspects against the source (mid-session captures resolve to the
    // official close once re-fetched after close); heal only if the value changed.
    for (const s of suspects) {
      try {
        const rows = await g.fetchRows(s, session);
        networkCalls += 1;
        const rec = rows.find((r) => r.date === session && r.c !== undefined);
        const cur = presentForSession(new Map(), g.store, session, [s]).length
          ? readMonthFile(g.store, isoYear(session), isoMonth(session))[s][session]
          : null;
        if (rec && cur && (cur.v !== rec.v || cur.c !== rec.c)) {
          upsertRecords(g.store, [rec], { pretty: false });
          report.healed.push({ market, session, symbols: [s], reason: 'sanity-reverify' });
        }
      } catch (err) {
        console.error(`[watchdog] sanity re-verify ${market} ${s} FAILED: ${err.message}`);
      }
      await sleep(300);
    }
    if (scan.lowVolume.length || scan.repeatedSnapshot.length || drift) {
      const anomalies = { lowVolume: scan.lowVolume, repeatedSnapshot: scan.repeatedSnapshot, ...(drift ? { drift } : {}) };
      report.anomalies = [...(report.anomalies || []), { market, session, ...anomalies }];
      persistCoverage(market, { ...covNow[market], anomalies });
    }
  }

  // ---- Escalation: a run of unexplained sessions is an outage, not a calendar ----
  //
  // One missing session can be a slow source. Two consecutive ones cannot
  // plausibly both be surprise closures — a real typhoon day is announced, and
  // never twice running without anyone noticing. So a streak escalates even
  // when every individual session looks "resolved", which is the failure this
  // whole change exists to prevent.
  for (const [market, g] of Object.entries(GROUPS)) {
    if (!g.symbols.length || g.calendar !== 'tw') continue;
    const recent = judgeableSessions(g, { lookback: 3, holidays });
    const bad = unexplainedSessions(recent, (s) =>
      presentForSession(new Map(), g.store, s, g.symbols).length === g.symbols.length
    );
    // Consecutive from the newest end only.
    let streak = 0;
    for (const s of [...recent].reverse()) {
      if (bad.includes(s)) streak += 1;
      else break;
    }
    if (streak >= 2) {
      const sessions = [...recent].reverse().slice(0, streak);
      report.escalations.push({ market, label: g.label, streak, sessions });
      console.log(`[watchdog]   ESCALATE ${g.label}: ${streak} consecutive unexplained sessions — ${sessions.join(', ')}`);
    }
  }

  if (networkCalls > 0 || report.healed.length || report.discoveredClosures.length) regenerateManifest();
  // Report goes to the repo root (NOT public/data), so it is never committed/deployed — it is a run artifact.
  fs.writeFileSync(
    path.join(process.cwd(), 'watchdog-report.json'),
    `${JSON.stringify({ ...report, generatedAt: new Date().toISOString(), networkCalls }, null, 2)}\n`
  );

  const totalUnresolved = report.unresolved.reduce((n, r) => n + r.symbols.length, 0);
  const rev = report.closureReview || {};
  console.log(
    `[watchdog] mode=${report.mode} networkCalls=${networkCalls} healed=${report.healed.length} ` +
      `discoveredClosures=${report.discoveredClosures.length} revokedClosures=${(rev.revoked || []).length} ` +
      `escalations=${report.escalations.length} unresolved=${totalUnresolved}`
  );
  for (const u of report.unresolved) console.log(`[watchdog]   UNRESOLVED ${u.label} ${u.session}: ${u.symbols.join(', ')}`);

  // Escalate a streak even if every symbol carries a verdict: "everything is
  // resolved" was precisely the state the system reported while two sessions
  // were missing.
  if (totalUnresolved > 0 || report.escalations.length) process.exitCode = 1;
}

/**
 * Merges the watchdog's verdict fields onto the existing coverage record,
 * preserving the fetch pipeline's lastSuccessfulWrite so a healthy poll doesn't
 * churn the timestamp (and therefore doesn't produce a needless commit).
 */
function persistCoverage(market, record) {
  const existing = readJson('status.json', {}).coverage?.[market] || {};
  writeCoverage(market, { ...existing, ...record, lastSuccessfulWrite: existing.lastSuccessfulWrite || record.lastSuccessfulWrite });
}

main().catch((err) => {
  console.error('[watchdog] FAILED:', err);
  process.exitCode = 1;
});
