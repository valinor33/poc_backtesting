/**
 * Single-TF Backtest (simple): EMA21 + FVG + CHOCH | RR configurable
 * Extra: maxOpenPositions para limitar posiciones simultáneas.
 */

import { ema, slopeUp, slopeDown, equityStats } from "../utils/math.js";

export async function runBacktestSingleTF(params, cb = {}) {
  const symU = (params.symbol || "").toUpperCase();
  let point = params.point;
  let valuePerPointPerLot = params.valuePerPointPerLot;
  if (!point || !valuePerPointPerLot) {
    if (symU.includes("XAU")) {
      point = 0.01;
      valuePerPointPerLot = 1;
    } else {
      point = 0.0001;
      valuePerPointPerLot = 10;
    }
  }

  const p = {
    symbol: params.symbol || "XAU/USD",
    timeframe: params.timeframe || "D1",
    riskPercent: Number(params.riskPercent ?? 1),
    RR: Number(params.RR ?? 2.5),
    maxTradesPerDay: Number(params.maxTradesPerDay ?? 3),
    maxOpenPositions: Number(params.maxOpenPositions ?? 1), // <— NUEVO
    maxBarsInTrade: Number(params.maxBarsInTrade ?? 20),
    fractalLeftRight: Number(params.fractalLeftRight ?? 2),
    fvgScanBars: Number(params.fvgScanBars ?? 200),
    startingEquity: Number(params.startingEquity ?? 10000),
    candles: Array.isArray(params.candles) ? [...params.candles] : [],
    point,
    valuePerPointPerLot,
  };

  const onStage = cb.onStage || (() => {});
  const onProgress = cb.onProgress || (() => {});
  const onEquity = cb.onEquity || (() => {});
  const onTrade = cb.onTrade || (() => {});
  const onStats = cb.onStats || (() => {});

  validateCandles(p.candles);
  const N = p.candles.length;
  if (N < 60)
    throw new Error("Se necesitan ≥ 60 velas para calcular EMA y swings");

  onStage(
    `1TF ${p.timeframe} | velas: ${N} | RR=${p.RR} | risk=${p.riskPercent}% | max/day=${p.maxTradesPerDay} | maxOpen=${p.maxOpenPositions}`
  );

  const closes = p.candles.map((c) => c.close);
  const ema21 = ema(21, closes);

  let equity = p.startingEquity;
  const equityCurve = [{ t: p.candles[0].time, equity }];
  const trades = [];
  const openPositions = [];
  const tradesPerDay = new Map();

  onEquity({ t: p.candles[0].time, equity });

  const chunk = Math.max(10, Math.floor(N / 100));

  for (let i = 50; i < N; i++) {
    const bar = p.candles[i];
    const curDay = toDateKey(bar.time);

    // 1) Cierres por SL/TP
    for (let k = openPositions.length - 1; k >= 0; k--) {
      const pos = openPositions[k];
      const res = checkExitSLTP(pos, bar, p.point);
      if (res.closed) {
        const pnl = res.profitPoints * p.valuePerPointPerLot * pos.lot;
        equity += pnl;
        const closed = { ...pos, exit: res.exitPrice, exitTime: bar.time, pnl };
        trades.push(closed);
        onTrade(closed);
        openPositions.splice(k, 1);
      }
    }

    // 2) Salida por tiempo
    for (let k = openPositions.length - 1; k >= 0; k--) {
      const pos = openPositions[k];
      if (i - pos.openIndex >= p.maxBarsInTrade) {
        const exitPrice = bar.close;
        const profitPoints =
          pos.dir === "long"
            ? (exitPrice - pos.entry) / p.point
            : (pos.entry - exitPrice) / p.point;
        const pnl = profitPoints * p.valuePerPointPerLot * pos.lot;
        equity += pnl;
        const closed = {
          ...pos,
          exit: exitPrice,
          exitTime: bar.time,
          pnl,
          reason: "time",
        };
        trades.push(closed);
        onTrade(closed);
        openPositions.splice(k, 1);
      }
    }

    // 3) Flip EMA
    const emaVal = ema21[i];
    const emaWin = ema21.slice(Math.max(0, i - 3), i + 1);
    const biasLong =
      bar.close > emaVal && slopeUp(emaWin, Math.min(3, emaWin.length - 1));
    const biasShort =
      bar.close < emaVal && slopeDown(emaWin, Math.min(3, emaWin.length - 1));

    for (let k = openPositions.length - 1; k >= 0; k--) {
      const pos = openPositions[k];
      if (
        (pos.dir === "long" && biasShort) ||
        (pos.dir === "short" && biasLong)
      ) {
        const exitPrice = bar.close;
        const profitPoints =
          pos.dir === "long"
            ? (exitPrice - pos.entry) / p.point
            : (pos.entry - exitPrice) / p.point;
        const pnl = profitPoints * p.valuePerPointPerLot * pos.lot;
        equity += pnl;
        const closed = {
          ...pos,
          exit: exitPrice,
          exitTime: bar.time,
          pnl,
          reason: "flip",
        };
        trades.push(closed);
        onTrade(closed);
        openPositions.splice(k, 1);
      }
    }

    // 4) Límite por día
    const countToday = tradesPerDay.get(curDay) || 0;
    if (countToday >= p.maxTradesPerDay) {
      equityCurve.push({ t: bar.time, equity });
      if (i % chunk === 0) {
        onProgress({ ratio: i / N, step: i });
        onStats(statsNow(equityCurve, trades));
      }
      continue;
    }

    // 5) Límite de posiciones abiertas simultáneas
    if (openPositions.length >= p.maxOpenPositions) {
      equityCurve.push({ t: bar.time, equity });
      if (i % chunk === 0) {
        onProgress({ ratio: i / N, step: i });
        onStats(statsNow(equityCurve, trades));
      }
      continue;
    }

    // 6) Señal
    if (!biasLong && !biasShort) {
      equityCurve.push({ t: bar.time, equity });
      if (i % chunk === 0) {
        onProgress({ ratio: i / N, step: i });
        onStats(statsNow(equityCurve, trades));
      }
      continue;
    }

    // 7) FVG
    const desired = biasLong ? "bull" : "bear";
    const fvg = findLastFVG(p.candles, i, desired, p.fvgScanBars);
    if (!fvg) {
      equityCurve.push({ t: bar.time, equity });
      continue;
    }

    // 8) Swings + CHOCH
    const swings = findLastSwings(p.candles, i, p.fractalLeftRight);
    if (!swings) {
      equityCurve.push({ t: bar.time, equity });
      continue;
    }
    const { lastSwingHigh, lastSwingLow } = swings;
    const chochOK = biasLong
      ? bar.close > lastSwingHigh
      : bar.close < lastSwingLow;
    if (!chochOK) {
      equityCurve.push({ t: bar.time, equity });
      continue;
    }

    // 9) SL/TP & tamaño
    const entry = bar.close;
    const sl = biasLong
      ? Math.min(lastSwingLow, fvg.low)
      : Math.max(lastSwingHigh, fvg.high);
    if (!isFinite(sl) || sl <= 0) {
      equityCurve.push({ t: bar.time, equity });
      continue;
    }

    const slPoints = Math.abs(entry - sl) / p.point;
    if (slPoints < 5) {
      equityCurve.push({ t: bar.time, equity });
      continue;
    }

    const tp = biasLong
      ? entry + p.RR * (entry - sl)
      : entry - p.RR * (sl - entry);

    const riskMoney = equity * (p.riskPercent / 100);
    const moneyPerLotPerPoint = p.valuePerPointPerLot;
    let lot = riskMoney / (slPoints * moneyPerLotPerPoint);
    const volStep = 0.01,
      volMin = 0.01,
      volMax = 100;
    lot = Math.max(
      volMin,
      Math.min(volMax, Math.floor(lot / volStep) * volStep)
    );
    if (lot <= 0) {
      equityCurve.push({ t: bar.time, equity });
      continue;
    }

    const pos = {
      dir: biasLong ? "long" : "short",
      entry,
      sl,
      tp,
      lot,
      time: bar.time,
      opened: true,
      openIndex: i,
    };
    openPositions.push(pos);
    onTrade({ ...pos });
    tradesPerDay.set(curDay, countToday + 1);

    equityCurve.push({ t: bar.time, equity });
    if (i % chunk === 0) {
      onProgress({ ratio: i / N, step: i });
      onStats(statsNow(equityCurve, trades));
      await sleep(0);
    }
  }

  // 10) Liquidación final
  const lastBar = p.candles[N - 1];
  for (let k = openPositions.length - 1; k >= 0; k--) {
    const pos = openPositions[k];
    const exitPrice = lastBar.close;
    const profitPoints =
      pos.dir === "long"
        ? (exitPrice - pos.entry) / p.point
        : (pos.entry - exitPrice) / p.point;
    const pnl = profitPoints * p.valuePerPointPerLot * pos.lot;
    equity += pnl;
    const closed = {
      ...pos,
      exit: exitPrice,
      exitTime: lastBar.time,
      pnl,
      reason: "eot",
    };
    trades.push(closed);
    onTrade(closed);
    openPositions.splice(k, 1);
  }

  equityCurve.push({ t: lastBar.time, equity });
  onEquity({ t: lastBar.time, equity });
  onStats(statsNow(equityCurve, trades));
}

