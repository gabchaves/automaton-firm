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

// @xyflow/react (Empresa's org graph, v3 plan Task 3) reads the viewport's
// CSS transform through `DOMMatrixReadOnly` when it recomputes node
// internals — jsdom doesn't implement it. Stub just the one field (`m22`,
// the matrix's vertical-scale component, which is how it reads the current
// zoom level) the library actually touches; every EmpresaTab test renders
// nodes with an explicit `measured` size (see OrgGraph.tsx) so real
// measurement/zoom math never needs to run, but the constructor must still
// exist or the import-time reference throws.
if (typeof window !== "undefined" && typeof (window as unknown as { DOMMatrixReadOnly?: unknown }).DOMMatrixReadOnly === "undefined") {
  class DOMMatrixReadOnlyStub {
    m22 = 1;
    constructor(_transform?: string) {}
  }
  (window as unknown as { DOMMatrixReadOnly: unknown }).DOMMatrixReadOnly = DOMMatrixReadOnlyStub;
}

// jsdom doesn't implement SVG layout, so `getBBox` is missing entirely on
// its SVG element instances — @xyflow/react's edge label (`EdgeText`)
// calls it to size the label's background rect. A fixed zero rect is
// fine: the v3 plan only needs the "mutação" label's text content to be
// queryable, not a real, non-zero-sized bounding box. jsdom's actual SVG
// elements resolve `getBBox` through `SVGElement.prototype` at runtime
// even though TS's lib.dom.d.ts only declares it on `SVGGraphicsElement`
// — the cast below targets the prototype jsdom instances really use.
type SVGElementWithBBox = { getBBox?: () => DOMRect };
const svgElementProto = SVGElement.prototype as unknown as SVGElementWithBBox;
if (typeof svgElementProto.getBBox !== "function") {
  svgElementProto.getBBox = () => ({ x: 0, y: 0, width: 0, height: 0 }) as DOMRect;
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
