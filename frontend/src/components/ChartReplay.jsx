import React, { useEffect, useMemo, useRef, useState } from "react";
import * as LightweightCharts from "lightweight-charts";
const { createChart, CrosshairMode } = LightweightCharts;

/**
 * props:
 * - candles: [{time(ms), open, high, low, close}, ...] ASC
 * - ema:     [{time(ms), value}, ...] ASC
 * - fvgZones:[{startTime(ms), endTime(ms), low, high, type:"bull"|"bear"}]
 * - trades:  [
 *     { opened:true, dir:"long"|"short", entry, sl, tp, lot, time(ms), RR }
 *     { opened:false, dir, entry, sl, tp, lot, time(ms), exitTime(ms), exit, pnl, RR }
 *   ]
 */
export default function ChartReplay({
  candles = [],
  ema = [],
  fvgZones = [],
  trades = [],
}) {
  const containerRef = useRef(null);
  const overlayRef = useRef(null);
  const chartRef = useRef(null);
  const candleSeriesRef = useRef(null);
  const emaSeriesRef = useRef(null);

  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(200);
  const [idx, setIdx] = useState(0); // reset a 0

  // Datos a segundos (requisito lightweight-charts)
  const chartCandles = useMemo(
    () =>
      (candles || []).map((c) => ({
        time: Math.floor(c.time / 1000),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    [candles]
  );

  const chartEMA = useMemo(
    () =>
      (ema || []).map((p) => ({
        time: Math.floor(p.time / 1000),
        value: p.value,
      })),
    [ema]
  );

  // ---------- INIT CHART ----------
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 560,
      crosshair: { mode: CrosshairMode.Normal },
      layout: { background: { color: "#0b1020" }, textColor: "#e5e7eb" },
      grid: {
        vertLines: { color: "#111827" },
        horzLines: { color: "#111827" },
      },
      timeScale: { timeVisible: true, borderVisible: false },
      rightPriceScale: { borderVisible: false },
    });

    const candlesS = chart.addCandlestickSeries({
      upColor: "#22c55e",
      downColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
      borderVisible: false,
    });

    const emaS = chart.addLineSeries({ color: "#facc15", lineWidth: 2 });

    chartRef.current = chart;
    candleSeriesRef.current = candlesS;
    emaSeriesRef.current = emaS;

    const redraw = () => requestAnimationFrame(drawOverlay);
    chart.timeScale().subscribeVisibleTimeRangeChange(redraw);

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: containerRef.current.clientWidth });
      requestAnimationFrame(drawOverlay);
    });
    ro.observe(containerRef.current);

    return () => {
      chart.timeScale().unsubscribeVisibleTimeRangeChange(redraw);
      ro.disconnect();
      chart.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- PLAY ----------
  useEffect(() => {
    if (!playing) return;
    if (idx >= chartCandles.length - 1) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(
      () => setIdx((i) => Math.min(i + 1, chartCandles.length - 1)),
      speed
    );
    return () => clearTimeout(t);
  }, [playing, idx, speed, chartCandles.length]);

  // ---------- DATA ----------
  useEffect(() => {
    if (
      !candleSeriesRef.current ||
      !emaSeriesRef.current ||
      chartCandles.length === 0
    )
      return;

    const endIdx = Math.max(1, Math.min(idx + 1, chartCandles.length));
    const data = chartCandles.slice(0, endIdx);
    const lastTime = data[data.length - 1]?.time;

    candleSeriesRef.current.setData(data);
    emaSeriesRef.current.setData(chartEMA.filter((p) => p.time <= lastTime));

    chartRef.current?.timeScale().scrollToPosition(1, true);
    requestAnimationFrame(drawOverlay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, chartCandles, chartEMA, fvgZones, trades]);

  // ---------- OVERLAY ----------
  const drawOverlay = () => {
    const chart = chartRef.current;
    const series = candleSeriesRef.current;
    const canvas = overlayRef.current;
    const wrap = containerRef.current;
    if (!chart || !series || !canvas || !wrap || chartCandles.length === 0)
      return;

    const rect = wrap.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
      canvas.width = rect.width;
      canvas.height = rect.height;
    }

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const ts = chart.timeScale();
    const priceToY = (p) => series.priceToCoordinate(p);
    const timeToX = (s) => ts.timeToCoordinate(s);

    const cutSec =
      chartCandles[Math.max(0, Math.min(idx, chartCandles.length - 1))]?.time ??
      0;
    if (timeToX(cutSec) == null) return;

    // ---- FVG como ray (hacia la derecha) ----
    (fvgZones || []).forEach((z) => {
      const s = Math.floor(z.startTime / 1000);
      if (s > cutSec) return;
      const xStart = timeToX(s);
      const yTop = priceToY(z.high);
      const yBot = priceToY(z.low);
      if ([xStart, yTop, yBot].some((v) => v == null)) return;

      const left = Math.max(0, xStart);
      const width = canvas.width - left;
      const top = Math.min(yTop, yBot);
      const height = Math.abs(yBot - yTop);

      ctx.fillStyle = "rgba(59,130,246,0.12)";
      ctx.strokeStyle = "rgba(59,130,246,0.35)";
      ctx.lineWidth = 1;
      ctx.fillRect(left, top, Math.max(1, width), Math.max(1, height));
      ctx.strokeRect(left, top, Math.max(1, width), Math.max(1, height));
    });

    // ---- TRADES: ancho 3 velas; altura = riesgo (entry↔SL) y reward (entry↔TP) ----
    const secToIndex = new Map(chartCandles.map((c, i) => [c.time, i]));
    const cutIdx = secToIndex.get(cutSec) ?? chartCandles.length - 1;
    const xAtIdx = (i) => ts.timeToCoordinate(chartCandles[i].time);

    const drawRRBoxes = (t) => {
      const openSec = Math.floor(t.time / 1000);
      const openIdx =
        secToIndex.get(openSec) ??
        chartCandles.findIndex((c) => c.time >= openSec);
      if (openIdx < 0) return;
      const endIdx = Math.min(openIdx + 3, cutIdx);
      if (endIdx <= openIdx) return;

      const x1 = xAtIdx(openIdx);
      const x2 = xAtIdx(endIdx);
      if (x1 == null || x2 == null) return;
      const left = Math.min(x1, x2);
      const width = Math.max(2, Math.abs(x2 - x1));

      const { entry, sl, tp } = t;
      const yEntry = priceToY(entry);
      const ySL = priceToY(sl);
      const yTP = priceToY(tp);
      if ([yEntry, ySL, yTP].some((v) => v == null)) return;

      // Risk (rojo)
      const rTop = Math.min(yEntry, ySL),
        rH = Math.abs(ySL - yEntry);
      ctx.fillStyle = "rgba(239,68,68,0.18)";
      ctx.strokeStyle = "rgba(239,68,68,0.55)";
      ctx.lineWidth = 1.2;
      ctx.fillRect(left, rTop, width, Math.max(2, rH));
      ctx.strokeRect(left, rTop, width, Math.max(2, rH));

      // Reward (verde)
      const gTop = Math.min(yEntry, yTP),
        gH = Math.abs(yTP - yEntry);
      ctx.fillStyle = "rgba(34,197,94,0.18)";
      ctx.strokeStyle = "rgba(34,197,94,0.55)";
      ctx.fillRect(left, gTop, width, Math.max(2, gH));
      ctx.strokeRect(left, gTop, width, Math.max(2, gH));

      // Label lot / RR
      ctx.save();
      ctx.font =
        "12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
      ctx.fillStyle = "#cbd5e1";
      const lotTxt = `lot ${Number(t.lot ?? 0).toFixed(2)} | RR ${t.RR ?? "-"}`;
      ctx.fillText(lotTxt, left + 4, (yEntry ?? 0) - 6);
      ctx.restore();
    };

    const all = Array.isArray(trades) ? trades : [];
    all
      .filter((t) => t?.opened && Math.floor(t.time / 1000) <= cutSec)
      .forEach(drawRRBoxes);
    all
      .filter(
        (t) => !t?.opened && Math.floor((t.exitTime ?? t.time) / 1000) <= cutSec
      )
      .forEach(drawRRBoxes);
  };

  // ---------- RESET ----------
  const handleReset = () => {
    setPlaying(false);
    setIdx(0);
    requestAnimationFrame(drawOverlay);
  };

  const clampIdx = (v) => Math.max(1, Math.min(v, chartCandles.length - 1));

  if (!chartCandles.length)
    return <div className="muted">Cargá un CSV (1 TF)…</div>;

  return (
    <div>
      <div style={{ position: "relative", width: "100%", height: 560 }}>
        <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
        <canvas
          ref={overlayRef}
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            zIndex: 10,
          }}
        />
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginTop: 12,
          flexWrap: "wrap",
        }}
      >
        <button className="btn" onClick={() => setPlaying((p) => !p)}>
          {playing ? "⏸︎ Pausa" : "▶️ Reproducir"}
        </button>
        <button
          className="btn outline"
          onClick={() => setIdx((i) => clampIdx(i - 1))}
        >
          ⏪ Step -1
        </button>
        <button
          className="btn outline"
          onClick={() => setIdx((i) => clampIdx(i + 1))}
        >
          ⏩ Step +1
        </button>
        <button className="btn danger" onClick={handleReset}>
          🔄 Reset
        </button>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          Velocidad
          <input
            type="range"
            min="50"
            max="1000"
            step="50"
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
          />
          <span className="muted">{speed} ms/vela</span>
        </label>
        <div className="muted">
          Idx {idx}/{Math.max(1, chartCandles.length - 1)}
        </div>
      </div>
    </div>
  );
}
