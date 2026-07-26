/**
 * 設定頁(殼)。今晚僅:資金水位輸入(草稿層)、dryRun 狀態、payload 紀錄檢視。
 */
import { DRY_RUN } from '../lib/dryRun.js';
import { getCapital, setCapital, payloadLog } from '../lib/draftStore.js';
import { escapeHtml } from '../../lib/format.js';

export function renderSettingsPage(el) {
  const capital = getCapital();
  el.innerHTML = `
    <h2 class="v2-page-title">設定</h2>

    <section class="v2-card">
      <h3 class="v2-card-title">資金水位</h3>
      <p class="v2-hint">交易計畫(S2)會以此為「所需資金 vs 資金水位」的比較基準(該處唯讀)。</p>
      <div class="v2-field-row">
        <label class="v2-field">
          <span>可動用資金(元)</span>
          <input type="number" id="v2-capital" class="num" min="0" step="1000"
            value="${capital ?? ''}" placeholder="尚未設定" />
        </label>
        <button type="button" class="v2-btn v2-btn-primary" id="v2-capital-save">儲存</button>
      </div>
    </section>

    <section class="v2-card">
      <h3 class="v2-card-title">草稿模式(dryRun)</h3>
      <p class="v2-num-key">${DRY_RUN ? '開啟 — 僅記憶體草稿' : '關閉 — 真實寫入'}</p>
      <p class="v2-hint">開關位置:<code>src/v2/lib/dryRun.js</code>。開啟時所有儲存/定案/成交確認
      只進記憶體並完整記錄 payload;重新整理頁面會清空草稿。</p>
      <details>
        <summary>動作紀錄(${payloadLog.length} 筆)</summary>
        <pre class="v2-log">${escapeHtml(payloadLog.map((e) => `${e.ts} ${e.action} ${JSON.stringify(e.payload)}`).join('\n')) || '尚無動作。開始建立今日清單即會出現紀錄。'}</pre>
      </details>
    </section>
  `;

  el.querySelector('#v2-capital-save').addEventListener('click', () => {
    const v = Number(el.querySelector('#v2-capital').value);
    if (Number.isFinite(v) && v >= 0) setCapital(v);
  });
}
