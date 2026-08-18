import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LeaderboardTab } from "../tabs/LeaderboardTab";
import { fixtureSnapshot } from "./fixtures";

describe("LeaderboardTab", () => {
  it("renders trader names and achievement badges from the snapshot", () => {
    render(<LeaderboardTab snapshot={fixtureSnapshot} />);

    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("Rand-7")).toBeInTheDocument();

    const badges = screen.getAllByText("✨");
    expect(badges).toHaveLength(2); // Ada has 2 achievements in the fixture; Rand-7 has 0

    expect(badges[0]).toHaveAttribute("title", "Primeira semana viva");
    expect(badges[1]).toHaveAttribute("title", "Dobrou o book");
  });

  it("renders an empty table without crashing when there is no snapshot yet", () => {
    render(<LeaderboardTab snapshot={null} />);

    expect(screen.queryByText("Ada")).not.toBeInTheDocument();
  });
});
