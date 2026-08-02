/**
 * v2 唯一的 localStorage 存取模組(對應 v1 的 store.js 抽象精神:
 * 只有這個檔案碰 localStorage;key 與 v1 完全分離,整夜 dryRun 下不會被呼叫)。
 */
const KEY = 'stockDiaryV2';

export function loadPersisted() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.error('v2store: 讀取失敗,以空狀態啟動', err);
    return null;
  }
}

/** 真實寫入。只有 draftStore 在 DRY_RUN === false 時會呼叫。 */
export function persistAll(state) {
  localStorage.setItem(KEY, JSON.stringify(state));
}
