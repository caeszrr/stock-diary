/**
 * S5 連環下一筆 → S2 表單預填的頁內傳遞(非草稿動作,純 UI 狀態)。
 */
let prefill = null; // { symbol, name, direction, chainParent }

export function setChainPrefill(p) { prefill = p; }
export function takeChainPrefill() { const p = prefill; prefill = null; return p; }
export function peekChainPrefill() { return prefill; }
