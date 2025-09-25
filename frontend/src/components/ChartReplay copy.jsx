import React, { useEffect, useMemo, useRef, useState } from "react";
import { createChart, CrosshairMode } from "lightweight-charts";

/**
 * Props:
 *  - candles: [{ time: {year,month,day}, open, high, low, close }]
 *  - ema:     [{ time: {y,m,d}, value }]
 *  - trades:  [{ id, side:'long'|'short', entryTime:{y,m,d}, closeTime?, entryPrice, takeProfit, stopLoss, result?:'tp'|'sl'|'open' }]
 *  - height?: number
 */
export default function ChartReplay({
  candles = [],
  ema = [],
  trades = [],
  height = 520,
}) {
  const containerRef = useRef(null);
  const overlayRef = useRef(null);

  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const timerRef = useRef(null);

  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const emaRef = useRef(null);

  const nextDelay = useMemo(() => {
    const base = 220;
    const factor = { 0.25: 4, 0.5: 2, 1: 1, 2: 0.5, 4: 0.25 }[speed] ?? 1;
    return Math.max(20, base * factor);
  }, [speed]);

  const currentTime = useMemo(
    () =>
      candles[idx] ? candles[idx].time : candles[candles.length - 1]?.time,
    [candles, idx]
  );

  /* ---------------- Chart init ---------------- */
  useEffect(() => {
    if (!containerRef.current || chartRef.current) return;

    const chart = createChart(containerRef.current, {
      height,
      layout: { background: { color: "transparent" }, textColor: "#C8D0E0" },
      grid: {
        vertLines: { color: "rgba(197,203,206,0.08)" },
        horzLines: { color: "rgba(197,203,206,0.08)" },
      },
      crosshair: { mode: CrosshairMode.Magnet },
      rightPriceScale: { borderColor: "rgba(197,203,206,0.2)" },
      timeScale: {
        borderColor: "rgba(197,203,206,0.2)",
        timeVisible: false, // ✅ diario
        secondsVisible: false, // ✅ diario
      },
      handleScroll: true,
      handleScale: true,
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: "#26a69a",
      downColor: "#ef5350",
      borderVisible: false,
      wickUpColor: "#26a69a",
      wickDownColor: "#ef5350",
    });

    const emaSeries = chart.addLineSeries({
      lineWidth: 2,
      lastValueVisible: false,
      priceLineVisible: false,
    });

    chartRef.current = chart;
    seriesRef.current = candleSeries;
    emaRef.current = emaSeries;

    const resize = () => {
      const w = containerRef.current?.clientWidth ?? 600;
      chart.applyOptions({ width: w, height });
      drawAllOverlays();
    };
    resize();
    const obs = new ResizeObserver(resize);
    obs.observe(containerRef.current);

    chart.timeScale().subscribeVisibleTimeRangeChange(drawAllOverlays);

    return () => {
      obs.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      emaRef.current = null;
    };
  }, [height]);

  /* ---------------- Set data por idx ---------------- */
  useEffect(() => {
    if (!seriesRef.current || candles.length === 0) return;

    seriesRef.current.setData(candles.slice(0, idx + 1));

    if (emaRef.current) {
      const emaData = ema.filter((p) => !isAfter(p.time, currentTime));
      emaRef.current.setData(emaData);
    }

    seriesRef.current.setMarkers(buildMarkersUntil(currentTime, trades));

    if (idx < 3) chartRef.current?.timeScale().fitContent();

    drawAllOverlays();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, ema, idx, trades]);

  /* ---------------- Auto-replay ---------------- */
  useEffect(() => {
    if (!playing) {
      clearTimer();
      return;
    }
    if (idx >= candles.length - 1) {
      setPlaying(false);
      return;
    }
    timerRef.current = setTimeout(() => {
      setIdx((i) => Math.min(i + 1, candles.length - 1));
    }, nextDelay);
    return clearTimer;
  }, [playing, idx, candles.length, nextDelay]);

  function clearTimer() {
    if (timerRef.current) clearTimeout(timerRef.current);
  }

  /* ---------------- Controles ---------------- */
  const playPause = () => setPlaying((p) => !p);
  const step = (d) => {
    setPlaying(false);
    setIdx((i) => clamp(i + d, 0, candles.length - 1));
  };
  const scrub = (e) => {
    setPlaying(false);
    setIdx(Number(e.target.value));
  };
  const slower = () =>
    setSpeed((s) => ({ 4: 2, 2: 1, 1: 0.5, 0.5: 0.25, 0.25: 0.25 }[s]));
  const faster = () =>
    setSpeed((s) => ({ 0.25: 0.5, 0.5: 1, 1: 2, 2: 4, 4: 4 }[s]));
  const total = candles.length ? candles.length - 1 : 0;

  /* ---------------- Markers de trades ---------------- */
  function buildMarkersUntil(tUntil, trs) {
    const list = [];
    for (const tr of trs) {
      if (!tr.entryTime || isAfter(tr.entryTime, tUntil)) continue;
      list.push({
        time: tr.entryTime,
        position: tr.side === "short" ? "aboveBar" : "belowBar",
        color: tr.side === "short" ? "#ef5350" : "#26a69a",
        shape: tr.side === "short" ? "arrowDown" : "arrowUp",
        text: `${tr.side === "short" ? "SHORT" : "LONG"} @ ${fmt(
          tr.entryPrice
        )}`,
      });
      if (tr.closeTime && !isAfter(tr.closeTime, tUntil)) {
        list.push({
          time: tr.closeTime,
          position: "inBar",
          color: tr.result === "tp" ? "#26a69a" : "#ef5350",
          shape: "cross",
          text: `${tr.result?.toUpperCase() || "EXIT"} @ ${fmt(
            tr.result === "tp" ? tr.takeProfit : tr.stopLoss
          )}`,
        });
      }
    }
    return list;
  }

  /* ---------------- FVG detect + draw ---------------- */

  // Detecta FVGs hasta el índice actual y descarta los ya rellenados
  function computeActiveFVGs() {
    const zones = [];
    // detectar
    for (let i = 2; i <= idx; i++) {
      const a = candles[i - 2];
      const c = candles[i];
      if (!a || !c) continue;

      // Bullish (gap por debajo): high[a] < low[c]
      if (a.high < c.low) {
        zones.push({
          side: "buy",
          startIndex: i, // nace con la vela i
          startTime: c.time,
          top: c.low, // borde superior de la zona
          bottom: a.high, // borde inferior
          filled: false,
        });
      }
      // Bearish (gap por arriba): low[a] > high[c]
      if (a.low > c.high) {
        zones.push({
          side: "sell",
          startIndex: i,
          startTime: c.time,
          top: a.low, // borde superior
          bottom: c.high, // borde inferior
          filled: false,
        });
      }
    }

    // marcar como rellenadas
    for (const z of zones) {
      for (let j = z.startIndex; j <= idx; j++) {
        const bar = candles[j];
        if (!bar) continue;
        if (z.side === "buy") {
          // se rellena cuando el LOW cae hasta el borde inferior del gap
          if (bar.low <= z.bottom) {
            z.filled = true;
            z.fillTime = bar.time;
            break;
          }
        } else {
          // sell: se rellena cuando el HIGH sube hasta el borde superior del gap
          if (bar.high >= z.top) {
            z.filled = true;
            z.fillTime = bar.time;
            break;
          }
        }
      }
    }

    // devuelvo solo las activas (no rellenas)
    return zones.filter((z) => !z.filled);
  }

  function drawAllOverlays() {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series || !overlayRef.current) return;

    const timeScale = chart.timeScale();
    const el = overlayRef.current;
    el.innerHTML = "";

    const now = currentTime;

    // ---- FVGs activos ----
    const activeFVGs = computeActiveFVGs();
    for (const z of activeFVGs) {
      const x1 = timeScale.timeToCoordinate(z.startTime);
      const x2 = timeScale.timeToCoordinate(now);
      if (x1 == null || x2 == null) continue;

      const yTop = series.priceToCoordinate(z.top);
      const yBot = series.priceToCoordinate(z.bottom);
      if (yTop == null || yBot == null) continue;

      const left = Math.min(x1, x2);
      const width = Math.max(1, Math.abs(x2 - x1));
      const top = Math.min(yTop, yBot);
      const height = Math.max(1, Math.abs(yTop - yBot));

      const color =
        z.side === "buy" ? "rgba(33,150,243,0.20)" : "rgba(244,67,54,0.20)";
      const border =
        z.side === "buy" ? "rgba(33,150,243,0.6)" : "rgba(244,67,54,0.6)";

      const box = document.createElement("div");
      box.style.position = "absolute";
      box.style.left = `${left}px`;
      box.style.top = `${top}px`;
      box.style.width = `${width}px`;
      box.style.height = `${height}px`;
      box.style.background = color; // azul/rojo translúcido
      box.style.borderTop = `2px solid ${border}`; // bordes
      box.style.borderBottom = `2px solid ${border}`;
      box.style.pointerEvents = "none";
      el.appendChild(box);
    }

    // ---- Overlays de trades (encima de FVG) ----
    for (const tr of trades) {
      if (!tr.entryTime || isAfter(tr.entryTime, now)) continue;

      const x1 = timeScale.timeToCoordinate(tr.entryTime);
      const x2 = timeScale.timeToCoordinate(
        tr.closeTime && !isAfter(tr.closeTime, now) ? tr.closeTime : now
      );
      if (x1 == null || x2 == null) continue;

      const yTP = series.priceToCoordinate(tr.takeProfit);
      const ySL = series.priceToCoordinate(tr.stopLoss);
      const yEntry = series.priceToCoordinate(tr.entryPrice);
      if (yTP == null || ySL == null || yEntry == null) continue;

      const left = Math.min(x1, x2);
      const width = Math.max(1, Math.abs(x2 - x1));
      const top = Math.min(yTP, ySL);
      const height = Math.max(1, Math.abs(yTP - ySL));

      const color = tr.result
        ? tr.result === "tp"
          ? "rgba(38,166,154,0.18)"
          : "rgba(239,83,80,0.18)"
        : "rgba(255,193,7,0.12)";
      const border = tr.result
        ? tr.result === "tp"
          ? "#26a69a"
          : "#ef5350"
        : "#ffc107";

      const box = document.createElement("div");
      box.style.position = "absolute";
      box.style.left = `${left}px`;
      box.style.top = `${top}px`;
      box.style.width = `${width}px`;
      box.style.height = `${height}px`;
      box.style.background = color;
      box.style.borderTop = `2px solid ${border}`;
      box.style.borderBottom = `2px solid ${border}`;
      box.style.pointerEvents = "none";
      el.appendChild(box);

      const dot = document.createElement("div");
      dot.style.position = "absolute";
      dot.style.left = `${x1 - 3}px`;
      dot.style.top = `${yEntry - 3}px`;
      dot.style.width = "6px";
      dot.style.height = "6px";
      dot.style.borderRadius = "50%";
      dot.style.background = tr.side === "short" ? "#ef5350" : "#26a69a";
      dot.style.boxShadow = "0 0 8px rgba(0,0,0,0.6)";
      dot.style.pointerEvents = "none";
      el.appendChild(dot);
    }
  }

  /* ---------------- UI ---------------- */
  return (
    <div style={{ position: "relative" }}>
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        <button onClick={() => step(-10)}>«</button>
        <button onClick={() => step(-1)}>‹</button>
        <button onClick={playPause}>{playing ? "Pausa" : "Play"}</button>
        <button onClick={() => step(+1)}>›</button>
        <button onClick={() => step(+10)}>»</button>
        <button onClick={slower}>- velocidad</button>
        <span style={{ minWidth: 40, textAlign: "center" }}>{speed}x</span>
        <button onClick={faster}>+ velocidad</button>
        <span style={{ opacity: 0.7 }}>
          idx: {idx} / {candles.length ? candles.length - 1 : 0}
        </span>
        <input
          type="range"
          min={0}
          max={candles.length ? candles.length - 1 : 0}
          value={idx}
          onChange={(e) => {
            setPlaying(false);
            setIdx(+e.target.value);
          }}
          style={{ flex: 1 }}
        />
      </div>

      <div
        ref={containerRef}
        style={{
          position: "relative",
          width: "100%",
          height,
          borderRadius: 12,
          overflow: "hidden",
        }}
      />
      <div
        ref={overlayRef}
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      />
    </div>
  );
}

/* ---------- utils ---------- */
function clamp(n, a, b) {
  return Math.max(a, Math.min(n, b));
}
function isAfter(a, b) {
  if (!a || !b) return false;
  const ka = a.year * 10000 + a.month * 100 + a.day;
  const kb = b.year * 10000 + b.month * 100 + b.day;
  return ka > kb;
}
function fmt(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v.toFixed(2) : String(n ?? "");
}
