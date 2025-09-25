
import express from "express";
import cors from "cors";
import { runBacktestSingleTF } from "./strategy/runBacktestSingleTF.js";

const app = express();
const PORT = process.env.PORT || 5501;

app.use(cors());
app.use(express.json({ limit: "10mb" }));

function sseHeaders(res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
}

app.get("/", (req,res)=>{
  res.json({ ok:true, service:"forex-backtester backend", endpoints:["POST /backtest/stream"] });
});

app.post("/backtest/stream", async (req, res) => {
  try {
    const payload = req.body || {};
    if (!payload?.candles || !Array.isArray(payload.candles)) {
      return res.status(400).json({ error: "candles array required" });
    }
    sseHeaders(res);
    const write = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

    console.log("PRE", JSON.stringify({
      symbol: payload.symbol,
      riskPercent: payload.riskPercent,
      RR: payload.RR,
      maxTradesPerDay: payload.maxTradesPerDay,
      fractalLeftRight: payload.fractalLeftRight,
      fvgScanBars: payload.fvgScanBars,
      point: payload.point,
      valuePerPointPerLot: payload.valuePerPointPerLot,
      startingEquity: payload.startingEquity,
      spreadPoints: payload.spreadPoints,
      data: "csv",
    }, null, 2));

    await runBacktestSingleTF(payload, {
      onStage: (msg) => write({ type: "log", payload: msg }),
      onEquity: (e) => write({ type: "equity", payload: e }),
      onProgress: (p) => write({ type: "progress", payload: p }),
      onTrade: (t) => write({ type: "trade", payload: t }),
      onStats: (s) => write({ type: "stats", payload: s }),
      onFVG: (z) => write({ type: "fvg", payload: z }),
    });

    res.write("event: end\ndata: {}\n\n");
    res.end();
  } catch (err) {
    console.error(err);
    try {
      res.write(`data: ${JSON.stringify({ type: "error", payload: String(err?.message || err) })}\n\n`);
      res.end();
    } catch {}
  }
});

app.listen(PORT, () => {
  console.log(`[backend] listening on http://localhost:${PORT}`);
});
