// @vitest-environment jsdom
//
// What a blank cell is allowed to say.
//
// On 2026-08-04 and 2026-08-05 every 上市 cell rendered 休 — the app calmly
// telling real users in Taipei that the market had been shut on two days they
// had personally watched it trade. The calendar had been poisoned by the
// monitoring, and the UI repeated the claim without hesitation.
//
// The rule these tests hold in place: 休 requires a confirmed closure. Anything
// merely missing says 資料延遲中. Anything not yet owed says nothing at all.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const CONFIRMED_HOLIDAY = '2026-07-10'; // genuine, evidence-backed
const TRADING_DAY = '2026-08-05'; // the day falsely marked closed

vi.mock('../lib/marketCalendar.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    // A calendar holding ONLY the confirmed closure — which is exactly what
    // config/market-holidays.json's `tw` list now contains.
    isTradingDay: (cal, iso) => {
      const weekday = new Date(`${iso}T00:00:00Z`).getUTCDay();
      if (weekday === 0 || weekday === 6) return false;
      return iso !== CONFIRMED_HOLIDAY;
    },
  };
});

let renderCell;
beforeEach(async () => {
  vi.resetModules();
  ({ renderCell } = await import('./cell.js'));
});

/** Renders one cell and returns its innerHTML. */
function render(symbol, date, stateCtx, rec) {
  return renderCell(rec, { symbol, date, stateCtx }).innerHTML;
}

const ctxFor = (expectedSession, coverage = null) => ({
  calMarket: 'tw',
  covMarket: 'tw',
  coverage,
  expectedSession,
});

describe('blank cell states', () => {
  it('renders 休 for a CONFIRMED closure', () => {
    const html = render('2330', CONFIRMED_HOLIDAY, ctxFor('2026-08-05'), undefined);
    expect(html).toContain('休');
    expect(html).toContain('cell-holiday');
  });

  it('renders 資料延遲中 — NOT 休 — for an owed session that is simply missing', () => {
    // The 8/5 case: a real trading day, no data. Before this change the calendar
    // said "holiday" and this cell said 休.
    const html = render('2330', TRADING_DAY, ctxFor('2026-08-05'), undefined);
    expect(html).toContain('cell-pending');
    expect(html).toContain('資料延遲中');
    expect(html).not.toContain('休');
  });

  it('renders a silent dimmed cell for a session not yet owed', () => {
    // 8/6 while the expected session is still 8/5 — a future column in the grid.
    const html = render('2330', '2026-08-06', ctxFor('2026-08-05'), undefined);
    expect(html).toContain('cell-future');
    expect(html).not.toContain('休');
    expect(html).not.toContain('資料延遲中');
  });

  it('renders 無 when the source positively confirms the symbol did not trade', () => {
    const cov = { sessionDate: TRADING_DAY, resolved: { 2330: 'no_trade' } };
    const html = render('2330', TRADING_DAY, ctxFor('2026-08-05', cov), undefined);
    expect(html).toContain('cell-notrade');
    expect(html).toContain('無');
  });

  it('never says 休 for a weekday absent from the confirmed-closure list', () => {
    for (const d of ['2026-08-03', '2026-08-04', '2026-08-05']) {
      const html = render('2330', d, ctxFor('2026-08-05'), undefined);
      expect(html, `${d} must not render 休`).not.toContain('>休<');
    }
  });
});
