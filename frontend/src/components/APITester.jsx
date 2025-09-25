import React, { useEffect, useMemo, useRef, useState } from "react";
import ChartReplay from "./ChartReplay.jsx";

export default function APITester() {
  const [candles, setCandles] = useState([]);
  const [ema21, setEma21] = useState([]);
  const [fvgZones, setFvgZones] = useState([]);
  const [trades, setTrades] = useState([]);
  const [equity, setEquity] = useState([]);
  const [stats, setStats] = useState(null);
  const [log, setLog] = useState("");

  const [form, setForm] = useState({
    symbol: "XAU/USD",
    interval: "1day",
    outputsize: 1000,
    RR: 2.5,
    riskPercent: 1,
    maxTradesPerDay: 3,
    maxOpenPositions: 1,
  });

  const fetchPreview = async () => {
    setCandles([]);
    setEma21([]);
    const resp = await fetch("http://localhost:5501/td/candles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol: form.symbol,
        interval: form.interval,
        outputsize: form.outputsize,
      }),
    });
    const json = await resp.json();
    setCandles(json || []);
    // ema simple
    const k = 2 / (21 + 1);
    let prev;
    setEma21(
      (json || []).map((c, i) => {
        if (i === 0) prev = c.close;
        else prev = c.close * k + prev * (1 - k);
        return { time: c.time, value: prev };
      })
    );
  };

  const start = async () => {
    setFvgZones([]);
    setTrades([]);
    setEquity([]);
    setStats(null);
    setLog("");
    const resp = await fetch("http://localhost:5501/backtest/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "singleTF",
        symbol: form.symbol,
        timeframe: form.interval,
        RR: Number(form.RR),
        riskPercent: Number(form.riskPercent),
        maxTradesPerDay: Number(form.maxTradesPerDay),
        maxOpenPositions: Number(form.maxOpenPositions),
        fetchFromTD: {
          interval: form.interval,
          outputsize: Number(form.outputsize),
        },
      }),
    });
    if (!resp.body) {
      alert("No SSE body");
      return;
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const pump = async () => {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";
      for (const chunk of parts) {
        const line = chunk.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        try {
          const evt = JSON.parse(line.slice(6));
          switch (evt.type) {
            case "log":
              setLog((s) => s + evt.payload + "\n");
              break;
            case "equity":
              setEquity((e) => [...e, evt.payload]);
              break;
            case "fvg":
              setFvgZones((z) => [...z, evt.payload]);
              break;
            case "trade":
              setTrades((t) => [...t, evt.payload]);
              break;
            case "stats":
              setStats(evt.payload);
              break;
          }
        } catch {}
      }
      pump();
    };
    pump();
  };

  return (
    <div className="card">
      <div className="row" style={{ gap: 10, alignItems: "center" }}>
        <input
          placeholder="XAU/USD"
          value={form.symbol}
          onChange={(e) => setForm((f) => ({ ...f, symbol: e.target.value }))}
        />
        <select
          value={form.interval}
          onChange={(e) => setForm((f) => ({ ...f, interval: e.target.value }))}
        >
          <option value="1day">1day</option>
          <option value="1h">1h</option>
          <option value="15min">15min</option>
          <option value="1min">1min</option>
        </select>
        <input
          type="number"
          min="1"
          max="5000"
          value={form.outputsize}
          onChange={(e) =>
            setForm((f) => ({ ...f, outputsize: e.target.value }))
          }
        />
        <button onClick={fetchPreview}>Preview</button>
        <label>
          RR{" "}
          <input
            type="number"
            step="0.1"
            value={form.RR}
            onChange={(e) => setForm((f) => ({ ...f, RR: e.target.value }))}
            style={{ width: 80 }}
          />
        </label>
        <label>
          Riesgo %{" "}
          <input
            type="number"
            step="0.1"
            value={form.riskPercent}
            onChange={(e) =>
              setForm((f) => ({ ...f, riskPercent: e.target.value }))
            }
            style={{ width: 80 }}
          />
        </label>
        <label>
          Max/day{" "}
          <input
            type="number"
            value={form.maxTradesPerDay}
            onChange={(e) =>
              setForm((f) => ({ ...f, maxTradesPerDay: e.target.value }))
            }
            style={{ width: 80 }}
          />
        </label>
        <label>
          Max abiertas{" "}
          <input
            type="number"
            value={form.maxOpenPositions}
            onChange={(e) =>
              setForm((f) => ({ ...f, maxOpenPositions: e.target.value }))
            }
            style={{ width: 80 }}
          />
        </label>
        <button onClick={start}>Iniciar Backtest</button>
      </div>

      <ChartReplay
        candles={candles}
        ema={ema21}
        fvgZones={fvgZones}
        trades={trades}
      />
      <div className="card">
        <div style={{ fontWeight: 600 }}>Logs</div>
        <div className="log">{log}</div>
      </div>
    </div>
  );
}
