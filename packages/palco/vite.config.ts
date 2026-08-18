import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Vitest re-exports Vite's defineConfig with an added `test` field, so this
// single file covers both the dev/build config (incl. the /api + /events
// proxy to the Motor's SSE server) and the vitest config — no separate
// vitest.config.ts needed.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:4242",
      "/events": "http://localhost:4242",
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/setupTests.ts"],
    include: ["src/__tests__/**/*.test.tsx"],
  },
});
