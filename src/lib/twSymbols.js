// Search index for the TW self-serve add-stock flow. Backed by data/tw-symbols.json
// (code -> { name, market }), refreshed daily by the pipeline, covers all 上市+上櫃.

const base = import.meta.env.BASE_URL;
let indexPromise = null;

function loadIndex() {
  if (!indexPromise) {
    indexPromise = fetch(`${base}data/tw-symbols.json`)
      .then((res) => (res.ok ? res.json() : {}))
      .catch(() => ({}));
  }
  return indexPromise;
}

/** Matches by code prefix or name substring. Returns [{ symbol, name_zh, market }]. */
export async function searchTwSymbols(query, limit = 20) {
  const q = query.trim();
  if (!q) return [];
  const index = await loadIndex();
  const results = [];
  for (const [code, info] of Object.entries(index)) {
    if (code.startsWith(q) || (info.name && info.name.includes(q))) {
      results.push({ symbol: code, name_zh: info.name, market: info.market });
      if (results.length >= limit) return results;
    }
  }
  return results;
}

export async function getTwSymbolInfo(code) {
  const index = await loadIndex();
  return index[code] || null;
}
