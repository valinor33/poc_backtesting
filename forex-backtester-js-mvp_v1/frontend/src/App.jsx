import React, { useState } from "react";
import axios from "axios";
import EquityChart from "./components/EquityChart.jsx";
import TradesTable from "./components/TradesTable.jsx";

export default function App(){
  const [form, setForm] = useState({
    symbol: "EURUSD",
    riskPercent: 1.0,
    RR: 2.5,
    maxSpreadPoints: 40,
    slippagePoints: 30,
    oneTradeAtATime: true,
    fractalLeftRight: 2,
    fvgScanBars: 50,
    point: 0.0001,
    valuePerPointPerLot: 10,
    startingEquity: 10000,
    spreadPoints: 20
  });
  const [data, setData] = useState({ H1:[], M15:[], M1:[] });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleFile = async (e, tf) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      const json = JSON.parse(text);
      if (!Array.isArray(json)) throw new Error("Expected an array of candles");
      setData(prev => ({ ...prev, [tf]: json }));
    } catch (err) {
      alert("Invalid JSON file: " + err.message);
    }
  };

  const run = async () => {
    setLoading(true);
    try {
      const res = await axios.post("/api/backtest", { ...form, data });
      setResult(res.data);
    } catch (err) {
      alert(err?.response?.data?.error || String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 16, maxWidth: 1200, margin: "0 auto", fontFamily: "system-ui, sans-serif" }}>
      <h1>Forex Backtester MVP</h1>
      <p>Strategy: <b>EMA21(H1) + FVG(M15) + CHOCH(M1) | RR 1:2.5</b></p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <section style={{ padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
          <h3>Parameters</h3>
          {Object.entries(form).map(([k,v]) => (
            <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <label style={{ width: 220 }}>{k}</label>
              <input
                type={typeof v === "boolean" ? "checkbox" : "number"}
                checked={typeof v === "boolean" ? v : undefined}
                value={typeof v === "boolean" ? undefined : v}
                onChange={(e)=>{
                  const val = typeof v === "boolean" ? e.target.checked : Number(e.target.value);
                  setForm(prev => ({ ...prev, [k]: val }));
                }}
              />
            </div>
          ))}
          <button onClick={run} disabled={loading} style={{ padding: "8px 12px" }}>
            {loading ? "Running..." : "Run backtest"}
          </button>
          <p style={{ fontSize: 12, color: "#666" }}>
            Load JSON arrays of candles for each timeframe below.
            Candle shape: {"{ time(ms), open, high, low, close }"}
          </p>
        </section>

        <section style={{ padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
          <h3>Load Data (JSON)</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div>
              <b>H1</b>
              <input type="file" accept="application/json" onChange={(e)=>handleFile(e,"H1")} />
              <small>{data.H1.length} candles</small>
            </div>
            <div>
              <b>M15</b>
              <input type="file" accept="application/json" onChange={(e)=>handleFile(e,"M15")} />
              <small>{data.M15.length} candles</small>
            </div>
            <div>
              <b>M1</b>
              <input type="file" accept="application/json" onChange={(e)=>handleFile(e,"M1")} />
              <small>{data.M1.length} candles</small>
            </div>
          </div>
        </section>
      </div>

      {result && (
        <>
          <section style={{ marginTop: 16, padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
            <h3>Summary</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12 }}>
              <Stat label="Trades" value={result.stats.trades} />
              <Stat label="Win rate %" value={result.stats.winRatePct.toFixed(2)} />
              <Stat label="Net P&L" value={result.stats.netProfit.toFixed(2)} />
              <Stat label="Avg/Trade" value={result.stats.avgTrade.toFixed(2)} />
              <Stat label="Max Drawdown" value={result.stats.maxDD.toFixed(2)} />
              <Stat label="Return %" value={result.stats.returnPct.toFixed(2)} />
            </div>
          </section>

          <section style={{ marginTop: 16, padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
            <h3>Equity Curve</h3>
            <EquityChart data={result.equityCurve} />
          </section>

          <section style={{ marginTop: 16, padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
            <h3>Trades</h3>
            <TradesTable rows={result.trades} />
          </section>
        </>
      )}
    </div>
  );
}

function Stat({label, value}){
  return (
    <div style={{ padding: 12, border: "1px solid #eee", borderRadius: 8 }}>
      <div style={{ fontSize:12, color:"#666" }}>{label}</div>
      <div style={{ fontSize:22, fontWeight:700 }}>{value}</div>
    </div>
  )
}