import React, { useEffect, useMemo, useRef, useState } from "react";
import { createChart, CrosshairMode } from "lightweight-charts";

/**
 * Props:
 *  - candles: [{ time: <unix seconds>, open, high, low, close }]
 *  - ema:     [{ time, value }]  (opcional)
 *  - trades:  [{
 *      id,
 *      side: 'long'|'short',
 *      entryTime, closeTime,       // unix seconds
 *      entryPrice, takeProfit, stopLoss,
 *      result: 'tp'|'sl'|'open'    // 'open' si sigue abierta
 *    }]
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
  const [speed, setSpeed] = useState(1); // 0.25, 0.5, 1, 2, 4
  const timerRef = useRef(null);

  // --- Chart + series ---
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const emaRef = useRef(null);

  // --- helpers velocidad ---
  const nextDelay = useMemo(() => {
    const base = 220; // ms
    const factor = { 0.25: 4, 0.5: 2, 1: 1, 2: 0.5, 4: 0.25 }[speed] ?? 1;
    return Math.max(20, base * factor);
  }, [speed]);

  // Tiempo actual según idx
  const currentTime = useMemo(
    () =>
      candles[idx] ? candles[idx].time : candles[candles.length - 1]?.time,
    [candles, idx]
  );

  // Inicialización del chart
  useEffect(() => {
    if (!containerRef.current) return;
    if (chartRef.current) return;

    const chart = createChart(containerRef.current, {
      height,
      layout: { background: { color: "transparent" }, textColor: "#C8D0E0" },
      grid: {
        vertLines: { color: "rgba(197, 203, 206, 0.08)" },
        horzLines: { color: "rgba(197, 203, 206, 0.08)" },
      },
      crosshair: { mode: CrosshairMode.Magnet },
      rightPriceScale: { borderColor: "rgba(197,203,206,0.2)" },
      timeScale: {
        borderColor: "rgba(197,203,206,0.2)",
        secondsVisible: true,
        timeVisible: true,
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
      if (!containerRef.current) return;
      const { clientWidth } = containerRef.current;
      chart.applyOptions({ width: clientWidth, height });
      drawTradeOverlays(); // re-posicionar overlays
    };
    resize();
    const obs = new ResizeObserver(resize);
    obs.observe(containerRef.current);

    // Redibujar overlays cuando cambia el rango visible
    chart.timeScale().subscribeVisibleTimeRangeChange(drawTradeOverlays);

    return () => {
      obs.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      emaRef.current = null;
    };
  }, [height]);

  // Set data inicial y por idx
  useEffect(() => {
    if (!seriesRef.current || candles.length === 0) return;

    // Cargamos de 0..idx
    seriesRef.current.setData(candles.slice(0, idx + 1));

    // EMA hasta idx
    if (emaRef.current) {
      const emaData = ema.filter((p) => p.time <= currentTime);
      emaRef.current.setData(emaData);
    }

    // Marcadores de entrada/salida hasta idx
    const markers = buildMarkersUntil(currentTime, trades);
    seriesRef.current.setMarkers(markers);

    // Ajustamos rango visible suave en el primer set
    if (idx < 3) {
      chartRef.current?.timeScale().fitContent();
    }

    // Dibuja overlays (rectángulos de trades)
    drawTradeOverlays();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, ema, idx, trades]);

  // Auto-replay
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
    timerRef.current = null;
  }

  // --- Controles ---
  const playPause = () => setPlaying((p) => !p);
  const step = (delta) => {
    setPlaying(false);
    setIdx((i) => clamp(i + delta, 0, candles.length - 1));
  };
  const scrub = (e) => {
    setPlaying(false);
    setIdx(Number(e.target.value));
  };
  const slower = () =>
    setSpeed((s) => ({ 4: 2, 2: 1, 1: 0.5, 0.5: 0.25, 0.25: 0.25 }[s]));
  const faster = () =>
    setSpeed((s) => ({ 0.25: 0.5, 0.5: 1, 1: 2, 2: 4, 4: 4 }[s]));

  function clamp(n, a, b) {
    return Math.max(a, Math.min(n, b));
  }

  // --- Markers de trades (flecha up/down en la vela de entrada; ✖ en salida) ---
  function buildMarkersUntil(tUntil, trs) {
    const list = [];
    for (const tr of trs) {
      if (!tr.entryTime || tr.entryTime > tUntil) continue;
      list.push({
        time: tr.entryTime,
        position: tr.side === "short" ? "aboveBar" : "belowBar",
        color: tr.side === "short" ? "#ef5350" : "#26a69a",
        shape: tr.side === "short" ? "arrowDown" : "arrowUp",
        text: `${tr.side === "short" ? "SHORT" : "LONG"} @ ${fmt(
          tr.entryPrice
        )}`,
      });
      if (tr.closeTime && tr.closeTime <= tUntil) {
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

  // --- Overlays rectangulares de trades (entre SL y TP; de entry→exit) ---
  function drawTradeOverlays() {
    const chart = chartRef.current;
    const s = seriesRef.current;
    if (!chart || !s || !overlayRef.current) return;

    const timeScale = chart.timeScale();
    const priceScale = chart.priceScale("right");
    const el = overlayRef.current;
    el.innerHTML = ""; // limpiar

    const now = currentTime;
    for (const tr of trades) {
      if (!tr.entryTime || tr.entryTime > now) continue;

      const x1 = timeScale.timeToCoordinate(tr.entryTime);
      const x2 = timeScale.timeToCoordinate(
        tr.closeTime && tr.closeTime <= now ? tr.closeTime : now
      );
      if (x1 == null || x2 == null) continue;

      const yTP = priceScale.priceToCoordinate(tr.takeProfit);
      const ySL = priceScale.priceToCoordinate(tr.stopLoss);
      const yEntry = priceScale.priceToCoordinate(tr.entryPrice);
      if (yTP == null || ySL == null || yEntry == null) continue;

      const left = Math.min(x1, x2);
      const width = Math.max(1, Math.abs(x2 - x1));
      const top = Math.min(yTP, ySL);
      const height = Math.max(1, Math.abs(yTP - ySL));

      // color según resultado conocido (o side si sigue abierta)
      const isWin = tr.result === "tp" || (!tr.result && tr.side === "long"); // heurística
      const color = tr.result
        ? tr.result === "tp"
          ? "rgba(38,166,154,0.18)"
          : "rgba(239,83,80,0.18)"
        : "rgba(255,193,7,0.12)";

      const borderColor = tr.result
        ? tr.result === "tp"
          ? "#26a69a"
          : "#ef5350"
        : "#ffc107";

      // rectángulo SL↔TP
      const box = document.createElement("div");
      box.style.position = "absolute";
      box.style.left = `${left}px`;
      box.style.top = `${top}px`;
      box.style.width = `${width}px`;
      box.style.height = `${height}px`;
      box.style.background = color;
      box.style.borderTop = `2px solid ${borderColor}`; // borde = TP
      box.style.borderBottom = `2px solid ${borderColor}`; // borde = SL
      box.style.pointerEvents = "none";
      el.appendChild(box);

      // punto de entrada
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

  // --- UI ---
  const total = candles.length ? candles.length - 1 : 0;
  const speedLabel = `${speed}x`;

  return (
    <div style={{ position: "relative" }}>
      {/* Controles */}
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
        <span style={{ minWidth: 40, textAlign: "center" }}>{speedLabel}</span>
        <button onClick={faster}>+ velocidad</button>
        <span style={{ opacity: 0.7 }}>
          idx: {idx} / {total}
        </span>
        <input
          type="range"
          min={0}
          max={total}
          value={idx}
          onChange={scrub}
          style={{ flex: 1 }}
        />
      </div>

      {/* Chart */}
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
      {/* capa de overlays */}
      <div
        ref={overlayRef}
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

/* --- util --- */
function fmt(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v.toFixed(2) : String(n ?? "");
}
