/**
 * S6 收盤儀式:今日小結輸入(dryRun append)。
 */
import { getSummary, setSummary } from '../../lib/draftStore.js';
import { localTimeLabel } from '../../lib/dates.js';
import { escapeHtml } from '../../../lib/format.js';
import { aiSlotHtml } from '../../components/aiSlot.js';

export function renderS6Close(el, ctx) {
  const { date, readonly } = ctx;
  const summary = getSummary(date);

  el.innerHTML = `
    <div class="v2-card">
      <h3 class="v2-card-title">S6 收盤儀式</h3>
      ${summary ? `
        <div class="v2-card" style="margin-bottom: var(--sp-3);">
          <p style="margin:0; white-space: pre-wrap;">${escapeHtml(summary.text)}</p>
          <p class="v2-hint">寫於 ${localTimeLabel(summary.ts)}</p>
        </div>` : (readonly
    ? '<p class="v2-empty">這一天沒有留下小結。</p>'
    : '<p class="v2-empty">收盤了 — 用三五句話寫下今天:照計畫了嗎?哪裡走樣?明天要改什麼?</p>')}
      ${readonly ? '' : `
        <label class="v2-field">
          <span>${summary ? '修改小結(重存會蓋掉上面這則)' : '今日小結'}</span>
          <textarea id="v2-s6-text" rows="4">${summary ? escapeHtml(summary.text) : ''}</textarea>
        </label>
        <button type="button" class="v2-btn v2-btn-primary" id="v2-s6-save" style="margin-top: var(--sp-3);">儲存小結</button>`}
      ${aiSlotHtml('收盤觀點')}
    </div>`;

  if (readonly) return;
  el.querySelector('#v2-s6-save')?.addEventListener('click', () => {
    const text = el.querySelector('#v2-s6-text').value.trim();
    if (!text) { el.querySelector('#v2-s6-text').focus(); return; }
    setSummary(date, text);
  });
}
