import React from "react";
import ReactDOM from "react-dom/client";
import "primereact/resources/themes/lara-dark-green/theme.css";
import "primereact/resources/primereact.min.css";
import "primeicons/primeicons.css";
// pxpush identity fonts — bundled via @fontsource (self-hosted woff2, no
// runtime Google Fonts/CDN request). MUST load before theme.css so the
// @font-face declarations exist by the time theme.css's font-family rules
// are applied.
import "@fontsource/anton/index.css"; // display: Anton ships one weight (400)
import "@fontsource/archivo/400.css"; // body: 400/500 per the identity plan
import "@fontsource/archivo/500.css";
import "@fontsource/geist-mono/index.css"; // mono: labels, numbers, timestamps
// v2 pxpush-identity overrides LAST — must load after the PrimeReact
// theme/base CSS (and the font-face imports above) so the token overrides
// and fonts both win.
import "./theme.css";
import App from "./App";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("root element not found");

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
