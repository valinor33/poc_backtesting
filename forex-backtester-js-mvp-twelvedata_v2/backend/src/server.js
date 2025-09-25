import express from "express";
import cors from "cors";
import morgan from "morgan";
import { parseCandleCSV } from "./services/csv_import.js";
import { runSingleTF } from "./strategy/emaFvgChoch_singleTF.js";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "25mb" }));
app.use(morgan("dev"));

const PORT = process.env.PORT || 5501;

app.get("/health", (_, res) => res.json({ ok: true }));

app.post("/import/csv", async (req, res) => {
  try {
    const { csv, options } = req.body || {};
    if (!csv || typeof csv !== "string")
      throw new Error("Body inválido: { csv }");
    const parsed = parseCandleCSV(csv, options || {});
    res.json(parsed);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: String(err?.message || err) });
  }
});

app.post("/backtest/stream", async (req, res) => {
  try {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const send = (type, payload) =>
      res.write(`data: ${JSON.stringify({ type, payload })}\n\n`);
    const close = () => {
      res.write("event: end\ndata: {}\n\n");
      res.end();
    };

    const params = req.body || {};
    if (!Array.isArray(params.candles) || !params.candles.length) {
      send("error", "Faltan candles (array) para modo singleTF");
      return close();
    }

    await runSingleTF(
      {
        symbol: params.symbol,
        timeframe: params.timeframe,
        riskPercent: params.riskPercent, // << sólo 3 inputs clave
        RR: params.RR,
        maxTradesPerDay: params.maxTradesPerDay ?? 3,
        // opcionales (se auto-calibran si no están)
        point: params.point,
        valuePerPointPerLot: params.valuePerPointPerLot,
        startingEquity: params.startingEquity ?? 10000,
        fractalLeftRight: params.fractalLeftRight ?? 2,
        fvgScanBars: params.fvgScanBars ?? 200,
        candles: params.candles,
      },
      {
        onStage: (msg) => send("log", msg),
        onProgress: (pr) => send("progress", pr),
        onEquity: (pt) => send("equity", pt),
        onTrade: (tr) => send("trade", tr),
        onStats: (st) => send("stats", st),
      }
    );

    close();
  } catch (err) {
    console.error(err);
    try {
      res.write(
        `data: ${JSON.stringify({
          type: "error",
          payload: String(err?.message || err),
        })}\n\n`
      );
      res.end();
    } catch {}
  }
});

app.listen(PORT, () =>
  console.log(`[backend] listening on http://localhost:${PORT}`)
);
