import React, { useMemo, useRef, useState } from "react";
import ChartReplay from "./ChartReplay.jsx";

/* ---------------- Parser Investing robusto ---------------- */

function detectSep(headerLine = "") {
  const count = (s) => headerLine.split(s).length - 1;
  const candidates = [
    [",", count(",")],
    [";", count(";")],
    ["\t", count("\t")],
  ];
  candidates.sort((a, b) => b[1] - a[1]);
  return candidates[0][0] || ",";
}
const normHeader = (s) =>
  String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\.+$/g, ""); // 'Vol.' -> 'vol'

function parseNumberInvesting(raw) {
  if (raw == null) return NaN;
  let v = String(raw).trim();
  // limpia símbolos y espacios duros
  v = v.replace(/\u00A0/g, " ").replace(/[^\d,.\- ]/g, "");
  // ‘1,234.56’ => ‘1234.56’
  if (v.includes(",") && v.includes(".")) v = v.replace(/,/g, "");
  else {
    // solo comas: ‘1234,56’ => ‘1234.56’
    if (v.includes(",") && !v.includes(".")) {
      v = v.replace(/\./g, "").replace(",", ".");
    } else {
      // múltiples separadores: asume miles
      if ((v.match(/\./g) || []).length > 1) v = v.replace(/\./g, "");
      if ((v.match(/,/g) || []).length > 1) v = v.replace(/,/g, "");
    }
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function safeParseCSVInvesting(text = "") {
  try {
    const lines = text
      .replace(/\uFEFF/g, "")
      .split(/\r?\n/)
      .filter(Boolean);
    if (!lines.length) return [];

    const sep = detectSep(lines[0]);
    const header = lines[0].split(sep).map(normHeader);

    const idx = {
      date: header.findIndex((h) =>
        ["date", "fecha", "time", "timestamp"].includes(h)
      ),
      price: header.findIndex((h) =>
        ["price", "precio", "close", "adj close", "adjclose"].includes(h)
      ),
      open: header.findIndex((h) => ["open", "apertura"].includes(h)),
      high: header.findIndex((h) => ["high", "maximo", "máximo"].includes(h)),
      low: header.findIndex((h) => ["low", "minimo", "mínimo"].includes(h)),
    };

    // si falta algo esencial, devuelve [] (no rompe la app)
    if (Object.values(idx).some((i) => i < 0)) return [];

    const out = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(sep).map((p) => p.trim());
      if (parts.length < header.length) continue;

      const t = Date.parse(parts[idx.date]);
      const o = parseNumberInvesting(parts[idx.open]);
      const h = parseNumberInvesting(parts[idx.high]);
      const l = parseNumberInvesting(parts[idx.low]);
      const c = parseNumberInvesting(parts[idx.price]);

      if (
        !Number.isFinite(t) ||
        !Number.isFinite(o) ||
        !Number.isFinite(h) ||
        !Number.isFinite(l) ||
        !Number.isFinite(c)
      )
        continue;

      out.push({ time: t, open: o, high: h, low: l, close: c });
    }
    out.sort((a, b) => a.time - b.time);
    return out;
  } catch (e) {
    console.error("CSV parse error:", e);
    return [];
  }
}

/* ---------------- EMA para overlay ---------------- */
function emaArr(period, arr) {
  if (!Array.isArray(arr) || arr.length === 0) return [];
  const k = 2 / (period + 1);
  const out = [];
  let prev = arr[0].close;
  for (let i = 0; i < arr.length; i++) {
    const v = i === 0 ? prev : arr[i].close * k + prev * (1 - k);
    out.push({ time: arr[i].time, value: v });
    prev = v;
  }
  return out;
}

/* ---------------- UI ---------------- */
export default function CSVTester() {
  const [rows, setRows] = useState([]);
  const [ema21, setEma21] = useState([]);
  const [fvgZones, setFvgZones] = useState([]);
  const [trades, setTrades] = useState([]);
  const [equity, setEquity] = useState([]);
  const [stats, setStats] = useState(null);
  const [log, setLog] = useState("");

  const fileRef = useRef(null);
  const [form, setForm] = useState({
    symbol: "XAU/USD",
    timeframe: "D1",
    RR: 2.5,
    riskPercent: 1,
    maxTradesPerDay: 3,
    maxOpenPositions: 1,
  });

  const handleFile = async (e) => {
    try {
      const f = e.target.files?.[0];
      if (!f) return;
      const txt = await f.text();
      const arr = safeParseCSVInvesting(txt);
      if (!arr.length) {
        alert(
          "No pude leer el CSV. Encabezados esperados: Date, Price, Open, High, Low (Vol. y Change% son opcionales)."
        );
        setRows([]);
        setEma21([]);
        return;
      }
      setRows(arr);
      setEma21(emaArr(21, arr));
      setFvgZones([]);
      setTrades([]);
      setEquity([]);
      setStats(null);
      setLog(`✅ Cargadas ${arr.length} velas correctamente`);
    } catch (err) {
      console.error(err);
      alert("Hubo un problema leyendo el archivo.");
    }
  };

  const start = async () => {
    if (!rows.length) {
      alert("Cargá un CSV primero");
      return;
    }
    setFvgZones([]);
    setTrades([]);
    setEquity([]);
    setStats(null);
    setLog("");

    try {
      const resp = await fetch("http://localhost:5501/backtest/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: form.symbol,
          timeframe: form.timeframe,
          RR: Number(form.RR),
          riskPercent: Number(form.riskPercent),
          maxTradesPerDay: Number(form.maxTradesPerDay),
          maxOpenPositions: Number(form.maxOpenPositions),
          candles: rows,
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
              case "fvg":
                setFvgZones((z) => [...z, evt.payload]);
                break;
              case "trade":
                setTrades((t) => [...t, evt.payload]);
                break;
              case "equity":
                setEquity((e) => [...e, evt.payload]);
                break;
              case "stats":
                setStats(evt.payload);
                break;
              default:
                break;
            }
          } catch {}
        }
        pump();
      };
      pump();
    } catch (err) {
      console.error(err);
      alert("No pude conectar con el backend en :5501/backtest/stream");
    }
  };

  const reset = () => {
    setFvgZones([]);
    setTrades([]);
    setEquity([]);
    setStats(null);
    setLog("");
    setRows([]);
    setEma21([]);
    if (fileRef.current) fileRef.current.value = "";
  };

  const metrics = useMemo(() => {
    const closed = trades.filter((t) => !t.opened);
    const wins = closed.filter((t) => t.pnl > 0).length;
    const losses = closed.filter((t) => t.pnl <= 0).length;
    const net = closed.reduce((a, t) => a + t.pnl, 0);
    return { trades: closed.length, wins, losses, net };
  }, [trades]);

  return (
    <div className="card">
      <div className="row" style={{ alignItems: "center", gap: 10 }}>
        <input type="file" accept=".csv" ref={fileRef} onChange={handleFile} />
        <label>
          RR{" "}
          <input
            type="number"
            step="0.1"
            value={form.RR}
            onChange={(e) => setForm((f) => ({ ...f, RR: e.target.value }))}
            style={{ width: 90 }}
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
            style={{ width: 90 }}
          />
        </label>
        <label>
          Max/day{" "}
          <input
            type="number"
            step="1"
            value={form.maxTradesPerDay}
            onChange={(e) =>
              setForm((f) => ({ ...f, maxTradesPerDay: e.target.value }))
            }
            style={{ width: 90 }}
          />
        </label>
        <label>
          Max abiertas{" "}
          <input
            type="number"
            step="1"
            min="1"
            value={form.maxOpenPositions}
            onChange={(e) =>
              setForm((f) => ({ ...f, maxOpenPositions: e.target.value }))
            }
            style={{ width: 90 }}
          />
        </label>
        <button onClick={start}>Iniciar Backtest</button>
        <button onClick={reset}>Reset</button>
      </div>

      <div className="metrics" style={{ marginTop: 12 }}>
        <div className="metric">
          <div>Trades</div>
          <b>{metrics.trades}</b>
        </div>
        <div className="metric">
          <div>Wins</div>
          <b>{metrics.wins}</b>
        </div>
        <div className="metric">
          <div>Losses</div>
          <b>{metrics.losses}</b>
        </div>
        <div className="metric">
          <div>Net</div>
          <b>{metrics.net?.toFixed(2)}</b>
        </div>
        <div className="metric">
          <div>Equity</div>
          <b>
            {equity.length ? equity[equity.length - 1].equity.toFixed(2) : "-"}
          </b>
        </div>
      </div>

      <ChartReplay
        candles={rows}
        ema={ema21}
        fvgZones={fvgZones}
        trades={trades}
      />

      <div className="card">
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Logs</div>
        <div className="log">{log}</div>
      </div>
    </div>
  );
}
