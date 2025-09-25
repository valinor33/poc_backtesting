/**
 * Streaming Backtest: EMA21(H1) + FVG(M15) + CHOCH(M1) | RR 1:2.5
 * Emits progress via callbacks (SSE).
 */

import { ema, slopeUp, slopeDown, equityStats } from "../utils/math.js";

/**
 * params.data = { H1:[], M15:[], M1:[] } OR params.fetchFromTD
 * callbacks: { onStage, onProgress, onEquity, onTrade, onStats }
 */
export async function runBacktestStream(params, cb = {}) {
  // --- auto-calibración por símbolo (XAU vs pares FX típicos) ---
  const symU = (params.symbol || "").toUpperCase();
  if (symU.includes("XAU")) {
    params.point = params.point ?? 0.01;
    params.valuePerPointPerLot = params.valuePerPointPerLot ?? 1;
  } else if (
    symU.includes("EUR/") ||
    symU.includes("GBP/") ||
    symU.includes("USD/") ||
    symU.includes("JPY/") ||
    symU.length === 6 // EURUSD, GBPUSD, etc. (por si vino sin "/")
  ) {
    params.point = params.point ?? 0.0001;
    params.valuePerPointPerLot = params.valuePerPointPerLot ?? 10;
  }

  const p = {
    symbol: params.symbol || "EUR/USD",
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
    spreadPoints: params.spreadPoints ?? 20,
    data: params.data,
  };
  const N = p.data?.M1?.length || 0;

  const onStage = cb.onStage || (() => {});
  const onProgress = cb.onProgress || (() => {});
  const onEquity = cb.onEquity || (() => {});
  const onTrade = cb.onTrade || (() => {});
  const onStats = cb.onStats || (() => {});

  validateData(p.data);

  onStage("Precomputing H1 EMA...");
  const h1Closes = p.data.H1.map((c) => c.close);
  const ema21 = ema(21, h1Closes);

  onStage("Indexing timeframes...");
  const idxH1 = makeTimeIndex(p.data.H1);
  const idxM15 = makeTimeIndex(p.data.M15);

  onStage("Starting main loop...");
  let equity = p.startingEquity;
  const trades = [];
  const equityCurve = [{ t: p.data.M1[0].time, equity }];

  // 🔸 Emitimos equity inicial
  onEquity({ t: p.data.M1[0].time, equity });

  let openPosition = null;
  // 🔸 Bajamos el chunk mínimo para ver siempre la curva
  const chunk = Math.max(10, Math.floor(N / 100)); // antes 50

  for (let i = 50; i < N; i++) {
    const m1 = p.data.M1[i];
    const [h1Candle, h1Pos] = latestByTime(idxH1, m1.time, p.data.H1);
    const [m15Candle, m15Pos] = latestByTime(idxM15, m1.time, p.data.M15);
    if (!h1Candle || !m15Candle) {
      equityCurve.push({ t: m1.time, equity });
      if (i % chunk === 0) {
        onEquity({ t: m1.time, equity });
        onProgress({ ratio: i / N, step: i });
      }
      continue;
    }

    // H1 bias by EMA21
    const emaVal = ema21[h1Pos];
    const emaWindow = ema21.slice(Math.max(0, h1Pos - 3), h1Pos + 1);
    const biasLong =
      h1Candle.close > emaVal &&
      slopeUp(emaWindow, Math.min(3, emaWindow.length - 1));
    const biasShort =
      h1Candle.close < emaVal &&
      slopeDown(emaWindow, Math.min(3, emaWindow.length - 1));

    // Check exits if open
    if (openPosition) {
      const res = checkExit(openPosition, m1, p.point);
      if (res.closed) {
        const pnl = res.profitPoints * p.valuePerPointPerLot * openPosition.lot;
        equity += pnl;
        const closed = {
          ...openPosition,
          exit: res.exitPrice,
          exitTime: m1.time,
          pnl,
        };
        trades.push(closed);
        onTrade(closed);
        openPosition = null;

        // 🔸 Emitimos equity y stats al cierre
        equityCurve.push({ t: m1.time, equity });
        onEquity({ t: m1.time, equity });
        onStats(statsNow(equityCurve, trades));
      }
    }
    if (!biasLong && !biasShort) {
      equityCurve.push({ t: m1.time, equity });
      if (i % chunk === 0) {
        onEquity({ t: m1.time, equity });
        onProgress({ ratio: i / N, step: i });
        onStats(statsNow(equityCurve, trades));
      }
      continue;
    }

    // FVG on M15
    const desired = biasLong ? "bull" : "bear";
    const fvg = findLastFVG(p.data.M15, m15Pos, desired, p.fvgScanBars);
    if (!fvg) {
      equityCurve.push({ t: m1.time, equity });
      if (i % chunk === 0) {
        onEquity({ t: m1.time, equity });
        onProgress({ ratio: i / N, step: i });
        onStats(statsNow(equityCurve, trades));
      }
      continue;
    }

    // Spread + interaction
    const bid = m1.close - p.spreadPoints * p.point * 0.5;
    const ask = m1.close + p.spreadPoints * p.point * 0.5;
    const spreadPts = (ask - bid) / p.point;
    if (spreadPts > p.maxSpreadPoints) {
      equityCurve.push({ t: m1.time, equity });
      continue;
    }

    let interacting = false;
    if (biasLong) interacting = bid <= fvg.high && bid >= fvg.low;
    if (biasShort) interacting = ask >= fvg.low && ask <= fvg.high;
    if (!interacting) {
      equityCurve.push({ t: m1.time, equity });
      continue;
    }

    // CHOCH on M1
    const swings = findLastSwings(p.data.M1, i, p.fractalLeftRight);
    if (!swings) {
      equityCurve.push({ t: m1.time, equity });
      continue;
    }
    const { lastSwingHigh, lastSwingLow } = swings;
    const chochLong = m1.close > lastSwingHigh;
    const chochShort = m1.close < lastSwingLow;
    const chochOK = biasLong ? chochLong : chochShort;
    if (!chochOK) {
      equityCurve.push({ t: m1.time, equity });
      continue;
    }

    // SL/TP
    const entry = biasLong ? ask : bid;
    const sl = biasLong
      ? Math.min(lastSwingLow, fvg.low)
      : Math.max(lastSwingHigh, fvg.high);
    if (!isFinite(sl) || sl <= 0) {
      equityCurve.push({ t: m1.time, equity });
      continue;
    }
    const slPoints = Math.abs(entry - sl) / p.point;
    if (slPoints < 5) {
      equityCurve.push({ t: m1.time, equity });
      continue;
    }
    const tp = biasLong
      ? entry + p.RR * (entry - sl)
      : entry - p.RR * (sl - entry);

    // Lot by risk
    const riskMoney = equity * (p.riskPercent / 100);
    const moneyPerLotPerPoint = p.valuePerPointPerLot;
    const lotRaw = riskMoney / (slPoints * moneyPerLotPerPoint);
    const volStep = 0.01;
    const volMin = 0.01;
    const volMax = 100;
    let lot = Math.max(
      volMin,
      Math.min(volMax, Math.floor(lotRaw / volStep) * volStep)
    );
    if (lot <= 0) {
      equityCurve.push({ t: m1.time, equity });
      continue;
    }

    // Open position
    if (p.oneTradeAtATime && openPosition) {
      // wait
    } else if (!openPosition) {
      openPosition = {
        dir: biasLong ? "long" : "short",
        entry,
        sl,
        tp,
        lot,
        time: m1.time,
      };
      onTrade({ ...openPosition, opened: true });
    }

    // Check exit intrabar
    if (openPosition) {
      const res = checkExit(openPosition, m1, p.point);
      if (res.closed) {
        const pnl = res.profitPoints * p.valuePerPointPerLot * openPosition.lot;
        equity += pnl;
        const closed = {
          ...openPosition,
          exit: res.exitPrice,
          exitTime: m1.time,
          pnl,
        };
        trades.push(closed);
        onTrade(closed);
        openPosition = null;

        // 🔸 Emitimos equity y stats al cierre
        equityCurve.push({ t: m1.time, equity });
        onEquity({ t: m1.time, equity });
        onStats(statsNow(equityCurve, trades));
      }
    }

    equityCurve.push({ t: m1.time, equity });

    // progress tick
    if (i % chunk === 0) {
      onEquity({ t: m1.time, equity });
      onProgress({ ratio: i / N, step: i });
      onStats(statsNow(equityCurve, trades));
      await sleep(0);
    }
  }

  // 🔸 Flush final de equity y stats
  if (equityCurve.length) {
    const last = equityCurve[equityCurve.length - 1];
    onEquity({ t: last.t, equity: last.equity });
  }
  onStats(statsNow(equityCurve, trades));
}

