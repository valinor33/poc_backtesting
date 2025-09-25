import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Canvas tipo TradingView con:
 * - Velas japonesas
 * - EMA (línea)
 * - FVG zones (bandas horizontales extendidas a la derecha)
 * - Rectángulos de operaciones (ancho = 3 velas; verde si pnl>0, rojo si pnl<=0)
 * - Replay (play/pause, speed, reset)
 * - Zoom con rueda y Pan con drag
 *
 * Props:
 *  - candles: [{time,open,high,low,close}]
 *  - ema: [{time,value}]
 *  - fvgZones: [{dir, low, high, index}]  // index es el índice de la vela del FVG
 *  - trades: [{time, dir, entry, sl, tp, lot, opened, exit, exitTime, pnl}]
 */
export default function ChartReplay({
  candles = [],
  ema = [],
  fvgZones = [],
  trades = [],
}) {
  const canvasRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [speedMs, setSpeedMs] = useState(50);
  const [idx, setIdx] = useState(0);

  // zoom/pan
  const [barW, setBarW] = useState(8); // ancho de vela en px
  const [offset, setOffset] = useState(0); // desplazamiento de barras hacia la izquierda (pan)
  const drag = useRef({ active: false, x: 0, offsetStart: 0 });

  // Mapa time->index para ubicar trades/fvg
  const timeToIndex = useMemo(() => {
    const m = new Map();
    candles.forEach((c, i) => m.set(c.time, i));
    return m;
  }, [candles]);

  // Normaliza EMA a puntos visibles (por idx)
  const emaIdx = useMemo(() => {
    if (!ema?.length || !candles?.length) return [];
    const map = new Map(ema.map((e) => [e.time, e.value]));
    return candles.map((c) => ({
      time: c.time,
      value: map.get(c.time) ?? null,
    }));
  }, [ema, candles]);

  // Reproducción
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setIdx((i) => Math.min(i + 1, Math.max(0, candles.length - 1)));
    }, speedMs);
    return () => clearInterval(t);
  }, [playing, speedMs, candles.length]);

  // Redibujar
  useEffect(() => {
    draw();
  }, [idx, candles, emaIdx, fvgZones, trades, barW, offset]);

  const reset = () => setIdx(0);

  // Eventos zoom/pan
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (e) => {
      e.preventDefault();
      const delta = Math.sign(e.deltaY);
      setBarW((w) => Math.max(3, Math.min(30, w - delta)));
    };

    const onDown = (e) => {
      drag.current = { active: true, x: e.clientX, offsetStart: offset };
    };
    const onMove = (e) => {
      if (!drag.current.active) return;
      const dx = e.clientX - drag.current.x;
      const bars = Math.round(dx / barW);
      setOffset(drag.current.offsetStart - bars);
    };
    const onUp = () => {
      drag.current.active = false;
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);

    return () => {
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [barW, offset]);

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas || !candles?.length) return;
    const ctx = canvas.getContext("2d");
    const W = (canvas.width = canvas.clientWidth);
    const H = (canvas.height = canvas.clientHeight);

    // Ventana visible (por zoom/pan)
    const barsFit = Math.max(10, Math.floor(W / barW) - 2);
    const right = Math.max(idx - offset, 0); // barra de la derecha
    const left = Math.max(0, right - barsFit);
    const slice = candles.slice(left, right + 1);
    if (!slice.length) {
      ctx.clearRect(0, 0, W, H);
      return;
    }

    // escala Y
    let min = Infinity,
      max = -Infinity;
    slice.forEach((c) => {
      min = Math.min(min, c.low);
      max = Math.max(max, c.high);
    });
    if (!isFinite(min) || !isFinite(max) || min === max) {
      min -= 1;
      max += 1;
    }
    const pad = (max - min) * 0.1;
    min -= pad;
    max += pad;

    const y = (p) => H - ((p - min) / (max - min)) * H;
    const x = (i) => (i - left) * barW + 0.5;

    // fondo
    ctx.fillStyle = "#0f1624";
    ctx.fillRect(0, 0, W, H);

    // grid horizontal
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let g = 1; g < 6; g++) {
      const gy = (H / 6) * g;
      ctx.moveTo(0, gy);
      ctx.lineTo(W, gy);
    }
    ctx.stroke();

    // FVG zones (hasta borde derecho)
    for (const z of fvgZones) {
      const zIdx = z.index ?? timeToIndex.get(z.time);
      if (zIdx == null) continue;
      if (zIdx > right) continue; // aún no aparece
      const x0 = Math.max(x(zIdx), 0);
      const w = W - x0;
      ctx.fillStyle =
        z.dir === "bull" ? "rgba(0,200,120,0.12)" : "rgba(255,80,80,0.12)";
      ctx.fillRect(x0, y(z.high), w, Math.max(2, y(z.low) - y(z.high)));
      // bordes
      ctx.strokeStyle =
        z.dir === "bull" ? "rgba(0,200,120,0.4)" : "rgba(255,80,80,0.4)";
      ctx.strokeRect(x0, y(z.high), w, Math.max(2, y(z.low) - y(z.high)));
    }

    // velas
    for (let i = left; i <= right; i++) {
      const c = candles[i];
      const xx = x(i);
      // mecha
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.beginPath();
      ctx.moveTo(xx, y(c.high));
      ctx.lineTo(xx, y(c.low));
      ctx.stroke();
      // cuerpo
      const up = c.close >= c.open;
      ctx.fillStyle = up ? "rgba(0, 200, 120, 0.9)" : "rgba(255, 80, 80, 0.9)";
      const bodyTop = y(Math.max(c.open, c.close));
      const bodyH = Math.max(1, Math.abs(y(c.close) - y(c.open)));
      ctx.fillRect(xx - barW * 0.4, bodyTop, barW * 0.8, bodyH);
    }

    // EMA
    ctx.strokeStyle = "rgba(255, 210, 0, 0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    let started = false;
    for (let i = left; i <= right; i++) {
      const v = emaIdx[i]?.value;
      if (v == null) continue;
      const xx = x(i);
      const yy = y(v);
      if (!started) {
        ctx.moveTo(xx, yy);
        started = true;
      } else ctx.lineTo(xx, yy);
    }
    ctx.stroke();

    // Operaciones (dibujar las que hayan ocurrido hasta 'right')
    const tradesToDraw = trades.filter(
      (t) => (timeToIndex.get(t.time) ?? 0) <= right
    );
    for (const t of tradesToDraw) {
      const iOpen = timeToIndex.get(t.time);
      if (iOpen == null || iOpen < left || iOpen > right) continue;

      const widthBars = 3;
      const xx = x(iOpen) - barW * 0.5;
      const ww = barW * widthBars;

      // Determinar color/altura según resultado
      let isProfit = null;
      let top, bottom;

      if (t.opened === false && typeof t.pnl === "number") {
        isProfit = t.pnl > 0;
        if (t.dir === "long") {
          top = y(Math.max(t.entry, isProfit ? t.exit ?? t.tp : t.sl));
          bottom = y(Math.min(t.entry, isProfit ? t.exit ?? t.tp : t.sl));
        } else {
          // en short el beneficio es hacia abajo
          top = y(Math.max(t.entry, isProfit ? t.sl : t.exit ?? t.tp));
          bottom = y(Math.min(t.entry, isProfit ? t.sl : t.exit ?? t.tp));
        }
      } else {
        // abierta: dibujar riesgo (entry <-> sl) en rojo claro
        top = y(Math.max(t.entry, t.sl));
        bottom = y(Math.min(t.entry, t.sl));
        isProfit = null;
      }

      const hh = Math.max(2, bottom - top);
      // fill
      ctx.fillStyle =
        isProfit === null
          ? "rgba(255,255,255,0.08)"
          : isProfit
          ? "rgba(0,200,120,0.18)"
          : "rgba(255,80,80,0.18)";
      ctx.fillRect(xx, top, ww, hh);
      // borde
      ctx.strokeStyle =
        isProfit === null
          ? "rgba(255,255,255,0.25)"
          : isProfit
          ? "rgba(0,200,120,0.8)"
          : "rgba(255,80,80,0.8)";
      ctx.lineWidth = 2;
      ctx.strokeRect(xx, top, ww, hh);

      // línea de entrada
      ctx.strokeStyle = "rgba(180,180,255,0.7)";
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(xx, y(t.entry));
      ctx.lineTo(xx + ww, y(t.entry));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Cursor de reproducción
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.beginPath();
    ctx.moveTo(x(right), 0);
    ctx.lineTo(x(right), H);
    ctx.stroke();

    // hud
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.fillText(`idx: ${idx} / ${candles.length - 1}`, 10, 18);
  }

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="row" style={{ gap: 10, alignItems: "center" }}>
        <button onClick={() => setPlaying((p) => !p)}>
          {playing ? "Pausa" : "Reproducir"}
        </button>
        <button onClick={() => setSpeedMs((s) => Math.min(300, s + 25))}>
          - velocidad
        </button>
        <button onClick={() => setSpeedMs((s) => Math.max(5, s - 25))}>
          + velocidad
        </button>
        <button onClick={reset}>Reset</button>
        <div style={{ opacity: 0.8 }}>
          idx: {idx} / {Math.max(0, candles.length - 1)}
        </div>
      </div>

      <div
        style={{
          position: "relative",
          width: "100%",
          height: 500,
          marginTop: 8,
          borderRadius: 10,
          overflow: "hidden",
          background: "#0f1624",
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.06)",
        }}
      >
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height: "100%", display: "block" }}
        />
      </div>
    </div>
  );
}
