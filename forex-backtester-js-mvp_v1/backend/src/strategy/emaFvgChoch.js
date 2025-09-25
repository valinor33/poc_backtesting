/**
 * Backtest strategy: EMA21(H1) + FVG(M15) + CHOCH(M1) | RR 1:2.5
 * JS port (MVP) from provided MQL5-like logic
 */

import { ema, slopeUp, slopeDown, equityStats } from "../utils/math.js";

/**
 * Candle type
 * { time:number (ms), open:number, high:number, low:number, close:number }
 */

/**
 * params = {
 *  symbol: "EURUSD",
 *  riskPercent: 1.0,
 *  RR: 2.5,
 *  maxSpreadPoints: 40,
 *  slippagePoints: 30,
 *  oneTradeAtATime: true,
 *  fractalLeftRight: 2,
 *  fvgScanBars: 50,
 *  point: 0.0001,             // default for many FX pairs
 *  valuePerPointPerLot: 10,    // PnL value per point per LOT (simplified)
 *  startingEquity: 10000,
 *  data: { H1:[], M15:[], M1:[] } // arrays of candles
 * }
 */

export async function runBacktest(params = {}) {
  const p = {
    symbol: params.symbol || "EURUSD",
    riskPercent: params.riskPercent ?? 1.0,
    RR: params.RR ?? 2.5,
    maxSpreadPoints: params.maxSpreadPoints ?? 40,
    slippagePoints: params.slippagePoints ?? 30,
    oneTradeAtATime: params.oneTradeAtATime ?? true,
    fractalLeftRight: params.fractalLeftRight ?? 2,
    fvgScanBars: params.fvgScanBars ?? 50,
    point: params.point ?? 0.0001,
    valuePerPointPerLot: params.valuePerPointPerLot ?? 10,
    startingEquity: params.startingEquity ?? 10000,
    data: params.data || { H1:[], M15:[], M1:[] },
    spreadPoints: params.spreadPoints ?? 20 // synthetic spread for backtest
  };

  validateData(p.data);

  // Precompute EMA21 on H1
  const h1Closes = p.data.H1.map(c => c.close);
  const ema21 = ema(21, h1Closes);

  // Build quick index by time to find the latest H1, M15 candle for each M1 candle
  const idxH1 = makeTimeIndex(p.data.H1);
  const idxM15 = makeTimeIndex(p.data.M15);

  let equity = p.startingEquity;
  const trades = [];
  const equityCurve = [{ t: p.data.M1[0].time, equity }];
  let openPosition = null; // {dir:'long'|'short', entry, sl, tp, lot, time}
  
  for (let i = 50; i < p.data.M1.length; i++) { // start with some buffer
    const m1 = p.data.M1[i];
    const [h1Candle, h1Pos] = latestByTime(idxH1, m1.time, p.data.H1);
    const [m15Candle, m15Pos] = latestByTime(idxM15, m1.time, p.data.M15);
    if (!h1Candle || !m15Candle) {
      equityCurve.push({ t: m1.time, equity });
      continue;
    }

    // ===== 1) H1 bias by EMA21 slope + price vs EMA
    const emaVal = ema21[h1Pos];
    const emaWindow = ema21.slice(Math.max(0, h1Pos-3), h1Pos+1);
    const biasLong  = (h1Candle.close > emaVal) && slopeUp(emaWindow, Math.min(3, emaWindow.length-1));
    const biasShort = (h1Candle.close < emaVal) && slopeDown(emaWindow, Math.min(3, emaWindow.length-1));
    if (!biasLong && !biasShort) {
      // manage open trade exit check per candle
      if (openPosition) {
        const res = checkExit(openPosition, m1);
        if (res.closed) {
          const pnl = res.profitPoints * p.valuePerPointPerLot * openPosition.lot;
          equity += pnl;
          trades.push({ ...openPosition, exit: res.exitPrice, exitTime: m1.time, pnl });
          openPosition = null;
        }
      }
      equityCurve.push({ t: m1.time, equity });
      continue;
    }

    // ===== 2) find last FVG on M15 in desired direction
    const desired = biasLong ? "bull" : "bear";
    const fvg = findLastFVG(p.data.M15, m15Pos, desired, p.fvgScanBars);
    if (!fvg) {
      if (openPosition) {
        const res = checkExit(openPosition, m1);
        if (res.closed) {
          const pnl = res.profitPoints * p.valuePerPointPerLot * openPosition.lot;
          equity += pnl;
          trades.push({ ...openPosition, exit: res.exitPrice, exitTime: m1.time, pnl });
          openPosition = null;
        }
      }
      equityCurve.push({ t: m1.time, equity });
      continue;
    }

    // ===== spread check + "interaction" with FVG on current M1 price
    const bid = m1.close - p.spreadPoints * p.point * 0.5;
    const ask = m1.close + p.spreadPoints * p.point * 0.5;
    const spreadPts = (ask - bid) / p.point;
    if (spreadPts > p.maxSpreadPoints) {
      equityCurve.push({ t: m1.time, equity });
      continue;
    }

    let interacting = false;
    if (biasLong)  interacting = (bid <= fvg.high && bid >= fvg.low);
    if (biasShort) interacting = (ask >= fvg.low && ask <= fvg.high);
    if (!interacting) {
      if (openPosition) {
        const res = checkExit(openPosition, m1);
        if (res.closed) {
          const pnl = res.profitPoints * p.valuePerPointPerLot * openPosition.lot;
          equity += pnl;
          trades.push({ ...openPosition, exit: res.exitPrice, exitTime: m1.time, pnl });
          openPosition = null;
        }
      }
      equityCurve.push({ t: m1.time, equity });
      continue;
    }

    // ===== 3) CHOCH trigger on M1
    const swings = findLastSwings(p.data.M1, i, p.fractalLeftRight);
    if (!swings) {
      equityCurve.push({ t: m1.time, equity });
      continue;
    }
    const { lastSwingHigh, lastSwingLow } = swings;
    const chochLong  = (m1.close > lastSwingHigh);
    const chochShort = (m1.close < lastSwingLow);
    const chochOK = biasLong ? chochLong : chochShort;
    if (!chochOK) {
      if (openPosition) {
        const res = checkExit(openPosition, m1);
        if (res.closed) {
          const pnl = res.profitPoints * p.valuePerPointPerLot * openPosition.lot;
          equity += pnl;
          trades.push({ ...openPosition, exit: res.exitPrice, exitTime: m1.time, pnl });
          openPosition = null;
        }
      }
      equityCurve.push({ t: m1.time, equity });
      continue;
    }

    // ===== 4) SL/TP
    const entry = biasLong ? ask : bid;
    const sl = biasLong ? Math.min(lastSwingLow, fvg.low) : Math.max(lastSwingHigh, fvg.high);
    if (!isFinite(sl) || sl <= 0) {
      equityCurve.push({ t: m1.time, equity });
      continue;
    }
    const slPoints = Math.abs(entry - sl) / p.point;
    if (slPoints < 5) { // avoid tiny SL
      equityCurve.push({ t: m1.time, equity });
      continue;
    }
    const tp = biasLong ? (entry + p.RR * (entry - sl)) : (entry - p.RR * (sl - entry));

    // ===== 5) Lot size by risk
    const riskMoney = equity * (p.riskPercent / 100);
    const moneyPerLotPerPoint = p.valuePerPointPerLot;
    const lotRaw = riskMoney / (slPoints * moneyPerLotPerPoint);
    const volStep = 0.01; const volMin = 0.01; const volMax = 100;
    let lot = Math.max(volMin, Math.min(volMax, Math.floor(lotRaw/volStep)*volStep));
    if (lot <= 0) {
      equityCurve.push({ t: m1.time, equity });
      continue;
    }

    // ===== 6) Manage existing position & open new one
    if (p.oneTradeAtATime && openPosition) {
      // do nothing until it closes
    } else if (!openPosition) {
      openPosition = {
        dir: biasLong ? "long" : "short",
        entry, sl, tp, lot,
        time: m1.time
      };
    }

    // Check exit immediately at this bar (if TP/SL hit intrabar using OHLC)
    if (openPosition) {
      const res = checkExit(openPosition, m1);
      if (res.closed) {
        const pnl = res.profitPoints * p.valuePerPointPerLot * openPosition.lot;
        equity += pnl;
        trades.push({ ...openPosition, exit: res.exitPrice, exitTime: m1.time, pnl });
        openPosition = null;
      }
    }

    equityCurve.push({ t: m1.time, equity });
  }

  const wins = trades.filter(t => t.pnl > 0).length;
  const losses = trades.filter(t => t.pnl <= 0).length;
  const net = trades.reduce((a,t)=>a+t.pnl,0);
  const stats = {
    trades: trades.length,
    wins, losses,
    winRatePct: trades.length? (wins / trades.length) * 100 : 0,
    netProfit: net,
    avgTrade: trades.length? net / trades.length : 0,
    ...equityStats(equityCurve)
  };

  return { params: p, stats, trades, equityCurve };
}

