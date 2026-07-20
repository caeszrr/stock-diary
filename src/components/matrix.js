import { formatDateHeader, escapeHtml } from '../lib/format.js';
import { renderCell } from './cell.js';
import { getMarketNote, setMarketNote, getProfile, setProfile, isPinned } from '../lib/userData.js';

/** Union of every date that appears under any symbol in dataMap, sorted ascending. */
function collectDateColumns(dataMap) {
  const dates = new Set();
  for (const bySymbol of Object.values(dataMap)) {
    for (const date of Object.keys(bySymbol)) dates.add(date);
  }
  return [...dates].sort();
}

function recFor(symbol, date, dataMap, pinnedDataMap) {
  return dataMap[symbol]?.[date] ?? pinnedDataMap?.[symbol]?.[date];
}

function buildHeaderCell(date, roc, onTogglePin) {
  const th = document.createElement('th');
  th.className = 'date-col sticky-row';
  th.dataset.date = date;
  const pinned = isPinned(date);
  th.innerHTML = `
    <div class="date-label">${formatDateHeader(date, { roc })}</div>
    <button type="button" class="pin-btn ${pinned ? 'pinned' : ''}" title="${pinned ? '取消釘選此日' : '釘選此日'}">${pinned ? '📌' : '📍'}</button>`;
  th.querySelector('.pin-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    onTogglePin(date);
  });
  return th;
}

function buildHeaderRow(dateColumns, pinnedDates, roc, onTogglePin) {
  const tr = document.createElement('tr');
  const corner = document.createElement('th');
  corner.className = 'corner-cell sticky-col sticky-row';
  corner.textContent = '個股';
  tr.appendChild(corner);
  for (const date of dateColumns) tr.appendChild(buildHeaderCell(date, roc, onTogglePin));
  if (pinnedDates.length) {
    const sep = document.createElement('th');
    sep.className = 'pin-separator sticky-row';
    sep.title = '以下為釘選日期';
    tr.appendChild(sep);
    for (const date of pinnedDates) tr.appendChild(buildHeaderCell(date, roc, onTogglePin));
  }
  return tr;
}

function totalColumnCount(dateColumns, pinnedDates) {
  return dateColumns.length + (pinnedDates.length ? pinnedDates.length + 1 : 0);
}

function buildRow({ symbol, name_zh, group, pending, isUserAdded }, dataMap, pinnedDataMap, dateColumns, pinnedDates, { onHideTicker, onRemoveTicker } = {}) {
  const tr = document.createElement('tr');
  tr.className = 'stock-row';
  tr.dataset.symbol = symbol;

  const nameCell = document.createElement('td');
  nameCell.className = 'name-cell sticky-col';
  const profile = getProfile(symbol);
  const pendingBadge = pending ? '<span class="pending-badge">資料待接入</span>' : '';
  const rowActionBtn = isUserAdded
    ? '<button type="button" class="row-action remove-btn">移除</button>'
    : (onHideTicker ? '<button type="button" class="row-action hide-btn">隱藏</button>' : '');
  nameCell.innerHTML = `
    <div class="name-main">${escapeHtml(name_zh)}${pendingBadge}</div>
    <div class="name-sub">${escapeHtml(symbol)} · ${escapeHtml(group)}</div>
    <button type="button" class="profile-toggle">${profile ? '▾ 個股筆記' : '＋ 個股筆記'}</button>
    ${rowActionBtn}
    <textarea class="profile-text" placeholder="部位／均價／剩餘股數／股利／里程碑高點…（可換行）">${escapeHtml(profile)}</textarea>
  `;
  const toggleBtn = nameCell.querySelector('.profile-toggle');
  const textarea = nameCell.querySelector('.profile-text');
  toggleBtn.addEventListener('click', () => {
    const open = nameCell.classList.toggle('profile-open');
    toggleBtn.textContent = open ? '▴ 個股筆記' : (textarea.value ? '▾ 個股筆記' : '＋ 個股筆記');
    if (open) textarea.focus();
  });
  let debounceTimer = null;
  textarea.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => setProfile(symbol, textarea.value), 400);
  });
  const hideBtn = nameCell.querySelector('.hide-btn');
  if (hideBtn) hideBtn.addEventListener('click', () => onHideTicker(symbol));
  const removeBtn = nameCell.querySelector('.remove-btn');
  if (removeBtn) {
    removeBtn.addEventListener('click', () => {
      if (window.confirm(`確定要移除「${name_zh}」嗎？此股票的筆記仍會保留，但畫面上不再顯示。`)) onRemoveTicker(symbol);
    });
  }
  tr.appendChild(nameCell);

  for (const date of dateColumns) {
    tr.appendChild(renderCell(dataMap[symbol]?.[date], { symbol, date }));
  }
  if (pinnedDates.length) {
    const sep = document.createElement('td');
    sep.className = 'pin-separator';
    tr.appendChild(sep);
    for (const date of pinnedDates) {
      tr.appendChild(renderCell(recFor(symbol, date, dataMap, pinnedDataMap), { symbol, date }));
    }
  }
  return tr;
}

