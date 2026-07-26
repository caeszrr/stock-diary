/**
 * 金庫頁(M9):手動輸入 lot(代號/名稱/股數/均價/擔保品/成本未載/壓箱底)
 * + lot 清單 + 「拍照匯入(即將推出)」disabled 主要動作。dryRun 同樣適用。
 */
import { getVaultLots, addVaultLot, removeVaultLot } from '../lib/draftStore.js';
import { getTwSymbolInfo } from '../lib/quotes.js';
import { fmtNum, escapeHtml } from '../../lib/format.js';
import { aiSlotHtml } from '../components/aiSlot.js';

function flagTags(lot) {
  const tags = [];
  if (lot.collateral) tags.push('擔保品');
  if (lot.costUnloaded) tags.push('成本未載');
  if (lot.keeper) tags.push('壓箱底');
  return tags.map((t) => `<span class="v2-chain-tag">${t}</span>`).join(' ');
}

export function renderVaultPage(el) {
  const lots = getVaultLots();

  const listHtml = lots.length
    ? `<div class="v2-table-wrap"><table class="v2-table">
        <thead><tr><th>股票</th><th>股數</th><th>均價</th><th>市值(成本)</th><th>標記</th><th></th></tr></thead>
        <tbody>${lots.map((l) => `
          <tr>
            <td>${escapeHtml(l.code)} ${escapeHtml(l.name || '')}</td>
            <td>${fmtNum(l.qty)}</td>
            <td>${l.costUnloaded ? '—' : fmtNum(l.avgPrice)}</td>
            <td>${l.costUnloaded ? '成本未載' : fmtNum(Math.round(l.qty * l.avgPrice))}</td>
            <td>${flagTags(l)}</td>
            <td><button type="button" class="v2-btn v2-btn-danger" data-lot-remove="${l.id}">移除</button></td>
          </tr>`).join('')}
        </tbody>
      </table></div>`
    : '<p class="v2-empty">用拍照或手動輸入建立金庫。</p>';

  el.innerHTML = `
    <h2 class="v2-page-title">金庫</h2>

    <section class="v2-card">
      <div class="v2-card-head">
        <h3 class="v2-card-title">持股 lot 清單</h3>
        <button type="button" class="v2-btn v2-btn-primary" disabled title="即將推出">📷 拍照匯入(即將推出)</button>
      </div>
      ${listHtml}
    </section>

    <section class="v2-card">
      <h3 class="v2-card-title">手動輸入一筆 lot</h3>
      <div class="v2-field-row">
        <label class="v2-field"><span>代號</span>
          <input type="text" id="v2-vault-code" inputmode="numeric" placeholder="例:2330" /></label>
        <label class="v2-field"><span>名稱(輸入代號自動帶入,可改)</span>
          <input type="text" id="v2-vault-name" placeholder="自動帶入" /></label>
      </div>
      <div class="v2-field-row">
        <label class="v2-field"><span>股數</span>
          <input type="number" id="v2-vault-qty" min="1" step="1" inputmode="numeric" /></label>
        <label class="v2-field"><span>均價</span>
          <input type="number" id="v2-vault-price" min="0" step="0.01" inputmode="decimal" /></label>
      </div>
      <div class="v2-field-row" style="align-items:center;">
        <label class="v2-field" style="flex:0 0 auto; flex-direction:row; align-items:center; gap:var(--sp-2); min-height:var(--tap);">
          <input type="checkbox" id="v2-vault-collateral" style="width:24px;height:24px;" /><span>擔保品</span></label>
        <label class="v2-field" style="flex:0 0 auto; flex-direction:row; align-items:center; gap:var(--sp-2); min-height:var(--tap);">
          <input type="checkbox" id="v2-vault-costunloaded" style="width:24px;height:24px;" /><span>成本未載</span></label>
        <label class="v2-field" style="flex:0 0 auto; flex-direction:row; align-items:center; gap:var(--sp-2); min-height:var(--tap);">
          <input type="checkbox" id="v2-vault-keeper" style="width:24px;height:24px;" /><span>壓箱底</span></label>
      </div>
      <p class="v2-hint" id="v2-vault-msg"></p>
      <button type="button" class="v2-btn v2-btn-primary" id="v2-vault-add">加入金庫</button>
      ${aiSlotHtml('金庫觀點')}
    </section>
  `;

  for (const btn of el.querySelectorAll('[data-lot-remove]')) {
    btn.addEventListener('click', () => removeVaultLot(btn.dataset.lotRemove));
  }

  const codeInput = el.querySelector('#v2-vault-code');
  const nameInput = el.querySelector('#v2-vault-name');
  codeInput.addEventListener('change', async () => {
    const info = await getTwSymbolInfo(codeInput.value.trim().toUpperCase());
    if (info && !nameInput.value) nameInput.value = info.name || '';
  });

  el.querySelector('#v2-vault-add').addEventListener('click', () => {
    const msg = el.querySelector('#v2-vault-msg');
    const code = codeInput.value.trim().toUpperCase();
    const qty = Number(el.querySelector('#v2-vault-qty').value);
    const costUnloaded = el.querySelector('#v2-vault-costunloaded').checked;
    const avgPrice = Number(el.querySelector('#v2-vault-price').value);
    if (!code) { msg.textContent = '請輸入代號。'; return; }
    if (!(qty > 0)) { msg.textContent = '股數要大於 0。'; return; }
    if (!costUnloaded && !(avgPrice > 0)) { msg.textContent = '請輸入均價,或勾「成本未載」。'; return; }
    addVaultLot({
      code,
      name: nameInput.value.trim(),
      qty,
      avgPrice: costUnloaded ? 0 : avgPrice,
      collateral: el.querySelector('#v2-vault-collateral').checked,
      costUnloaded,
      keeper: el.querySelector('#v2-vault-keeper').checked,
    });
  });
}
