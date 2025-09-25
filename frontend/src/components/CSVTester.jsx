import React, { useMemo, useRef, useState } from "react";
import ChartReplay from "./ChartReplay.jsx";

/** Split una línea CSV respetando comillas */
function splitCSVLine(line, sep) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      // manejar comillas escapadas ""
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === sep && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Normaliza string numérico a Number detectando miles/decimales */
function numSmart(s) {
  if (s == null) return NaN;
  let v = String(s).trim();
  if (!v) return NaN;
  v = v.replace(/%/g, "").trim(); // quitar %
  // patrones
  const commaThousand = /^\d{1,3}(,\d{3})+(\.\d+)?$/; // 1,234.56
  const dotThousand = /^\d{1,3}(\.\d{3})+(,\d+)?$/; // 1.234,56
  if (commaThousand.test(v)) {
    v = v.replace(/,/g, ""); // elimina miles
    return Number(v); // decimal ya es punto
  }
  if (dotThousand.test(v)) {
    v = v.replace(/\./g, ""); // elimina miles
    v = v.replace(/,/g, "."); // decimal a punto
    return Number(v);
  }
  // solo coma decimal (ej: 1234,56)
  if (v.includes(",") && !v.includes(".")) {
    v = v.replace(/,/g, ".");
    return Number(v);
  }
  // por defecto: quitar separadores de miles sueltos
  // (a veces Investing trae 2,631.89 sin comillas bien)
  if ((v.match(/,/g) || []).length > 0 && (v.match(/\./g) || []).length === 1) {
    // intenta formato miles-coma + decimal punto
    v = v.replace(/,/g, "");
  }
  return Number(v);
}

/**
 * Parser flexible:
 * - Investing.com: "Date","Price","Open","High","Low","Vol.","Change %"
 * - Genérico: time|date|timestamp, open, high, low, (close|price|adj close)
 * Devuelve [{time,open,high,low,close}] ordenado por time (ms)
 */
function parseCSV(text) {
  const rawLines = text.split(/\r?\n/);
  const lines = rawLines.map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];

  // Detectar separador principal (si la cabecera tiene ';' y no ',')
  const sep = lines[0].includes(";") && !lines[0].includes(",") ? ";" : ",";

  const header = splitCSVLine(lines[0], sep).map((h) => h.trim().toLowerCase());

  const timeKeys = ["time", "date", "timestamp"];
  const openKeys = ["open", "apertura"];
  const highKeys = ["high", "max", "alto"];
  const lowKeys = ["low", "min", "bajo"];
  const closeKeys = ["close", "price", "adj close", "cierre"];

  const findIdx = (keys) => {
    for (const k of keys) {
      const i = header.indexOf(k);
      if (i >= 0) return i;
    }
    return -1;
  };

  let iTime = findIdx(timeKeys);
  let iOpen = findIdx(openKeys);
  let iHigh = findIdx(highKeys);
  let iLow = findIdx(lowKeys);
  let iClose = findIdx(closeKeys);

  // Fallback típico Investing (Date / Price)
  if (iTime < 0 && header.includes("date")) iTime = header.indexOf("date");
  if (iClose < 0 && header.includes("price")) iClose = header.indexOf("price");

  if ([iTime, iOpen, iHigh, iLow, iClose].some((v) => v < 0)) {
    throw new Error(
      "CSV debe tener columnas de tiempo y OHLC. Faltan: time, open, high, low, close. " +
        "Aceptado: time|date|timestamp y open, high, low, (close|price|adj close)"
    );
  }

  const rows = [];
  for (let r = 1; r < lines.length; r++) {
    const parts = splitCSVLine(lines[r], sep);
    if (parts.length < header.length) continue;

    let tRaw = parts[iTime];
    // ayuda a Safari con 'YYYY-MM-DD'
    if (/^\d{4}-\d{2}-\d{2}/.test(tRaw)) tRaw = tRaw.replace(/-/g, "/");

    let t = Number(tRaw);
    if (!Number.isFinite(t)) t = Date.parse(tRaw);
    if (!Number.isFinite(t)) continue;

    const o = numSmart(parts[iOpen]);
    const h = numSmart(parts[iHigh]);
    const l = numSmart(parts[iLow]);
    const c = numSmart(parts[iClose]);
    if ([o, h, l, c].some((x) => !Number.isFinite(x))) continue;

    rows.push({ time: t, open: o, high: h, low: l, close: c });
  }

  rows.sort((a, b) => a.time - b.time);
  return rows;
}

function emaArr(period, candles) {
  const k = 2 / (period + 1);
  const out = [];
  let prev;
  candles.forEach((c, i) => {
    if (i === 0) prev = c.close;
    else prev = c.close * k + prev * (1 - k);
    out.push({ time: c.time, value: prev });
  });
  return out;
}

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
    maxOpenPositions: 1, // límite simultáneo
  });

  const handleFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const txt = await f.text();
    const arr = parseCSV(txt);
    setRows(arr);
    setEma21(emaArr(21, arr));
    setFvgZones([]);
    setTrades([]);
    setEquity([]);
    setStats(null);
    setLog(`Cargadas ${arr.length} velas`);
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
        } catch {
          /* ignore */
        }
      }
      pump();
    };
    pump();
  };

  const reset = () => {
    setFvgZones([]);
    setTrades([]);
    setEquity([]);
    setStats(null);
    setLog("");
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
      <h2 style={{ marginTop: 0 }}>Forex Backtester (Single TF CSV)</h2>

      <div
        className="row"
        style={{ alignItems: "center", gap: 10, flexWrap: "wrap" }}
      >
        <input type="file" accept=".csv" ref={fileRef} onChange={handleFile} />
        <label>
          RR
          <input
            type="number"
            step="0.1"
            value={form.RR}
            onChange={(e) => setForm((f) => ({ ...f, RR: e.target.value }))}
            style={{ width: 90 }}
          />
        </label>
        <label>
          Riesgo %
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
          Max/day
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
          Max abiertas
          <input
            type="number"
            step="1"
            min="1"
            value={form.maxOpenPositions}
            onChange={(e) =>
              setForm((f) => ({ ...f, maxOpenPositions: e.target.value }))
            }
            style={{ width: 110 }}
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
        <div className="log" style={{ whiteSpace: "pre-wrap" }}>
          {log}
        </div>
      </div>
    </div>
  );
}
