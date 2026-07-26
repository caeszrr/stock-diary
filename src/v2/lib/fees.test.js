import { describe, it, expect } from 'vitest';
import {
  commission, sellTax, buyCost, sellProceeds,
  breakEvenSellPrice, riskReward, roundTripPnl,
} from './fees.js';

// 費率:手續費 0.1353% 雙邊;當沖賣稅 0.15%;隔日賣稅 0.3%;買進端稅 = 0。
// 手續費/稅各自無條件捨去到整數元。以下期望值全部手算。

describe('fees', () => {
  it('買進成本:100 元 × 1000 股 → 手續費 135、稅 0', () => {
    const r = buyCost(100, 1000);
    expect(r.amount).toBe(100000);
    expect(r.fee).toBe(135); // floor(100000 × 0.001353) = floor(135.3)
    expect(r.tax).toBe(0);
    expect(r.total).toBe(100135);
  });

  it('一般(隔日)賣出:稅 0.3% → 淨入 99565', () => {
    const r = sellProceeds(100, 1000, { dayTrade: false });
    expect(r.fee).toBe(135);
    expect(r.tax).toBe(300); // floor(100000 × 0.003)
    expect(r.total).toBe(99565);
  });

  it('當沖賣出:稅 0.15% → 淨入 99715', () => {
    const r = sellProceeds(100, 1000, { dayTrade: true });
    expect(r.tax).toBe(150); // floor(100000 × 0.0015)
    expect(r.total).toBe(99715);
  });

  it('買進端稅恆為 0(含大部位)', () => {
    expect(buyCost(2350, 100000).tax).toBe(0);
    expect(buyCost(0.5, 1).tax).toBe(0);
  });

  it('零股極端值:500 元 × 1 股 → 手續費捨去為 0', () => {
    const b = buyCost(500, 1);
    expect(b.fee).toBe(0); // floor(500 × 0.001353) = floor(0.6765)
    expect(b.total).toBe(500);
    const s = sellProceeds(500, 1, { dayTrade: false });
    expect(s.tax).toBe(1); // floor(1.5)
    expect(s.total).toBe(499);
  });

  it('超大部位:2350 × 100000 股手續費 = 317955', () => {
    expect(commission(2350 * 100000)).toBe(317955); // floor(235,000,000 × 0.001353)
  });

  it('損益兩平賣價(隔日):entry 100 → ≈ 100.573', () => {
    // 100 × 1.001353 / (1 − 0.001353 − 0.003)
    expect(breakEvenSellPrice(100, { dayTrade: false })).toBeCloseTo(100.573, 2);
  });

  it('損益兩平賣價(當沖)低於隔日:entry 100 → ≈ 100.422', () => {
    const dt = breakEvenSellPrice(100, { dayTrade: true });
    expect(dt).toBeCloseTo(100.422, 2);
    expect(dt).toBeLessThan(breakEvenSellPrice(100, { dayTrade: false }));
  });

  it('風報比:買進 100/停損 95/目標 110 → 2;停損放錯邊 → null', () => {
    expect(riskReward({ direction: 'buy', entry: 100, stop: 95, target: 110 })).toBe(2);
    expect(riskReward({ direction: 'sell', entry: 100, stop: 105, target: 90 })).toBe(2);
    expect(riskReward({ direction: 'buy', entry: 100, stop: 105, target: 110 })).toBeNull();
    expect(riskReward({ direction: 'buy', entry: 100, stop: 95, target: 102 })).toBeCloseTo(0.4, 10);
    // 目標在虧損側(買進但目標 < 進場)一樣無效
    expect(riskReward({ direction: 'buy', entry: 100, stop: 95, target: 98 })).toBeNull();
  });

  it('來回結算:買 100 賣 102 × 1000(隔日)→ 淨損益 1421;當沖平盤 → −420', () => {
    const r = roundTripPnl({ buyPrice: 100, sellPrice: 102, qty: 1000, dayTrade: false });
    expect(r.buyFee).toBe(135);
    expect(r.sellFee).toBe(138); // floor(102000 × 0.001353) = floor(138.006)
    expect(r.sellTax).toBe(306);
    expect(r.totalFees).toBe(579);
    expect(r.gross).toBe(2000);
    expect(r.net).toBe(1421);

    const flat = roundTripPnl({ buyPrice: 100, sellPrice: 100, qty: 1000, dayTrade: true });
    expect(flat.net).toBe(-(135 + 135 + 150));
  });
});
