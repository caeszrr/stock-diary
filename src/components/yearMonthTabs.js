import { tabYears, enabledMonths, isCurrentMonth, taipeiTodayIso } from '../lib/monthTabs.js';

/**
 * Year/month tabs. Enablement comes from `calendar ∪ data` (see lib/monthTabs.js),
 * never from the data manifest alone — the current month and current year are
 * always clickable even before that month's first session has been fetched.
 */
export function renderTabs(container, { manifest, selectedYear, selectedMonth, onSelectYear, onSelectMonth, todayIso = taipeiTodayIso() }) {
  container.innerHTML = '';

  const years = tabYears(manifest, todayIso);
  const currentYear = todayIso.slice(0, 4);

  const yearRow = document.createElement('div');
  yearRow.className = 'tabs-row tabs-year';
  for (const year of years) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `tab-btn${year === selectedYear ? ' active' : ''}${year === currentYear ? ' tab-current' : ''}`;
    btn.textContent = `${year}年`;
    btn.addEventListener('click', () => onSelectYear(year));
    yearRow.appendChild(btn);
  }
  container.appendChild(yearRow);

  const monthRow = document.createElement('div');
  monthRow.className = 'tabs-row tabs-month';
  const enabled = enabledMonths(manifest, selectedYear, todayIso);
  for (let m = 1; m <= 12; m += 1) {
    const mm = String(m).padStart(2, '0');
    const current = isCurrentMonth(selectedYear, mm, todayIso);
    // The current month is clickable unconditionally — an empty August must read
    // as "no data yet", never as "this month does not exist".
    const isEnabled = current || enabled.has(mm);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `tab-btn month-btn${mm === selectedMonth ? ' active' : ''}${current ? ' tab-current' : ''}${isEnabled ? '' : ' disabled'}`;
    btn.textContent = `${m}月`;
    btn.disabled = !isEnabled;
    if (!isEnabled) btn.title = '尚未開始交易';
    if (isEnabled) btn.addEventListener('click', () => onSelectMonth(mm));
    monthRow.appendChild(btn);
  }
  container.appendChild(monthRow);
}
