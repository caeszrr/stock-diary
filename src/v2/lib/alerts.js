/**
 * S3 警報引擎(v2 內薄實作;見 DECISIONS.md D5)。
 * 門檻判定 + 頁內警示;Telegram 為薄轉接層 stub —
 * 介面完整,實際只把要發送的訊息寫入 payloadLog(靜態站無後端,
 * 晨間接上 bot token/後端時替換 sendTelegram 的實作即可)。
 */
import { DRY_RUN } from './dryRun.js';
import { payloadLog } from './draftStore.js';

/**
 * 以最近收盤價評估一筆計畫:
 *   pct     = 現價(最近收盤)距進場價的百分比(帶方向)
 *   near    = |pct| ≤ 該筆門檻(預設 2%)
 *   touched = 已觸價(買進:價 ≤ 進場;賣出:價 ≥ 進場)
 */
export function evaluatePlan(plan, quote) {
  if (!quote || quote.c === undefined || !(plan.entry > 0)) return null;
  const pct = ((quote.c - plan.entry) / plan.entry) * 100;
  const near = Math.abs(pct) <= plan.thresholdPct;
  const touched = plan.direction === 'buy' ? quote.c <= plan.entry : quote.c >= plan.entry;
  return { pct, near, touched, price: quote.c, priceDate: quote.date };
}

/** Telegram 薄轉接層(stub):記錄要發送的訊息,不做網路請求。 */
export function sendTelegram(message) {
  payloadLog.push({
    ts: new Date().toISOString(),
    action: 'alert.telegram(stub)',
    dryRun: DRY_RUN,
    payload: { message, note: '未接後端 — 僅記錄。接上 bot token 後替換此函式實作。' },
  });
  console.info('[v2 alert→telegram stub]', message);
}

// 同一計畫同一條件只警示一次(頁面 session 內防洗版)
const alerted = new Set();

/** 檢查所有計畫,回傳觸發清單並對新觸發者送出(stub)通知。 */
export function checkAlerts(plans, quotes) {
  const triggered = [];
  for (const p of plans) {
    if (p.status !== 'planned') continue;
    const ev = evaluatePlan(p, quotes[p.symbol]);
    if (!ev) continue;
    const kind = ev.touched ? 'touched' : (ev.near ? 'near' : null);
    if (!kind) continue;
    triggered.push({ plan: p, ev, kind });
    const key = `${p.id}:${kind}`;
    if (!alerted.has(key)) {
      alerted.add(key);
      const verb = kind === 'touched' ? '已觸價' : `接近進場價(門檻 ${p.thresholdPct}%)`;
      sendTelegram(`【盯盤】${p.symbol} ${p.name || ''} ${verb}:最近收盤 ${ev.price}(${ev.priceDate}),進場 ${p.entry},距離 ${ev.pct.toFixed(2)}%`);
    }
  }
  return triggered;
}
