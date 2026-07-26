/**
 * 交易日頁:七步機械線(S1–S7)。M2 起逐步充實。
 */
import { fullDateLabel } from '../lib/dates.js';

export function renderDayPage(el, date) {
  el.innerHTML = `
    <h2 class="v2-page-title">交易日 — ${fullDateLabel(date)}</h2>
    <section class="v2-card">
      <p class="v2-empty">七步流程建置中(M2)。</p>
    </section>
  `;
}
