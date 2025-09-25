# Forex Backtester Backend (JS)

Simple Express server exposing `/backtest` to run the EMA21(H1) + FVG(M15) + CHOCH(M1) strategy.

## Run

```bash
cd backend
npm i
npm run dev
```

## API

`POST /backtest`

Body:
```json
{
  "symbol": "EURUSD",
  "riskPercent": 1.0,
  "RR": 2.5,
  "maxSpreadPoints": 40,
  "slippagePoints": 30,
  "oneTradeAtATime": true,
  "fractalLeftRight": 2,
  "fvgScanBars": 50,
  "point": 0.0001,
  "valuePerPointPerLot": 10,
  "startingEquity": 10000,
  "spreadPoints": 20,
  "data": {
    "H1": [{"time": 1704067200000, "open":1.1,"high":1.11,"low":1.09,"close":1.105}],
    "M15": [],
    "M1": []
  }
}
```

Returns: stats, trades, equityCurve.

> **Note:** This MVP assumes a simplified pip/point value model (`valuePerPointPerLot=10`) typical for many FX pairs and uses a synthetic `spreadPoints`. Replace with your broker-specific values as needed.