/** S3 盯盤(M5 實作)。 */
export function renderS3Watch(el, ctx) {
  el.innerHTML = `
    <div class="v2-card">
      <a id="v2-s3"></a>
      <h3 class="v2-card-title">S3 盯盤</h3>
      <p class="v2-empty">建立交易計畫後,這裡會顯示每筆計畫的距離條與警示。(M5 建置中)</p>
    </div>`;
}
