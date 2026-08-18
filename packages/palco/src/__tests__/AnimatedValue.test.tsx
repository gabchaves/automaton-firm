import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AnimatedValue } from "../AnimatedValue";

describe("AnimatedValue", () => {
  it("renders the formatted value immediately on mount, with no animation needed", () => {
    render(<AnimatedValue value={1234} format={(n) => `$${n.toFixed(2)}`} />);
    expect(screen.getByText("$1234.00")).toBeInTheDocument();
  });

  it("settles on the new formatted value once the prop changes", async () => {
    const { rerender } = render(<AnimatedValue value={0} format={(n) => n.toFixed(0)} durationMs={20} />);
    expect(screen.getByText("0")).toBeInTheDocument();

    rerender(<AnimatedValue value={100} format={(n) => n.toFixed(0)} durationMs={20} />);

    await waitFor(() => expect(screen.getByText("100")).toBeInTheDocument());
  });
});
