// Twelve Data fetcher (fixed):
// - Normalize symbols (EURUSD -> EUR/USD) if missing slash
// - Clamp outputsize to [1, 5000]
// Node 18+: usa fetch nativo

function normalizeSymbol(symbol) {
  if (!symbol) throw new Error("Symbol is required");
  if (symbol.includes("/")) return symbol.trim();
  const s = symbol.trim().toUpperCase().replace(/\s+/g, "");
  if (s.length === 6) return s.slice(0, 3) + "/" + s.slice(3); // EURUSD -> EUR/USD
  if (s.endsWith("USD") && s.length > 3) return s.slice(0, -3) + "/USD";
  return s;
}

export async function fetchCandlesTD(symbol, interval, outputsize, apiKey) {
  const sym = normalizeSymbol(symbol);
  let size = Number(outputsize || 1000);
  if (!Number.isFinite(size) || size < 1) size = 1;
  if (size > 5000) size = 5000;

  const url = new URL("https://api.twelvedata.com/time_series");
  url.searchParams.set("symbol", sym);
  url.searchParams.set("interval", interval); // "1min", "15min", "1h"
  url.searchParams.set("outputsize", String(size)); // clamp 1..5000
  url.searchParams.set("format", "JSON");
  url.searchParams.set("apikey", apiKey);

  const resp = await fetch(url, { method: "GET" });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${txt}`);
  }
  const j = await resp.json();
  if (j.status && j.status !== "ok") {
    throw new Error(j.message || "Twelve Data API error");
  }
  if (!Array.isArray(j.values)) {
    throw new Error("No 'values' in Twelve Data response");
  }
  const arr = j.values.map((v) => ({
    time: new Date(v.datetime).getTime(),
    open: parseFloat(v.open),
    high: parseFloat(v.high),
    low: parseFloat(v.low),
    close: parseFloat(v.close),
  }));
  arr.sort((a, b) => a.time - b.time);
  return arr;
}
