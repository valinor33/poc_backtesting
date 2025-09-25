# Backend (Twelve Data + Streaming Backtest)

- `POST /fetch` → descarga velas desde **Twelve Data** (H1/M15/M1 según config).
- `POST /backtest/stream` → corre el backtest **streaming via SSE** (Server-Sent Events).
  - Envía eventos: `log`, `progress`, `equity`, `trade`, `stats`, y `end`.

## Configuración

1. Copiá `.env.example` a `.env` y poné tu API key:
```
TWELVEDATA_API_KEY=tu_api_key
PORT=5501
```

2. Instalar y correr:
```bash
npm i
npm run dev
```

> Node 18+ (usa `fetch` nativo).