/**
 * v2 app 進入點。由 src/main.js 在 hash 為 #/v2 時動態載入(最小接線)。
 */
import './tokens.css';
import './v2.css';
import { DRY_RUN } from './lib/dryRun.js';
import { parseRoute, onRouteChange, navigate } from './router.js';
import { loadStatus } from './lib/quotes.js';
import { taipeiTodayIso } from './lib/dates.js';
import { renderDayPage } from './pages/day.js';
import { renderVaultPage } from './pages/vault.js';
import { renderSettingsPage } from './pages/settings.js';
import { subscribe } from './lib/draftStore.js';

const NAV = [
  { key: 'day', label: '交易日', hash: () => `#/v2/day/${taipeiTodayIso()}`, enabled: true },
  { key: 'vault', label: '金庫', hash: () => '#/v2/vault', enabled: true },
  { key: 'settings', label: '設定', hash: () => '#/v2/settings', enabled: true },
  { key: 'history', label: '歷史回顧', hash: () => '', enabled: false },
  { key: 'stats', label: '統計分析', hash: () => '', enabled: false },
];

function mdLabel(iso) {
  if (!iso) return '—';
  const [, m, d] = iso.split('-');
  return `${Number(m)}/${Number(d)}`;
}

function statusHtml(status) {
  const cov = status?.coverage || {};
  const tw = cov.tw;
  const pipeline = tw
    ? `資料:${mdLabel(tw.sessionDate)} 收盤${tw.complete ? '(完整)' : '(補抓中)'}`
    : '資料:載入中…';
  return `
    <span class="v2-status-item v2-status-off" title="Fugle 即時報價尚未接通;所有價格為最近收盤">● Fugle 即時:未接通</span>
    <span class="v2-status-item" title="EOD 報價管線(public/data)">${pipeline}</span>
    ${DRY_RUN ? '<span class="v2-status-item v2-status-dry" title="草稿模式:所有儲存動作只進記憶體,不寫入資料庫">dryRun 草稿模式</span>' : ''}
  `;
}

export function mountV2() {
  document.title = '股票日記 V2';
  const app = document.querySelector('#app');
  app.innerHTML = `
    <div class="v2-root">
      <aside class="v2-sidebar">
        <div class="v2-brand">股票日記 <span class="v2-badge">V2</span></div>
        <nav class="v2-nav" id="v2-nav"></nav>
        <a class="v2-back-v1" href="#" id="v2-back-v1">← 回 V1 版</a>
      </aside>
      <div class="v2-maincol">
        <header class="v2-topbar" id="v2-topbar">載入中…</header>
        <main class="v2-page" id="v2-page"></main>
      </div>
    </div>
  `;

  const navEl = document.getElementById('v2-nav');
  const pageEl = document.getElementById('v2-page');
  const topbarEl = document.getElementById('v2-topbar');

  document.getElementById('v2-back-v1').addEventListener('click', (e) => {
    e.preventDefault();
    location.hash = '';
    location.reload();
  });

  let currentRoute = parseRoute();

  function renderNav() {
    navEl.innerHTML = NAV.map((item) => {
      if (!item.enabled) {
        return `<span class="v2-nav-item v2-nav-disabled" title="規劃中">${item.label}</span>`;
      }
      const active = currentRoute.page === item.key ? ' v2-nav-active' : '';
      return `<a class="v2-nav-item${active}" href="${item.hash()}">${item.label}</a>`;
    }).join('');
  }

  function renderPage() {
    renderNav();
    if (currentRoute.page === 'vault') renderVaultPage(pageEl);
    else if (currentRoute.page === 'settings') renderSettingsPage(pageEl);
    else renderDayPage(pageEl, currentRoute.date);
  }

  onRouteChange((route) => {
    currentRoute = route;
    renderPage();
  });

  // 草稿層任何變動 → 重繪目前頁面(單向資料流)
  subscribe(() => renderPage());

  loadStatus().then((status) => { topbarEl.innerHTML = statusHtml(status); });
  topbarEl.innerHTML = statusHtml(null);

  if (!location.hash.startsWith('#/v2/')) {
    navigate(`/v2/day/${taipeiTodayIso()}`);
    currentRoute = parseRoute();
  }
  renderPage();
}

mountV2();
