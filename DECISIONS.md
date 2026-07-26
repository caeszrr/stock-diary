# DECISIONS — 2026-07-26 深夜自主長跑 v2

整夜遇到選擇時的決定與理由。時間以 `date` 實測時鐘(2026-07-27 凌晨)為準。

## D1 — Prompt 假設與本 repo 現實不符(03:15)
Prompt 多處要求「重用既有」:feeCalculator、Fugle 連線、警報引擎+Telegram、
v1 追加下單邏輯、SQLite 資料庫、vitest。經全 repo grep 與檔案勘查,**以上皆不存在**。
本 repo 是 vanilla JS + Vite 靜態站(GitHub Pages),資料 = `public/data/*.json`
(EOD 報價管線)+ localStorage(使用者資料)。
**決定**:依整夜規則不中斷、不發問,在 `src/v2/**` 內自建對應能力,逐項如下
(D2–D8),全部記錄。

## D2 — 費用計算器自建(取代「重用 feeCalculator」)
無既有 feeCalculator 可 import。**決定**:於 `src/v2/lib/fees.js` 依 prompt 明定
費率機械實作:手續費 0.1353% 雙邊、當沖賣稅 0.15%、隔日(一般)賣稅 0.3%、
買進端稅 = 0。**不擅自加最低手續費 NT$20**(各券商折扣不同,擅自加會讓數字
與使用者實際帳單不符);函式保留 `minFee` 參數(預設 0)供日後設定。
以 vitest 單元測試鎖住公式(見 D4)。

## D3 — 「Fugle 連線」頂部狀態列改為誠實的資料管線狀態
無 Fugle SDK/金鑰。**決定**:頂部狀態列顯示兩件事:
(1)「Fugle 即時:未接通」固定灰色狀態(誠實呈現,不假裝有即時源);
(2) 既有 EOD 管線狀態:重用 `src/lib/loadMonth.js` 的 `loadStatus()`,顯示
最新交易日與覆蓋完整度。所有「現價」欄位一律標示「最近收盤」,絕不偽裝即時
(CLAUDE.md:禁止捏造市場資料)。

## D4 — 新依賴:vitest(devDependency,官方 npm registry)
M4 要求 vitest 單元測試,repo 無任何測試框架。**決定**:安裝 `vitest`
(僅 devDependency,官方 registry),`package.json` 加 `"test": "vitest run"`。
此為鐵律 4 明文允許的「新依賴記入 DECISIONS.md」路徑;`package.json`/
`package-lock.json` 的 diff 列入晨報。

## D5 — S3 警報:頁內警示 + Telegram 薄轉接層(stub)
無既有警報引擎與 Telegram 整合。**決定**:`src/v2/lib/alerts.js` 自建門檻判定
(預設 2%、每筆可調)與頁內醒目警示;Telegram 端寫成薄轉接層
`sendTelegram()` — 介面完整但因無 bot token/後端而為記錄型 stub(把要發的
訊息寫入 payload 紀錄),晨間接上真憑證即可替換實作。靜態站無伺服器,
真正的 Telegram 發送本來就需另外的後端或 GitHub Actions,今晚不越界建後端。

## D6 — dryRun 草稿層與真實寫入目標
無 SQLite;本專案「生產資料」= v1 的 localStorage(`src/lib/userData.js`)與
`public/data/*.json`。**決定**:整夜對兩者零寫入。v2 自建
`src/v2/lib/v2store.js`,真實寫入目標為**獨立** localStorage key
(`stockDiaryV2`,與 v1 的 key 完全分離),遵守「單一模組談 localStorage」的
既有抽象精神。dryRun 開關在 `src/v2/lib/dryRun.js`(`DRY_RUN = true`):
所有儲存/定案/成交確認走記憶體草稿層 + 完整 payload 紀錄(UI 可檢視);
真實寫入函式已寫好但被 DRY_RUN 擋住。**副作用(誠實揭露)**:dryRun 模式下
重新整理頁面會清空草稿 — 晨間驗收請在同一頁面 session 內走完流程。

## D7 — 接線的唯一例外檔 = `src/main.js`
v1 無路由、無側欄,進入點是 `src/main.js`。**決定**:唯一動到的既有檔案為
`src/main.js`:(1) 開頭攔截 `#/v2` hash → 動態 import `src/v2/main.js` 並跳過
v1 初始化;(2) v1 頁首加一顆「V2 新版」入口按鈕。app 預設(無 hash)仍進 v1。
完整 diff 列入晨報。

## D8 — S5「參考 v1 既有追加下單邏輯」
v1 無任何下單邏輯可參考。**決定**:依 prompt 規格全新實作(成交確認完成瞬間
彈出「同股下一筆?」、預填同檔、方向預設反向可切換、`chainParent` 鏈結並在
畫面顯示鏈條)。

## D9 — 「現價」資料源與距離條
唯一合法報價源 = `public/data/`(EOD)。**決定**:S1 即時價卡與 S3 距離條
以「最近收盤價」計算,卡上明示資料時點;09:00 前(或休市日)無跳動屬正常,
已寫進晨報驗收清單。不接任何未授權的第三方即時報價(避免捏造/來路不明資料)。

## D10 — 交易日頁的「今日」= 台北時區
沿用 v1 慣例(`taipeiTodayIso`):日期判定一律 Asia/Taipei。
過去日期 = 整頁唯讀(輸入禁用 + 頁頂提示);未來日期不開放。
