import React, { useRef, useState, useEffect } from "react";
import EquityChart from "./EquityChart.jsx";
import TradesTable from "./TradesTable.jsx";
import ChartReplay from "./ChartReplay.jsx";
import { emaSeries, detectFVG } from "../utils/indicators.js";

export default function CSVTester() {
  const [symbol, setSymbol] = useState("XAU/USD");
  const [timeframe, setTimeframe] = useState("D1");
  const [riskPercent, setRiskPercent] = useState(1);
  const [RR, setRR] = useState(2.5);
  const [maxTradesPerDay, setMaxTradesPerDay] = useState(3);

  const [singleInfo, setSingleInfo] = useState({ name: "", count: 0 });
  const [equity, setEquity] = useState([]);
  const [trades, setTrades] = useState([]);
  const [stats, setStats] = useState(null);
  const [logs, setLogs] = useState([]);
  const [progress, setProgress] = useState(0);
  const [running, setRunning] = useState(false);

  const [emaArr, setEmaArr] = useState([]);
  const [fvgZones, setFvgZones] = useState([]);

  const logRef = useRef(null);
  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [logs]);
  const addLog = (msg) =>
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);

  const onFileSingle = async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    addLog(`Subiendo CSV: ${file.name}`);
    const res = await fetch("/api/import/csv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csv: text, options: { timeframe } }),
    });
    const j = await res.json();
    if (!res.ok) {
      addLog("Error CSV: " + (j?.error || "?"));
      return;
    }
    window._SINGLE = j.candles;
    setSingleInfo({ name: file.name, count: j.candles.length });
    addLog(`CSV cargado: ${j.candles.length} velas`);

    const ema21 = emaSeries(21, j.candles);
    const fvgs = detectFVG(j.candles, 800);
    setEmaArr(ema21);
    setFvgZones(fvgs);
  };

  const run = async () => {
    if (!window._SINGLE?.length) {
      alert("Subí un CSV (1 TF)");
      return;
    }

    setEquity([]);
    setTrades([]);
    setStats(null);
    setLogs([]);
    setProgress(0);
    setRunning(true);
    addLog("Iniciando backtest (1 TF) con cierres por flip/tiempo/EOT…");

    try {
      const body = {
        mode: "singleTF",
        symbol,
        timeframe,
        riskPercent: Number(riskPercent),
        RR: Number(RR),
        maxTradesPerDay: Number(maxTradesPerDay),
        startingEquity: 10000,
        fractalLeftRight: 2,
        fvgScanBars: 200,
        maxBarsInTrade: 20,
        candles: window._SINGLE,
      };

      const resp = await fetch("/api/backtest/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        addLog("No se pudo iniciar el stream");
        setRunning(false);
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sep;
        while ((sep = buffer.indexOf("\n\n")) !== -1) {
          const chunk = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          if (chunk.startsWith("data: ")) {
            try {
              handleEvent(JSON.parse(chunk.slice(6)));
            } catch {}
          }
        }
      }
    } catch (e) {
      addLog("Stream error: " + e.message);
    } finally {
      setRunning(false);
      addLog("Finalizado.");
    }
  };

  const handleEvent = ({ type, payload }) => {
    if (type === "log") addLog(String(payload ?? ""));
    if (type === "progress")
      setProgress(Math.max(0, Math.min(1, Number(payload?.ratio || 0))));
    if (type === "equity" && payload?.equity)
      setEquity((prev) => [...prev, payload]);

    if (type === "trade" && payload) {
      // Registramos aberturas y cierres para pintar en el chart
      setTrades((prev) => [...prev, payload]);
      if (payload.opened) {
        addLog(
          `ABRE ${String(payload.dir || "").toUpperCase()} @${
            payload.entry
          } lot ${payload.lot}`
        );
      } else {
        addLog(
          `CIERRA ${payload.dir} PnL ${Number(payload.pnl || 0).toFixed(2)} ${
            payload.reason ? "(" + payload.reason + ")" : ""
          }`
        );
      }
    }

    if (type === "stats") setStats(payload);
  };

  return (
    <div>
      <div className="card">
        <h3>CSV (1 TF)</h3>
        <div className="flex gap-3 items-center flex-wrap">
          <label>
            Símbolo{" "}
            <input
              type="text"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
            />
          </label>
          <label>
            Timeframe
            <select
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value)}
            >
              <option value="D1">D1</option>
              <option value="W1">W1</option>
              <option value="MN1">MN1</option>
              <option value="H4">H4</option>
              <option value="H1">H1</option>
            </select>
          </label>
          <input type="file" accept=".csv,text/csv" onChange={onFileSingle} />
          <div className="muted">
            {singleInfo.name || "—"}{" "}
            {singleInfo.count ? `(${singleInfo.count} velas)` : ""}
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Parámetros</h3>
        <div className="flex gap-4 flex-wrap">
          <label>
            % riesgo por trade
            <input
              type="number"
              step="0.1"
              value={riskPercent}
              onChange={(e) => setRiskPercent(e.target.value)}
            />
          </label>
          <label>
            RR
            <input
              type="number"
              step="0.1"
              value={RR}
              onChange={(e) => setRR(e.target.value)}
            />
          </label>
          <label>
            Máx. trades/día
            <input
              type="number"
              step="1"
              value={maxTradesPerDay}
              onChange={(e) => setMaxTradesPerDay(e.target.value)}
            />
          </label>
        </div>
        <div className="flex items-center gap-3 mt-3">
          <button className="btn" onClick={run} disabled={running}>
            {running ? "Ejecutando…" : "Iniciar Backtest"}
          </button>
          <progress max="1" value={progress}></progress>
          <span>{Math.round(progress * 100)}%</span>
        </div>
        <div className="log" ref={logRef} style={{ marginTop: 8 }}>
          {logs.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      </div>

      {window._SINGLE?.length > 0 && (
        <div className="card" style={{ marginTop: 12 }}>
          <h3>Chart Replay</h3>
          {/* <<< pasamos TODAS las operaciones (abiertas y cerradas) >>> */}
          <ChartReplay
            candles={window._SINGLE}
            ema={emaArr}
            fvgZones={fvgZones}
            trades={trades}
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 mt-4">
        <div className="card">
          <h3>Equity Curve</h3>
          <EquityChart data={equity ?? []} />
        </div>
        <div className="card">
          <h3>Resumen</h3>
          {stats ? (
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Trades" value={stats.trades} />
              <Stat
                label="Win %"
                value={Number(stats.winRatePct ?? 0).toFixed(2)}
              />
              <Stat
                label="Net P&L"
                value={Number(stats.netProfit ?? 0).toFixed(2)}
              />
              <Stat
                label="Avg Trade"
                value={Number(stats.avgTrade ?? 0).toFixed(2)}
              />
              <Stat
                label="Max DD"
                value={Number(stats.maxDrawdown ?? 0).toFixed(2)}
              />
              <Stat
                label="Return %"
                value={Number(stats.returnPct ?? 0).toFixed(2)}
              />
            </div>
          ) : (
            <div className="muted">Sin datos aún…</div>
          )}
        </div>
      </div>

      <div className="card mt-4">
        <h3>Trades (cerrados)</h3>
        <TradesTable rows={(trades ?? []).filter((t) => t && !t.opened)} />
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="p-2 border rounded-md">
      <div className="muted text-xs">{label}</div>
      <div className="text-lg font-bold">{value}</div>
    </div>
  );
}
