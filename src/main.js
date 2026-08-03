import './style.css';

// ---- V2 新版接線(整夜唯一的既有檔案修改;見 src/v2/ 與 DECISIONS.md D7)----
// hash 為 #/v2 開頭 → 掛 v2 app;預設(無 hash)仍進 v1。跨界切換整頁重載。
const IS_V2 = location.hash.startsWith('#/v2');
window.addEventListener('hashchange', () => {
  if (location.hash.startsWith('#/v2') !== IS_V2) location.reload();
});
if (IS_V2) import('./v2/main.js');

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((err) => {
      console.error('stock-diary: service worker registration failed', err);
    });
  });
}

import { loadManifest, loadStatus, loadMonth } from './lib/loadMonth.js';
import { isTradingDay } from './lib/marketCalendar.js';
import { taipeiTodayIso, enabledMonths, emptyMonthMessage } from './lib/monthTabs.js';
import { startUpdateWatch, forceRefresh } from './lib/appUpdate.js';
import { buildSystemStatusHtml } from './components/systemStatus.js';
import { renderTabs } from './components/yearMonthTabs.js';
import { renderMatrix } from './components/matrix.js';
import { renderSettings } from './components/settingsPanel.js';
import { renderAddStockDialog } from './components/addStockDialog.js';
import { renderWelcome } from './components/welcomeScreen.js';
import { pinnedIndices, groupedTickers } from './lib/watchlist.js';
import { loadUserTickerHistories } from './lib/userTickerData.js';
import {
  getCollapsedGroups, setCollapsedGroups,
  getPinnedDates, togglePinnedDate,
  getStartMode, setStartMode,
  setTickerHidden, removeUserTicker,
} from './lib/userData.js';

if (!IS_V2) startV1();

