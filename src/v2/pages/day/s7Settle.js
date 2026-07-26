/** S7 結算(M8 實作)。 */
export function renderS7Settle(el, ctx) {
  el.innerHTML = `
    <div class="v2-card">
      <h3 class="v2-card-title">S7 結算</h3>
      <p class="v2-empty">今日已確認成交會在這裡機械計算含費損益,逐筆列費用明細。(M8 建置中)</p>
    </div>`;
}
