// Pulls one symbol's history out of the full-market tw-all archive, lazily, for
// self-serve TW stock adds. tw-all only accumulates forward from each month's
// first pipeline run (see README "The full Taiwan market archive"), so missing
// months 404 and are treated as empty — never fabricated.

const base = import.meta.env.BASE_URL;
const monthCache = new Map(); // "YYYY-MM" -> Promise<{symbol: {date: rec}}>

function loadTwAllMonth(year, month) {
  const key = `${year}-${month}`;
  if (!monthCache.has(key)) {
    monthCache.set(
      key,
      fetch(`${base}data/tw-all/${year}/${month}.json`)
        .then((res) => (res.ok ? res.json() : {}))
        .catch(() => ({})),
    );
  }
  return monthCache.get(key);
}

/** Returns { "YYYY-MM-DD": rec } across every month tw-all actually has (per its own manifest section). */
export async function fetchTwAllHistory(symbol, manifest) {
  // manifest.twAll is the tw-all archive's own {years, monthsByYear} — it only
  // accumulates forward from each month's first pipeline run, so it's usually
  // a strict subset of the main manifest. Falling back to the main manifest
  // keeps this working against an older manifest.json that predates the
  // `twAll` field, at the cost of some harmless 404s until the next fetch run.
  const twAllManifest = manifest.twAll || manifest;
  const months = [];
  for (const year of twAllManifest.years || []) {
    for (const month of twAllManifest.monthsByYear[year] || []) months.push([year, month]);
  }
  const monthMaps = await Promise.all(months.map(([y, m]) => loadTwAllMonth(y, m)));
  const merged = {};
  for (const monthMap of monthMaps) {
    Object.assign(merged, monthMap[symbol] || {});
  }
  return merged;
}
