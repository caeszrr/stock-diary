/**
 * 交易日頁 — 七步機械線(S1–S7)協調器。
 * 由上而下照一天節奏排版;頂部:日期列 + 步驟進度指示。
 * 過去日期 = 整頁唯讀(DESIGN.md §7)。
 */
import { taipeiTodayIso, prevDayIso, nextDayIso, fullDateLabel } from '../lib/dates.js';
import { isoToRocLabel } from '../../lib/format.js';
import { getDayList, plansForDate, getSummary } from '../lib/draftStore.js';
import { latestQuotes } from '../lib/quotes.js';
import { renderS1List } from './day/s1List.js';
import { renderS2Plans } from './day/s2Plans.js';
import { renderS3Watch } from './day/s3Watch.js';
import { renderS4Fills } from './day/s4Fills.js';
import { renderS6Close } from './day/s6Close.js';
import { renderS7Settle } from './day/s7Settle.js';

const STEPS = [
  { n: 1, label: '定案清單' },
  { n: 2, label: '交易計畫' },
  { n: 3, label: '盯盤' },
  { n: 4, label: '成交確認' },
  { n: 5, label: '連環下一筆' },
  { n: 6, label: '收盤儀式' },
  { n: 7, label: '結算' },
];

function resolved(p) { return p.status === 'filled' || p.status === 'unfilled'; }

/** 每一步的完成判定(機械、可重算)。 */
function stepStates(date) {
  const list = getDayList(date);
  const plans = plansForDate(date);
  const done = {
    1: list.finalized,
    2: plans.length > 0,
    3: plans.length > 0, // 盯盤為持續狀態,建立計畫即啟動
    4: plans.length > 0 && plans.every(resolved),
    5: plans.length > 0 && plans.every(resolved), // 連環為 S4 完成時的即時提議
    6: !!getSummary(date),
    7: !!getSummary(date) && plans.length > 0 && plans.every(resolved),
  };
  let current = 7;
  for (const s of STEPS) { if (!done[s.n]) { current = s.n; break; } }
  return { done, current };
}

function stepsHtml(date) {
  const { done, current } = stepStates(date);
  // 注意:不能用 href="#…" 錨點 — 會改掉 #/v2 hash 而被接線判定為離開 v2。
  return `<nav class="v2-steps" aria-label="七步進度">${STEPS.map((s) => {
    const cls = done[s.n] ? 'v2-step-done' : (s.n === current ? 'v2-step-current' : '');
    const target = s.n === 5 ? 4 : s.n; // S5 是 S4 完成瞬間的彈窗,捲到 S4 卡
    return `<button type="button" class="v2-step ${cls}" data-step-scroll="v2-s${target}">S${s.n} ${s.label}</button>`;
  }).join('')}</nav>`;
}

function dateRowHtml(date, today) {
  const isToday = date === today;
  return `
    <div class="v2-card-head" style="margin-bottom: var(--sp-4);">
      <a class="v2-btn" href="#/v2/day/${prevDayIso(date)}" title="前一日">← 前一日</a>
      <div style="text-align:center;">
        <div class="v2-num-key">${fullDateLabel(date)}${isToday ? '(今天)' : ''}</div>
        <div class="v2-hint">${isoToRocLabel(date)}</div>
      </div>
      ${isToday
        ? '<span class="v2-btn" style="visibility:hidden;">後一日 →</span>'
        : `<a class="v2-btn" href="#/v2/day/${nextDayIso(date)}" title="後一日">後一日 →</a>`}
    </div>`;
}

export async function renderDayPage(el, date) {
  const today = taipeiTodayIso();
  const readonly = date < today;

  el.innerHTML = `
    <h2 class="v2-page-title">交易日</h2>
    ${dateRowHtml(date, today)}
    ${readonly ? '<div class="v2-readonly-banner">🔒 過去日期 — 整頁唯讀,僅供回顧,所有輸入已停用。</div>' : ''}
    ${stepsHtml(date)}
    <div id="v2-day-sections">
      <section id="v2-s1"></section>
      <section id="v2-s2"></section>
      <section id="v2-s3"></section>
      <section id="v2-s4"></section>
      <section id="v2-s6"></section>
      <section id="v2-s7"></section>
    </div>
  `;

  for (const btn of el.querySelectorAll('[data-step-scroll]')) {
    btn.addEventListener('click', () => {
      document.getElementById(btn.dataset.stepScroll)?.scrollIntoView({ behavior: 'smooth' });
    });
  }

  const ctx = { date, readonly, quotes: {}, el };

  // 同步先畫(報價欄位顯示載入中),報價回來後重畫相關步驟
  drawSections(ctx);

  const symbols = [...new Set([
    ...getDayList(date).symbols.map((t) => t.code),
    ...plansForDate(date).map((p) => p.symbol),
  ])];
  if (symbols.length) {
    ctx.quotes = await latestQuotes(symbols, date);
    if (el.querySelector('#v2-day-sections')) drawSections(ctx);
  }
}

function drawSections(ctx) {
  renderS1List(ctx.el.querySelector('#v2-s1'), ctx);
  renderS2Plans(ctx.el.querySelector('#v2-s2'), ctx);
  renderS3Watch(ctx.el.querySelector('#v2-s3'), ctx);
  renderS4Fills(ctx.el.querySelector('#v2-s4'), ctx);
  renderS6Close(ctx.el.querySelector('#v2-s6'), ctx);
  renderS7Settle(ctx.el.querySelector('#v2-s7'), ctx);
}
