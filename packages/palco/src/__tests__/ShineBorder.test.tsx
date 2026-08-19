import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ShineBorder } from "../components/ShineBorder";

describe("ShineBorder", () => {
  it("renders the shine overlay plus its children when active", () => {
    render(
      <ShineBorder active>
        <div>Recorde (pico)</div>
      </ShineBorder>,
    );
    expect(screen.getByTestId("shine-border-overlay")).toBeInTheDocument();
    expect(screen.getByText("Recorde (pico)")).toBeInTheDocument();
  });

  it("renders no overlay when inactive, but still renders children", () => {
    render(
      <ShineBorder active={false}>
        <div>Recorde (pico)</div>
      </ShineBorder>,
    );
    expect(screen.queryByTestId("shine-border-overlay")).not.toBeInTheDocument();
    expect(screen.getByText("Recorde (pico)")).toBeInTheDocument();
  });
});
