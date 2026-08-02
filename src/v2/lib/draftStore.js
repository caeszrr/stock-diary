/**
 * v2 草稿層(dryRun 核心)。
 *
 * 所有「儲存/定案/成交確認」動作一律經過 dispatch():
 *   1. 完整 payload 追加到 payloadLog(append-only,含時間戳與 dryRun 旗標)
 *   2. 套用到記憶體 state
 *   3. DRY_RUN === false 時才呼叫 v2store.persistAll() 真實寫入
 *
 * dryRun 模式下重新整理頁面會清空草稿(誠實揭露;見 DECISIONS.md D6)。
 */
import { DRY_RUN } from './dryRun.js';
import { loadPersisted, persistAll } from './v2store.js';

function emptyState() {
  return {
    // 每個交易日一份:{ symbols:[{code,name}], finalized:bool, unlockLog:[{ts,reason}] }
    lists: {},
    // planId -> 計畫(見 addPlan payload)
    plans: {},
    // 收盤小結:date -> { text, ts }
    summaries: {},
    // 金庫 lot 清單(append)
    vaultLots: [],
    // 設定(資金水位等)
    settings: { capital: null },
  };
}

let state = (!DRY_RUN && loadPersisted()) || emptyState();

/** append-only 動作紀錄(dryRun 證據;設定頁可檢視)。 */
export const payloadLog = [];

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function notify() { for (const fn of listeners) fn(); }

let seq = 0;
export function nextId(prefix) {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}`;
}

function dispatch(action, payload, apply) {
  payloadLog.push({ ts: new Date().toISOString(), action, dryRun: DRY_RUN, payload });
  console.info(`[v2 draft] ${action}`, payload);
  apply(state);
  if (!DRY_RUN) persistAll(state);
  notify();
}

export function getState() { return state; }

// ---------- S1 定案清單 ----------

export function getDayList(date) {
  return state.lists[date] || { symbols: [], finalized: false, unlockLog: [] };
}

export function addSymbolToList(date, { code, name }) {
  dispatch('list.addSymbol', { date, code, name }, (s) => {
    const list = s.lists[date] || (s.lists[date] = { symbols: [], finalized: false, unlockLog: [] });
    if (!list.symbols.some((t) => t.code === code)) list.symbols.push({ code, name });
  });
}

export function removeSymbolFromList(date, code) {
  dispatch('list.removeSymbol', { date, code }, (s) => {
    const list = s.lists[date];
    if (list) list.symbols = list.symbols.filter((t) => t.code !== code);
  });
}

export function finalizeList(date) {
  dispatch('list.finalize', { date }, (s) => {
    const list = s.lists[date] || (s.lists[date] = { symbols: [], finalized: false, unlockLog: [] });
    list.finalized = true;
  });
}

export function unlockList(date, reason) {
  dispatch('list.unlock', { date, reason }, (s) => {
    const list = s.lists[date];
    if (!list) return;
    list.finalized = false;
    list.unlockLog.push({ ts: new Date().toISOString(), reason });
  });
}

// ---------- S2 交易計畫 ----------

export function plansForDate(date) {
  return Object.values(state.plans).filter((p) => p.date === date);
}

export function addPlan(date, { symbol, name, direction, entry, stop, target, qty, dayTrade, chainParent = null }) {
  const id = nextId('plan');
  dispatch('plan.add', { id, date, symbol, name, direction, entry, stop, target, qty, dayTrade, chainParent }, (s) => {
    s.plans[id] = {
      id, date, symbol, name, direction, entry, stop, target, qty,
      dayTrade: !!dayTrade,
      thresholdPct: 2, // S3 接近門檻預設 2%,每筆可改
      chainParent,
      status: 'planned', // planned | filled | unfilled
      fill: null,
      unfilledReason: null,
    };
  });
  return id;
}

export function updatePlan(id, patch) {
  dispatch('plan.update', { id, patch }, (s) => {
    if (s.plans[id]) Object.assign(s.plans[id], patch);
  });
}

export function removePlan(id) {
  dispatch('plan.remove', { id }, (s) => { delete s.plans[id]; });
}

export function setPlanThreshold(id, thresholdPct) {
  dispatch('plan.setThreshold', { id, thresholdPct }, (s) => {
    if (s.plans[id]) s.plans[id].thresholdPct = thresholdPct;
  });
}

// ---------- S4 成交確認(append 型) ----------

export function confirmFill(id, { price, qty }) {
  dispatch('plan.confirmFill', { id, price, qty }, (s) => {
    const p = s.plans[id];
    if (!p) return;
    p.status = 'filled';
    p.fill = { price, qty, ts: new Date().toISOString() };
  });
}

export function markUnfilled(id, reason) {
  dispatch('plan.markUnfilled', { id, reason }, (s) => {
    const p = s.plans[id];
    if (!p) return;
    p.status = 'unfilled';
    p.unfilledReason = reason;
  });
}

// ---------- S6 收盤小結 ----------

export function setSummary(date, text) {
  dispatch('summary.set', { date, text }, (s) => {
    s.summaries[date] = { text, ts: new Date().toISOString() };
  });
}

export function getSummary(date) { return state.summaries[date] || null; }

// ---------- M9 金庫 ----------

export function addVaultLot({ code, name, qty, avgPrice, collateral, costUnloaded, keeper }) {
  const id = nextId('lot');
  dispatch('vault.addLot', { id, code, name, qty, avgPrice, collateral, costUnloaded, keeper }, (s) => {
    s.vaultLots.push({ id, code, name, qty, avgPrice, collateral, costUnloaded, keeper, ts: new Date().toISOString() });
  });
  return id;
}

export function removeVaultLot(id) {
  dispatch('vault.removeLot', { id }, (s) => {
    s.vaultLots = s.vaultLots.filter((l) => l.id !== id);
  });
}

export function getVaultLots() { return state.vaultLots; }

// ---------- 設定 ----------

export function setCapital(amount) {
  dispatch('settings.setCapital', { amount }, (s) => { s.settings.capital = amount; });
}

export function getCapital() { return state.settings.capital; }
