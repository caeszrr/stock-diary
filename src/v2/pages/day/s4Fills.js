/** S4 成交確認 + S5 連環下一筆(M6/M7 實作)。 */
export function renderS4Fills(el, ctx) {
  el.innerHTML = `
    <div class="v2-card">
      <a id="v2-s4"></a>
      <h3 class="v2-card-title">S4 成交確認 <span class="v2-hint">/ S5 連環下一筆</span></h3>
      <p class="v2-empty">營業員回電後,在這裡逐筆確認成交或註記未成交。(M6 建置中)</p>
    </div>`;
}
