import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MuralTab } from "../tabs/MuralTab";
import { fixtureSnapshot } from "./fixtures";

describe("MuralTab", () => {
  it("renders feed items using the pre-formatted, pre-escaped html from the snapshot", () => {
    render(<MuralTab snapshot={fixtureSnapshot} />);

    expect(screen.getByText(/fechou BTCUSDT/)).toBeInTheDocument();
    // "Ada" comes from the <strong> inside the trader_hired item's html.
    expect(screen.getByText("Ada")).toBeInTheDocument();
  });

  it("shows a placeholder when there is no snapshot yet", () => {
    render(<MuralTab snapshot={null} />);

    expect(screen.getByText("Sem eventos ainda.")).toBeInTheDocument();
  });
});
