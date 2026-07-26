import { escapeHtml } from '../lib/format.js';

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function mdLabel(iso) {
  if (!iso) return '—';
  const [, m, d] = iso.split('-');
  return `${Number(m)}/${Number(d)}`;
}

const HEALTH_LABEL = {
  healthy: '<span class="sys-ok">正常</span>',
  'resolved-empty': '<span class="sys-ok">正常（含確認無交易）</span>',
  gap: '<span class="sys-alert">異常（已通報）</span>',
};

function verdictLabel(cov) {
  if (!cov) return '—';
  if (cov.health && HEALTH_LABEL[cov.health]) return HEALTH_LABEL[cov.health];
  if (cov.complete) return '<span class="sys-ok">完整</span>';
  return '<span class="sys-warn">補抓中</span>';
}

/** Renders the 系統狀態 panel body from the fetched status.json (freshness + coverage + watchdog verdict). */
export function buildSystemStatusHtml(status = {}) {
  const cov = status.coverage || {};
  const rows = [
    { key: 'tw', label: '台股上市' },
    { key: 'tpex', label: '台股上櫃' },
    { key: 'us', label: '美股' },
  ];
  const body = rows.map(({ key, label }) => {
    const s = status[key] || {};
    const c = cov[key];
    const date = c?.sessionDate || s.latestSessionDate;
    const coverageText = c ? `${c.actualCount}/${c.expectedCount} 檔` : '—';
    const gaps = c?.missingCodes?.length ? `<div class="sys-gaps">缺漏：${escapeHtml(c.missingCodes.join('、'))}</div>` : '';
    return `
      <div class="sys-row">
        <div class="sys-market">${label}</div>
        <div class="sys-cells">
          <div><span class="sys-k">最新交易日</span> ${mdLabel(date)}</div>
          <div><span class="sys-k">完整度</span> ${coverageText}</div>
          <div><span class="sys-k">狀態</span> ${verdictLabel(c)}</div>
          <div><span class="sys-k">最後抓取</span> ${fmtTime(s.lastRun)}</div>
          ${gaps}
        </div>
      </div>`;
  }).join('');

  return `
    <p class="settings-note">此面板顯示自動抓取管線與監測程式（watchdog）的最新狀態。若某市場長時間「補抓中」或顯示「異常」，系統會自動重試並在無法修復時於 GitHub 開 issue 通知維護者。</p>
    <div class="sys-status">${body}</div>
    <p class="settings-note">下次更新：每個交易日收盤後自動抓取（台股約台北時間下午，美股約隔日清晨）。若剛好有新版本，本頁會自動更新到最新。</p>`;
}
