import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { runBacktestSingleTF } from "./strategy/singleTF.js";
import { fetchCandlesTD } from "./services/twelvedata.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.get("/", (_, res) => res.send("OK"));

/** endpoint helper para previsualizar velas de TwelveData */
app.post("/td/candles", async (req, res) => {
  try {
    const { symbol, interval = "1day", outputsize = 500 } = req.body || {};
    const candles = await fetchCandlesTD({
      apiKey: process.env.TWELVEDATA_API_KEY,
      symbol,
      interval,
      outputsize,
    });
    res.json(candles);
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.post("/backtest/stream", async (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const send = (type, payload) =>
    res.write(`data: ${JSON.stringify({ type, payload })}\n\n`);

  try {
    const body = req.body || {};
    let candles = body.candles;

    // si no pasan candles, usamos TwelveData (API tab)
    if (!Array.isArray(candles) || candles.length === 0) {
      const td = body.fetchFromTD || {};
      if (!td.interval) throw new Error("faltan candles o fetchFromTD");
      candles = await fetchCandlesTD({
        apiKey: process.env.TWELVEDATA_API_KEY,
        symbol: body.symbol,
        interval: td.interval,
        outputsize: td.outputsize ?? 1000,
      });
    }

    send(
      "log",
      `1TF ${body.timeframe || "D1"} | velas: ${candles.length} | RR=${
        body.RR
      } | risk=${body.riskPercent}% | max/day=${body.maxTradesPerDay}`
    );

    await runBacktestSingleTF(
      { ...body, candles },
      {
        onStage: (m) => send("log", m),
        onProgress: (p) => send("progress", p),
        onEquity: (e) => send("equity", e),
        onTrade: (t) => send("trade", t),
        onStats: (s) => send("stats", s),
        onFVG: (z) => send("fvg", z),
      }
    );

    res.write("event: end\n");
    res.write("data: {}\n\n");
    res.end();
  } catch (e) {
    send("log", `Error: ${String(e.message || e)}`);
    res.end();
  }
});

const PORT = process.env.PORT || 5501;
app.listen(PORT, () =>
  console.log(`[backend] listening on http://localhost:${PORT}`)
);
