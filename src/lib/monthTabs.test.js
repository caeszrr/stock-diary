// @vitest-environment jsdom
//
// Regression tests for the 2026-08-03 month rollover, when the 8月 tab rendered
// greyed out and unclickable because no August data existed yet. These simulate
// the clock on the first calendar day and the first trading day of a new month
// so the next rollover (2026-09-01) is verified here, not in production.

import { describe, it, expect } from 'vitest';
import { renderTabs } from '../components/yearMonthTabs.js';
import { tabYears, enabledMonths, emptyMonthMessage, isCurrentMonth } from './monthTabs.js';

/** The manifest as it stood on the night of 2026-08-03: data through July only. */
const JULY_MANIFEST = {
  years: ['2026'],
  monthsByYear: { 2026: ['01', '02', '03', '04', '05', '06', '07'] },
};

function renderInto(manifest, todayIso, selectedMonth) {
  const el = document.createElement('div');
  renderTabs(el, {
    manifest,
    selectedYear: todayIso.slice(0, 4),
    selectedMonth,
    onSelectYear: () => {},
    onSelectMonth: () => {},
    todayIso,
  });
  const months = [...el.querySelectorAll('.month-btn')];
  return { el, months, month: (m) => months[m - 1] };
}

describe('month tab enablement — calendar ∪ data', () => {
  it('keeps the current month clickable on the first trading day of a new month, with no data for it', () => {
    // The exact production failure: Monday 2026-08-03, manifest still July-only.
    const { month } = renderInto(JULY_MANIFEST, '2026-08-03', '08');
    expect(month(8).disabled).toBe(false);
    expect(month(8).className).toContain('active');
    expect(month(8).className).not.toContain('disabled');
  });

  it('keeps the current month clickable on the first CALENDAR day of a new month (a Saturday)', () => {
    // 2026-08-01 is a Saturday — no trading has happened yet in August at all.
    const { month } = renderInto(JULY_MANIFEST, '2026-08-01', '08');
    expect(month(8).disabled).toBe(false);
  });

  // Superseded by the calendar-driven grid: a future month now renders its
  // scheduled trading days blank rather than nothing, so there is no longer any
  // reason to lock the user out of it. Every month of the current year opens.
  it('enables every month of the current year, including future ones', () => {
    const { month } = renderInto(JULY_MANIFEST, '2026-08-03', '08');
    for (let m = 1; m <= 12; m += 1) expect(month(m).disabled).toBe(false);
  });

  it('keeps months that DO have data clickable', () => {
    const { month } = renderInto(JULY_MANIFEST, '2026-08-03', '08');
    for (const m of [1, 2, 3, 4, 5, 6, 7]) expect(month(m).disabled).toBe(false);
  });

  it('renders a month the pipeline missed entirely rather than dropping it', () => {
    const gappy = { years: ['2026'], monthsByYear: { 2026: ['01', '02', '05'] } };
    expect(enabledMonths(gappy, '2026', '2026-05-20').has('03')).toBe(true);
    expect(enabledMonths(gappy, '2026', '2026-05-20').has('04')).toBe(true);
  });

  it('adds the current year to the year tabs at a year rollover', () => {
    // 2027-01-01: the manifest still only knows 2026.
    expect(tabYears(JULY_MANIFEST, '2027-01-01')).toEqual(['2026', '2027']);
    expect(enabledMonths(JULY_MANIFEST, '2027', '2027-01-01').has('01')).toBe(true);
    expect(isCurrentMonth('2027', '01', '2027-01-01')).toBe(true);
  });

  it('marks the current month/year so it is visually distinct', () => {
    const { el, month } = renderInto(JULY_MANIFEST, '2026-08-03', '08');
    expect(month(8).className).toContain('tab-current');
    expect(el.querySelector('.tabs-year .tab-current').textContent).toBe('2026年');
  });
});

describe('empty-month explanation (zh-TW)', () => {
  it('says the month has not started trading on the first calendar day when it is a weekend', () => {
    expect(emptyMonthMessage('2026', '08', '2026-08-01')).toBe('本月尚未開始交易');
  });

  it('says data arrives after today’s close on the first trading day', () => {
    expect(emptyMonthMessage('2026', '08', '2026-08-03')).toBe('本月尚無資料，今日收盤後更新');
  });

  it('says the market is closed at a weekend once the month has traded', () => {
    expect(emptyMonthMessage('2026', '08', '2026-08-08')).toBe('週末休市，本月尚無資料');
  });

  it('handles a TWSE holiday falling on the first calendar day of a month', () => {
    // 2026-09-28 is a listed TWSE holiday; check a month whose opening days are closed.
    expect(emptyMonthMessage('2026', '09', '2026-09-01')).toBe('本月尚無資料，今日收盤後更新');
  });

  it('labels a future month and a past month distinctly', () => {
    expect(emptyMonthMessage('2026', '12', '2026-08-03')).toBe('本月尚未開始交易');
    expect(emptyMonthMessage('2026', '03', '2026-08-03')).toBe('本月無資料');
  });
});