// ==== helpers (idénticos a tu versión anterior) ====
function validateCandles(arr) {
  if (!Array.isArray(arr) || arr.length === 0) throw new Error("candles vacío");
  arr.sort((a, b) => a.time - b.time);
}
function toDateKey(ms) {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function statsNow(equityCurve, trades) {
  const closed = trades.filter((t) => !t.opened);
  const wins = closed.filter((t) => t.pnl > 0).length;
  const losses = closed.filter((t) => t.pnl <= 0).length;
  const net = closed.reduce((a, t) => a + t.pnl, 0);
  const e = equityStats(equityCurve);
  return {
    trades: closed.length,
    wins,
    losses,
    winRatePct: closed.length ? (wins / closed.length) * 100 : 0,
    netProfit: net,
    avgTrade: closed.length ? net / closed.length : 0,
    startEquity: e.start,
    endEquity: e.end,
    maxDrawdown: e.maxDD,
    returnPct: e.returnPct,
  };
}
function findLastFVG(arr, pos, desired, scanBars) {
  const start = Math.max(2, pos - scanBars);
  for (let i = pos; i >= start; i--) {
    const c0 = arr[i],
      c2 = arr[i - 2];
    if (!c2) break;
    if ((desired === "bull" || desired === "none") && c0.low > c2.high) {
      return { low: c2.high, high: c0.low, dir: "bull", index: i };
    }
    if ((desired === "bear" || desired === "none") && c0.high < c2.low) {
      return { low: c0.high, high: c2.low, dir: "bear", index: i };
    }
  }
  return null;
}
function findLastSwings(arr, pos, n) {
  const start = Math.max(n, pos - 300),
    end = Math.min(arr.length - n - 1, pos);
  let lastSwingHigh = null,
    lastSwingLow = null;
  for (let i = start; i <= end; i++) {
    let isHigh = true,
      isLow = true;
    for (let k = 1; k <= n; k++) {
      if (!(arr[i].high > arr[i - k].high && arr[i].high > arr[i + k].high))
        isHigh = false;
      if (!(arr[i].low < arr[i - k].low && arr[i].low < arr[i + k].low))
        isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh && lastSwingHigh === null) lastSwingHigh = arr[i].high;
    if (isLow && lastSwingLow === null) lastSwingLow = arr[i].low;
    if (lastSwingHigh !== null && lastSwingLow !== null) break;
  }
  if (lastSwingHigh === null || lastSwingLow === null) return null;
  return { lastSwingHigh, lastSwingLow };
}
function checkExitSLTP(position, bar, point) {
  const { dir, sl, tp } = position;
  let hitTP = false,
    hitSL = false,
    exitPrice = null;
  if (dir === "long") {
    hitSL = bar.low <= sl;
    hitTP = bar.high >= tp;
    if (hitSL && hitTP) {
      const dSL = Math.abs(position.entry - sl);
      const dTP = Math.abs(tp - position.entry);
      exitPrice = dSL < dTP ? sl : tp;
    } else if (hitSL) exitPrice = sl;
    else if (hitTP) exitPrice = tp;
  } else {
    hitSL = bar.high >= sl;
    hitTP = bar.low <= tp;
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
