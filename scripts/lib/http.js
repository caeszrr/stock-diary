const UA = 'Mozilla/5.0 (compatible; stock-diary-pipeline/1.0)';

// TWSE's per-symbol history endpoint answers a bare (Location-less) 307 when it's
// rate-limiting a caller — treat that like a 429 and back off harder than a normal retry.
const THROTTLE_STATUSES = new Set([307, 429]);

/** Fetches JSON with retries; throttle responses (307/429) get a longer exponential backoff. Throws with a readable message on final failure. */
export async function fetchJson(url, { retries = 3, retryDelayMs = 1500, headers = {} } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers } });
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status} ${res.statusText}`);
        err.status = res.status;
        throw err;
      }
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`Non-JSON response (${text.slice(0, 120)}...)`);
      }
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        const throttled = THROTTLE_STATUSES.has(err.status);
        // Capped backoff: enough to ride out a brief rate-limit window without letting a
        // single stubborn request stall an entire backfill/repair run for tens of seconds.
        const delay = throttled ? Math.min(retryDelayMs * 2 ** (attempt + 1), 6000) : retryDelayMs;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw new Error(`fetchJson failed for ${url}: ${lastErr.message}`);
}

/** Parses a numeric string that may have +/- signs, commas, stray letters (e.g. TWSE's ex-dividend "X" marker), or trailing spaces. Returns undefined (never NaN/0-fabricated) if not parseable. */
export function parseNum(str) {
  if (str === undefined || str === null) return undefined;
  const cleaned = String(str).replace(/,/g, '').trim();
  const match = cleaned.match(/-?\d+(\.\d+)?/);
  if (!match) return undefined;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : undefined;
}
