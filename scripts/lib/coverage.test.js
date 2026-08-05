// Regression tests for expectedSessionDate — the pipeline's answer to "which
// trading day should this run have produced?".
//
// On 2026-08-03 GitHub delivered the 07:10 UTC TW cron at 16:09 UTC, i.e. 00:09
// Taipei the NEXT day. The old implementation anchored on "today in Taipei or
// earlier", so it demanded a 2026-08-04 session that had not traded, declared
// all 67 上市 symbols missing, and failed the run. These pin the market-clock
// behaviour, including across a month rollover.

import { describe, it, expect } from 'vitest';
import { expectedSessionDate, recentTradingSessions } from './coverage.js';

const at = (iso) => new Date(iso);

describe('expectedSessionDate — TW', () => {
  it('expects today once the Taipei publish cutoff has passed (the 15:10 cron)', () => {
    // 07:10 UTC = 15:10 Taipei on Monday 2026-08-03.
    expect(expectedSessionDate('tw', { now: at('2026-08-03T07:10:00Z') })).toBe('2026-08-03');
  });

  it('still judges Monday when the cron is delivered after Taipei midnight', () => {
    // The actual 2026-08-03 failure: delivered 16:09 UTC = 00:09 Taipei Tue 08-04.
    expect(expectedSessionDate('tw', { now: at('2026-08-03T16:09:04Z') })).toBe('2026-08-03');
  });

  it('does not expect a session before that day has closed', () => {
    // 02:00 UTC = 10:00 Taipei Tuesday — mid-session, nothing published yet.
    expect(expectedSessionDate('tw', { now: at('2026-08-04T02:00:00Z') })).toBe('2026-08-03');
  });

  it('reaches back into the previous MONTH on the first trading day, before the close', () => {
    // 10:00 Taipei on Tue 2026-09-01: the expected session is still 2026-08-31.
    expect(expectedSessionDate('tw', { now: at('2026-09-01T02:00:00Z') })).toBe('2026-08-31');
  });

  it('rolls into the new month once the first session of that month publishes', () => {
    expect(expectedSessionDate('tw', { now: at('2026-09-01T07:10:00Z') })).toBe('2026-09-01');
  });

  it('reaches back over a weekend on the first calendar day of a month', () => {
    // Sat 2026-08-01 — the last session was Friday 2026-07-31.
    expect(expectedSessionDate('tw', { now: at('2026-08-01T07:10:00Z') })).toBe('2026-07-31');
  });

  it('skips a run of listed TWSE holidays', () => {
    // 2026-09-28 and the preceding Friday 2026-09-25 are both TWSE holidays,
    // so the expected session walks back to Thursday 2026-09-24.
    expect(expectedSessionDate('tw', { now: at('2026-09-28T07:10:00Z') })).toBe('2026-09-24');
  });

  it('treats tpex on the Taiwan calendar', () => {
    expect(expectedSessionDate('tpex', { now: at('2026-08-03T16:09:04Z') })).toBe('2026-08-03');
  });
});

describe('expectedSessionDate — US', () => {
  it('expects today once the New York cutoff has passed (the 22:30 UTC cron)', () => {
    // 22:30 UTC = 18:30 ET Tuesday 2026-08-04.
    expect(expectedSessionDate('us', { now: at('2026-08-04T22:30:00Z') })).toBe('2026-08-04');
  });

  it('still judges Tuesday from the watchdog pass that runs at 00:00 UTC Wednesday', () => {
    // The UTC date has rolled to 08-05 but it is only 20:00 ET on 08-04.
    // The old UTC-date anchor expected a 2026-08-05 session here.
    expect(expectedSessionDate('us', { now: at('2026-08-05T00:00:00Z') })).toBe('2026-08-04');
  });

  it('does not expect a session while the US market is still open', () => {
    // 14:00 UTC = 10:00 ET — mid-session.
    expect(expectedSessionDate('us', { now: at('2026-08-04T14:00:00Z') })).toBe('2026-08-03');
  });

  it('skips a listed US holiday (Labor Day 2026-09-07)', () => {
    expect(expectedSessionDate('us', { now: at('2026-09-07T22:30:00Z') })).toBe('2026-09-04');
  });
});

describe('expectedSessionDate — explicit override', () => {
  it('honours an explicit `today` (used by the watchdog and backfill)', () => {
    expect(expectedSessionDate('tw', { today: '2026-08-03' })).toBe('2026-08-03');
    expect(expectedSessionDate('tw', { today: '2026-08-02' })).toBe('2026-07-31');
  });
});

describe('recentTradingSessions', () => {
  it('walks back across a month boundary', () => {
    expect(recentTradingSessions('tw', 4, { today: '2026-08-03' })).toEqual([
      '2026-07-29',
      '2026-07-30',
      '2026-07-31',
      '2026-08-03',
    ]);
  });
});
