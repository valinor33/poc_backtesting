# Forex Backtester JS MVP

Stack:
- **Backend:** Node.js + Express (`/backend`)
- **Frontend:** React + Vite (`/frontend`)

Implements the strategy: **EMA21(H1) + FVG(M15) + CHOCH(M1) | RR 1:2.5**

## Quick start

### 1) Backend
```bash
cd backend
npm i
npm run dev
```
Backend runs on `http://localhost:5501`

### 2) Frontend
```bash
cd ../frontend
npm i
npm run dev
```
Open `http://localhost:5173`

The frontend proxies `/api` to the backend.

## Data format

Upload three JSON files (one per timeframe: H1, M15, M1). Each must be an array of candles:
```json
[
  { "time": 1704067200000, "open":1.10000, "high":1.10100, "low":1.09900, "close":1.10050 }
]
```
- `time` is milliseconds since epoch (UTC).
- Candles should be sorted ascending by time (the app will sort if needed).

## Notes & Assumptions

- This MVP uses a simplified pip/point model with `valuePerPointPerLot=10` for convenience.
- `spreadPoints` is synthetic; adjust to your broker’s typical spread.
- CHOCH is detected when current M1 close breaks the most recent fractal swing (n=fractalLeftRight).
- FVG on M15: bullish if `Low[n] > High[n-2]`; bearish if `High[n] < Low[n-2]` (searching backward from current time).
- Entry occurs on M1 at current bid/ask within the FVG, with H1 EMA21 bias/slope aligned, plus CHOCH trigger.
- SL uses `min(lastSwingLow, fvg.low)` for longs and `max(lastSwingHigh, fvg.high)` for shorts. TP = RR × risk distance.
- Lot size = `(equity * risk%) / (SL_points * valuePerPointPerLot)` clamped to `[0.01, 100]` with step `0.01`.

You can refine execution rules, position management, commissions, and data providers later.