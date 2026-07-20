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

/** Returns { "YYYY-MM-DD": rec } across every month present in the manifest. */
export async function fetchTwAllHistory(symbol, manifest) {
  const months = [];
  for (const year of manifest.years || []) {
    for (const month of manifest.monthsByYear[year] || []) months.push([year, month]);
  }
  const monthMaps = await Promise.all(months.map(([y, m]) => loadTwAllMonth(y, m)));
  const merged = {};
  for (const monthMap of monthMaps) {
    Object.assign(merged, monthMap[symbol] || {});
  }
  return merged;
}
