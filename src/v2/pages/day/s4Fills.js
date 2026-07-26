/**
 * S4 成交確認(營業員回電):「確認成交」輸入成交價/股數,或「未成交」+一句原因。
 * 全部 append 型 payload(dryRun 草稿層)。
 * S5 連環下一筆:成交確認完成的瞬間彈出「同股下一筆?」——
 * 一鍵建立同檔新計畫預填,方向預設反向可切換,chainParent 鏈結。
 */
import { plansForDate, confirmFill, markUnfilled } from '../../lib/draftStore.js';
import { fmtNum, escapeHtml } from '../../../lib/format.js';
import { aiSlotHtml } from '../../components/aiSlot.js';
import { setChainPrefill } from './chainPrefill.js';

function shortId(id) { return id ? id.slice(-4) : ''; }

function fillFormHtml(p) {
  return `
    <div class="hidden" data-fill-form="${p.id}" style="margin-top: var(--sp-3);">
      <div class="v2-field-row">
        <label class="v2-field"><span>成交價</span>
          <input type="number" min="0" step="0.01" inputmode="decimal" value="${p.entry}" data-fill-price="${p.id}" /></label>
        <label class="v2-field"><span>成交股數</span>
          <input type="number" min="1" step="1" inputmode="numeric" value="${p.qty}" data-fill-qty="${p.id}" /></label>
        <button type="button" class="v2-btn v2-btn-primary" data-fill-confirm="${p.id}">回報成交</button>
      </div>
    </div>
    <div class="hidden" data-nofill-form="${p.id}" style="margin-top: var(--sp-3);">
      <div class="v2-field-row">
        <label class="v2-field" style="flex:2;"><span>未成交原因(一句)</span>
          <input type="text" data-nofill-reason="${p.id}" placeholder="例:掛價沒到,收盤前撤單" /></label>
        <button type="button" class="v2-btn" data-nofill-confirm="${p.id}">確定未成交</button>
      </div>
    </div>`;
}

function planRowHtml(p, readonly) {
  const chainTag = p.chainParent ? `<span class="v2-chain-tag">🔗 接續 #${shortId(p.chainParent)}</span>` : '';
  const idTag = `<span class="v2-hint" style="margin:0;">#${shortId(p.id)}</span>`;
  if (p.status === 'filled') {
    return `
      <div class="v2-card" style="margin-bottom: var(--sp-3);">
        <div class="v2-card-head">
          <h4 class="v2-card-title" style="margin:0;">✅ ${p.direction === 'buy' ? '買進' : '賣出'} ${escapeHtml(p.symbol)} ${escapeHtml(p.name || '')} ${chainTag} ${idTag}</h4>
        </div>
        <div class="v2-num-key num">成交 ${fmtNum(p.fill.price)} × ${fmtNum(p.fill.qty)} 股</div>
      </div>`;
  }
  if (p.status === 'unfilled') {
    return `
      <div class="v2-card" style="margin-bottom: var(--sp-3);">
        <div class="v2-card-head">
          <h4 class="v2-card-title" style="margin:0;">▢ ${p.direction === 'buy' ? '買進' : '賣出'} ${escapeHtml(p.symbol)} ${escapeHtml(p.name || '')} — 未成交 ${idTag}</h4>
        </div>
        <p class="v2-hint">原因:${escapeHtml(p.unfilledReason || '—')}</p>
      </div>`;
  }
  return `
    <div class="v2-card" style="margin-bottom: var(--sp-3);">
      <div class="v2-card-head">
        <h4 class="v2-card-title" style="margin:0;">${p.direction === 'buy' ? '買進' : '賣出'} ${escapeHtml(p.symbol)} ${escapeHtml(p.name || '')} ${chainTag} ${idTag}</h4>
        ${readonly ? '' : `<button type="button" class="v2-btn v2-btn-more" data-s4-menu="${p.id}" title="更多動作">⋯</button>`}
      </div>
      <div class="v2-num-key num">計畫:${fmtNum(p.entry)} × ${fmtNum(p.qty)} 股</div>
      ${readonly ? '' : `
        <button type="button" class="v2-btn v2-btn-primary" data-fill-open="${p.id}">確認成交</button>
        <div class="hidden" data-s4-menu-body="${p.id}" style="display:inline-block;">
          <button type="button" class="v2-btn" data-nofill-open="${p.id}">未成交</button>
        </div>
        ${fillFormHtml(p)}`}
    </div>`;
}

