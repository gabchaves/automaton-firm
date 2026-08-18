import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { GenomeChips } from "../GenomeChips";
import type { PalcoGenome } from "../types";

function genome(overrides: Partial<PalcoGenome>): PalcoGenome {
  return {
    symbol: "BTCUSDT",
    leverage: 2,
    riskFraction: 0.75,
    combinator: "all",
    genes: [],
    ...overrides,
  };
}

describe("GenomeChips", () => {
  it("formats a momentum gene", () => {
    render(<GenomeChips genome={genome({ genes: [{ family: "momentum", params: { fastBars: 8, slowBars: 34 } }] })} />);
    expect(screen.getByText("⚡ Momentum 8/34b")).toBeInTheDocument();
  });

  it("formats a meanReversion gene", () => {
    render(
      <GenomeChips
        genome={genome({ genes: [{ family: "meanReversion", params: { lookbackBars: 40, entryZ: 1.5 } }] })}
      />,
    );
    expect(screen.getByText("🎯 Reversão z>1.5 (40b)")).toBeInTheDocument();
  });

  it("formats a breakout gene", () => {
    render(<GenomeChips genome={genome({ genes: [{ family: "breakout", params: { channelBars: 20 } }] })} />);
    expect(screen.getByText("🚪 Breakout 20b")).toBeInTheDocument();
  });

  it("formats a regimeFilter gene", () => {
    render(<GenomeChips genome={genome({ genes: [{ family: "regimeFilter", params: { smaBars: 96 } }] })} />);
    expect(screen.getByText("🛡️ Regime SMA96")).toBeInTheDocument();
  });

  it("formats the combinator sentence for all/majority/any", () => {
    const { rerender } = render(<GenomeChips genome={genome({ combinator: "all" })} />);
    expect(screen.getByText("entra quando todos concordam")).toBeInTheDocument();

    rerender(<GenomeChips genome={genome({ combinator: "majority" })} />);
    expect(screen.getByText("entra pela maioria")).toBeInTheDocument();

    rerender(<GenomeChips genome={genome({ combinator: "any" })} />);
    expect(screen.getByText("entra se qualquer um sinalizar")).toBeInTheDocument();
  });

  it("formats the symbol/leverage desk chip", () => {
    render(<GenomeChips genome={genome({ symbol: "ETHUSDT", leverage: 3 })} />);
    expect(screen.getByText("ETHUSDT · 3x")).toBeInTheDocument();
  });

  it("applies the compact modifier class when requested", () => {
    const { container } = render(<GenomeChips genome={genome({})} compact />);
    expect(container.querySelector(".genome-chips--compact")).toBeInTheDocument();
  });
});
