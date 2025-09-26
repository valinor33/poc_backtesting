// ===== Indicadores básicos en el front =====
export function emaSeries(period, candles) {
  if (!Array.isArray(candles) || candles.length === 0) return [];
  const k = 2 / (period + 1);
  let prev = candles[0].close;
  const out = [{ time: candles[0].time, value: prev }];
  for (let i = 1; i < candles.length; i++) {
    const v = candles[i].close * k + prev * (1 - k);
    out.push({ time: candles[i].time, value: v });
    prev = v;
  }
  return out;
}

// FVG scan estilo ICT: para candle i, comparar contra i-2
export function detectFVG(candles, scanBars = 500) {
  const zones = [];
  for (let i = 2; i < candles.length; i++) {
    const c0 = candles[i];
    const c2 = candles[i - 2];
    if (!c0 || !c2) continue;

    // Bullish FVG: Low[i] > High[i-2]
    if (c0.low > c2.high) {
      zones.push({
        startTime: candles[i - 2].time,
        endTime: candles[i].time,
        low: c2.high,
        high: c0.low,
        type: "bull",
        index: i,
      });
    }
    // Bearish FVG: High[i] < Low[i-2]
    if (c0.high < c2.low) {
      zones.push({
        startTime: candles[i - 2].time,
        endTime: candles[i].time,
        low: c0.high,
        high: c2.low,
        type: "bear",
        index: i,
      });
    }
  }
  return zones;
}
