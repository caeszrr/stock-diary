/**
 * S7 結算:從今日「已確認成交」(草稿層)機械計算含費損益,逐筆列費用明細。
 * 計算規則見 src/v2/lib/settle.js 檔頭(同樣印在卡片上)。
 */
import { plansForDate } from '../../lib/draftStore.js';
import { settleDay } from '../../lib/settle.js';
import { fmtNum, escapeHtml } from '../../../lib/format.js';
import { aiSlotHtml } from '../../components/aiSlot.js';

function pnlClass(v) { return v > 0 ? 'v2-up' : (v < 0 ? 'v2-down' : 'v2-flat'); }
function signed(v) { return `${v > 0 ? '+' : ''}${fmtNum(v)}`; }

export function renderS7Settle(el, ctx) {
  const { date } = ctx;
  const fills = plansForDate(date)
    .filter((p) => p.status === 'filled')
    .map((p) => ({ symbol: p.symbol, name: p.name, direction: p.direction, price: p.fill.price, qty: p.fill.qty, ts: p.fill.ts }));

  if (!fills.length) {
    el.innerHTML = `
      <div class="v2-card">
        <h3 class="v2-card-title">S7 結算</h3>
        <p class="v2-empty">今日尚無已確認成交 — 在 S4 回報成交後,這裡會機械計算含費損益。</p>
      </div>`;
    return;
  }

  const r = settleDay(fills);

  const feeRows = r.rows.map((f) => `
    <tr>
      <td>${escapeHtml(f.symbol)} ${escapeHtml(f.name || '')}</td>
      <td>${f.direction === 'buy' ? '買' : '賣'}</td>
      <td>${fmtNum(f.price)}</td>
      <td>${fmtNum(f.qty)}</td>
      <td>${fmtNum(f.amount)}</td>
      <td>${fmtNum(f.fee)}</td>
      <td>${f.direction === 'sell' ? `${fmtNum(f.tax)}${f.dayTradeTax ? '(當沖 0.15%)' : '(0.3%)'}` : '0'}</td>
    </tr>`).join('');

  const matchRows = r.matches.map((m) => `
    <tr>
      <td>${escapeHtml(m.symbol)} ${escapeHtml(m.name || '')}</td>
      <td>${fmtNum(m.qty)}</td>
      <td>${m.buyPrice === null ? '—' : fmtNum(m.buyPrice)}</td>
      <td>${m.sellPrice === null ? '—' : fmtNum(m.sellPrice)}</td>
      <td class="${m.gross === null ? '' : pnlClass(m.gross)}">${m.gross === null
    ? (m.oneSided === 'buy' ? '單邊買進(未平倉)' : '單邊賣出(既有持股)')
    : signed(m.gross)}</td>
    </tr>`).join('');

  el.innerHTML = `
    <div class="v2-card">
      <h3 class="v2-card-title">S7 結算</h3>
      <div class="v2-num-lg num ${pnlClass(r.net)}">${signed(r.net)} 元</div>
      <p class="v2-hint num">= 已配對毛損益 ${signed(r.grossMatched)} − 費用合計 ${fmtNum(r.totalFees)}(含單邊費用,從嚴)</p>

      <h4 class="v2-card-title">逐筆費用明細</h4>
      <div class="v2-table-wrap"><table class="v2-table">
        <thead><tr><th>股票</th><th>方向</th><th>成交價</th><th>股數</th><th>價金</th><th>手續費</th><th>證交稅</th></tr></thead>
        <tbody>${feeRows}</tbody>
      </table></div>

      <h4 class="v2-card-title" style="margin-top: var(--sp-4);">損益配對(FIFO)</h4>
      <div class="v2-table-wrap"><table class="v2-table">
        <thead><tr><th>股票</th><th>股數</th><th>買價</th><th>賣價</th><th>毛損益</th></tr></thead>
        <tbody>${matchRows}</tbody>
      </table></div>

      <p class="v2-hint">規則:同日同檔有買有賣的賣出以當沖稅 0.15% 計,其餘賣出 0.3%;
      手續費 0.1353% 雙邊各自無條件捨去。單邊(未平倉)不計損益、只列費用 — 不捏造。</p>
      ${aiSlotHtml('結算觀點')}
    </div>`;
}
