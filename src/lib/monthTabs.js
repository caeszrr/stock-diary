// Which year/month tabs exist and which are clickable.
//
// The rule is **calendar ∪ data, never data alone**. The manifest is built by
// scanning public/data for month files, so before a month's first successful
// pipeline run it simply has no entry — and on 2026-08-03, the app's first ever
// month rollover, that made the 8月 tab render disabled. The user could not
// reach August at all, while the data watchdog reported green because the data
// it had was internally complete.
//
// So: the current month and the current year are always present and always
// clickable, data or not. An empty month is a normal state with an explanation,
// not a missing one.

import { isTradingDay } from './marketCalendar.js';

/**
 * Today's date in Asia/Taipei as "YYYY-MM-DD". This is a Taiwan-market app, so
 * "the current month" is Taipei's month — not the browser's local one, which
 * would flip a day early/late for a user abroad.
 */
export function taipeiTodayIso(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const m = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${m.year}-${m.month}-${m.day}`;
}

const mm = (n) => String(n).padStart(2, '0');

/** The year tabs to render: every year with data, ∪ the current year, ascending. */
export function tabYears(manifest, todayIso) {
  const years = new Set(manifest.years || []);
  years.add(todayIso.slice(0, 4));
  return [...years].sort();
}

/**
 * The clickable months for `year`, as a Set of "MM".
 *
 * Current year: ALL TWELVE, always. A future month is a perfectly meaningful
 * thing to open now that the grid is rendered from the calendar — it shows the
 * month's scheduled trading days, blank and dimmed, and answers "when does the
 * market next trade?" A disabled tab answers nothing, and the whole class of
 * month-rollover bugs lived in the gap between "has data" and "is reachable".
 *
 * Past years: the interior of the data range is filled in, so a month the
 * pipeline missed entirely still renders (empty) instead of vanishing.
 */
export function enabledMonths(manifest, year, todayIso) {
  const data = new Set((manifest.monthsByYear || {})[year] || []);
  const enabled = new Set(data);
  const curYear = todayIso.slice(0, 4);
  const nums = [...data].map(Number);

  if (year === curYear) {
    for (let m = 1; m <= 12; m += 1) enabled.add(mm(m));
  } else if (nums.length) {
    for (let m = Math.min(...nums); m <= Math.max(...nums); m += 1) enabled.add(mm(m));
  }
  return enabled;
}

/** True if `year`/`month` is the Taipei current month. Never disable this one. */
export function isCurrentMonth(year, month, todayIso) {
  return year === todayIso.slice(0, 4) && month === todayIso.slice(5, 7);
}

/**
 * The zh-TW explanation for a month that rendered with no rows, so an empty
 * month reads as a known state rather than a broken app. Returns null when the
 * month has data (caller renders the matrix instead).
 */
export function emptyMonthMessage(year, month, todayIso) {
  const prefix = `${year}-${month}`;
  const today = todayIso.slice(0, 7);

  if (prefix > today) return '本月尚未開始交易';
  if (prefix < today) return '本月無資料';

  // Current month: has any trading day actually happened yet this month?
  const day = Number(todayIso.slice(8, 10));
  let tradedThisMonth = false;
  for (let d = 1; d <= day; d += 1) {
    if (isTradingDay('tw', `${prefix}-${mm(d)}`)) {
      tradedThisMonth = true;
      break;
    }
  }
  if (!tradedThisMonth) return '本月尚未開始交易';
  if (!isTradingDay('tw', todayIso)) return '週末休市，本月尚無資料';
  return '本月尚無資料，今日收盤後更新';
}
