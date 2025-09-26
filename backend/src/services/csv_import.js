// CSV -> candles {time, open, high, low, close}
import { parse } from "csv-parse/sync";

/**
 * options = {
 *   timeframe: "M1"|"M15"|"H1"|"D1", // solo informativo (lo devuelve en meta)
 *   delimiter?: "," | ";" | "\t" | "|",
 *   dateFormat?: "auto" | "mdy" | "dmy" | "iso"
 *   mapping?: { time?: string, open?: string, high?: string, low?: string, close?: string }
 * }
 */
export function parseCandleCSV(csvText, options = {}) {
  const delimiter = options.delimiter || detectDelimiter(csvText);
  const records = parse(csvText, {
    delimiter,
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  if (!records.length) throw new Error("CSV vacío o sin filas");

  // columnas conocidas
  const cols = Object.keys(records[0]).map((c) => c.trim());
  const guess = guessMapping(cols);
  const map = { ...guess, ...(options.mapping || {}) };

  const out = [];
  for (const row of records) {
    const tRaw = row[map.time];
    const oRaw = row[map.open];
    const hRaw = row[map.high];
    const lRaw = row[map.low];
    const cRaw = row[map.close];

    const t = parseDateMs(String(tRaw), options.dateFormat || "auto");
    const toNum = (v) =>
      parseFloat(String(v).replace(/,/g, "").replace(/\s+/g, ""));
    const o = toNum(oRaw),
      h = toNum(hRaw),
      l = toNum(lRaw),
      c = toNum(cRaw);

    if ([t, o, h, l, c].some((x) => !isFinite(x))) continue;
    out.push({ time: t, open: o, high: h, low: l, close: c });
  }

  // orden ascendente
  out.sort((a, b) => a.time - b.time);
  return {
    timeframe: options.timeframe || "UNKNOWN",
    candles: out,
    columns: cols,
    mapping: map,
  };
}

function detectDelimiter(sample) {
  const candidates = [",", ";", "\t", "|"];
  let best = ",",
    bestCount = -1;
  const first = sample.split(/\r?\n/).slice(0, 5);
  for (const d of candidates) {
    const counts = first
      .map((line) => line.split(d).length - 1)
      .reduce((a, b) => a + b, 0);
    if (counts > bestCount) {
      bestCount = counts;
      best = d;
    }
  }
  return best;
}

function guessMapping(cols) {
  const lc = cols.reduce((acc, c) => ((acc[c.toLowerCase()] = c), acc), {});
  const pick = (...names) => {
    for (const n of names) {
      const k = n.toLowerCase();
      if (lc[k]) return lc[k];
    }
    return null;
  };
  return {
    time: pick("datetime", "date", "time", "timestamp"),
    open: pick("open", "o"),
    high: pick("high", "h"),
    low: pick("low", "l"),
    close: pick("close", "c", "price", "adj close"),
  };
}

function parseDateMs(s, mode) {
  s = s.trim();
  if (mode === "iso" || /\d{4}-\d{2}-\d{2}/.test(s)) {
    return new Date(s).getTime();
  }
  // dd/mm/yyyy o mm/dd/yyyy
  if (/^\d{1,2}\/\d{1,2}\/\d{4}( \d{2}:\d{2}(:\d{2})?)?$/.test(s)) {
    const [datePart, timePart] = s.split(" ");
    const [a, b, y] = datePart.split("/").map((n) => parseInt(n, 10));
    let m, d;
    if (mode === "dmy" || (mode === "auto" && a > 12)) {
      d = a;
      m = b;
    } else {
      m = a;
      d = b;
    }
    const hhmmss = (timePart || "00:00:00")
      .split(":")
      .map((n) => parseInt(n, 10));
    const [H = 0, M = 0, S = 0] = hhmmss;
    return Date.UTC(y, m - 1, d, H, M, S);
  }
  // fallback general
  const t = Date.parse(s);
  if (isNaN(t)) throw new Error("Formato de fecha no reconocido: " + s);
  return t;
}
