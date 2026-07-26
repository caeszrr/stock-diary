/**
 * S3 盯盤:每筆計畫一條距離條(現價距進場價 %),
 * 門檻預設 2%、每筆可調;達門檻或觸價 → 頁內醒目警示 + 警報引擎(alerts.js)。
 * 「現價」= 最近收盤(EOD 資料;開盤前/休市無跳動屬正常)。
 */
import { plansForDate, setPlanThreshold } from '../../lib/draftStore.js';
import { evaluatePlan, checkAlerts } from '../../lib/alerts.js';
import { fmtNum, escapeHtml } from '../../../lib/format.js';
import { aiSlotHtml } from '../../components/aiSlot.js';

function distBarHtml(ev, thresholdPct) {
  // 距離條:距離 0% = 滿條;門檻的 5 倍距離以上 = 空條。接近(≤門檻)轉紅。
  const range = Math.max(thresholdPct * 5, 1);
  const width = Math.max(0, Math.min(100, (1 - Math.abs(ev.pct) / range) * 100));
  return `
    <div class="v2-distbar" title="距進場價 ${ev.pct.toFixed(2)}%">
      <div class="v2-distbar-fill ${ev.near || ev.touched ? 'v2-distbar-near' : ''}" style="width:${width.toFixed(0)}%;"></div>
    </div>`;
}

function watchCardHtml(p, ev, readonly, loading) {
  const statusTag = ev
    ? (ev.touched
      ? '<span class="v2-chain-tag" style="border-color:var(--up); color:var(--up);">🔔 已觸價</span>'
      : (ev.near ? '<span class="v2-chain-tag" style="border-color:var(--up); color:var(--up);">⚠ 接近門檻</span>' : ''))
    : '';
  return `
    <div class="v2-card" style="margin-bottom: var(--sp-3);">
      <div class="v2-card-head">
        <h4 class="v2-card-title" style="margin:0;">
          ${p.direction === 'buy' ? '買進' : '賣出'} ${escapeHtml(p.symbol)} ${escapeHtml(p.name || '')} ${statusTag}
        </h4>
      </div>
      ${ev ? `
        <div class="v2-num-key num ${ev.pct > 0 ? 'v2-up' : (ev.pct < 0 ? 'v2-down' : 'v2-flat')}">
          距進場 ${ev.pct > 0 ? '+' : ''}${ev.pct.toFixed(2)}%
          <span style="font-size: var(--fs-base); color: var(--text-dim);">(最近收盤 ${fmtNum(ev.price)}・${ev.priceDate},進場 ${fmtNum(p.entry)})</span>
        </div>
        ${distBarHtml(ev, p.thresholdPct)}`
    : `<p class="v2-hint">${loading ? '報價載入中…' : '最近收盤:尚無資料 — 無法計算距離(絕不以捏造值代替)。'}</p>`}
      <div class="v2-field-row" style="align-items:center;">
        <label class="v2-field" style="flex:0 0 160px;">
          <span>接近門檻(%)</span>
          <input type="number" min="0.1" step="0.1" value="${p.thresholdPct}"
            data-threshold="${p.id}" ${readonly ? 'disabled' : ''} />
        </label>
      </div>
    </div>`;
}

export function renderS3Watch(el, ctx) {
  const { date, readonly, quotes } = ctx;
  const plans = plansForDate(date).filter((p) => p.status === 'planned');
  const triggered = checkAlerts(plans, quotes);

  const alertBanner = triggered.length
    ? `<div class="v2-alert-banner">🔔 ${triggered.map(({ plan, ev, kind }) =>
      `${escapeHtml(plan.symbol)} ${kind === 'touched' ? '已觸價' : '接近進場'}(距離 ${ev.pct.toFixed(2)}%)`).join('、')}
       — 打電話給營業員了嗎?</div>`
    : '';

  const cards = plans.length
    ? plans.map((p) => watchCardHtml(p, evaluatePlan(p, quotes[p.symbol]), readonly, ctx.quotesLoading)).join('')
    : '<p class="v2-empty">沒有等待中的計畫 — 在 S2 建立計畫後,這裡會顯示每筆的距離條與警示。</p>';

  el.innerHTML = `
    <div class="v2-card">
      <h3 class="v2-card-title">S3 盯盤</h3>
      ${alertBanner}
      ${cards}
      <p class="v2-hint">價格為最近收盤(EOD);開盤前與休市日無跳動屬正常。</p>
      ${aiSlotHtml('盯盤觀點')}
    </div>`;

  if (readonly) return;
  for (const input of el.querySelectorAll('[data-threshold]')) {
    input.addEventListener('change', () => {
      const v = Number(input.value);
      if (Number.isFinite(v) && v >= 0.1) setPlanThreshold(input.dataset.threshold, v);
    });
  }
}
