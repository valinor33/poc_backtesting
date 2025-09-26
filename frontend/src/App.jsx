import React, { useEffect, useRef, useState } from "react";
import EquityChart from "./components/EquityChart.jsx";
import TradesTable from "./components/TradesTable.jsx";
import CSVTester from "./components/CSVTester.jsx";

function useLocalStorage(key, initial) {
  const [val, setVal] = useState(() => {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : initial;
  });
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(val));
  }, [key, val]);
  return [val, setVal];
}

export default function App() {
  const [apiKey, setApiKey] = useLocalStorage("TD_API_KEY", "");
  const [symbol, setSymbol] = useLocalStorage("symbol", "EUR/USD");
  const [tab, setTab] = useLocalStorage("tab", "twelve"); // "twelve" | "csv"

  const [sizes, setSizes] = useLocalStorage("sizes", {
    H1: 1500,
    M15: 3000,
    M1: 5000,
  });
  const [params, setParams] = useLocalStorage("params", {
    riskPercent: 1.0,
    RR: 2.5,
    maxSpreadPoints: 40,
    slippagePoints: 30,
    oneTradeAtATime: true,
    fractalLeftRight: 2,
    fvgScanBars: 50,
    point: 0.0001, // FX default
    valuePerPointPerLot: 10, // FX default
    startingEquity: 10000,
    spreadPoints: 20,
  });

  // panel state (Twelve Data)
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState([]);
  const [progress, setProgress] = useState(0);
  const [equity, setEquity] = useState([]);
  const [trades, setTrades] = useState([]);
  const [stats, setStats] = useState(null);
  const addLog = (msg) =>
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  const logRef = useRef(null);
  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [logs]);

  const start = async () => {
    if (!apiKey) {
      alert(
        "Poné tu API key de Twelve Data en el frontend y en el backend (.env)"
      );
      return;
    }
    setLogs([]);
    setProgress(0);
    setEquity([]);
    setTrades([]);
    setStats(null);
    setRunning(true);
    addLog("Starting...");
    const clamp = (n) => Math.max(1, Math.min(5000, Number(n) || 1));
    const sizesClamped = {
      H1: clamp(sizes.H1),
      M15: clamp(sizes.M15),
      M1: clamp(sizes.M1),
    };

    try {
      const resp = await fetch("/api/backtest/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-td-key": apiKey },
        body: JSON.stringify({
          symbol,
          ...params,
          fetchFromTD: {
            H1: { interval: "1h", outputsize: sizesClamped.H1 },
            M15: { interval: "15min", outputsize: sizesClamped.M15 },
            M1: { interval: "1min", outputsize: sizesClamped.M1 },
          },
        }),
      });
      if (!resp.ok && resp.status !== 200) {
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
    } catch (err) {
      addLog("Stream error: " + err.message);
    } finally {
      setRunning(false);
      addLog("Finished.");
    }
  };

  const handleEvent = ({ type, payload }) => {
    if (type === "log") addLog(payload);
    if (type === "progress")
      setProgress(Math.max(0, Math.min(1, payload.ratio || 0)));
    if (type === "equity") setEquity((prev) => [...prev, payload]);
    if (type === "trade") {
      if (payload.opened)
        addLog(
          `Opened ${payload.dir.toUpperCase()} lot ${payload.lot} @ ${Number(
            payload.entry
          ).toFixed(5)}`
        );
      else
        addLog(
          `Closed ${payload.dir.toUpperCase()} PnL ${Number(
            payload.pnl
          ).toFixed(2)}`
        );
      setTrades((prev) => [...prev, payload]);
    }
    if (type === "stats") setStats(payload);
  };

  return (
    <div style={{ padding: 16, maxWidth: 1280, margin: "0 auto" }}>
      <h1>Forex Backtester</h1>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button
          className={`btn ${tab === "twelve" ? "" : "outline"}`}
          onClick={() => setTab("twelve")}
        >
          Twelve Data
        </button>
        <button
          className={`btn ${tab === "csv" ? "" : "outline"}`}
          onClick={() => setTab("csv")}
        >
          CSV Tester
        </button>
      </div>

      {tab === "twelve" ? (
        <>
          <p className="muted">
            Estrategia: <b>EMA21(H1) + FVG(M15) + CHOCH(M1)</b> | RR 1:2.5
          </p>
          <div className="grid grid3">
            <div className="card">
              <h3>API Key</h3>
              <label>
                {" "}
                Twelve Data Key
                <input
                  type="text"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="td_xxx..."
                />
              </label>
              <p className="muted">
                Guardada en tu navegador (localStorage). En el backend usá{" "}
                <span className="chip">.env</span>
              </p>
            </div>

            <div className="card">
              <h3>Símbolo & Tamaño</h3>
              <label>
                {" "}
                Símbolo
                <input
                  type="text"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                />
              </label>
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  marginTop: 8,
                  flexWrap: "wrap",
                }}
              >
                <span className="chip">H1</span>
                <input
                  type="number"
                  max="5000"
                  min="1"
                  value={sizes.H1}
                  onChange={(e) =>
                    setSizes({
                      ...sizes,
                      H1: Math.min(5000, Math.max(1, Number(e.target.value))),
                    })
                  }
                />
                <span className="chip">M15</span>
                <input
                  type="number"
                  max="5000"
                  min="1"
                  value={sizes.M15}
                  onChange={(e) =>
                    setSizes({
                      ...sizes,
                      M15: Math.min(5000, Math.max(1, Number(e.target.value))),
                    })
                  }
                />
                <span className="chip">M1</span>
                <input
                  type="number"
                  max="5000"
                  min="1"
                  value={sizes.M1}
                  onChange={(e) =>
                    setSizes({
                      ...sizes,
                      M1: Math.min(5000, Math.max(1, Number(e.target.value))),
                    })
                  }
                />
              </div>
            </div>

            <div className="card">
              <h3>Parámetros</h3>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {Object.entries(params).map(([k, v]) => (
                  <label key={k}>
                    {k}
                    <input
                      type={typeof v === "boolean" ? "checkbox" : "number"}
                      checked={typeof v === "boolean" ? v : undefined}
                      value={typeof v === "boolean" ? undefined : v}
                      onChange={(e) => {
                        const val =
                          typeof v === "boolean"
                            ? e.target.checked
                            : Number(e.target.value);
                        setParams((prev) => ({ ...prev, [k]: val }));
                      }}
                    />
                  </label>
                ))}
              </div>
              <p className="muted" style={{ marginTop: 8 }}>
                Tip: Para XAU/USD, el backend ajusta <code>point=0.01</code> y{" "}
                <code>valuePerPointPerLot=1</code> automáticamente.
              </p>
            </div>
          </div>

          <div className="card" style={{ marginTop: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button className="btn" onClick={start} disabled={running}>
                {" "}
                {running ? "Running..." : "Start Backtest"}{" "}
              </button>
              <progress max="1" value={progress}></progress>
              <span>{Math.round(progress * 100)}%</span>
            </div>
            <div ref={logRef} className="log" style={{ marginTop: 8 }}>
              {logs.map((l, i) => (
                <div key={i}>{l}</div>
              ))}
            </div>
          </div>

          <div className="grid grid2" style={{ marginTop: 12 }}>
            <div className="card">
              <h3>Equity Curve</h3>
              <EquityChart data={equity} />
            </div>
            <div className="card">
              <h3>Resumen</h3>
              {stats ? (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3,1fr)",
                    gap: 8,
                  }}
                >
                  <Stat label="Trades" value={stats.trades} />
                  <Stat label="Wins" value={stats.wins} />
                  <Stat label="Losses" value={stats.losses} />
                  <Stat
                    label="Win rate %"
                    value={stats.winRatePct.toFixed(2)}
                  />
                  <Stat label="Net P&L" value={stats.netProfit.toFixed(2)} />
                  <Stat label="Avg/Trade" value={stats.avgTrade.toFixed(2)} />
                  <Stat
                    label="Start Eq."
                    value={stats.startEquity?.toFixed(2)}
                  />
                  <Stat label="End Eq." value={stats.endEquity?.toFixed(2)} />
                  <Stat label="Max DD" value={stats.maxDrawdown?.toFixed(2)} />
                  <Stat label="Return %" value={stats.returnPct?.toFixed(2)} />
                </div>
              ) : (
                <div className="muted">Sin datos aún…</div>
              )}
            </div>
          </div>

          <div className="card" style={{ marginTop: 12 }}>
            <h3>Trades</h3>
            <TradesTable rows={trades.filter((t) => !t.opened)} />
          </div>
        </>
      ) : (
        <CSVTester defaultParams={params} />
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div style={{ padding: 8, border: "1px solid #eee", borderRadius: 8 }}>
      <div className="muted">{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700 }}>{value}</div>
    </div>
  );
}
