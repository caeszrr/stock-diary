// Regression tests for the false-closure incident of 2026-08-04/05.
//
// Every case here corresponds to a step the old code actually took. If any of
// these go green-to-red, the system has regained the ability to invent a
// holiday out of its own outage.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { publishCutoffPassed } from './coverage.js';
import { judgeSession } from './sessionSweep.js';

describe('publishCutoffPassed — the wall-clock floor under every verdict', () => {
  const at = (iso) => new Date(iso);

  it('refuses a session that has not reached its close+publish cutoff', () => {
    // 2026-08-05 00:22 Taipei = 2026-08-04T16:22Z. This is the exact moment the
    // pipeline demanded a 2026-08-05 session and found nothing, because the
    // Taiwan market would not open for another 8.5 hours.
    expect(publishCutoffPassed('tw', '2026-08-05', at('2026-08-04T16:22:00Z'))).toBe(false);
  });

  it('still refuses during the session itself, before the close has published', () => {
    // 12:00 Taipei — market open, nothing settled yet.
    expect(publishCutoffPassed('tw', '2026-08-05', at('2026-08-05T04:00:00Z'))).toBe(false);
  });

  it('accepts once the cutoff has passed on the market clock', () => {
    // 15:10 Taipei, the scheduled fetch window.
    expect(publishCutoffPassed('tw', '2026-08-05', at('2026-08-05T07:10:00Z'))).toBe(true);
  });

  it('accepts any earlier date outright', () => {
    expect(publishCutoffPassed('tw', '2026-08-04', at('2026-08-05T04:00:00Z'))).toBe(true);
  });

  it('uses the market own clock, not UTC', () => {
    // 2026-08-05 21:00 UTC = 17:00 New York — US cutoff just reached, while in
    // Taipei it is already 2026-08-06 05:00.
    expect(publishCutoffPassed('us', '2026-08-05', at('2026-08-05T21:00:00Z'))).toBe(true);
    expect(publishCutoffPassed('us', '2026-08-05', at('2026-08-05T19:59:00Z'))).toBe(false);
  });
});

describe('judgeSession — may suspect a closure, may never declare one', () => {
  const group = { label: 'test', calendar: 'tw', store: 'tw', symbols: ['A', 'B'], fetchRows: () => [] };

  it('raises only a suspicion when the whole group is absent and sources answered empty', () => {
    const outcomes = new Map([['A', 'source-empty'], ['B', 'source-empty']]);
    const { verdicts, suspectedClosure } = judgeSession(group, { present: [], missing: ['A', 'B'], outcomes });

    expect(suspectedClosure).toBe(true);
    // Crucially NOT market_closed: unconfirmed means loud, not settled.
    expect(verdicts).toEqual({ A: 'unresolved', B: 'unresolved' });
    expect(Object.values(verdicts)).not.toContain('market_closed');
  });

  it('does not suspect a closure when any fetch errored — that is an outage', () => {
    const outcomes = new Map([['A', 'source-empty'], ['B', 'fetch-error']]);
    const { verdicts, suspectedClosure } = judgeSession(group, { present: [], missing: ['A', 'B'], outcomes });
    expect(suspectedClosure).toBe(false);
    expect(verdicts.B).toBe('unresolved');
  });

  it('does not suspect a closure when part of the market did trade', () => {
    const outcomes = new Map([['B', 'source-empty']]);
    const { suspectedClosure, verdicts } = judgeSession(group, { present: ['A'], missing: ['B'], outcomes });
    expect(suspectedClosure).toBe(false);
    expect(verdicts.B).toBe('no_trade'); // a single symbol not trading is a verdict, not a holiday
  });
});

