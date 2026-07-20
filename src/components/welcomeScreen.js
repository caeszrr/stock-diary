import { setStartMode } from '../lib/userData.js';

/** Full-screen first-visit choice. Calls onChosen(mode) after the user picks and the overlay is removed. */
export function renderWelcome(rootEl, onChosen) {
  const overlay = document.createElement('div');
  overlay.className = 'welcome-overlay';
  overlay.innerHTML = `
    <div class="welcome-panel">
      <h1>歡迎使用股票日記</h1>
      <p class="welcome-intro">請選擇您想要的起始畫面。之後隨時可以在「設定」裡切換，不會影響已記錄的筆記。</p>
      <div class="welcome-choices">
        <button type="button" class="welcome-choice" data-mode="full">
          <span class="welcome-choice-title">載入完整預設清單</span>
          <span class="welcome-choice-desc">直接顯示已經幫您準備好的台美股觀察清單</span>
        </button>
        <button type="button" class="welcome-choice" data-mode="blank">
          <span class="welcome-choice-title">從空白開始</span>
          <span class="welcome-choice-desc">只顯示大盤指數，自己新增想追蹤的股票</span>
        </button>
      </div>
    </div>
  `;
  rootEl.appendChild(overlay);
  for (const btn of overlay.querySelectorAll('.welcome-choice')) {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      setStartMode(mode);
      overlay.remove();
      onChosen(mode);
    });
  }
}
