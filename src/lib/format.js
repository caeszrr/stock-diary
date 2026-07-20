const WEEKDAY_CHARS = ['日', '一', '二', '三', '四', '五', '六'];
const ROC_OFFSET = 1911;

/** "2026-07-01" -> "7/1（三）" */
export function formatDateHeader(iso, { roc = false } = {}) {
  const [y, m, d] = iso.split('-').map(Number);
  const weekday = WEEKDAY_CHARS[new Date(`${iso}T00:00:00Z`).getUTCDay()];
  const yearLabel = roc ? `民${y - ROC_OFFSET}/` : '';
  return `${yearLabel}${m}/${d}（${weekday}）`;
}

export function isoToRocLabel(iso) {
  const [y, m, d] = iso.split('-');
  return `民${Number(y) - ROC_OFFSET}/${Number(m)}/${Number(d)}`;
}

/** Formats a price/number with thousands separators; returns '' for missing values (never fabricate). */
export function fmtNum(n, { decimals } = {}) {
  if (n === undefined || n === null || Number.isNaN(n)) return '';
  if (decimals !== undefined) return n.toFixed(decimals);
  return Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export function fmtVolume(n) {
  if (n === undefined || n === null) return '';
  return n.toLocaleString('en-US');
}

/** Change % = (c - pc) / pc * 100. Returns undefined if either value is missing (never fabricate). */
export function changePct(c, pc) {
  if (c === undefined || pc === undefined || pc === 0) return undefined;
  return ((c - pc) / pc) * 100;
}

/** Amplitude 振幅 = (h - l) / pc * 100. */
export function amplitudePct(h, l, pc) {
  if (h === undefined || l === undefined || pc === undefined || pc === 0) return undefined;
  return ((h - l) / pc) * 100;
}

/** Taiwan convention: red = up, green = down, everywhere, no exceptions. */
export function changeColorClass(pct) {
  if (pct === undefined || Number.isNaN(pct)) return '';
  if (pct > 0) return 'chg-up';
  if (pct < 0) return 'chg-down';
  return 'chg-flat';
}

/** Escapes user-generated text before it's interpolated into innerHTML templates. */
export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
