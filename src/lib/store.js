// Thin abstraction over the persistence backend for all user-generated data
// (notes, profiles, pins, hidden/added tickers, settings). Everything else in
// the app talks to userData.js, never to localStorage directly — so a future
// database backend can replace this one file without touching call sites.

const STORAGE_KEY = 'stock-diary:userdata';
const SCHEMA_VERSION = 1;

function emptyState() {
  return {
    version: SCHEMA_VERSION,
    cellNotes: {}, // "SYMBOL|YYYY-MM-DD" -> { shape, note, emphasis }
    profiles: {}, // SYMBOL -> freeform text
    marketNotes: {}, // YYYY-MM-DD -> freeform text (大盤筆記)
    pinnedDates: [], // ["YYYY-MM-DD"]
    hiddenTickers: [], // [SYMBOL] — preloaded tickers hidden by the user
    userTickers: [], // [{ symbol, market, name_zh, group, addedAt, pending }]
    collapsedGroups: [],
    startMode: null, // "full" | "blank" | null (undecided — show welcome screen)
  };
}

/** Migrates older persisted shapes forward. No-op today; hook for future schema changes. */
function migrate(raw) {
  if (!raw || typeof raw !== 'object') return emptyState();
  const base = emptyState();
  if (raw.version === SCHEMA_VERSION) {
    return { ...base, ...raw };
  }
  // Unknown/older version: keep recognized fields, drop the rest rather than crash.
  return { ...base, ...raw, version: SCHEMA_VERSION };
}

function readRaw() {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    if (!text) return emptyState();
    return migrate(JSON.parse(text));
  } catch {
    return emptyState();
  }
}

let cache = readRaw();
let writeTimer = null;
const WRITE_DEBOUNCE_MS = 400;

function flush() {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch (err) {
    // Quota exceeded or storage disabled — surface once via console, don't crash the UI.
    console.error('stock-diary: failed to save to localStorage', err);
  }
}

function scheduleWrite() {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(flush, WRITE_DEBOUNCE_MS);
}

/**
 * Opportunistic flush for tab-close/backgrounding: only writes if a debounced
 * save is actually pending (i.e. `writeTimer` is set). Flushing unconditionally
 * here would re-save the in-memory `cache` even when nothing changed since the
 * last save — including re-writing over storage that was cleared externally
 * (browser "clear site data", devtools) while this tab stayed open, silently
 * undoing that clear the moment the tab backgrounds or closes.
 */
function flushIfPending() {
  if (writeTimer) flush();
}

window.addEventListener('beforeunload', flushIfPending);
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushIfPending();
});

export function getState() {
  return cache;
}

/** mutator receives the current state and may mutate it in place; schedules a debounced save. */
export function update(mutator) {
  mutator(cache);
  scheduleWrite();
}

/** Forces an immediate synchronous save (used before export/import/reload flows). */
export function saveNow() {
  flush();
}

export function replaceAll(newState) {
  cache = migrate(newState);
  flush();
}

export function resetAll() {
  cache = emptyState();
  flush();
}
