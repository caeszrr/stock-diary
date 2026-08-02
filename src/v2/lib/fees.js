/**
 * 台股費用計算(機械公式,唯一費率來源;見 DECISIONS.md D2)。
 *
 * 費率(prompt 明定):
 *   手續費 0.1353% 買賣雙邊
 *   證交稅:當沖賣出 0.15%;一般(隔日)賣出 0.3%;買進端 = 0
 * 金額處理:手續費與稅各自無條件捨去到整數元(台灣券商通例)。
 * 不擅自加最低手續費(minFee 預設 0,保留參數供日後設定)。
 */
export const FEE_RATE = 0.001353;
export const TAX_DAYTRADE_SELL = 0.0015;
export const TAX_NORMAL_SELL = 0.003;

/** 手續費(單邊):floor(價金 × 0.1353%),不低於 minFee。 */
export function commission(amount, { minFee = 0 } = {}) {
  if (!(amount > 0)) return 0;
  return Math.max(Math.floor(amount * FEE_RATE), minFee);
}

/** 賣出證交稅:floor(價金 × 稅率);買進為 0。 */
export function sellTax(amount, { dayTrade = false } = {}) {
  if (!(amount > 0)) return 0;
  return Math.floor(amount * (dayTrade ? TAX_DAYTRADE_SELL : TAX_NORMAL_SELL));
}

/** 買進總成本 = 價金 + 手續費(買進端稅 = 0)。 */
export function buyCost(price, qty, opts = {}) {
  const amount = price * qty;
  const fee = commission(amount, opts);
  return { amount, fee, tax: 0, total: amount + fee };
}

/** 賣出淨入 = 價金 − 手續費 − 證交稅。 */
export function sellProceeds(price, qty, { dayTrade = false, minFee = 0 } = {}) {
  const amount = price * qty;
  const fee = commission(amount, { minFee });
  const tax = sellTax(amount, { dayTrade });
  return { amount, fee, tax, total: amount - fee - tax };
}

/**
 * 含費損益兩平賣價(近似連續式,顯示用):
 * P × (1 − feeRate − taxRate) = entry × (1 + feeRate)
 */
export function breakEvenSellPrice(entry, { dayTrade = false } = {}) {
  if (!(entry > 0)) return 0;
  const taxRate = dayTrade ? TAX_DAYTRADE_SELL : TAX_NORMAL_SELL;
  return (entry * (1 + FEE_RATE)) / (1 - FEE_RATE - taxRate);
}

/** 做空方向的損益兩平回補價:entry × (1 − feeRate − taxRate) / (1 + feeRate)。 */
export function breakEvenBuyBackPrice(entry, { dayTrade = false } = {}) {
  if (!(entry > 0)) return 0;
  const taxRate = dayTrade ? TAX_DAYTRADE_SELL : TAX_NORMAL_SELL;
  return (entry * (1 - FEE_RATE - taxRate)) / (1 + FEE_RATE);
}

/**
 * 風報比 = |目標 − 進場| / |進場 − 停損|。
 * 停損必須在虧損側、目標在獲利側,否則回傳 null(視為無效計畫)。
 */
export function riskReward({ direction, entry, stop, target }) {
  if (!(entry > 0) || !(stop > 0) || !(target > 0)) return null;
  const risk = direction === 'sell' ? stop - entry : entry - stop;
  const reward = direction === 'sell' ? entry - target : target - entry;
  if (risk <= 0 || reward <= 0) return null;
  return reward / risk;
}

/**
 * 一買一賣的含費損益回顧(S7 結算用)。
 * 回傳逐項費用明細與淨損益。
 */
export function roundTripPnl({ buyPrice, sellPrice, qty, dayTrade = false, minFee = 0 }) {
  const buy = buyCost(buyPrice, qty, { minFee });
  const sell = sellProceeds(sellPrice, qty, { dayTrade, minFee });
  return {
    buyAmount: buy.amount,
    buyFee: buy.fee,
    sellAmount: sell.amount,
    sellFee: sell.fee,
    sellTax: sell.tax,
    totalFees: buy.fee + sell.fee + sell.tax,
    gross: sell.amount - buy.amount,
    net: sell.total - buy.total,
  };
}