function startV1() {
  const app = document.querySelector('#app');
  app.innerHTML = `
    <div class="app-shell">
      <header class="app-header">
        <h1>股票日記</h1>
        <div class="status-line" id="status-line"></div>
        <button type="button" id="refresh-data" class="refresh-btn" title="重新抓取最新資料並更新到最新版本">🔄 重新整理資料</button>
        <button type="button" id="roc-toggle" class="roc-toggle">切換民國/西元</button>
        <a href="#/v2" id="v2-entry" class="roc-toggle" title="開啟 V2 新版(建置中)">✨ V2 新版</a>
        <div id="add-stock-slot"></div>
        <div id="settings-slot"></div>
      </header>
      <div id="tabs"></div>
      <div id="banner-slot"></div>
      <div class="matrix-wrapper" id="matrix-wrapper"></div>
    </div>
  `;

  const tabsEl = document.querySelector('#tabs');
  const bannerSlot = document.querySelector('#banner-slot');
  const matrixWrapper = document.querySelector('#matrix-wrapper');
  const statusLine = document.querySelector('#status-line');
  const rocToggleBtn = document.querySelector('#roc-toggle');
  const settingsSlot = document.querySelector('#settings-slot');
  const addStockSlot = document.querySelector('#add-stock-slot');

  const state = {
    manifest: { years: [], monthsByYear: {} },
    manifestLoaded: null,
    status: {},
    year: null,
    month: null,
    roc: false,
    collapsedGroups: getCollapsedGroups(),
  };

  const monthCache = new Map(); // "YYYY-MM" -> Promise<dataMap>
  function loadMonthCached(year, month) {
    const key = `${year}-${month}`;
    if (!monthCache.has(key)) monthCache.set(key, loadMonth(year, month));
    return monthCache.get(key);
  }

  function mdLabel(iso) {
    if (!iso) return '—';
    const [, m, d] = iso.split('-');
    return `${Number(m)}/${Number(d)}`;
  }

  /** Coverage stamp: "上市 7/24 · 67/67" per market, colored by completeness so a partial session is visible at a glance. */
  function renderStatusLine() {
    const cov = state.status.coverage || {};
    const markets = [
      { key: 'tw', label: '上市' },
      { key: 'tpex', label: '上櫃' },
      { key: 'us', label: '美股' },
    ];
    const parts = [];
    for (const { key, label } of markets) {
      const c = cov[key];
      const s = state.status[key];
      if (!c && !s) continue;
      const date = c?.sessionDate || s?.latestSessionDate;
      if (c) {
        const cls = c.health === 'gap' ? 'stamp-alert' : (c.complete ? 'stamp-ok' : 'stamp-warn');
        const title = c.health === 'gap'
          ? `缺漏：${(c.missingCodes || []).join('、') || '—'}`
          : (c.complete ? '完整' : '補抓中');
        parts.push(`<span class="stamp ${cls}" title="${title}">${label} ${mdLabel(date)} <b>${c.actualCount}/${c.expectedCount}</b></span>`);
      } else {
        parts.push(`<span class="stamp">${label} ${mdLabel(date)}</span>`);
      }
    }
    statusLine.innerHTML = parts.join('') || '尚無資料';
  }

  /**
   * The app always opens on the current Taipei month. The one case where it
   * cannot honour that faithfully is a manifest it failed to fetch — then it
   * still shows the current month but has no idea which other months exist, so
   * it says so rather than letting the tabs look silently truncated.
   */
  function fallbackNoticeHtml() {
    if (state.manifestLoaded !== false) return '';
    return `<div class="freshness-banner banner-warn">⚠ 無法讀取資料目錄，僅顯示本月；請點「🔄 重新整理資料」重試</div>`;
  }

  /** One-line freshness banner: latest / holiday / delayed / anomaly, in zh-TW. */
  function freshnessBannerHtml() {
    const cov = state.status.coverage || {};
    const markets = ['tw', 'tpex', 'us'];
    const present = markets.filter((m) => cov[m]);
    if (!present.length) return '';
    const anyGap = present.some((m) => cov[m].health === 'gap');
    const anyIncomplete = present.some((m) => !cov[m].complete && cov[m].health !== 'gap');
    if (anyGap) return `<div class="freshness-banner banner-alert">⚠ 資料異常，已通知維護者</div>`;
    if (anyIncomplete) return `<div class="freshness-banner banner-warn">⏳ 資料延遲中，系統正在重試</div>`;

    const today = taipeiTodayIso();
    const tradingSomewhere = isTradingDay('tw', today) || isTradingDay('us', today);
    if (!tradingSomewhere) {
      const latest = cov.tw?.sessionDate || cov.us?.sessionDate;
      return `<div class="freshness-banner banner-holiday">今日休市（正常，最新資料為 ${mdLabel(latest)}）</div>`;
    }
    return `<div class="freshness-banner banner-ok">✓ 資料為最新</div>`;
  }

  /** Loads whichever extra months are needed to have data for every pinned date not in the current month. */
  async function loadPinnedDataMap(pinnedDates, currentDataMap) {
    const needed = new Map(); // "YYYY-MM" -> [dates]
    for (const date of pinnedDates) {
      const [y, m] = date.split('-');
      const key = `${y}-${m}`;
      if (key === `${state.year}-${state.month}`) continue; // already in currentDataMap
      if (!needed.has(key)) needed.set(key, [y, m]);
    }
    const merged = {};
    const monthMaps = await Promise.all(
      [...needed.values()].map(([y, m]) => loadMonthCached(y, m)),
    );
    for (const dataMap of monthMaps) {
      for (const [symbol, byDate] of Object.entries(dataMap)) {
        merged[symbol] = { ...merged[symbol], ...byDate };
      }
    }
    // Also fold in current-month data so recFor() has a single place to look for pinned dates that DO fall in this month.
    for (const [symbol, byDate] of Object.entries(currentDataMap)) {
      merged[symbol] = { ...merged[symbol], ...byDate };
    }
    return merged;
  }

  function renderBlankModeBanner(groups) {
    const totalTickers = groups.reduce((n, g) => n + g.tickers.length, 0);
    if (getStartMode() !== 'blank' || totalTickers > 0) return '';
    return `
      <div class="blank-banner">
        <p>您的觀察清單目前是空的。點擊右上角「＋新增股票」，開始記錄第一檔股票吧！</p>
      </div>`;
  }

  async function renderTabsAndMatrix() {
    renderTabs(tabsEl, {
      manifest: state.manifest,
      selectedYear: state.year,
      selectedMonth: state.month,
      onSelectYear: (year) => {
        state.year = year;
        const months = [...enabledMonths(state.manifest, year, taipeiTodayIso())].sort();
        if (!months.includes(state.month)) state.month = months[months.length - 1];
        renderTabsAndMatrix();
      },
      onSelectMonth: (month) => {
        state.month = month;
        renderTabsAndMatrix();
      },
    });

    matrixWrapper.innerHTML = '<p class="loading-state">載入中…</p>';
    const dataMap = await loadMonthCached(state.year, state.month);
    const groups = groupedTickers();

    // User-added TW self-serve stocks aren't in tw/us/idx (pipeline-only files) — their
    // history comes from the tw-all archive instead, fetched lazily and merged in here.
    const userTwTickers = groups.flatMap((g) => g.tickers).filter((t) => t.isUserAdded && t.market !== 'us');
    const userHistories = userTwTickers.length ? await loadUserTickerHistories(userTwTickers, state.manifest) : {};
    const monthPrefix = `${state.year}-${state.month}`;
    for (const [symbol, byDate] of Object.entries(userHistories)) {
      const currentMonthSlice = Object.fromEntries(Object.entries(byDate).filter(([d]) => d.startsWith(monthPrefix)));
      dataMap[symbol] = { ...(dataMap[symbol] || {}), ...currentMonthSlice };
    }

    const pinnedDates = getPinnedDates();
    const pinnedDataMap = pinnedDates.length ? await loadPinnedDataMap(pinnedDates, dataMap) : {};
    for (const [symbol, byDate] of Object.entries(userHistories)) {
      pinnedDataMap[symbol] = { ...(pinnedDataMap[symbol] || {}), ...byDate };
    }

    bannerSlot.innerHTML = fallbackNoticeHtml() + freshnessBannerHtml() + renderBlankModeBanner(groups);

    // A month with no session data at all is a normal state (the current month
    // before its first close, a month the pipeline missed) — say so in zh-TW
    // rather than rendering an empty grid that reads as a broken app.
    const hasAnyData = Object.values(dataMap).some((byDate) => Object.keys(byDate).length > 0);
    if (!hasAnyData) {
      const msg = emptyMonthMessage(state.year, state.month, taipeiTodayIso());
      matrixWrapper.innerHTML = `<p class="empty-state empty-month">${msg}</p>`;
      return;
    }

    renderMatrix(matrixWrapper, {
      dataMap,
      pinnedDataMap,
      pinnedDates,
      roc: state.roc,
      collapsedGroups: state.collapsedGroups,
      pinnedIndexTickers: pinnedIndices(),
      groupedTickers: groups,
      coverage: state.status.coverage || {},
      onToggleGroup: (group) => {
        if (state.collapsedGroups.has(group)) state.collapsedGroups.delete(group);
        else state.collapsedGroups.add(group);
        setCollapsedGroups(state.collapsedGroups);
        renderTabsAndMatrix();
      },
      onTogglePin: (date) => {
        togglePinnedDate(date);
        renderTabsAndMatrix();
      },
      onHideTicker: (symbol) => {
        setTickerHidden(symbol, true);
        renderTabsAndMatrix();
      },
      onRemoveTicker: (symbol) => {
        removeUserTicker(symbol);
        renderTabsAndMatrix();
      },
    });
  }

  rocToggleBtn.addEventListener('click', () => {
    state.roc = !state.roc;
    renderTabsAndMatrix();
  });

  renderSettings(settingsSlot, {
    onStartModeChange: (mode) => {
      setStartMode(mode);
      renderTabsAndMatrix();
    },
    onUnhideTicker: () => renderTabsAndMatrix(),
    extraSections: [{ title: '系統狀態', html: '<div id="system-status-body"></div>' }],
    onOpen: () => {
      const el = document.getElementById('system-status-body');
      if (el) el.innerHTML = buildSystemStatusHtml(state.status);
    },
  });

  document.querySelector('#refresh-data').addEventListener('click', () => forceRefresh());

  renderAddStockDialog(addStockSlot, {
    onAdded: () => renderTabsAndMatrix(),
  });

  async function init() {
    const [manifest, status] = await Promise.all([loadManifest(), loadStatus()]);
    state.manifest = manifest.years ? manifest : { years: [], monthsByYear: {} };
    state.status = status;
    renderStatusLine();

    // The default view is the current Taipei month, always — including before
    // that month's first session has been fetched. Only a manifest we could not
    // load at all forces a fallback, and that fallback is announced on screen
    // (fallbackNoticeHtml) instead of silently showing an older month.
    const todayIso = taipeiTodayIso();
    state.year = todayIso.slice(0, 4);
    state.month = todayIso.slice(5, 7);
    state.manifestLoaded = (state.manifest.years || []).length > 0;

    if (getStartMode() === null) {
      renderWelcome(app, () => renderTabsAndMatrix());
    } else {
      await renderTabsAndMatrix();
    }

    // Guard against a stale service-worker copy: reload if a newer build deployed.
    startUpdateWatch();
  }

  init();
}
