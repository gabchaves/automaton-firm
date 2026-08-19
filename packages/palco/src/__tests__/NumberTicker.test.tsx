import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { NumberTicker } from "../components/NumberTicker";

describe("NumberTicker", () => {
  it("renders the formatted value immediately on mount, with no animation needed", () => {
    render(<NumberTicker value={1234} format={(n) => `$${n.toFixed(2)}`} />);
    expect(screen.getByText("$1234.00")).toBeInTheDocument();
  });

  it("handles $-style money formatting, animating only the numeric part", () => {
    render(<NumberTicker value={9636} format={(n) => `$${(n / 100).toFixed(2)}`} />);
    expect(screen.getByText("$96.36")).toBeInTheDocument();
  });

  it("defaults to reduced motion in the test environment: a value change snaps immediately, no waitFor needed", () => {
    const { rerender } = render(<NumberTicker value={0} format={(n) => n.toFixed(0)} />);
    expect(screen.getByText("0")).toBeInTheDocument();

    rerender(<NumberTicker value={100} format={(n) => n.toFixed(0)} />);

    // Synchronous assertion (no `await waitFor`) — proves the reduced-motion
    // fallback engaged and skipped the spring entirely.
    expect(screen.getByText("100")).toBeInTheDocument();
  });

  it("still settles on the new formatted value when reduced motion is explicitly disabled", async () => {
    const { rerender } = render(<NumberTicker value={0} format={(n) => n.toFixed(0)} reduced={false} />);
    expect(screen.getByText("0")).toBeInTheDocument();

    rerender(<NumberTicker value={100} format={(n) => n.toFixed(0)} reduced={false} />);

    await waitFor(() => expect(screen.getByText("100")).toBeInTheDocument());
  });
});
