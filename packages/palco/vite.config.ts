import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Vitest re-exports Vite's defineConfig with an added `test` field, so this
// single file covers both the dev/build config (incl. the /api + /events
// proxy to the Motor's SSE server) and the vitest config — no separate
// vitest.config.ts needed.
//
// Tailwind v4, CSS-first: @tailwindcss/vite reads src/tw.css's `@import
// "tailwindcss"` + `@theme` block directly, no tailwind.config.js/postcss
// needed (v3-style config file). Tailwind utility classes are for the NEW
// Magic-UI-style components only (v3.2 plan) — theme.css's hand-authored
// pxpush identity rules are untouched.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": "http://localhost:4242",
      "/events": "http://localhost:4242",
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/setupTests.ts"],
    // v3.2 plan added muralVoice.ts's pure-logic test file with no JSX
    // (.test.ts, not .test.tsx) — widen the glob so it (and any future
    // non-component test file) actually gets picked up instead of
    // silently skipped.
    include: ["src/__tests__/**/*.test.{ts,tsx}"],
  },
});
