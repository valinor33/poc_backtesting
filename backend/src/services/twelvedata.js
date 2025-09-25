import fetch from "node-fetch";

const TD_BASE = "https://api.twelvedata.com/time_series";

export async function fetchCandlesTD({
  apiKey,
  symbol,
  interval = "1day",
  outputsize = 500,
}) {
  // límites TwelveData: outputsize 1..5000
  const size = Math.max(1, Math.min(5000, Number(outputsize) || 500));
  const url = new URL(TD_BASE);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", interval);
  url.searchParams.set("outputsize", String(size));
  url.searchParams.set("apikey", apiKey);

  const r = await fetch(url.toString());
  const j = await r.json();

  if (!r.ok || j.status === "error" || !j.values) {
    const msg = j?.message || "TwelveData error";
    throw new Error(`TwelveData: ${msg}`);
  }

  // TD entrega reverse-chronological
  const rows = (j.values || [])
    .map((v) => ({
      time: Date.parse(v.datetime),
      open: Number(v.open),
      high: Number(v.high),
      low: Number(v.low),
      close: Number(v.close),
    }))
    .filter(
      (x) =>
        Number.isFinite(x.time) &&
        Number.isFinite(x.open) &&
        Number.isFinite(x.high) &&
        Number.isFinite(x.low) &&
        Number.isFinite(x.close)
    );

  rows.sort((a, b) => a.time - b.time);
  return rows;
}
