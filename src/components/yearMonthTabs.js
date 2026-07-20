export function renderTabs(container, { years, monthsByYear, selectedYear, selectedMonth, onSelectYear, onSelectMonth }) {
  container.innerHTML = '';

  const yearRow = document.createElement('div');
  yearRow.className = 'tabs-row tabs-year';
  for (const year of years) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `tab-btn${year === selectedYear ? ' active' : ''}`;
    btn.textContent = `${year}年`;
    btn.addEventListener('click', () => onSelectYear(year));
    yearRow.appendChild(btn);
  }
  container.appendChild(yearRow);

  const monthRow = document.createElement('div');
  monthRow.className = 'tabs-row tabs-month';
  const available = new Set(monthsByYear[selectedYear] || []);
  for (let m = 1; m <= 12; m += 1) {
    const mm = String(m).padStart(2, '0');
    const btn = document.createElement('button');
    btn.type = 'button';
    const isAvailable = available.has(mm);
    btn.className = `tab-btn month-btn${mm === selectedMonth ? ' active' : ''}${isAvailable ? '' : ' disabled'}`;
    btn.textContent = `${m}月`;
    btn.disabled = !isAvailable;
    if (isAvailable) btn.addEventListener('click', () => onSelectMonth(mm));
    monthRow.appendChild(btn);
  }
  container.appendChild(monthRow);
}
