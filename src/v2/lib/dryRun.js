/**
 * dryRun 總開關。
 *
 * true  = 今晚模式:所有「儲存/定案/成交確認」只進記憶體草稿層,
 *         完整 payload 記錄於 draftStore 的 payloadLog(設定頁可檢視);
 *         真實寫入函式(v2store.persistAll)已寫好但被此旗標擋住。
 * false = 真實寫入 localStorage key `stockDiaryV2`(與 v1 使用者資料完全分離)。
 *
 * 晨間切換步驟:把下面這行改成 `export const DRY_RUN = false;`,
 * 重新整理頁面,親手做第一筆真實寫入當驗收。
 */
export const DRY_RUN = true;
