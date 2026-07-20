import { fmtNum, fmtVolume, changePct, amplitudePct, changeColorClass, escapeHtml } from '../lib/format.js';
import { getCellNote, setCellNote } from '../lib/userData.js';

function emphasisClass(note) {
  if (!note) return '';
  if (note.emphasis === 'bold') return 'note-bold';
  if (note.emphasis === 'highlight') return 'note-highlight';
  return '';
}

function compactHtml(rec, note) {
  if (!rec || rec.c === undefined) return '<div class="cell-empty"></div>';
  const pct = changePct(rec.c, rec.pc);
  const colorClass = changeColorClass(pct);
  const boldClass = pct !== undefined && Math.abs(pct) >= 3 ? 'chg-bold' : '';
  const pctLabel = pct === undefined ? '' : `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`;
  const hasNoteText = note && note.note;
  const shapeLine = note && note.shape ? `<div class="cell-shape">${escapeHtml(note.shape)}</div>` : '';
  return `
    <div class="cell-compact ${colorClass} ${emphasisClass(note)} ${hasNoteText ? 'has-note' : ''}">
      <div class="cell-close">${fmtNum(rec.c)}</div>
      <div class="cell-pct ${boldClass}">${pctLabel}</div>
      ${shapeLine}
    </div>`;
}

function detailRow(label, value) {
  if (value === '' || value === undefined) return '';
  return `<div class="detail-row"><span class="detail-label">${label}</span><span class="detail-value">${value}</span></div>`;
}

function detailHtml(rec) {
  if (!rec) return '';
  const pct = changePct(rec.c, rec.pc);
  const change = rec.c !== undefined && rec.pc !== undefined ? rec.c - rec.pc : undefined;
  const amp = amplitudePct(rec.h, rec.l, rec.pc);
  const yearRange = rec.yh !== undefined || rec.yl !== undefined ? `${fmtNum(rec.yh)} / ${fmtNum(rec.yl)}` : '';
  return `
    <div class="cell-detail">
      ${detailRow('開盤', fmtNum(rec.o))}
      ${detailRow('最高', fmtNum(rec.h))}
      ${detailRow('最低', fmtNum(rec.l))}
      ${detailRow('昨收', fmtNum(rec.pc))}
      ${detailRow('漲跌', change === undefined ? '' : `${change > 0 ? '+' : ''}${fmtNum(change)}`)}
      ${detailRow('總量', fmtVolume(rec.v))}
      ${detailRow('成交金額', fmtVolume(rec.to))}
      ${detailRow('振幅', amp === undefined ? '' : `${amp.toFixed(2)}%`)}
      ${detailRow('一年高低', yearRange)}
    </div>`;
}

function noteEditorHtml(symbol, date, note) {
  const n = note || { shape: '', note: '', emphasis: 'none' };
  const groupName = `emphasis-${symbol}-${date}`;
  const radio = (value, label) => `
    <label class="emphasis-opt">
      <input type="radio" name="${groupName}" value="${value}" ${n.emphasis === value ? 'checked' : ''}>
      ${label}
    </label>`;
  return `
    <div class="note-editor">
      <label class="note-field">
        <span class="note-field-label">形態</span>
        <input type="text" class="note-shape" maxlength="24" placeholder="山丘震平…" value="${escapeHtml(n.shape)}">
      </label>
      <label class="note-field">
        <span class="note-field-label">筆記</span>
        <textarea class="note-text" rows="3" placeholder="自由記錄...">${escapeHtml(n.note)}</textarea>
      </label>
      <div class="note-emphasis">
        <span class="note-field-label">強調</span>
        ${radio('none', '無')}
        ${radio('bold', '粗體')}
        ${radio('highlight', '重點')}
      </div>
    </div>`;
}

/** Builds a <td> for one symbol/date cell, wired to the notes store when symbol+date are given. */
export function renderCell(rec, { symbol, date } = {}) {
  const td = document.createElement('td');
  td.className = 'cell';
  const note = symbol && date ? getCellNote(symbol, date) : null;
  td.innerHTML = compactHtml(rec, note);
  if (!rec || rec.c === undefined || !symbol || !date) return td;

  td.tabIndex = 0;
  const toggle = () => toggleCell(td, rec, symbol, date);
  td.addEventListener('click', toggle);
  td.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  });
  return td;
}

function toggleCell(td, rec, symbol, date) {
  const expanded = td.classList.toggle('expanded');
  const note = getCellNote(symbol, date);
  if (!expanded) {
    td.innerHTML = compactHtml(rec, note);
    return;
  }
  td.innerHTML = compactHtml(rec, note) + detailHtml(rec) + noteEditorHtml(symbol, date, note);
  wireNoteEditor(td, rec, symbol, date);
}

function wireNoteEditor(td, rec, symbol, date) {
  const shapeInput = td.querySelector('.note-shape');
  const textInput = td.querySelector('.note-text');
  const radios = td.querySelectorAll('input[type="radio"]');

  // Clicking/typing inside the editor must not re-collapse the cell.
  td.querySelector('.note-editor').addEventListener('click', (e) => e.stopPropagation());
  td.querySelector('.note-editor').addEventListener('keydown', (e) => e.stopPropagation());

  let debounceTimer = null;
  const persist = () => {
    const emphasis = td.querySelector('input[type="radio"]:checked')?.value || 'none';
    setCellNote(symbol, date, { shape: shapeInput.value, note: textInput.value, emphasis });
    refreshCompact();
  };
  const debouncedPersist = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(persist, 400);
  };
  const refreshCompact = () => {
    const existing = td.querySelector('.cell-compact');
    const note = getCellNote(symbol, date);
    existing.outerHTML = compactHtml(rec, note);
  };

  shapeInput.addEventListener('input', debouncedPersist);
  textInput.addEventListener('input', debouncedPersist);
  for (const r of radios) r.addEventListener('change', persist);
}
