# Forex Backtester JS (Twelve Data + SSE)

Este MVP extendido integra **Twelve Data** para descargar velas (H1/M15/M1) y corre el backtest con **SSE** mostrando progreso en tiempo real, equity curve y trades.

## Estructura
- **/backend**: Express + SSE + Twelve Data
- **/frontend**: React + Vite + Recharts (equity y UI de progreso)

## Pasos

### 1) Backend
```bash
cd backend
cp .env.example .env   # poné tu TWELVEDATA_API_KEY
npm i
npm run dev
```
- `POST /fetch` → descarga velas (si querés probar por separado).
- `POST /backtest/stream` → stream de backtest.

### 2) Frontend
```bash
cd ../frontend
npm i
npm run dev
```
- Abrí `http://localhost:5173`
- Poné tu **API key** en el primer panel (opcional para el back, pero el back usa `.env`)

## Notas
- Node 18+ (usa `fetch` nativo).
- El flujo del frontend dispara `/api/backtest/stream`, que:
  1) descarga velas H1/M15/M1 desde Twelve Data (según `outputsize`),
  2) corre el backtest y emite eventos: `log`, `progress`, `equity`, `trade`, `stats`.
- Estrategia: EMA21(H1) + FVG(M15) + CHOCH(M1) con RR 1:2.5, SL por swings/FVG, lot por % riesgo.