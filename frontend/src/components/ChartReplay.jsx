import React, { useEffect, useRef, useState } from "react";
import { createChart, CrosshairMode } from "lightweight-charts";

export default function ChartReplay({
  candles = [],
  ema = [],
  fvgZones = [],
  trades = [],
}) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const mainRef = useRef(null);
  const emaRef = useRef(null);

  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(50);

  // init chart
  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;

    const chart = createChart(host, {
      layout: { background: { color: "#0f172a" }, textColor: "#cbd5e1" },
      grid: {
        vertLines: { color: "#1e293b" },
        horzLines: { color: "#1e293b" },
      },
      rightPriceScale: { borderColor: "#334155" },
      timeScale: { borderColor: "#334155", rightOffset: 6 },
      crosshair: { mode: CrosshairMode.Normal },
    });

    const main = chart.addCandlestickSeries();
    const emaS = chart.addLineSeries({ color: "#facc15", lineWidth: 2 });

    chartRef.current = chart;
    mainRef.current = main;
    emaRef.current = emaS;

    const ro = new ResizeObserver(() => {
      const r = host.getBoundingClientRect();
      chart.applyOptions({ width: r.width, height: Math.max(360, r.height) });
    });
    ro.observe(host);
    const r0 = host.getBoundingClientRect();
    chart.applyOptions({ width: r0.width, height: Math.max(360, r0.height) });

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      mainRef.current = null;
      emaRef.current = null;
    };
  }, []);

  // feed series
  useEffect(() => {
    if (!mainRef.current || candles.length === 0) return;
    mainRef.current.setData(
      candles.map((c) => ({
        time: Math.floor(c.time / 1000),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }))
    );
    if (emaRef.current) {
      emaRef.current.setData(
        (ema || []).map((e) => ({
          time: Math.floor(e.time / 1000),
          value: e.value,
        }))
      );
    }
    setIdx(Math.max(0, candles.length - 1));
  }, [candles, ema]);

  // overlay canvas
  useEffect(() => {
    if (!chartRef.current || !mainRef.current || !containerRef.current) return;

    const host = containerRef.current;
    const chart = chartRef.current;
    const series = mainRef.current;

    const overlay = document.createElement("canvas");
    overlay.style.position = "absolute";
    overlay.style.left = "0";
    overlay.style.top = "0";
    overlay.style.pointerEvents = "none";
    overlay.style.zIndex = "5";
    host.appendChild(overlay);

    const ctx = overlay.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const ts = chart.timeScale();

    const resize = () => {
      const { width, height } = host.getBoundingClientRect();
      overlay.width = Math.max(1, Math.floor(width * dpr));
      overlay.height = Math.max(1, Math.floor(height * dpr));
      overlay.style.width = width + "px";
      overlay.style.height = height + "px";
      draw();
    };

    const draw = () => {
      if (!candles.length) return;
      ctx.clearRect(0, 0, overlay.width, overlay.height);
      ctx.save();
      ctx.scale(dpr, dpr);

      const tLimit = candles[idx]?.time ?? 0;

      // FVG
      (fvgZones || []).forEach((z) => {
        if (!z?.indexTime || z.indexTime > tLimit) return;
        const x0 = ts.timeToCoordinate(Math.floor(z.indexTime / 1000));
        const yH = series.priceToCoordinate(z.high);
        const yL = series.priceToCoordinate(z.low);
        if (x0 == null || yH == null || yL == null) return;

        const x1 = overlay.width / dpr;
        const top = Math.min(yH, yL);
        const h = Math.abs(yH - yL);

        ctx.fillStyle = "rgba(59,130,246,0.12)";
        ctx.strokeStyle = "rgba(59,130,246,0.25)";
        ctx.fillRect(x0, top, x1 - x0, h);
        ctx.strokeRect(x0, top, x1 - x0, h);
      });

      // Trades (3 velas de ancho)
      (trades || []).forEach((tr) => {
        if (!tr?.time || tr.time > tLimit) return;
        const i = candles.findIndex((c) => c.time === tr.time);
        if (i < 0) return;

        const c0 = candles[i];
        const c3 = candles[Math.min(candles.length - 1, i + 3)];
        const x0 = ts.timeToCoordinate(Math.floor(c0.time / 1000));
        const x3 = ts.timeToCoordinate(Math.floor(c3.time / 1000));
        const ySL = series.priceToCoordinate(tr.sl);
        const yTP = series.priceToCoordinate(tr.tp);
        if (x0 == null || x3 == null || ySL == null || yTP == null) return;

        const left = Math.min(x0, x3);
        const width = Math.abs(x3 - x0);
        const top = Math.min(ySL, yTP);
        const height = Math.abs(ySL - yTP);

        const win =
          (typeof tr.pnl === "number" && tr.pnl > 0) ||
          (tr.exit != null && tr.tp != null && tr.exit === tr.tp);

        ctx.fillStyle = win ? "rgba(34,197,94,0.22)" : "rgba(239,68,68,0.22)";
        ctx.strokeStyle = win ? "rgba(34,197,94,0.6)" : "rgba(239,68,68,0.6)";
        ctx.fillRect(left, top, width, height);
        ctx.strokeRect(left, top, width, height);
      });

      ctx.restore();
    };

    const onRange = () => draw();
    const onSize = () => resize();

    ts.subscribeVisibleTimeRangeChange(onRange);
    ts.subscribeVisibleLogicalRangeChange(onRange);
    const ro = new ResizeObserver(onSize);
    ro.observe(host);

    resize();
    const tick = setInterval(draw, 100);

    return () => {
      clearInterval(tick);
      ro.disconnect();
      ts.unsubscribeVisibleTimeRangeChange(onRange);
      ts.unsubscribeVisibleLogicalRangeChange(onRange);
      overlay.remove();
    };
  }, [candles, fvgZones, trades, idx]);

  // playback
  useEffect(() => {
    if (!playing || candles.length === 0) return;
    const h = setInterval(
      () => setIdx((i) => Math.min(candles.length - 1, i + 1)),
      Math.max(5, speed)
    );
    return () => clearInterval(h);
  }, [playing, speed, candles.length]);

  return (
    <div className="card">
      <div className="row" style={{ gap: 8, marginBottom: 8 }}>
        <button onClick={() => setPlaying((p) => !p)}>
          {playing ? "Pausa" : "Reproducir"}
        </button>
        <button onClick={() => setSpeed((s) => Math.min(500, s + 25))}>
          - velocidad
        </button>
        <button onClick={() => setSpeed((s) => Math.max(5, s - 25))}>
          + velocidad
        </button>
        <button onClick={() => setIdx(0)}>Reset</button>
        <div>
          idx: {idx} / {Math.max(0, candles.length - 1)}
        </div>
      </div>
      <div
        ref={containerRef}
        style={{ position: "relative", width: "100%", height: 520 }}
      />
    </div>
  );
}