function buildMarketNoteRow(dateColumns, pinnedDates) {
  const tr = document.createElement('tr');
  tr.className = 'market-note-row';
  const label = document.createElement('td');
  label.className = 'name-cell sticky-col market-note-label';
  label.textContent = '大盤筆記';
  tr.appendChild(label);

  const buildTextCell = (date) => {
    const td = document.createElement('td');
    td.className = 'cell market-note-cell';
    const textarea = document.createElement('textarea');
    textarea.className = 'market-note-text';
    textarea.placeholder = '今日大盤／總經筆記…';
    textarea.value = getMarketNote(date);
    let debounceTimer = null;
    textarea.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => setMarketNote(date, textarea.value), 400);
    });
    td.appendChild(textarea);
    return td;
  };

  for (const date of dateColumns) tr.appendChild(buildTextCell(date));
  if (pinnedDates.length) {
    const sep = document.createElement('td');
    sep.className = 'pin-separator';
    tr.appendChild(sep);
    for (const date of pinnedDates) tr.appendChild(buildTextCell(date));
  }
  return tr;
}

function buildGroupHeaderRow(groupName, colCount, collapsed, onToggle) {
  const tr = document.createElement('tr');
  tr.className = 'group-header-row';
  const th = document.createElement('th');
  th.colSpan = colCount + 1;
  th.className = 'group-header sticky-col-group';
  th.innerHTML = `<button type="button" class="group-toggle">${collapsed ? '▶' : '▼'} ${escapeHtml(groupName)}</button>`;
  th.querySelector('button').addEventListener('click', () => onToggle(groupName));
  tr.appendChild(th);
  return tr;
}

export function renderMatrix(container, {
  dataMap,
  pinnedDataMap = {},
  pinnedDates = [],
  roc,
  collapsedGroups,
  onToggleGroup,
  onTogglePin,
  onHideTicker,
  onRemoveTicker,
  pinnedIndexTickers,
  groupedTickers,
}) {
  const dateColumns = collectDateColumns(dataMap);
  const totalCols = totalColumnCount(dateColumns, pinnedDates);
  const table = document.createElement('table');
  table.className = 'matrix';

  const thead = document.createElement('thead');
  thead.appendChild(buildHeaderRow(dateColumns, pinnedDates, roc, onTogglePin));
  table.appendChild(thead);

  // Pinned indices — always visible, not collapsible, above the watchlist groups.
  const indexTbodyGroup = document.createElement('tbody');
  indexTbodyGroup.className = 'pinned-indices';
  for (const idx of pinnedIndexTickers) {
    indexTbodyGroup.appendChild(buildRow(idx, dataMap, pinnedDataMap, dateColumns, pinnedDates));
  }
  indexTbodyGroup.appendChild(buildMarketNoteRow(dateColumns, pinnedDates));
  table.appendChild(indexTbodyGroup);

  const tbody = document.createElement('tbody');
  for (const { group, tickers } of groupedTickers) {
    const collapsed = collapsedGroups.has(group);
    tbody.appendChild(buildGroupHeaderRow(group, totalCols, collapsed, onToggleGroup));
    if (!collapsed) {
      for (const ticker of tickers) {
        tbody.appendChild(buildRow(ticker, dataMap, pinnedDataMap, dateColumns, pinnedDates, { onHideTicker, onRemoveTicker }));
      }
    }
  }
  table.appendChild(tbody);

  container.replaceChildren(table);

  // Auto-scroll to the latest trading day.
  const wrapper = container;
  requestAnimationFrame(() => {
    wrapper.scrollLeft = wrapper.scrollWidth;
  });

  return { dateColumns };
}
