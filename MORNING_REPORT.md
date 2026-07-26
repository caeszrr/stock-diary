# MORNING_REPORT — 2026-07-26 深夜自主長跑 v2

執行時段:2026-07-27 03:09–03:45(`date` 實測)。分支 `fix/coverage-watchdog`,
安全快照 tag:`pre-overnight-20260726`(commit `430c5c1`)。

## 一、完成清單(檔案 + 行號證據)

| 里程碑 | 內容 | 證據 |
|---|---|---|
| M1 | v2 殼:hash 路由、側欄(交易日/金庫/設定啟用,歷史/統計灰)、頂部狀態列、v1「✨ V2 新版」入口 | `src/v2/main.js:16-22`(NAV)、`src/main.js:48`(入口)、commit `b1d04eb` |
| M2 | 日期列 + 七步進度指示 + 過去日整頁唯讀 | `src/v2/pages/day.js:17-25`(STEPS)、`day.js:77`(readonly)、commit `6869628` |
| M3 | S1 定案清單:加入/移除/定案鎖定/解鎖需理由並留存 | `src/v2/pages/day/s1List.js:60-76`、解鎖紀錄 `draftStore.js:81-89`、commit `50358f3` |
| M4 | S2 交易計畫:含費損益兩平、風報比 <1.5 硬閘+原因、所需資金 vs 資金水位(唯讀)、T+2 交割預覽;**10 個 vitest 測試全過** | `src/v2/pages/day/s2Plans.js:66-77`(硬閘)、`src/v2/lib/fees.js`、`fees.test.js`、commit `fa9f1ad` |
| M5 | S3 盯盤:距離條、門檻預設 2% 每筆可調、觸價/接近頁內警示 + 警報引擎 | `src/v2/pages/day/s3Watch.js`、`src/v2/lib/alerts.js:41-56`、commit `a86f935` |
| M6 | S4 成交確認:成交價/股數回報、未成交+一句原因,append 型 payload | `src/v2/pages/day/s4Fills.js`、commit `08085cf` |
| M7 | S5 連環下一筆:成交瞬間彈窗、同股預填、方向預設反向可切換、chainParent 鏈條顯示 | `s4Fills.js:76-110`(openChainDialog)、`chainPrefill.js`、commit `08085cf` |
| M8 | S6 收盤小結 + S7 結算(FIFO 配對、當沖稅自動判定、逐筆費用明細、單邊誠實列示) | `src/v2/pages/day/s6Close.js`、`s7Settle.js`、`src/v2/lib/settle.js`、commit `d5f953c` |
| M9 | 金庫:手動 lot(代號/名稱/股數/均價/擔保品/成本未載/壓箱底)+ 清單 + 「拍照匯入(即將推出)」disabled 主動作 + 空狀態文案 | `src/v2/pages/vault.js`、commit `742e469` |
| M10 | DESIGN.md 逐頁自我審查:違規 2 項 → 修 → 歸零(詳 OVERNIGHT_LOG.md) | commit `7544210` |
| M11 | 打磨:千分位/tabular-nums/載入與錯誤狀態/Enter 鍵盤/超長股名 | commit `3ef814f` |
| M12 | 證明(見下方) | 本檔 + OVERNIGHT_LOG.md |

設計憲法:`src/v2/DESIGN.md`。決策紀錄:`DECISIONS.md`(D1–D10)。

## 二、誠實未完成 / BLOCKED

- **Telegram 實際發送**:repo 無警報後端、無 bot token(BLOCKED)。已建薄轉接層
  `src/v2/lib/alerts.js` `sendTelegram()` — 觸發時把訊息完整寫入動作紀錄,
  晨間接上憑證後只需替換該函式實作。
- **Fugle 即時報價**:無 SDK/金鑰(BLOCKED)。頂部狀態列誠實顯示「未接通」;
  所有現價一律標示「最近收盤(EOD)」,09:00 前無跳動屬正常。
- **S2 計畫「編輯」**:目前僅能刪除重建(updatePlan API 已在草稿層備好,UI 未做)。
- **設定頁**只有資金水位 + dryRun 檢視,其餘為殼。
- **dryRun 草稿在重新整理後消失**(記憶體層特性,D6)— 驗收請一口氣走完。

## 三、DECISIONS 摘要(全文見 DECISIONS.md)

