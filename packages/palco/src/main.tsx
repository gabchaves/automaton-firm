import React from "react";
import ReactDOM from "react-dom/client";
import "primereact/resources/themes/lara-dark-green/theme.css";
import "primereact/resources/primereact.min.css";
import "primeicons/primeicons.css";
// v1.1 dark-site overrides LAST — must load after the PrimeReact theme/base
// CSS so the token overrides win.
import "./theme.css";
import App from "./App";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("root element not found");

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
