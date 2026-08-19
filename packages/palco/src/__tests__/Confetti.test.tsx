import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Confetti } from "../components/Confetti";
import { fixtureSnapshot } from "./fixtures";

describe("Confetti", () => {
  it("renders a full-viewport canvas and never bursts on the initial feed population", () => {
    const { container } = render(<Confetti feed={fixtureSnapshot.feed} />);
    expect(container.querySelector("canvas")).toBeInTheDocument();
  });

  it("does not throw when a genuinely new record_broken id appears on a later render", () => {
    const { rerender } = render(<Confetti feed={fixtureSnapshot.feed} />);
    const withNewRecord = [
      { id: 999, ts: 1, type: "record_broken", html: "", payload: { peakEquityMc: 2_000_000 } },
      ...fixtureSnapshot.feed,
    ];
    expect(() => rerender(<Confetti feed={withNewRecord} />)).not.toThrow();
  });

  it("does not throw when the feed is empty", () => {
    expect(() => render(<Confetti feed={[]} />)).not.toThrow();
  });
});
