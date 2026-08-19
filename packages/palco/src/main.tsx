import React from "react";
import ReactDOM from "react-dom/client";
import "primereact/resources/themes/lara-dark-green/theme.css";
import "primereact/resources/primereact.min.css";
import "primeicons/primeicons.css";
// @xyflow/react's default theme (Empresa's org graph, v3 plan Task 3) —
// loaded here, before theme.css, same rule as PrimeReact above: theme.css
// overrides it via the --xy-* custom properties, never the reverse.
import "@xyflow/react/dist/style.css";
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
// Tailwind v4 utilities LAST — scoped to the new Magic-UI-style components
// only (v3.2 plan); theme.css's hand-authored pxpush rules above still win
// for everything else since Tailwind's utilities are opt-in per class.
import "./tw.css";
import App from "./App";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("root element not found");

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
