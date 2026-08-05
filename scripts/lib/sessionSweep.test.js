// Tests for the recent-session sweep: the posture that makes a fetch run
// correct regardless of WHEN it fires.
//
// The 2026-08-03 loss happened because the pipeline computed "today's session"
// from the clock and fetched exactly that. A run delivered 9h late past Taipei
// midnight therefore lost Monday entirely. These pin the two properties that
// prevent a repeat: the judged window is clock-independent within a day, and a
// settled verdict is never re-requested forever.

import { describe, it, expect } from 'vitest';
import { judgeableSessions, judgeSession, resolvedSymbols } from './sessionSweep.js';
import { buildGroups, GROUPS_FOR_FETCH } from './marketGroups.js';

const TW = { calendar: 'tw', store: 'tw', symbols: ['2330'], fetchRows: () => [] };
const US = { calendar: 'us', store: 'us', symbols: ['NVDA'], fetchRows: () => [] };

describe('judgeableSessions — the window a run judges', () => {
  it('covers the last N published sessions, crossing a month boundary', () => {
    // 2026-08-04 10:00 Taipei: 08-04 has not published, so the window ends 08-03.
    const s = judgeableSessions(TW, { lookback: 3, now: Date.parse('2026-08-04T02:00:00Z') });
    expect(s).toEqual(['2026-07-30', '2026-07-31', '2026-08-03']);
  });

  it('is the SAME window whether the run fires on time or 9 hours late', () => {
    // The exact 2026-08-03 pair: 07:10 UTC (15:10 Taipei, on time) vs 16:09 UTC
    // (00:09 Taipei the next day, as delivered). A clock-derived "today" gave
    // different answers here; the judged window must not.
    const onTime = judgeableSessions(TW, { lookback: 3, now: Date.parse('2026-08-03T07:10:00Z') });
    const late = judgeableSessions(TW, { lookback: 3, now: Date.parse('2026-08-03T16:09:04Z') });
    expect(late).toEqual(onTime);
    expect(late).toContain('2026-08-03');
  });

  it('never judges a session that has not published yet', () => {
    // Mid-session Tuesday: 08-04 must not appear, or every symbol reads "missing".
    const s = judgeableSessions(TW, { lookback: 3, now: Date.parse('2026-08-04T02:00:00Z') });
    expect(s).not.toContain('2026-08-04');
  });

  it('admits today as soon as it has published, so an on-time run sweeps it', () => {
    // 07:13 UTC = 15:13 Taipei, just past the publish cutoff. The session this
    // run exists to fetch must be inside the window it then verifies.
    const s = judgeableSessions(TW, { lookback: 3, now: Date.parse('2026-08-03T07:13:00Z') });
    expect(s[s.length - 1]).toBe('2026-08-03');
  });

  it('uses each market’s own calendar', () => {
    const tw = judgeableSessions(TW, { lookback: 2, now: Date.parse('2026-09-28T07:10:00Z') });
    const us = judgeableSessions(US, { lookback: 2, now: Date.parse('2026-09-28T22:30:00Z') });
    // 2026-09-28 and 09-25 are TWSE holidays; the US market traded on both.
    expect(tw).not.toContain('2026-09-25');
    expect(us).toContain('2026-09-25');
  });
});

