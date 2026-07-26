/**
 * 金庫頁(M9):手動輸入 lot + 清單 + 「拍照匯入(即將推出)」disabled 主要動作。
 */
export function renderVaultPage(el) {
  el.innerHTML = `
    <h2 class="v2-page-title">金庫</h2>
    <section class="v2-card">
      <p class="v2-empty">用拍照或手動輸入建立金庫。</p>
      <p class="v2-hint">(M9 建置中)</p>
    </section>
  `;
}
