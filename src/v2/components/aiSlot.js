/**
 * AiSlot — 推論區占位(DESIGN.md §5 擺放律)。
 * 預設隱藏的摺疊區塊,不接任何後端;禁 AI/LLM import(此檔零 import)。
 */
export function aiSlotHtml(title = '推論觀點') {
  return `
    <details class="v2-aislot">
      <summary>${title}(未啟用)</summary>
      <p class="v2-aislot-body">此區保留給未來的推論功能,目前未啟用、不連任何後端。</p>
    </details>`;
}
