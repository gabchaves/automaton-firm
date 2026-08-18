import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// This project imports test functions explicitly from "vitest" rather than
// setting `test.globals: true`, so @testing-library/react's automatic
// after-each DOM cleanup (which only self-registers when it finds a global
// `afterEach`) never kicks in on its own. Wire it up explicitly instead —
// otherwise DOM from one test leaks into assertions in the next.
afterEach(() => {
  cleanup();
});

// jsdom doesn't implement ResizeObserver / matchMedia, both of which
// PrimeReact's responsive components (TabView, DataTable) probe for. Stub
// them so component tests don't crash on things unrelated to what they
// assert.
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverStub;
}

if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}