describe('closure evidence — confirmation, contradiction, falsifiability', () => {
  let dir;
  let cwd;
  let mod;

  beforeEach(async () => {
    cwd = process.cwd();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'closure-'));
    fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'public', 'data', 'tw', '2026'), { recursive: true });
    process.chdir(dir);
    vi.resetModules();
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const writeCalendar = (json) =>
    fs.writeFileSync(path.join(dir, 'config', 'market-holidays.json'), JSON.stringify(json, null, 2));

  const loadWith = async (twse, tpex) => {
    vi.doMock('./twse.js', () => ({ fetchAllListedForDate: async () => twse, fetchTaiexHistoryDay: async () => null }));
    vi.doMock('./tpex.js', () => ({ fetchAllOtcForDate: async () => tpex }));
    return import('./closureEvidence.js');
  };

  const HEALTHY_EMPTY = { ok: true, empty: true, records: [], names: {} };
  const HAS_SESSION = { ok: true, empty: false, records: [{ symbol: 'X' }], names: {} };
  const UNREACHABLE = { ok: false, empty: false, records: [], names: {}, error: 'ETIMEDOUT' };

  it('confirms a closure when both exchanges answer healthy-and-empty after the cutoff', async () => {
    writeCalendar({ tw: [], us: [], twPlanned: [], twDiscovered: [] });
    mod = await loadWith(HEALTHY_EMPTY, HEALTHY_EMPTY);
    const r = await mod.confirmTwClosure('2026-07-10', { now: new Date('2026-07-13T00:00:00Z') });
    expect(r.confirmed).toBe(true);
    expect(r.reason).toBe('both-exchanges-healthy-and-empty');
  });

  it('REFUSES to confirm when a source is unreachable — an outage is not a holiday', async () => {
    writeCalendar({ tw: [], us: [], twPlanned: [], twDiscovered: [] });
    mod = await loadWith(UNREACHABLE, HEALTHY_EMPTY);
    const r = await mod.confirmTwClosure('2026-07-10', { now: new Date('2026-07-13T00:00:00Z') });
    expect(r.confirmed).toBe(false);
    expect(r.reason).toBe('source-unreachable');
  });

  it('REFUSES to confirm before the session has closed, however empty the sources are', async () => {
    writeCalendar({ tw: [], us: [], twPlanned: [], twDiscovered: [] });
    mod = await loadWith(HEALTHY_EMPTY, HEALTHY_EMPTY);
    // The 2026-08-04T16:26Z run that invented the 2026-08-05 holiday.
    const r = await mod.confirmTwClosure('2026-08-05', { now: new Date('2026-08-04T16:26:00Z') });
    expect(r.confirmed).toBe(false);
    expect(r.reason).toBe('session-not-closed-yet');
  });

  it('REFUSES to confirm when the exchange does have a session for that date', async () => {
    writeCalendar({ tw: [], us: [], twPlanned: [], twDiscovered: [] });
    mod = await loadWith(HAS_SESSION, HEALTHY_EMPTY);
    const r = await mod.confirmTwClosure('2026-08-05', { now: new Date('2026-08-06T08:00:00Z') });
    expect(r.confirmed).toBe(false);
    expect(r.reason).toBe('session-exists');
  });

  it('keeps unproven verdicts out of the rendered calendar, so they cannot show 休', async () => {
    writeCalendar({
      tw: ['2026-08-05'],
      us: [],
      twPlanned: [],
      twDiscovered: ['2026-08-05'], // legacy bare string: no evidence
    });
    mod = await loadWith(UNREACHABLE, UNREACHABLE);
    const file = mod.loadClosureFile();
    expect(mod.confirmedTwClosures(file)).toEqual([]);
    expect(mod.rebuildTwCalendar(file).tw).toEqual([]);
  });

  it('auto-revokes a closure contradicted by stored data', async () => {
    writeCalendar({ tw: ['2026-08-05'], us: [], twPlanned: [], twDiscovered: ['2026-08-05'] });
    fs.writeFileSync(
      path.join(dir, 'public', 'data', 'tw', '2026', '08.json'),
      JSON.stringify({ 2330: { '2026-08-05': { c: 2405 } } })
    );
    mod = await loadWith(UNREACHABLE, UNREACHABLE);

    const contradicted = mod.contradictedClosures();
    expect(contradicted).toHaveLength(1);
    expect(contradicted[0].date).toBe('2026-08-05');

    const result = await mod.reviewClosures({ now: new Date('2026-08-06T08:00:00Z'), log: () => {} });
    expect(result.revoked.map((r) => r.date)).toContain('2026-08-05');
    expect(mod.loadClosureFile().tw).not.toContain('2026-08-05');
  });

  it('revokes an unproven verdict once a session turns out to exist', async () => {
    writeCalendar({ tw: ['2026-08-05'], us: [], twPlanned: [], twDiscovered: ['2026-08-05'] });
    mod = await loadWith(HAS_SESSION, HEALTHY_EMPTY);
    const result = await mod.reviewClosures({ now: new Date('2026-08-06T08:00:00Z'), log: () => {} });
    expect(result.revoked.map((r) => r.date)).toContain('2026-08-05');
  });

  it('leaves an unprovable verdict on file but out of the calendar', async () => {
    writeCalendar({ tw: ['2026-08-05'], us: [], twPlanned: [], twDiscovered: ['2026-08-05'] });
    mod = await loadWith(UNREACHABLE, UNREACHABLE);
    const result = await mod.reviewClosures({ now: new Date('2026-08-06T08:00:00Z'), log: () => {} });
    expect(result.stillUnproven.map((r) => r.date)).toContain('2026-08-05');
    expect(mod.loadClosureFile().tw).not.toContain('2026-08-05');
  });

  it('treats the official published calendar as evidence in its own right', async () => {
    writeCalendar({ tw: [], us: [], twPlanned: ['2026-10-10'], twDiscovered: [] });
    mod = await loadWith(UNREACHABLE, UNREACHABLE);
    const r = await mod.confirmTwClosure('2026-10-10', { now: new Date('2026-10-12T08:00:00Z'), json: mod.loadClosureFile() });
    expect(r.confirmed).toBe(true);
    expect(r.reason).toBe('official-calendar');
  });

  it('counts consecutive unexplained sessions for escalation', async () => {
    writeCalendar({ tw: [], us: [], twPlanned: [], twDiscovered: [] });
    mod = await loadWith(HEALTHY_EMPTY, HEALTHY_EMPTY);
    const sessions = ['2026-08-03', '2026-08-04', '2026-08-05'];
    const complete = (s) => s === '2026-08-03';
    expect(mod.unexplainedSessions(sessions, complete)).toEqual(['2026-08-05', '2026-08-04']);
  });
});
