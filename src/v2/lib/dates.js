import { isTradingDay } from '../../lib/marketCalendar.js';

/** 台北時區的今天(沿用 v1 慣例:日期判定一律 Asia/Taipei)。 */
export function taipeiTodayIso() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const m = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${m.year}-${m.month}-${m.day}`;
}

export function isValidIsoDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

function addDaysIso(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function prevDayIso(iso) { return addDaysIso(iso, -1); }
export function nextDayIso(iso) { return addDaysIso(iso, 1); }

/**
 * T+2 交割日:自交易日起往後找第 2 個台股交易日
 * (重用 v1 marketCalendar 的假日/週末判定)。
 */
export function settlementDateIso(tradeIso) {
  let d = tradeIso;
  let found = 0;
  for (let i = 0; i < 15 && found < 2; i += 1) {
    d = addDaysIso(d, 1);
    if (isTradingDay('tw', d)) found += 1;
  }
  return d;
}

/** 民國顯示,例:2026-07-27 → 民國115年7月27日(週一) */
export function fullDateLabel(iso, { roc = false } = {}) {
  const [y, m, d] = iso.split('-').map(Number);
  const weekday = ['日', '一', '二', '三', '四', '五', '六'][new Date(`${iso}T00:00:00`).getDay()];
  if (roc) return `民國${y - 1911}年${m}月${d}日(週${weekday})`;
  return `${y}年${m}月${d}日(週${weekday})`;
}
