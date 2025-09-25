import React, { useState } from "react";
import CSVTester from "./components/CSVTester.jsx";
import APITester from "./components/APITester.jsx";

export default function App() {
  const [tab, setTab] = useState("csv");
  return (
    <div className="container">
      <h1>Forex Backtester (Single TF CSV)</h1>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="row" style={{ gap: 8 }}>
          <button
            className={tab === "csv" ? "btn btn-primary" : "btn"}
            onClick={() => setTab("csv")}
          >
            CSV
          </button>
          <button
            className={tab === "api" ? "btn btn-primary" : "btn"}
            onClick={() => setTab("api")}
          >
            API (TwelveData)
          </button>
        </div>
      </div>

      {tab === "csv" ? <CSVTester /> : <APITester />}
    </div>
  );
}