function statsNow(equityCurve, trades) {
  const wins = trades.filter((t) => t.pnl > 0).length;
  const losses = trades.filter((t) => t.pnl <= 0).length;
  const net = trades.reduce((a, t) => a + t.pnl, 0);
  const e = equityStats(equityCurve);
  return {
    trades: trades.length,
    wins,
    losses,
    winRatePct: trades.length ? (wins / trades.length) * 100 : 0,
    netProfit: net,
    avgTrade: trades.length ? net / trades.length : 0,
    startEquity: e.start,
    endEquity: e.end,
    maxDrawdown: e.maxDD,
    returnPct: e.returnPct,
  };
}

// --------------- helpers ---------------

function validateData(data) {
  if (
    !data ||
    !Array.isArray(data.H1) ||
    !Array.isArray(data.M15) ||
    !Array.isArray(data.M1)
  )
    throw new Error("data must include arrays H1, M15, M1");
  for (const tf of ["H1", "M15", "M1"])
    data[tf].sort((a, b) => a.time - b.time);
}
function makeTimeIndex(candles) {
  return candles.map((c) => c.time);
}
function latestByTime(index, t, candles) {
  let lo = 0,
    hi = index.length - 1,
    pos = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (index[mid] <= t) {
      pos = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return [pos >= 0 ? candles[pos] : null, pos];
}
function findLastFVG(m15, pos, desired, scanBars) {
  const start = Math.max(2, pos - scanBars);
  for (let i = pos; i >= start; i--) {
    const n = i,
      n2 = i - 2;
    if (n2 < 0) break;
    const c0 = m15[n],
      c2 = m15[n2];
    if ((desired === "bull" || desired === "none") && c0.low > c2.high)
      return { low: c2.high, high: c0.low, dir: "bull", index: n };
    if ((desired === "bear" || desired === "none") && c0.high < c2.low)
      return { low: c0.high, high: c2.low, dir: "bear", index: n };
  }
  return null;
}
function findLastSwings(m1, pos, n) {
  const start = Math.max(n, pos - 300),
    end = Math.min(m1.length - n - 1, pos);
  let lastSwingHigh = null,
    lastSwingLow = null;
  for (let i = start; i <= end; i++) {
    let isHigh = true,
      isLow = true;
    for (let k = 1; k <= n; k++) {
      if (!(m1[i].high > m1[i - k].high && m1[i].high > m1[i + k].high))
        isHigh = false;
      if (!(m1[i].low < m1[i - k].low && m1[i].low < m1[i + k].low))
        isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh && lastSwingHigh === null) lastSwingHigh = m1[i].high;
    if (isLow && lastSwingLow === null) lastSwingLow = m1[i].low;
    if (lastSwingHigh !== null && lastSwingLow !== null) break;
  }
  if (lastSwingHigh === null || lastSwingLow === null) return null;
  return { lastSwingHigh, lastSwingLow };
}
function checkExit(position, m1bar, point) {
  const { dir, sl, tp } = position;
  let hitTP = false,
    hitSL = false,
    exitPrice = null;
  if (dir === "long") {
    hitSL = m1bar.low <= sl;
    hitTP = m1bar.high >= tp;
    if (hitSL && hitTP) {
      const dSL = Math.abs(position.entry - sl);
      const dTP = Math.abs(tp - position.entry);
      exitPrice = dSL < dTP ? sl : tp;
    } else if (hitSL) exitPrice = sl;
    else if (hitTP) exitPrice = tp;
  } else {
    hitSL = m1bar.high >= sl;
    hitTP = m1bar.low <= tp;
    if (hitSL && hitTP) {
      const dSL = Math.abs(sl - position.entry);
      const dTP = Math.abs(position.entry - tp);
      exitPrice = dSL < dTP ? sl : tp;
    } else if (hitSL) exitPrice = sl;
    else if (hitTP) exitPrice = tp;
  }
  if (exitPrice !== null) {
    const profitPoints =
      dir === "long"
        ? (exitPrice - position.entry) / point
        : (position.entry - exitPrice) / point;
    return { closed: true, exitPrice, profitPoints };
  }
  return { closed: false };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
