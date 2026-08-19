import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LeaderboardTab } from "../tabs/LeaderboardTab";
import { fixtureSnapshot } from "./fixtures";

describe("LeaderboardTab", () => {
  it("renders trader names and a single achievements-count badge with a tooltip listing labels", () => {
    render(<LeaderboardTab snapshot={fixtureSnapshot} />);

    expect(screen.getAllByText("Ada Faria").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Rand-7").length).toBeGreaterThan(0);

    // Ada Faria has 2 achievements in the fixture -> a single "✨2" badge,
    // not one icon per achievement.
    const badge = screen.getByText("✨2");
    expect(badge).toHaveAttribute("title", "Primeira semana viva, Dobrou o book");

    // Rand-7 has zero achievements -> no badge at all.
    expect(screen.queryByText("✨0")).not.toBeInTheDocument();
  });

  it("no longer renders the genoma or conquistas columns (too abstract, per user feedback)", () => {
    render(<LeaderboardTab snapshot={fixtureSnapshot} />);

    expect(screen.queryByText("Genoma")).not.toBeInTheDocument();
    expect(screen.queryByText("Conquistas")).not.toBeInTheDocument();
    // The old genome chips rendered gene family labels like "momentum" —
    // confirm none of that leaks through anymore.
    expect(screen.queryByText(/momentum/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/⚡ Momentum/)).not.toBeInTheDocument();
  });

  it("shows a green rank chip for the top-3 rows and a P&L % column derived from realized P&L", () => {
    render(<LeaderboardTab snapshot={fixtureSnapshot} />);

    // Ada Faria is row 1 (highest book) -> rank chip "1".
    const rankChips = document.querySelectorAll(".rank-chip");
    expect(Array.from(rankChips).map((el) => el.textContent)).toContain("1");

    // Ada Faria: realizedPnlMc 120_000 / cards.traderStartMc 200_000 * 100 = 60.0%.
    expect(screen.getByText("60.0%")).toBeInTheDocument();
    // Rand-7: -20_000 / 200_000 * 100 = -10.0%.
    expect(screen.getByText("-10.0%")).toBeInTheDocument();
  });

  it("shows a mood emoji next to each trader's name", () => {
    render(<LeaderboardTab snapshot={fixtureSnapshot} />);

    // One .mood-emoji span per fixture trader (Ada Faria, Rand-7); the
    // exact emoji per status/book ratio is covered by mood.test.tsx.
    const moodEmojis = document.querySelectorAll(".mood-emoji");
    expect(moodEmojis.length).toBe(2);
  });

  it("renders an empty table without crashing when there is no snapshot yet", () => {
    render(<LeaderboardTab snapshot={null} />);

    expect(screen.queryByText("Ada Faria")).not.toBeInTheDocument();
  });

  it("sorts a fired trader with a HIGHER book below a live trader with a lower book, with an 'encerrados' divider between them", () => {
    // The adversarial case: a naive book-desc sort would put "Rico Demitido"
    // (book 900_000) above "Pobre Vivo" (book 50_000) — this is the
    // regression the v4 plan's Task A3 explicitly calls for.
    const adversarial = {
      ...fixtureSnapshot,
      leaderboard: [
        { ...fixtureSnapshot.leaderboard[0], traderId: "t-rico", name: "Rico Demitido", cohort: "evolved", status: "fired", bookMc: 900_000 },
        { ...fixtureSnapshot.leaderboard[0], traderId: "t-pobre", name: "Pobre Vivo", cohort: "evolved", status: "live", bookMc: 50_000 },
      ],
    };

    render(<LeaderboardTab snapshot={adversarial} />);

    const names = Array.from(document.querySelectorAll(".row-name-text")).map((el) => el.textContent ?? "");
    const liveIndex = names.findIndex((t) => t.includes("Pobre Vivo"));
    const firedIndex = names.findIndex((t) => t.includes("Rico Demitido"));
    expect(liveIndex).toBeGreaterThanOrEqual(0);
    expect(firedIndex).toBeGreaterThan(liveIndex);

    expect(screen.getByText("— encerrados —")).toBeInTheDocument();
  });

  it("does not render the 'encerrados' divider when every trader in the snapshot is live", () => {
    render(<LeaderboardTab snapshot={fixtureSnapshot} />);

    // The shared fixture's leaderboard is all-live (see fixtures.ts).
    expect(screen.queryByText("— encerrados —")).not.toBeInTheDocument();
  });

  it("mutes fired/dead rows further via the leaderboard-row-muted class", () => {
    const withFired = {
      ...fixtureSnapshot,
      leaderboard: [
        { ...fixtureSnapshot.leaderboard[0], traderId: "t-live", name: "Live One", cohort: "evolved", status: "live", bookMc: 500_000 },
        { ...fixtureSnapshot.leaderboard[0], traderId: "t-fired", name: "Fired One", cohort: "evolved", status: "fired", bookMc: 100_000 },
      ],
    };

    render(<LeaderboardTab snapshot={withFired} />);

    expect(document.querySelectorAll(".leaderboard-row-muted").length).toBe(1);
  });
});
