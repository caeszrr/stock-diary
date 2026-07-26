const base = import.meta.env.BASE_URL;

async function fetchJsonOrEmpty(url, opts) {
  try {
    const res = await fetch(url, opts);
    if (!res.ok) return {};
    return await res.json();
  } catch {
    return {};
  }
}

// status.json / manifest.json carry the freshness + coverage the monitoring UI
// reads — always fetch them fresh (no-store, cache-busted) so a stale
// service-worker/browser copy can never mask a delayed or incomplete session.
function fetchFresh(url) {
  return fetchJsonOrEmpty(`${url}?ts=${Date.now()}`, { cache: 'no-store' });
}

/** Fetches tw/us/idx data for one year/month and merges them into one { symbol: { date: {...} } } map. */
export async function loadMonth(year, month) {
  const [tw, us, idx] = await Promise.all([
    fetchJsonOrEmpty(`${base}data/tw/${year}/${month}.json`),
    fetchJsonOrEmpty(`${base}data/us/${year}/${month}.json`),
    fetchJsonOrEmpty(`${base}data/idx/${year}/${month}.json`),
  ]);
  return { ...tw, ...us, ...idx };
}

export async function loadManifest() {
  return fetchFresh(`${base}data/manifest.json`);
}

export async function loadStatus() {
  return fetchFresh(`${base}data/status.json`);
}
