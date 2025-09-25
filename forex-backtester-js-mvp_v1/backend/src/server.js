import express from "express";
import cors from "cors";
import morgan from "morgan";
import { runBacktest } from "./strategy/emaFvgChoch.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "25mb" }));
app.use(morgan("dev"));

// Health
app.get("/health", (_, res) => res.json({ ok: true }));

// Backtest endpoint
app.post("/backtest", async (req, res) => {
  try {
    const params = req.body || {};
    const result = await runBacktest(params);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: String(err?.message || err) });
  }
});

const PORT = process.env.PORT || 5501;
app.listen(PORT, () => console.log(`[backend] listening on http://localhost:${PORT}`));