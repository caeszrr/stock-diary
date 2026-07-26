/**
 * S2 交易計畫:每檔手動輸入 進場/停損/目標/股數 → 即時顯示
 * 含費損益兩平、風報比(<1.5 硬閘)、所需資金 vs 資金水位(唯讀)、T+2 交割預覽。
 * 費用公式唯一來源:src/v2/lib/fees.js(測試鎖定)。
 */
import {
  getDayList, plansForDate, addPlan, removePlan, getCapital,
} from '../../lib/draftStore.js';
import {
  buyCost, sellProceeds, breakEvenSellPrice, breakEvenBuyBackPrice, riskReward,
} from '../../lib/fees.js';
import { settlementDateIso } from '../../lib/dates.js';
import { fmtNum, escapeHtml } from '../../../lib/format.js';
import { aiSlotHtml } from '../../components/aiSlot.js';
import { peekChainPrefill, takeChainPrefill } from './chainPrefill.js';

export const RR_GATE = 1.5;

function shortId(id) { return id ? id.slice(-4) : ''; }

/** 計畫卡(關鍵數字 + 一個主動作位置由各步驟決定;S2 卡的主動作 = 無,溢出選單 = 刪除)。 */
function planCardHtml(p, readonly) {
  const rr = riskReward(p);
  const be = p.direction === 'buy'
    ? breakEvenSellPrice(p.entry, { dayTrade: p.dayTrade })
    : breakEvenBuyBackPrice(p.entry, { dayTrade: p.dayTrade });
  const funds = p.direction === 'buy'
    ? buyCost(p.entry, p.qty).total
    : sellProceeds(p.entry, p.qty, { dayTrade: p.dayTrade }).total;
  return `
    <div class="v2-card" style="margin-bottom: var(--sp-3);">
      <div class="v2-card-head">
        <h4 class="v2-card-title" style="margin:0;">
          ${p.direction === 'buy' ? '買進' : '賣出'} ${escapeHtml(p.symbol)} ${escapeHtml(p.name || '')}
          ${p.dayTrade ? '<span class="v2-chain-tag">當沖</span>' : ''}
          ${p.chainParent ? `<span class="v2-chain-tag">🔗 連環・接續 #${shortId(p.chainParent)}</span>` : ''}
        </h4>
        ${readonly ? '' : `<button type="button" class="v2-btn v2-btn-more" data-plan-menu="${p.id}" title="更多動作">⋯</button>`}
      </div>
      <div class="v2-num-key num">進場 ${fmtNum(p.entry)}・停損 ${fmtNum(p.stop)}・目標 ${fmtNum(p.target)}・${fmtNum(p.qty)} 股</div>
      <div class="v2-hint num">
        風報比 ${rr === null ? '—' : rr.toFixed(2)}・損益兩平 ${fmtNum(be, { decimals: 2 })}・
        ${p.direction === 'buy' ? `所需資金 ${fmtNum(funds)} 元` : `預估淨入 ${fmtNum(funds)} 元`}
      </div>
      <div class="hidden" data-plan-menu-body="${p.id}" style="margin-top: var(--sp-2);">
        <button type="button" class="v2-btn v2-btn-danger" data-plan-remove="${p.id}">刪除計畫</button>
      </div>
    </div>`;
}

function previewHtml(vals, date) {
  const { direction, entry, stop, target, qty, dayTrade } = vals;
  const ready = entry > 0 && stop > 0 && target > 0 && qty > 0;
  if (!ready) return '<p class="v2-hint">輸入四個數字後,這裡會即時顯示費用與風險檢核。</p>';

  const rr = riskReward({ direction, entry, stop, target });
  const be = direction === 'buy'
    ? breakEvenSellPrice(entry, { dayTrade })
    : breakEvenBuyBackPrice(entry, { dayTrade });
  const cost = direction === 'buy' ? buyCost(entry, qty) : sellProceeds(entry, qty, { dayTrade });
  const capital = getCapital();
  const settle = settlementDateIso(date);

  let rrLine;
  let gateBlocked = false;
  if (rr === null) {
    rrLine = `<span class="v2-up">風報比無法計算 — 停損要放在虧損側、目標放在獲利側。</span>`;
    gateBlocked = true;
  } else if (rr < RR_GATE) {
    rrLine = `<span class="v2-up">風報比 ${rr.toFixed(2)} < ${RR_GATE} — 擋單:風險大於報酬,調整停損或目標後才能建立。</span>`;
    gateBlocked = true;
  } else {
    rrLine = `風報比 <b class="num">${rr.toFixed(2)}</b>(≥ ${RR_GATE} 通過)`;
  }

  const fundsLabel = direction === 'buy' ? '所需資金' : '預估淨入';
  const capLine = capital === null
    ? `資金水位:尚未設定(可到「設定」頁輸入,這裡唯讀)`
    : `資金水位:<b class="num">${fmtNum(capital)}</b> 元${direction === 'buy' && cost.total > capital ? ' <span class="v2-up">— 所需資金超過水位!</span>' : ''}`;

  return `
    <div class="v2-hint" style="font-size: var(--fs-base);">
      <div>${rrLine}</div>
      <div class="num">含費損益兩平:<b>${fmtNum(be, { decimals: 2 })}</b> 元
        (手續費 0.1353% 雙邊${dayTrade ? '、當沖賣稅 0.15%' : '、隔日賣稅 0.3%'})</div>
      <div class="num">${fundsLabel}:<b>${fmtNum(cost.total)}</b> 元
        (價金 ${fmtNum(cost.amount)} + 手續費 ${fmtNum(cost.fee)}${cost.tax ? ` − 稅 ${fmtNum(cost.tax)}` : ''})</div>
      <div>${capLine}</div>
      <div class="num">T+2 交割預覽:${settle} ${direction === 'buy' ? `應付 ${fmtNum(cost.total)}` : `應收 ${fmtNum(cost.total)}`} 元</div>
    </div>
    ${gateBlocked ? '' : ''}`;
}

function readForm(el) {
  return {
    symbol: el.querySelector('#v2-s2-symbol')?.value || '',
    direction: el.querySelector('#v2-s2-direction')?.value || 'buy',
    dayTrade: el.querySelector('#v2-s2-daytrade')?.checked || false,
    entry: Number(el.querySelector('#v2-s2-entry')?.value) || 0,
    stop: Number(el.querySelector('#v2-s2-stop')?.value) || 0,
    target: Number(el.querySelector('#v2-s2-target')?.value) || 0,
    qty: Number(el.querySelector('#v2-s2-qty')?.value) || 0,
  };
}

export function renderS2Plans(el, ctx) {
  const { date, readonly } = ctx;
  const list = getDayList(date);
  const plans = plansForDate(date);
  const prefill = peekChainPrefill();

  const plansHtml = plans.length
    ? plans.map((p) => planCardHtml(p, readonly)).join('')
    : `<p class="v2-empty">尚無交易計畫${list.finalized ? ' — 用下方表單建立第一筆。' : ' — 先在 S1 定案清單。'}</p>`;

  let formHtml = '';
  if (!readonly && list.finalized && list.symbols.length) {
    const options = list.symbols.map((t) => `<option value="${escapeHtml(t.code)}" ${prefill?.symbol === t.code ? 'selected' : ''}>${escapeHtml(t.code)} ${escapeHtml(t.name || '')}</option>`).join('');
    formHtml = `
      <div style="border-top: 1px solid var(--border); padding-top: var(--sp-4); margin-top: var(--sp-3);">
        <h4 class="v2-card-title">新計畫
          ${prefill ? `<span class="v2-chain-tag">🔗 連環・接續 #${shortId(prefill.chainParent)}</span>` : ''}
        </h4>
        <div class="v2-field-row">
          <label class="v2-field"><span>股票</span>
            <select id="v2-s2-symbol">${options}</select></label>
          <label class="v2-field"><span>方向</span>
            <select id="v2-s2-direction">
              <option value="buy" ${(!prefill || prefill.direction === 'buy') ? 'selected' : ''}>買進</option>
              <option value="sell" ${prefill?.direction === 'sell' ? 'selected' : ''}>賣出</option>
            </select></label>
          <label class="v2-field" style="flex:0 0 auto; flex-direction:row; align-items:center; gap:var(--sp-2); min-height:var(--tap);">
            <input type="checkbox" id="v2-s2-daytrade" style="width:24px; height:24px;" /><span>當沖</span>
          </label>
        </div>
        <div class="v2-field-row">
          <label class="v2-field"><span>進場價</span><input type="number" id="v2-s2-entry" min="0" step="0.01" inputmode="decimal" /></label>
          <label class="v2-field"><span>停損價</span><input type="number" id="v2-s2-stop" min="0" step="0.01" inputmode="decimal" /></label>
          <label class="v2-field"><span>目標價</span><input type="number" id="v2-s2-target" min="0" step="0.01" inputmode="decimal" /></label>
          <label class="v2-field"><span>股數</span><input type="number" id="v2-s2-qty" min="0" step="1" inputmode="numeric" /></label>
        </div>
        <div id="v2-s2-preview" style="margin: var(--sp-3) 0;"></div>
        <button type="button" class="v2-btn v2-btn-primary" id="v2-s2-create" disabled>建立計畫</button>
      </div>`;
  } else if (!readonly && !list.finalized) {
    formHtml = '';
  }

  el.innerHTML = `
    <div class="v2-card">
      <h3 class="v2-card-title">S2 交易計畫</h3>
      ${plansHtml}
      ${formHtml}
      ${aiSlotHtml('計畫觀點')}
    </div>`;

  // 計畫卡溢出選單
  for (const btn of el.querySelectorAll('[data-plan-menu]')) {
    btn.addEventListener('click', () => {
      el.querySelector(`[data-plan-menu-body="${btn.dataset.planMenu}"]`)?.classList.toggle('hidden');
    });
  }
  for (const btn of el.querySelectorAll('[data-plan-remove]')) {
    btn.addEventListener('click', () => removePlan(btn.dataset.planRemove));
  }

  const createBtn = el.querySelector('#v2-s2-create');
  if (!createBtn) return;

  const previewEl = el.querySelector('#v2-s2-preview');
  const update = () => {
    const vals = readForm(el);
    previewEl.innerHTML = previewHtml(vals, date);
    const rr = riskReward(vals);
    const valid = vals.symbol && vals.entry > 0 && vals.stop > 0 && vals.target > 0 && vals.qty > 0
      && rr !== null && rr >= RR_GATE;
    createBtn.disabled = !valid;
  };
  for (const id of ['symbol', 'direction', 'daytrade', 'entry', 'stop', 'target', 'qty']) {
    el.querySelector(`#v2-s2-${id}`)?.addEventListener('input', update);
  }
  update();

  createBtn.addEventListener('click', () => {
    const vals = readForm(el);
    const rr = riskReward(vals);
    if (rr === null || rr < RR_GATE) return; // 硬閘(按鈕已 disabled,雙保險)
    const t = list.symbols.find((s) => s.code === vals.symbol);
    const chain = takeChainPrefill();
    addPlan(date, {
      symbol: vals.symbol,
      name: t?.name || '',
      direction: vals.direction,
      entry: vals.entry,
      stop: vals.stop,
      target: vals.target,
      qty: vals.qty,
      dayTrade: vals.dayTrade,
      chainParent: chain?.symbol === vals.symbol ? chain.chainParent : null,
    });
  });
}
