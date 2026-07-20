// Public API for all user-generated data. Backed by store.js (localStorage today).
// Quote data (public/data/) and this module are entirely separate — nothing here
// is ever touched by a data refresh, and nothing in loadMonth.js ever writes here.

import { getState, update, saveNow, replaceAll, resetAll } from './store.js';

const BACKUP_APP_ID = 'stock-diary-backup';

function cellKey(symbol, date) {
  return `${symbol}|${date}`;
}

// ---- Cell notes (形態 / 筆記 / emphasis) ----

export function getCellNote(symbol, date) {
  return getState().cellNotes[cellKey(symbol, date)] || null;
}

export function setCellNote(symbol, date, { shape, note, emphasis }) {
  const key = cellKey(symbol, date);
  update((s) => {
    const isEmpty = !shape && !note && (!emphasis || emphasis === 'none');
    if (isEmpty) {
      delete s.cellNotes[key];
    } else {
      s.cellNotes[key] = { shape: shape || '', note: note || '', emphasis: emphasis || 'none' };
    }
  });
}

// ---- Per-stock profile (freeform, line breaks preserved) ----

export function getProfile(symbol) {
  return getState().profiles[symbol] || '';
}

export function setProfile(symbol, text) {
  update((s) => {
    if (!text) delete s.profiles[symbol];
    else s.profiles[symbol] = text;
  });
}

// ---- Per-day 大盤筆記 (macro/market note) ----

export function getMarketNote(date) {
  return getState().marketNotes[date] || '';
}

export function setMarketNote(date, text) {
  update((s) => {
    if (!text) delete s.marketNotes[date];
    else s.marketNotes[date] = text;
  });
}

// ---- Pinned reference dates ----

export function getPinnedDates() {
  return [...getState().pinnedDates].sort();
}

export function isPinned(date) {
  return getState().pinnedDates.includes(date);
}

export function togglePinnedDate(date) {
  update((s) => {
    const i = s.pinnedDates.indexOf(date);
    if (i === -1) s.pinnedDates.push(date);
    else s.pinnedDates.splice(i, 1);
  });
}

// ---- Hidden preloaded tickers (full mode: hide, never delete) ----

export function getHiddenTickers() {
  return getState().hiddenTickers;
}

export function isHidden(symbol) {
  return getState().hiddenTickers.includes(symbol);
}

export function setTickerHidden(symbol, hidden) {
  update((s) => {
    const i = s.hiddenTickers.indexOf(symbol);
    if (hidden && i === -1) s.hiddenTickers.push(symbol);
    else if (!hidden && i !== -1) s.hiddenTickers.splice(i, 1);
  });
}

// ---- User-added tickers (blank mode + full-mode additions) ----

export function getUserTickers() {
  return getState().userTickers;
}

export function addUserTicker(ticker) {
  update((s) => {
    if (s.userTickers.some((t) => t.symbol === ticker.symbol)) return;
    s.userTickers.push({ addedAt: new Date().toISOString(), pending: false, ...ticker });
  });
}

export function removeUserTicker(symbol) {
  update((s) => {
    s.userTickers = s.userTickers.filter((t) => t.symbol !== symbol);
  });
}

export function markUserTickerResolved(symbol) {
  update((s) => {
    const t = s.userTickers.find((tk) => tk.symbol === symbol);
    if (t) t.pending = false;
  });
}

// ---- Group collapse state ----

export function getCollapsedGroups() {
  return new Set(getState().collapsedGroups);
}

export function setCollapsedGroups(setOrArray) {
  update((s) => {
    s.collapsedGroups = [...setOrArray];
  });
}

// ---- Start mode (welcome screen choice) ----

export function getStartMode() {
  return getState().startMode;
}

export function setStartMode(mode) {
  update((s) => {
    s.startMode = mode;
  });
}

// ---- Export / import backup ----

export function exportBackup() {
  saveNow();
  const state = getState();
  return {
    app: BACKUP_APP_ID,
    exportedAt: new Date().toISOString(),
    data: state,
  };
}

export function downloadBackup() {
  const backup = exportBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `stock-diary-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Throws on malformed input; caller shows the zh-TW error. */
export function importBackupFromText(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('INVALID_JSON');
  }
  if (!parsed || parsed.app !== BACKUP_APP_ID || !parsed.data) {
    throw new Error('NOT_A_BACKUP');
  }
  replaceAll(parsed.data);
}

export function wipeAll() {
  resetAll();
}
