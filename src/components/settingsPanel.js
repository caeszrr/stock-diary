import { downloadBackup, importBackupFromText, getStartMode, setTickerHidden } from '../lib/userData.js';
import { hiddenConfigTickers } from '../lib/watchlist.js';
import { escapeHtml } from '../lib/format.js';

function alertZh(msg) {
  window.alert(msg);
}

/**
 * Renders the settings gear button + modal panel. `sections` is an array of
 * { title, render(container) } — later phases (start mode, install guide,
 * 使用說明) append sections here without touching this file's structure.
 */
export function renderSettings(container, { onStartModeChange, onUnhideTicker, extraSections = [] } = {}) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'settings-btn';
  btn.title = '設定';
  btn.textContent = '⚙ 設定';
  container.appendChild(btn);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay hidden';
  overlay.innerHTML = `
    <div class="modal-panel" role="dialog" aria-label="設定">
      <div class="modal-header">
        <h2>設定</h2>
        <button type="button" class="modal-close" aria-label="關閉">✕</button>
      </div>
      <div class="modal-body" id="settings-body"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  const body = overlay.querySelector('#settings-body');

  function section(title, html) {
    const div = document.createElement('div');
    div.className = 'settings-section';
    div.innerHTML = `<h3>${title}</h3>${html}`;
    return div;
  }

  // 使用說明
  const helpSection = section('使用說明', `
    <p class="settings-note">股票日記會在每個交易日收盤後自動更新價格，您只需要打開網頁查看、記筆記即可，不需要手動做任何操作。</p>
    <p class="settings-field-label">安裝到電腦（Chrome / Edge）</p>
    <ol class="settings-steps">
      <li>用 Chrome 或 Edge 開啟這個網站</li>
      <li>點網址列最右邊的安裝圖示（或按右上角選單 ⋮ → 「安裝股票日記」）</li>
      <li>按「安裝」，桌面就會出現捷徑，之後點它開啟是獨立視窗，不用再找瀏覽器分頁</li>
    </ol>
    <p class="settings-field-label">安裝到手機</p>
    <ol class="settings-steps">
      <li><strong>Android（Chrome）</strong>：右上角選單 ⋮ → 「新增至主畫面」或「安裝應用程式」→ 確認</li>
      <li><strong>iPhone（Safari）</strong>：底部的分享圖示 ⬆ → 往下找「加入主畫面」→ 確認</li>
    </ol>
    <p class="settings-note">⚠️ 重要：您的筆記、標記、自選股清單都只存在<strong>這台裝置的這個瀏覽器</strong>裡，換手機、換電腦或清除瀏覽器資料都不會跟著走。請定期到下方「備份與還原」匯出備份存檔。</p>
  `);
  body.appendChild(helpSection);

  // 備份與還原
  const backupSection = section('備份與還原', `
    <p class="settings-note">您的所有筆記、標記、自選股都只儲存在<strong>這台裝置的瀏覽器</strong>裡，不會自動上傳。
    請定期按「匯出備份」下載一份存檔；若清除瀏覽器資料、換裝置或換瀏覽器，務必先匯入備份，否則筆記將會遺失且無法復原。</p>
    <div class="settings-actions">
      <button type="button" class="btn-primary" id="export-backup-btn">⬇ 匯出備份</button>
      <label class="btn-secondary file-btn">
        ⬆ 匯入備份
        <input type="file" accept="application/json" id="import-backup-input" hidden>
      </label>
    </div>
  `);
  body.appendChild(backupSection);
  backupSection.querySelector('#export-backup-btn').addEventListener('click', () => {
    downloadBackup();
  });
  backupSection.querySelector('#import-backup-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    try {
      importBackupFromText(text);
      alertZh('匯入成功！頁面即將重新整理。');
      window.location.reload();
    } catch {
      alertZh('匯入失敗：這不是有效的股票日記備份檔，請確認檔案內容。');
    } finally {
      e.target.value = '';
    }
  });

  // 顯示模式
  const modeSection = section('顯示模式', `
    <p class="settings-note">您可以隨時切換，不會影響已記錄的筆記。</p>
    <div class="settings-actions">
      <button type="button" class="btn-secondary" data-mode="full">載入完整預設清單</button>
      <button type="button" class="btn-secondary" data-mode="blank">從空白開始</button>
    </div>
    <p class="settings-note current-mode-note"></p>
  `);
  body.appendChild(modeSection);
  const currentModeNote = modeSection.querySelector('.current-mode-note');
  function refreshModeNote() {
    const mode = getStartMode();
    currentModeNote.textContent = `目前模式：${mode === 'blank' ? '從空白開始' : '完整預設清單'}`;
  }
  refreshModeNote();
  for (const b of modeSection.querySelectorAll('[data-mode]')) {
    b.addEventListener('click', () => {
      const mode = b.dataset.mode;
      if (mode === getStartMode()) return;
      const msg = mode === 'full'
        ? '切換為「完整預設清單」會顯示所有預設股票（先前隱藏的仍維持隱藏），您的筆記不會受影響，確定切換？'
        : '切換為「從空白開始」會隱藏所有預設股票，只保留您自行新增的股票與指數列，您的筆記不會受影響，確定切換？';
      if (!window.confirm(msg)) return;
      onStartModeChange?.(mode);
      refreshModeNote();
    });
  }

  // 已隱藏股票
  const hiddenSection = section('已隱藏股票', '<div class="hidden-ticker-list"></div>');
  body.appendChild(hiddenSection);
  const hiddenListEl = hiddenSection.querySelector('.hidden-ticker-list');
  function refreshHiddenList() {
    const hidden = hiddenConfigTickers();
    if (!hidden.length) {
      hiddenListEl.innerHTML = '<p class="settings-note">目前沒有隱藏的股票。</p>';
      return;
    }
    hiddenListEl.innerHTML = hidden.map((t) => `
      <div class="hidden-ticker-row" data-symbol="${escapeHtml(t.symbol)}">
        <span>${escapeHtml(t.name_zh)}（${escapeHtml(t.symbol)}）</span>
        <button type="button" class="btn-secondary unhide-btn">取消隱藏</button>
      </div>`).join('');
    for (const row of hiddenListEl.querySelectorAll('.hidden-ticker-row')) {
      row.querySelector('.unhide-btn').addEventListener('click', () => {
        setTickerHidden(row.dataset.symbol, false);
        onUnhideTicker?.();
        refreshHiddenList();
      });
    }
  }
  refreshHiddenList();

  for (const { title, html } of extraSections) {
    body.appendChild(section(title, html));
  }

  function open() {
    refreshHiddenList();
    refreshModeNote();
    overlay.classList.remove('hidden');
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

  return { open, close, body };
}