describe('judgeSession — a confirmed no-trade is a verdict, not a failure', () => {
  const outcomes = (pairs) => new Map(Object.entries(pairs));

  it('marks a source-confirmed empty day no_trade, not unresolved', () => {
    const { verdicts, suspectedClosure } = judgeSession(TW, {
      present: ['A'],
      missing: ['B'],
      outcomes: outcomes({ B: 'source-empty' }),
    });
    expect(verdicts.B).toBe('no_trade');
    expect(suspectedClosure).toBe(false);
  });

  it('escalates a fetch error as unresolved', () => {
    const { verdicts } = judgeSession(TW, {
      present: ['A'],
      missing: ['B'],
      outcomes: outcomes({ B: 'fetch-error' }),
    });
    expect(verdicts.B).toBe('unresolved');
  });

  // This test used to assert that a whole-market source-confirmed absence WAS a
  // market closure, decided right here. That is the bug: this function cannot
  // tell "the market did not trade" from "the market has not traded yet", and
  // on 2026-08-03/04 it chose wrong twice and wrote both into the calendar. It
  // may now only raise a suspicion for lib/closureEvidence.js to prove.
  it('only SUSPECTS a closure on a whole-market source-confirmed absence', () => {
    const { verdicts, suspectedClosure } = judgeSession(TW, {
      present: [],
      missing: ['A', 'B'],
      outcomes: outcomes({ A: 'source-empty', B: 'source-empty' }),
    });
    expect(suspectedClosure).toBe(true);
    expect(verdicts.A).toBe('unresolved');
    expect(verdicts.A).not.toBe('market_closed');
  });

  it('does NOT even suspect a closure when a network error could explain the absence', () => {
    const { suspectedClosure } = judgeSession(TW, {
      present: [],
      missing: ['A', 'B'],
      outcomes: outcomes({ A: 'source-empty', B: 'fetch-error' }),
    });
    expect(suspectedClosure).toBe(false);
  });

  it('marks a group with no repair path no_history rather than unresolved', () => {
    const tpex = { ...TW, fetchRows: null };
    const { verdicts } = judgeSession(tpex, {
      present: [],
      missing: ['5347'],
      outcomes: outcomes({ 5347: 'no-repair-path' }),
    });
    expect(verdicts['5347']).toBe('no_history');
  });
});

describe('resolvedSymbols — settled cells are not re-requested forever', () => {
  it('collects every non-unresolved verdict', () => {
    const skip = resolvedSymbols({ resolved: { A: 'no_trade', B: 'suspended', C: 'unresolved' } });
    expect([...skip].sort()).toEqual(['A', 'B']);
  });

  it('is empty for a record with no verdicts', () => {
    expect(resolvedSymbols(undefined).size).toBe(0);
    expect(resolvedSymbols({ resolved: {} }).size).toBe(0);
  });
});

describe('marketGroups — the idx stores the watchdog used to ignore (issue #3)', () => {
  const groups = buildGroups([
    { symbol: '2330', market: 'twse' },
    { symbol: '5347', market: 'tpex' },
    { symbol: 'NVDA', market: 'us' },
    { symbol: 'TAIEX', market: 'index' },
    { symbol: 'SPX', market: 'index' },
  ]);

  it('monitors the idx store on both calendars', () => {
    expect(groups.idxTw.store).toBe('idx');
    expect(groups.idxTw.calendar).toBe('tw');
    expect(groups.idxTw.symbols).toEqual(['TAIEX']);
    expect(groups.idxUs.store).toBe('idx');
    expect(groups.idxUs.calendar).toBe('us');
    expect(groups.idxUs.symbols).toEqual(['SPX']);
  });

  it('splits TAIEX from the US indices so a Taiwan holiday does not fail them', () => {
    // One combined idx group would mark SPX missing every TWSE holiday.
    expect(groups.idxTw.symbols).not.toContain('SPX');
    expect(groups.idxUs.symbols).not.toContain('TAIEX');
  });

  it('gives TAIEX a repair path (it previously had none)', () => {
    expect(typeof groups.idxTw.fetchRows).toBe('function');
  });

  it('leaves tpex without one, as documented', () => {
    expect(groups.tpex.fetchRows).toBeNull();
  });

  it('assigns every group to exactly one fetch script', () => {
    const assigned = Object.values(GROUPS_FOR_FETCH).flat();
    expect(assigned.sort()).toEqual(Object.keys(groups).sort());
    expect(new Set(assigned).size).toBe(assigned.length);
  });
});
