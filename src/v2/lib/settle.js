/**
 * S7 當日結算 — 純機械計算,無任何推論。
 *
 * 規則(全部顯示在 UI 上):
 * - 只計「已確認成交」;逐筆列 價金/手續費/稅。
 * - 稅率:同日同檔「有買也有賣」的賣出視為當沖(0.15%);其餘賣出 0.3%;買進 0。
 * - 已實現損益:同檔內以 FIFO 將賣出配對買進;配對到的數量算毛損益。
 * - 淨損益 = 已配對毛損益 − 今日全部費用(含未配對單邊的費用,誠實從嚴)。
 * - 未配對的股數列為「單邊(未平倉/賣既有持股)」,不捏造其損益。
 */
import { commission, sellTax } from './fees.js';

export function settleDay(fills) {
  const bySymbol = new Map();
  for (const f of fills) {
    if (!bySymbol.has(f.symbol)) bySymbol.set(f.symbol, []);
    bySymbol.get(f.symbol).push(f);
  }

  const rows = []; // 逐筆費用明細
  const matches = []; // FIFO 配對
  let totalFees = 0;
  let grossMatched = 0;

  for (const [symbol, list] of bySymbol) {
    list.sort((a, b) => (a.ts < b.ts ? -1 : 1));
    const hasBuy = list.some((f) => f.direction === 'buy');
    const hasSell = list.some((f) => f.direction === 'sell');
    const sameDayRoundTrip = hasBuy && hasSell;

    for (const f of list) {
      const amount = f.price * f.qty;
      const fee = commission(amount);
      const tax = f.direction === 'sell' ? sellTax(amount, { dayTrade: sameDayRoundTrip }) : 0;
      totalFees += fee + tax;
      rows.push({ ...f, amount, fee, tax, dayTradeTax: f.direction === 'sell' && sameDayRoundTrip });
    }

    // FIFO 配對
    const buyQueue = list.filter((f) => f.direction === 'buy').map((f) => ({ ...f, remain: f.qty }));
    for (const s of list.filter((f) => f.direction === 'sell')) {
      let sellRemain = s.qty;
      for (const b of buyQueue) {
        if (sellRemain <= 0 || b.remain <= 0) continue;
        const q = Math.min(b.remain, sellRemain);
        b.remain -= q;
        sellRemain -= q;
        const gross = (s.price - b.price) * q;
        grossMatched += gross;
        matches.push({ symbol, name: s.name, qty: q, buyPrice: b.price, sellPrice: s.price, gross });
      }
      if (sellRemain > 0) {
        matches.push({ symbol, name: s.name, qty: sellRemain, buyPrice: null, sellPrice: s.price, gross: null, oneSided: 'sell' });
      }
    }
    for (const b of buyQueue) {
      if (b.remain > 0) matches.push({ symbol, name: b.name, qty: b.remain, buyPrice: b.price, sellPrice: null, gross: null, oneSided: 'buy' });
    }
  }

  return { rows, matches, totalFees, grossMatched, net: grossMatched - totalFees };
}
