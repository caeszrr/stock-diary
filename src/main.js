import './style.css';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((err) => {
      console.error('stock-diary: service worker registration failed', err);
    });
  });
}

import { loadManifest, loadStatus, loadMonth } from './lib/loadMonth.js';
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

const app = document.querySelector('#app');
app.innerHTML = `
  <div class="app-shell">
    <header class="app-header">
      <h1>股票日記</h1>
      <div class="status-line" id="status-line"></div>
      <button type="button" id="roc-toggle" class="roc-toggle">切換民國/西元</button>
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

function renderStatusLine() {
  const parts = [];
  const labels = { tw: 'TW上市', tpex: 'TW上櫃', us: '美股' };
  for (const [market, label] of Object.entries(labels)) {
    const s = state.status[market];
    if (!s) continue;
    const stamp = s.latestSessionDate || '—';
    parts.push(`${label} 最後更新：${stamp}`);
  }
  statusLine.textContent = parts.join('　|　') || '尚無資料';
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
    years: state.manifest.years,
    monthsByYear: state.manifest.monthsByYear,
    selectedYear: state.year,
    selectedMonth: state.month,
    onSelectYear: (year) => {
      state.year = year;
      const months = state.manifest.monthsByYear[year] || [];
      if (!months.includes(state.month)) state.month = months[months.length - 1];
      renderTabsAndMatrix();
    },
    onSelectMonth: (month) => {
      state.month = month;
      renderTabsAndMatrix();
    },
  });

  if (!state.year || !state.month) {
    matrixWrapper.innerHTML = '<p class="empty-state">尚無資料，請稍後再試。</p>';
    return;
  }

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

  bannerSlot.innerHTML = renderBlankModeBanner(groups);

  renderMatrix(matrixWrapper, {
    dataMap,
    pinnedDataMap,
    pinnedDates,
    roc: state.roc,
    collapsedGroups: state.collapsedGroups,
    pinnedIndexTickers: pinnedIndices(),
    groupedTickers: groups,
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
});

renderAddStockDialog(addStockSlot, {
  onAdded: () => renderTabsAndMatrix(),
});

async function init() {
  const [manifest, status] = await Promise.all([loadManifest(), loadStatus()]);
  state.manifest = manifest.years ? manifest : { years: [], monthsByYear: {} };
  state.status = status;
  renderStatusLine();

  const years = state.manifest.years || [];
  const now = new Date();
  const currentYear = String(now.getFullYear());
  const currentMonth = String(now.getMonth() + 1).padStart(2, '0');

  if (years.includes(currentYear) && (state.manifest.monthsByYear[currentYear] || []).includes(currentMonth)) {
    state.year = currentYear;
    state.month = currentMonth;
  } else if (years.length) {
    state.year = years[years.length - 1];
    const months = state.manifest.monthsByYear[state.year] || [];
    state.month = months[months.length - 1];
  }

  if (getStartMode() === null) {
    renderWelcome(app, () => renderTabsAndMatrix());
  } else {
    await renderTabsAndMatrix();
  }
}

init();
