// Date helpers for the pipeline. All "local" dates are Asia/Taipei; TWSE/TPEx
// sources report dates in the ROC (Minguo) calendar, where ROC year = AD year - 1911.

const ROC_OFFSET = 1911;

/**
 * Converts a TWSE/TPEx ROC date string to an ISO "YYYY-MM-DD" string.
 * Accepts compact "1150709" (YYYMMDD, no separators) or slash form "115/07/09".
 */
export function rocToISO(rocStr) {
  const digits = String(rocStr).replace(/\//g, '');
  if (!/^\d{6,7}$/.test(digits)) {
    throw new Error(`Unrecognized ROC date: ${rocStr}`);
  }
  const rocYear = Number(digits.slice(0, digits.length - 4));
  const month = digits.slice(digits.length - 4, digits.length - 2);
  const day = digits.slice(digits.length - 2);
  const adYear = rocYear + ROC_OFFSET;
  return `${adYear}-${month}-${day}`;
}

/** Converts an ISO "YYYY-MM-DD" date into the compact western YYYYMMDD TWSE query param. */
export function isoToCompactAD(iso) {
  return iso.replaceAll('-', '');
}

/** Today's date in Asia/Taipei as "YYYY-MM-DD". */
export function todayTaipei() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

export function isoYear(iso) {
  return iso.slice(0, 4);
}

export function isoMonth(iso) {
  return iso.slice(5, 7);
}

/**
 * Lists every {year, month} pair (as "YYYY"/"MM" strings) from startIso to endIso inclusive,
 * used to drive per-month backfill requests.
 */
export function monthsBetween(startIso, endIso) {
  const months = [];
  let y = Number(isoYear(startIso));
  let m = Number(isoMonth(startIso));
  const endY = Number(isoYear(endIso));
  const endM = Number(isoMonth(endIso));
  while (y < endY || (y === endY && m <= endM)) {
    months.push({ year: String(y), month: String(m).padStart(2, '0') });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return months;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Lists every Mon-Fri ISO date from startIso to endIso inclusive (still may include holidays — callers must handle no-data responses gracefully). */
export function weekdaysBetween(startIso, endIso) {
  const out = [];
  const cur = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(`${endIso}T00:00:00Z`);
  while (cur <= end) {
    const day = cur.getUTCDay();
    if (day !== 0 && day !== 6) out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}