// ----------------- Strategy helpers -----------------

function validateData(data){
  if (!data || !Array.isArray(data.H1) || !Array.isArray(data.M15) || !Array.isArray(data.M1))
    throw new Error("data must include arrays H1, M15, M1");
  for (const tf of ["H1","M15","M1"]) {
    data[tf].sort((a,b)=> a.time - b.time);
  }
}

function makeTimeIndex(candles){
  // candles sorted asc by time; returns array of times
  return candles.map(c => c.time);
}

function latestByTime(index, t, candles){
  // find latest candle with time <= t (binary search)
  let lo = 0, hi = index.length - 1, pos = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (index[mid] <= t) { pos = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return [pos >= 0 ? candles[pos] : null, pos];
}

function findLastFVG(m15, pos, desired, scanBars){
  // Search back from pos to pos-scanBars for a 3-candle FVG:
  // bullish: Low[n] > High[n-2]; bearish: High[n] < Low[n-2]
  const start = Math.max(2, pos - scanBars);
  for (let i = pos; i >= start; i--) {
    const n = i;
    const n1 = i-1;
    const n2 = i-2;
    if (n2 < 0) break;
    const c0 = m15[n]; const c2 = m15[n2];
    // bullish
    if ((desired === "bull" || desired === "none") && c0.low > c2.high) {
      const low = c2.high;
      const high = c0.low;
      return { low, high, dir:"bull", index:n };
    }
    // bearish
    if ((desired === "bear" || desired === "none") && c0.high < c2.low) {
      const low = c0.high;
      const high = c2.low;
      return { low, high, dir:"bear", index:n };
    }
  }
  return null;
}

function findLastSwings(m1, pos, n){
  // fractal-based: find nearest swing high and swing low behind 'pos'
  const start = Math.max(n, pos - 300);
  const end = Math.min(m1.length - n - 1, pos);
  let lastSwingHigh = null;
  let lastSwingLow = null;
  for (let i = start; i <= end; i++) {
    let isHigh = true, isLow = true;
    for (let k = 1; k <= n; k++) {
      if (!(m1[i].high > m1[i-k].high && m1[i].high > m1[i+k].high)) isHigh = false;
      if (!(m1[i].low  < m1[i-k].low  && m1[i].low  < m1[i+k].low )) isLow  = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh && lastSwingHigh === null) lastSwingHigh = m1[i].high;
    if (isLow  && lastSwingLow  === null) lastSwingLow  = m1[i].low;
    if (lastSwingHigh !== null && lastSwingLow !== null) break;
  }
  if (lastSwingHigh === null || lastSwingLow === null) return null;
  return { lastSwingHigh, lastSwingLow };
}

function checkExit(position, m1bar){
  // Simulate intrabar TP/SL hits using m1bar high/low
  const { dir, sl, tp } = position;
  let hitTP = false, hitSL = false, exitPrice = null;
  if (dir === "long") {
    hitSL = m1bar.low <= sl;
    hitTP = m1bar.high >= tp;
    // Assume SL/TP priority by proximity (simple rule)
    if (hitSL && hitTP) {
      const dSL = Math.abs(position.entry - sl);
      const dTP = Math.abs(tp - position.entry);
      if (dSL < dTP) { exitPrice = sl; hitTP = false; }
      else { exitPrice = tp; hitSL = false; }
    } else if (hitSL) exitPrice = sl;
    else if (hitTP) exitPrice = tp;
  } else {
    hitSL = m1bar.high >= sl;
    hitTP = m1bar.low  <= tp;
    if (hitSL && hitTP) {
      const dSL = Math.abs(sl - position.entry);
      const dTP = Math.abs(position.entry - tp);
      if (dSL < dTP) { exitPrice = sl; hitTP = false; }
      else { exitPrice = tp; hitSL = false; }
    } else if (hitSL) exitPrice = sl;
    else if (hitTP) exitPrice = tp;
  }
  if (hitSL || hitTP) {
    const profitPoints = (dir === "long")
      ? (exitPrice - position.entry) /  positionPoint(position)
      : (position.entry - exitPrice) /  positionPoint(position);
    return { closed: true, exitPrice, profitPoints };
  }
  return { closed: false };
}

function positionPoint(position) {
  // point size is not stored per position; assume 0.0001 default in this scope is fine for PnL points calc
  return 0.0001;
}