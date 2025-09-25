// Basic helpers (EMA, statistics)

export function ema(period, values) {
  if (!Array.isArray(values) || values.length === 0) return [];
  const k = 2 / (period + 1);
  const out = [];
  let emaPrev = values[0];
  out.push(emaPrev);
  for (let i = 1; i < values.length; i++) {
    const v = values[i];
    emaPrev = v * k + emaPrev * (1 - k);
    out.push(emaPrev);
  }
  return out;
}

export function slopeUp(arr, lookback = 3) {
  if (!arr || arr.length < lookback + 1) return false;
  const a = arr[arr.length - 1 - lookback];
  const b = arr[arr.length - 1];
  return b > a;
}
export function slopeDown(arr, lookback = 3) {
  if (!arr || arr.length < lookback + 1) return false;
  const a = arr[arr.length - 1 - lookback];
  const b = arr[arr.length - 1];
  return b < a;
}

// Simple stats
export function sum(a) { return a.reduce((x,y)=>x+y,0); }
export function mean(a){ return a.length? sum(a)/a.length : 0; }

export function equityStats(equityCurve){
  if (!equityCurve || !equityCurve.length) return { start:0, end:0, maxDD:0, returnPct:0 };
  const start = equityCurve[0].equity;
  let peak = start;
  let maxDD = 0;
  for (const p of equityCurve) {
    if (p.equity > peak) peak = p.equity;
    const dd = (peak - p.equity);
    if (dd > maxDD) maxDD = dd;
  }
  const end = equityCurve[equityCurve.length-1].equity;
  const returnPct = start? ((end - start)/start)*100 : 0;
  return { start, end, maxDD, returnPct };
}