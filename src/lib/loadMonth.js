const base = import.meta.env.BASE_URL;

async function fetchJsonOrEmpty(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return {};
    return await res.json();
  } catch {
    return {};
  }
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
  return fetchJsonOrEmpty(`${base}data/manifest.json`);
}

export async function loadStatus() {
  return fetchJsonOrEmpty(`${base}data/status.json`);
}
