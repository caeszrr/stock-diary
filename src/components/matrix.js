import { formatDateHeader, escapeHtml } from '../lib/format.js';
import { renderCell } from './cell.js';
import { marketKeysFor, expectedSessionDate, tradingDaysInMonth } from '../lib/marketCalendar.js';
import { getMarketNote, setMarketNote, getProfile, setProfile, isPinned } from '../lib/userData.js';

/**
 * The month's columns, driven by the CALENDAR and then filled from the data —
 * not the other way round.
 *
 * Deriving columns from whatever dates happened to be in dataMap made the grid
 * a mirror of the pipeline's mood: a month with no successful run rendered no
 * columns at all (a black void), a half-fetched month silently rendered short,
 * and a session that went missing left no trace to notice. With every scheduled
 * trading day pre-rendered, a new month is just numbers filling into a layout
 * that already exists, and a hole is visible as a hole.
 *
 * Columns are the union of BOTH calendars' trading days: a US session on a
 * Taiwan holiday is still a real column (the 美股 rows have data), and the TW
 * rows in it render 休 per-row. Weekends, closed for everyone, never appear.
 *
 * Any date present in the data is also included even if the calendar disagrees.
 * That is the contradiction case — if we hold records for a day marked closed,
 * the right response is to show it, not to hide the evidence.
 */
function collectDateColumns(dataMap, year, month) {
  const dates = new Set();
  if (year && month) {
    for (const d of tradingDaysInMonth('tw', year, month)) dates.add(d);
    for (const d of tradingDaysInMonth('us', year, month)) dates.add(d);
  }
  const prefix = year && month ? `${year}-${month}` : null;
  for (const bySymbol of Object.values(dataMap)) {
    for (const date of Object.keys(bySymbol)) {
      if (!prefix || date.startsWith(prefix)) dates.add(date);
    }
  }
  return [...dates].sort();
}

function recFor(symbol, date, dataMap, pinnedDataMap) {
  return dataMap[symbol]?.[date] ?? pinnedDataMap?.[symbol]?.[date];
}

function buildHeaderCell(date, roc, onTogglePin, { future = false } = {}) {
  const th = document.createElement('th');
  // A future column is present and labelled but visibly recessive — the user can
  // see the shape of the month ahead without mistaking it for missing data.
  th.className = `date-col sticky-row${future ? ' date-col-future' : ''}`;
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

function buildHeaderRow(dateColumns, pinnedDates, roc, onTogglePin, futureFrom) {
  const tr = document.createElement('tr');
  const corner = document.createElement('th');
  corner.className = 'corner-cell sticky-col sticky-row';
  corner.textContent = '個股';
  tr.appendChild(corner);
  for (const date of dateColumns) {
    tr.appendChild(buildHeaderCell(date, roc, onTogglePin, { future: !!futureFrom && date > futureFrom }));
  }
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

function buildRow({ symbol, name_zh, group, market, pending, isUserAdded }, dataMap, pinnedDataMap, dateColumns, pinnedDates, { onHideTicker, onRemoveTicker, coverage = {} } = {}) {
  const tr = document.createElement('tr');
  tr.className = 'stock-row';
  tr.dataset.symbol = symbol;

  const { cov: covKey, cal } = marketKeysFor({ market, symbol });
  // expectedSession is the calendar's yardstick, NOT the coverage record's
  // sessionDate. A blank past that yardstick is a future day; a blank before it
  // is data we owe the user. Deriving it from coverage instead would let a
  // stalled pipeline redefine "future" and hide its own gap.
  const stateCtx = {
    covMarket: covKey,
    calMarket: cal,
    coverage: covKey ? coverage[covKey] : null,
    expectedSession: expectedSessionDate(cal),
  };

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
    tr.appendChild(renderCell(dataMap[symbol]?.[date], { symbol, date, stateCtx }));
  }
  if (pinnedDates.length) {
    const sep = document.createElement('td');
    sep.className = 'pin-separator';
    tr.appendChild(sep);
    for (const date of pinnedDates) {
      tr.appendChild(renderCell(recFor(symbol, date, dataMap, pinnedDataMap), { symbol, date, stateCtx }));
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
  coverage = {},
  year,
  month,
}) {
  const dateColumns = collectDateColumns(dataMap, year, month);
  const totalCols = totalColumnCount(dateColumns, pinnedDates);
  // Anything past the later of the two markets' expected sessions is genuinely
  // in the future and should look it.
  const futureFrom = [expectedSessionDate('tw'), expectedSessionDate('us')].sort().pop();
  const table = document.createElement('table');
  table.className = 'matrix';

  const thead = document.createElement('thead');
  thead.appendChild(buildHeaderRow(dateColumns, pinnedDates, roc, onTogglePin, futureFrom));
  table.appendChild(thead);

  // Pinned indices — always visible, not collapsible, above the watchlist groups.
  const indexTbodyGroup = document.createElement('tbody');
  indexTbodyGroup.className = 'pinned-indices';
  for (const idx of pinnedIndexTickers) {
    indexTbodyGroup.appendChild(buildRow(idx, dataMap, pinnedDataMap, dateColumns, pinnedDates, { coverage }));
  }
  indexTbodyGroup.appendChild(buildMarketNoteRow(dateColumns, pinnedDates));
  table.appendChild(indexTbodyGroup);

  const tbody = document.createElement('tbody');
  for (const { group, tickers } of groupedTickers) {
    const collapsed = collapsedGroups.has(group);
    tbody.appendChild(buildGroupHeaderRow(group, totalCols, collapsed, onToggleGroup));
    if (!collapsed) {
      for (const ticker of tickers) {
        tbody.appendChild(buildRow(ticker, dataMap, pinnedDataMap, dateColumns, pinnedDates, { onHideTicker, onRemoveTicker, coverage }));
      }
    }
  }
  table.appendChild(tbody);

  container.replaceChildren(table);

  // Auto-scroll to the latest session that actually has data.
  //
  // This used to be `scrollLeft = scrollWidth` — jump to the far right — which
  // was right only while the last column was also the newest data. Now that the
  // whole month is pre-rendered, the far right is the END OF THE MONTH, so that
  // line landed the user on a wall of blank future columns (worst on a phone,
  // where it reads as an empty app). Scroll to the data instead.
  const wrapper = container;
  requestAnimationFrame(() => {
    const withData = new Set();
    for (const byDate of Object.values(dataMap)) {
      for (const [date, rec] of Object.entries(byDate)) {
        if (rec && rec.c !== undefined) withData.add(date);
      }
    }
    const inMonth = [...withData].filter((d) => dateColumns.includes(d)).sort();
    const target = inMonth.pop() || futureFrom;

    const headers = [...wrapper.querySelectorAll('th.date-col[data-date]')];
    if (!headers.length) return;
    const th =
      headers.find((h) => h.dataset.date === target) ||
      [...headers].reverse().find((h) => h.dataset.date <= target);
    if (!th) {
      // Every column is in the future (a month that has not started): stay at
      // the left edge, on the first scheduled trading day.
      wrapper.scrollLeft = 0;
      return;
    }
    const stickyWidth = table.querySelector('.sticky-col')?.getBoundingClientRect().width || 0;
    // Keep two columns of lead-in so the target sits in context rather than
    // jammed against the sticky name column.
    const lead = th.getBoundingClientRect().width * 2;
    wrapper.scrollLeft = Math.max(0, th.offsetLeft - stickyWidth - lead);
  });

  return { dateColumns };
}