/** S5:成交確認完成的瞬間彈出。dialog 掛 body,能活過頁面重繪。 */
function openChainDialog(plan) {
  document.getElementById('v2-chain-dialog')?.remove();
  const reversed = plan.direction === 'buy' ? 'sell' : 'buy';
  const dlg = document.createElement('dialog');
  dlg.id = 'v2-chain-dialog';
  dlg.className = 'v2-dialog v2-root';
  dlg.innerHTML = `
    <div class="v2-dialog-body">
      <h4 class="v2-dialog-title">🔗 同股下一筆?</h4>
      <p style="margin:0;">${escapeHtml(plan.symbol)} ${escapeHtml(plan.name || '')} 已成交
        ${fmtNum(plan.fill.price)} × ${fmtNum(plan.fill.qty)} 股。要接著建立下一筆嗎?</p>
      <label class="v2-field"><span>下一筆方向(預設反向)</span>
        <select id="v2-chain-direction">
          <option value="sell" ${reversed === 'sell' ? 'selected' : ''}>賣出</option>
          <option value="buy" ${reversed === 'buy' ? 'selected' : ''}>買進</option>
        </select></label>
      <div class="v2-dialog-actions">
        <button type="button" class="v2-btn" id="v2-chain-no">不用了</button>
        <button type="button" class="v2-btn v2-btn-primary" id="v2-chain-yes">建立下一筆(預填同股)</button>
      </div>
    </div>`;
  document.body.appendChild(dlg);
  dlg.showModal();
  dlg.querySelector('#v2-chain-no').addEventListener('click', () => { dlg.close(); dlg.remove(); });
  dlg.querySelector('#v2-chain-yes').addEventListener('click', () => {
    setChainPrefill({
      symbol: plan.symbol,
      name: plan.name,
      direction: dlg.querySelector('#v2-chain-direction').value,
      chainParent: plan.id,
    });
    dlg.close();
    dlg.remove();
    // 觸發 v2 路由重繪(hash 未變,僅重進 render),讓 S2 表單帶入預填
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    setTimeout(() => document.getElementById('v2-s2')?.scrollIntoView({ behavior: 'smooth' }), 100);
  });
}

export function renderS4Fills(el, ctx) {
  const { date, readonly } = ctx;
  const plans = plansForDate(date);

  const rows = plans.length
    ? plans.map((p) => planRowHtml(p, readonly)).join('')
    : '<p class="v2-empty">還沒有計畫可回報 — 營業員回電後,在這裡逐筆確認成交或註記未成交。</p>';

  el.innerHTML = `
    <div class="v2-card">
      <h3 class="v2-card-title">S4 成交確認 <span class="v2-hint" style="margin:0;">/ S5 連環下一筆</span></h3>
      ${rows}
      ${aiSlotHtml('回報觀點')}
    </div>`;

  if (readonly) return;

  for (const btn of el.querySelectorAll('[data-s4-menu]')) {
    btn.addEventListener('click', () => {
      el.querySelector(`[data-s4-menu-body="${btn.dataset.s4Menu}"]`)?.classList.toggle('hidden');
    });
  }
  for (const btn of el.querySelectorAll('[data-fill-open]')) {
    btn.addEventListener('click', () => {
      el.querySelector(`[data-fill-form="${btn.dataset.fillOpen}"]`)?.classList.toggle('hidden');
      el.querySelector(`[data-nofill-form="${btn.dataset.fillOpen}"]`)?.classList.add('hidden');
    });
  }
  for (const btn of el.querySelectorAll('[data-nofill-open]')) {
    btn.addEventListener('click', () => {
      el.querySelector(`[data-nofill-form="${btn.dataset.nofillOpen}"]`)?.classList.toggle('hidden');
      el.querySelector(`[data-fill-form="${btn.dataset.nofillOpen}"]`)?.classList.add('hidden');
    });
  }
  for (const btn of el.querySelectorAll('[data-fill-confirm]')) {
    btn.addEventListener('click', () => {
      const id = btn.dataset.fillConfirm;
      const price = Number(el.querySelector(`[data-fill-price="${id}"]`)?.value);
      const qty = Number(el.querySelector(`[data-fill-qty="${id}"]`)?.value);
      if (!(price > 0) || !(qty > 0)) return;
      confirmFill(id, { price, qty });
      // dispatch 已同步重繪頁面;此刻從草稿層取回最新狀態再彈 S5
      const filled = plansForDate(date).find((p) => p.id === id);
      if (filled?.status === 'filled') openChainDialog(filled);
    });
  }
  for (const btn of el.querySelectorAll('[data-nofill-confirm]')) {
    btn.addEventListener('click', () => {
      const id = btn.dataset.nofillConfirm;
      const reason = el.querySelector(`[data-nofill-reason="${id}"]`)?.value.trim();
      if (!reason) { el.querySelector(`[data-nofill-reason="${id}"]`)?.focus(); return; }
      markUnfilled(id, reason);
    });
  }
}
