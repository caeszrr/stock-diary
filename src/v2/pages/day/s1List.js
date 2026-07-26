/**
 * S1 定案清單:鍵入代號建今日清單 → 定案鎖定;解鎖需一句理由(留存草稿紀錄)。
 * 即時價卡重用 EOD 報價服務(quotes.js),一律標示「最近收盤」。
 */
import {
  getDayList, addSymbolToList, removeSymbolFromList, finalizeList, unlockList,
} from '../../lib/draftStore.js';
import { getTwSymbolInfo } from '../../lib/quotes.js';
import { localTimeLabel } from '../../lib/dates.js';
import { fmtNum, changePct, escapeHtml } from '../../../lib/format.js';
import { aiSlotHtml } from '../../components/aiSlot.js';

function pctClass(pct) {
  if (pct === undefined || pct === null) return 'v2-flat';
  return pct > 0 ? 'v2-up' : (pct < 0 ? 'v2-down' : 'v2-flat');
}

function quoteCardHtml(t, q) {
  if (!q) {
    return `<div class="v2-hint">最近收盤:尚無資料</div>`;
  }
  const pct = changePct(q.c, q.pc);
  const cls = pctClass(pct);
  const sign = pct !== undefined && pct > 0 ? '+' : '';
  return `
    <div class="v2-num-key ${cls}">${fmtNum(q.c)}
      <span style="font-size: var(--fs-base);">${pct !== undefined ? `${sign}${pct.toFixed(2)}%` : ''}</span>
    </div>
    <div class="v2-hint">最近收盤(${q.date})</div>`;
}

export function renderS1List(el, ctx) {
  const { date, readonly, quotes } = ctx;
  const list = getDayList(date);
  const dis = readonly ? 'disabled' : '';

  const itemsHtml = list.symbols.length
    ? list.symbols.map((t) => `
        <div class="v2-card" style="margin-bottom: var(--sp-3);">
          <div class="v2-card-head">
            <h4 class="v2-card-title" style="margin:0;">${escapeHtml(t.code)} ${escapeHtml(t.name || '')}</h4>
            ${list.finalized || readonly ? '' : `
              <button type="button" class="v2-btn v2-btn-more" data-menu="${escapeHtml(t.code)}" title="更多動作">⋯</button>`}
          </div>
          ${quoteCardHtml(t, quotes[t.code])}
          <div class="v2-hint hidden" data-menu-body="${escapeHtml(t.code)}">
            <button type="button" class="v2-btn v2-btn-danger" data-remove="${escapeHtml(t.code)}">自清單移除</button>
          </div>
        </div>`).join('')
    : `<p class="v2-empty">今日清單是空的 — 輸入股票代號,按「加入」建立今日要盯的清單。</p>`;

  el.innerHTML = `
    <div class="v2-card" id="v2-s1-card">
      <a id="v2-s1"></a>
      <div class="v2-card-head">
        <h3 class="v2-card-title">S1 定案清單
          ${list.finalized ? '<span class="v2-chain-tag">已定案 🔒</span>' : ''}
        </h3>
      </div>
      ${list.unlockLog.length ? `<p class="v2-hint">解鎖紀錄:${list.unlockLog.map((u) => `${localTimeLabel(u.ts)}「${escapeHtml(u.reason)}」`).join(';')}</p>` : ''}
      ${itemsHtml}
      ${readonly ? '' : (list.finalized ? `
        <div class="v2-field-row">
          <label class="v2-field" style="flex:2;">
            <span>解鎖理由(必填一句,會留存)</span>
            <input type="text" id="v2-s1-unlock-reason" placeholder="例:盤前新聞改變想法" />
          </label>
          <button type="button" class="v2-btn" id="v2-s1-unlock">解鎖修改</button>
        </div>` : `
        <div class="v2-field-row">
          <label class="v2-field">
            <span>股票代號(台股)</span>
            <input type="text" id="v2-s1-code" inputmode="numeric" placeholder="例:2330" ${dis} />
          </label>
          <button type="button" class="v2-btn" id="v2-s1-add" ${dis}>加入</button>
          <button type="button" class="v2-btn v2-btn-primary" id="v2-s1-finalize"
            ${dis || (list.symbols.length ? '' : 'disabled')}>定案</button>
        </div>
        <p class="v2-hint" id="v2-s1-msg"></p>`)}
      ${aiSlotHtml('清單觀點')}
    </div>`;

  if (readonly) return;

  // ⋯ 溢出選單(每卡一個)
  for (const btn of el.querySelectorAll('[data-menu]')) {
    btn.addEventListener('click', () => {
      el.querySelector(`[data-menu-body="${btn.dataset.menu}"]`)?.classList.toggle('hidden');
    });
  }
  for (const btn of el.querySelectorAll('[data-remove]')) {
    btn.addEventListener('click', () => removeSymbolFromList(date, btn.dataset.remove));
  }

  const addBtn = el.querySelector('#v2-s1-add');
  if (addBtn) {
    const codeInput = el.querySelector('#v2-s1-code');
    const msg = el.querySelector('#v2-s1-msg');
    const doAdd = async () => {
      const code = codeInput.value.trim().toUpperCase();
      if (!code) return;
      msg.textContent = '查詢中…';
      const info = await getTwSymbolInfo(code);
      if (!info) {
        msg.textContent = `找不到代號「${code}」— 請確認是台股代號(上市/上櫃)。`;
        return;
      }
      addSymbolToList(date, { code, name: info.name || '' });
    };
    addBtn.addEventListener('click', doAdd);
    codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAdd(); });
    el.querySelector('#v2-s1-finalize')?.addEventListener('click', () => finalizeList(date));
  }

  el.querySelector('#v2-s1-unlock')?.addEventListener('click', () => {
    const reason = el.querySelector('#v2-s1-unlock-reason').value.trim();
    if (!reason) {
      el.querySelector('#v2-s1-unlock-reason').focus();
      return;
    }
    unlockList(date, reason);
  });
}