repo 勘查發現 prompt 假設的 feeCalculator/Fugle/Telegram/SQLite/警報引擎/
v1 下單邏輯**皆不存在**(本專案是 vanilla JS + Vite 靜態站)。因此:費用公式
依 prompt 明定費率自建於 `src/v2/lib/fees.js` 並以 10 個單元測試鎖住(D2);
不加最低手續費 NT$20(各券商折扣不同,留 `minFee` 參數,D2);新依賴僅
**vitest**(devDependency,官方 registry,D4);v2 真實寫入目標為獨立
localStorage key `stockDiaryV2`,與 v1 使用者資料完全隔離(D6);唯一動到的
既有檔案 = `src/main.js`(D7,實際變更 **+13 行**,證明見下)。

## 四、如何打開 v2

1. `npm run dev` → 開 http://localhost:5173/stock-diary/(預設進 **v1**,不變)。
2. 點 v1 頁首「**✨ V2 新版**」按鈕,或直接開 `…/stock-diary/#/v2`。
3. 側欄「← 回 V1 版」隨時退回。

## 五、dryRun 開關位置與晨間切換步驟

- 位置:**`src/v2/lib/dryRun.js`**(整個檔案只有一個 `DRY_RUN` 常數)。
- 目前 `export const DRY_RUN = true;` — 所有儲存/定案/成交確認只進記憶體草稿層,
  完整 payload 可在「設定 → 草稿模式 → 動作紀錄」檢視。
- 晨間切換:Caesar 在場時改為 `false` → 重新整理頁面 → 親手做第一筆真實寫入
  (寫入獨立 key `stockDiaryV2`,絕不碰 v1 資料)當驗收。

## 六、Caesar 10 分鐘驗收清單

1. 開 app → 確認**預設仍是 v1**、資料矩陣如常。
2. 點「✨ V2 新版」→ 進 v2 交易日頁(頂部:Fugle 未接通/資料 7/24 收盤/dryRun 徽章)。
3. S1:輸入 `2330` →「加入」→ 見台積電最近收盤卡 →「定案」🔒;
   點「解鎖修改」需填一句理由,理由會留存顯示。
4. S2:進場 100/停損 95/目標 102/股數 1000 → **風報比 0.40 被硬閘擋下**(紅字原因);
   把目標改 110 → 風報比 2.00 放行 → 見損益兩平 100.57、所需資金、T+2 預覽 →「建立計畫」。
5. S3:見距離條與「距進場 %」;把門檻 2% 改成其他值試試。
6. S4:「確認成交」→ 回報成交 → **彈出「同股下一筆?」**。
7. S5:點「建立下一筆」→ S2 表單預填同股、方向已反轉(可切換)、掛 🔗 鏈條標籤。
8. 金庫:手動輸入一筆 lot(勾擔保品/壓箱底試試)→ 清單出現(dryRun)。
9. 切「← 前一日」到過去日期 → 整頁唯讀 + 🔒 提示條。
10. 註明:**09:00 前價格無跳動屬正常**(資料為最近收盤 EOD)。

## 七、M12 證明摘要

- **build**:`vite build` ✓(v2 獨立 chunk `main-*.js` 40.9 kB gzip 12.6 kB)。
- **測試**:`npx vitest run` → **10 passed (10)**。
- **純度**:`grep -rn "agent\|anthropic\|persona" src/v2/` → **0 筆**。
- **範圍**:`git diff pre-overnight-20260726 -- . ':(exclude)src/v2'` 僅:
  `DECISIONS.md`/`OVERNIGHT_LOG.md`/`MORNING_REPORT.md`/`PLAIN_LOG.md`(文件)、
  `backups/`(安全備份)、`package.json`+`package-lock.json`(vitest,D4)、
  `src/main.js`(接線;`git diff -w` 證實**僅 +13 行**,其餘是包進 `startV1()` 的縮排)。
- **Playwright**:桌機 1400×900 + 手機 390×844 全頁掃描、S1–S7 與金庫互動流程
  實測,**零 console error、零 pageerror**;v1 迴歸正常。
- **commit 清單**:M1 `b1d04eb`→M2 `6869628`→M3 `50358f3`→M4 `fa9f1ad`→
  M5 `a86f935`→M6+M7 `08085cf`→M8 `d5f953c`→M9 `742e469`→M10 `7544210`→
  M11 `3ef814f`→M12(本檔 commit)。

## 八、緊急回滾

```
git reset --hard pre-overnight-20260726
```
**警告:會清掉整晚成果,只有 app 打不開才用。**(v2 走獨立 chunk、預設進 v1,
理論上 v1 壞掉的唯一面積是 src/main.js 那 13 行接線。)
