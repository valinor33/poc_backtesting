import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./styles.css"; // ⬅️ importa aquí los estilos

ReactDOM.createRoot(document.getElementById("root")).render(
  <div className="app-wrap">
    <App />
  </div>
);
