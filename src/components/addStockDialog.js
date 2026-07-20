import { searchTwSymbols } from '../lib/twSymbols.js';
import { addUserTicker, getUserTickers } from '../lib/userData.js';
import { isPreloadedSymbol } from '../lib/watchlist.js';
import { allTickers } from '../lib/tickers.js';

function existingGroupNames() {
  const names = new Set(allTickers().filter((t) => t.market !== 'index').map((t) => t.group));
  for (const t of getUserTickers()) if (t.group) names.add(t.group);
  return [...names];
}

function copyButtonHtml() {
  return '<button type="button" class="btn-secondary copy-btn">📋 複製訊息</button>';
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function renderAddStockDialog(container, { onAdded } = {}) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'add-stock-btn';
  btn.textContent = '＋ 新增股票';
  container.appendChild(btn);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay hidden add-stock-overlay';
  overlay.innerHTML = `
    <div class="modal-panel" role="dialog" aria-label="新增股票">
      <div class="modal-header">
        <h2>新增股票</h2>
        <button type="button" class="modal-close" aria-label="關閉">✕</button>
      </div>
      <div class="modal-body">
        <div class="market-tabs">
          <button type="button" class="market-tab active" data-tab="tw">台股（即時）</button>
          <button type="button" class="market-tab" data-tab="us">美股（需維護者協助）</button>
        </div>

        <div class="tab-panel tw-panel">
          <label class="field-label" for="tw-search">代號或名稱</label>
          <input type="text" id="tw-search" placeholder="例如：2330 或 台積電" autocomplete="off">
          <div class="tw-results"></div>
          <div class="tw-selected hidden">
            <div class="tw-selected-info"></div>
            <label class="field-label" for="tw-group">分類（可自訂）</label>
            <input type="text" id="tw-group" list="group-options" placeholder="例如：台股-自選">
            <button type="button" class="btn-primary tw-add-btn">加入觀察清單</button>
          </div>
          <p class="add-success tw-success hidden">已加入！此股票的完整歷史資料已自動載入。</p>
        </div>

        <div class="tab-panel us-panel hidden">
          <p class="settings-note">美股需要維護者手動加入資料來源。新增後會先顯示「資料待接入」，
          您可以一鍵複製下方訊息傳給維護者；維護者加入後，資料會自動補上，不需要您再做任何事。</p>
          <label class="field-label" for="us-symbol">美股代號</label>
          <input type="text" id="us-symbol" placeholder="例如：NVDA" autocomplete="off">
          <label class="field-label" for="us-name">中文名稱（選填）</label>
          <input type="text" id="us-name" placeholder="例如：輝達">
          <label class="field-label" for="us-group">分類（可自訂）</label>
          <input type="text" id="us-group" list="group-options" placeholder="例如：美股-自選">
          <button type="button" class="btn-primary us-add-btn">加入並產生請求訊息</button>
          <div class="us-request hidden">
            <label class="field-label">請將以下訊息傳給維護者</label>
            <div class="request-message-row">
              <input type="text" class="request-message" readonly>
              ${copyButtonHtml()}
            </div>
            <p class="copy-feedback"></p>
          </div>
        </div>
        <datalist id="group-options"></datalist>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const groupOptions = overlay.querySelector('#group-options');
  function refreshGroupOptions() {
    groupOptions.innerHTML = existingGroupNames().map((g) => `<option value="${g}"></option>`).join('');
  }

  // ---- Tabs ----
  const tabs = overlay.querySelectorAll('.market-tab');
  const twPanel = overlay.querySelector('.tw-panel');
  const usPanel = overlay.querySelector('.us-panel');
  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      for (const t of tabs) t.classList.toggle('active', t === tab);
      twPanel.classList.toggle('hidden', tab.dataset.tab !== 'tw');
      usPanel.classList.toggle('hidden', tab.dataset.tab !== 'us');
    });
  }

  // ---- TW self-serve ----
  const twSearch = overlay.querySelector('#tw-search');
  const twResults = overlay.querySelector('.tw-results');
  const twSelected = overlay.querySelector('.tw-selected');
  const twSelectedInfo = overlay.querySelector('.tw-selected-info');
  const twGroupInput = overlay.querySelector('#tw-group');
  const twAddBtn = overlay.querySelector('.tw-add-btn');
  const twSuccess = overlay.querySelector('.tw-success');
  let selectedTw = null;
  let searchDebounce = null;

  twSearch.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    twSuccess.classList.add('hidden');
    const q = twSearch.value;
    searchDebounce = setTimeout(async () => {
      const results = await searchTwSymbols(q);
      twResults.innerHTML = results.length
        ? results.map((r) => `
            <button type="button" class="tw-result-item" data-symbol="${r.symbol}" data-market="${r.market}" data-name="${r.name_zh}">
              <span class="tw-result-name">${r.name_zh}</span>
              <span class="tw-result-code">${r.symbol} · ${r.market === 'twse' ? '上市' : '上櫃'}</span>
              ${isPreloadedSymbol(r.symbol) ? '<span class="tw-result-badge">已在清單中</span>' : ''}
            </button>`).join('')
        : (q.trim() ? '<p class="settings-note">找不到符合的股票</p>' : '');
    }, 200);
  });

  twResults.addEventListener('click', (e) => {
    const item = e.target.closest('.tw-result-item');
    if (!item) return;
    selectedTw = { symbol: item.dataset.symbol, market: item.dataset.market, name_zh: item.dataset.name };
    twSelectedInfo.textContent = `${selectedTw.name_zh}（${selectedTw.symbol}）`;
    twSelected.classList.remove('hidden');
    refreshGroupOptions();
  });

  twAddBtn.addEventListener('click', () => {
    if (!selectedTw) return;
    const group = twGroupInput.value.trim() || '自選股';
    addUserTicker({ symbol: selectedTw.symbol, market: selectedTw.market, name_zh: selectedTw.name_zh, group });
    twSuccess.classList.remove('hidden');
    twSelected.classList.add('hidden');
    twSearch.value = '';
    twResults.innerHTML = '';
    twGroupInput.value = '';
    selectedTw = null;
    onAdded?.();
  });

  // ---- US assisted ----
  const usSymbol = overlay.querySelector('#us-symbol');
  const usName = overlay.querySelector('#us-name');
  const usGroup = overlay.querySelector('#us-group');
  const usAddBtn = overlay.querySelector('.us-add-btn');
  const usRequest = overlay.querySelector('.us-request');
  const requestMessageInput = overlay.querySelector('.request-message');
  const copyFeedback = overlay.querySelector('.copy-feedback');
  const copyBtn = overlay.querySelector('.copy-btn');

  usSymbol.addEventListener('input', () => {
    usSymbol.value = usSymbol.value.toUpperCase();
  });

  usAddBtn.addEventListener('click', () => {
    const symbol = usSymbol.value.trim().toUpperCase();
    if (!symbol) return;
    const group = usGroup.value.trim() || '美股-自選';
    const name_zh = usName.value.trim() || symbol;
    addUserTicker({ symbol, market: 'us', name_zh, group, pending: true });
    const message = `請幫我新增美股 ${symbol}`;
    requestMessageInput.value = message;
    usRequest.classList.remove('hidden');
    copyFeedback.textContent = '';
    onAdded?.();
  });

  copyBtn.addEventListener('click', async () => {
    const ok = await copyToClipboard(requestMessageInput.value);
    if (ok) {
      copyFeedback.textContent = '已複製！';
    } else {
      requestMessageInput.select();
      copyFeedback.textContent = '請手動複製（已選取文字）';
    }
  });

  // ---- Open/close ----
  function open() {
    refreshGroupOptions();
    overlay.classList.remove('hidden');
    twSearch.focus();
  }
  function close() {
    overlay.classList.add('hidden');
  }
  btn.addEventListener('click', open);
  overlay.querySelector('.modal-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.classList.contains('hidden')) close();
  });

  return { open, close };
}
