import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SobreTab } from "../tabs/SobreTab";
import { fixtureSnapshot } from "./fixtures";
import type { PalcoSnapshot } from "../types";

describe("SobreTab", () => {
  it("renders the builder's name and bio, with no phone number anywhere on the page", () => {
    render(<SobreTab snapshot={fixtureSnapshot} />);

    expect(screen.getByText("Gabriel Ernesto Chaves")).toBeInTheDocument();
    expect(screen.getByText(/Analista em Legal Operations na Reasset Capital/)).toBeInTheDocument();
    // Privacy ruling: no phone number is published anywhere on this page.
    expect(screen.queryByText(/98186/)).not.toBeInTheDocument();
  });

  it("carries the golden rule (moved from the global footer) and puts the project first", () => {
    render(<SobreTab snapshot={fixtureSnapshot} />);

    expect(screen.getByText(/Dinheiro real só entra em discussão/)).toBeInTheDocument();
    const titles = screen.getAllByText(/^(O projeto|Quem constrói)$/).map((el) => el.textContent);
    expect(titles).toEqual(["O projeto", "Quem constrói"]);
  });

  it("renders the mailto contact link and LinkedIn as plain text (no phone, no LinkedIn URL)", () => {
    render(<SobreTab snapshot={fixtureSnapshot} />);

    const mailLink = screen.getByRole("link", { name: /gabchaves2@gmail\.com/i });
    expect(mailLink).toHaveAttribute("href", "mailto:gabchaves2@gmail.com");
    expect(screen.getByText(/LinkedIn/)).toBeInTheDocument();
  });

  it("renders the live virgin-days and gensEvolved facts from the snapshot", () => {
    render(<SobreTab snapshot={fixtureSnapshot} />);

    // Fixture: cards.virginDays = 12.3, cards.gensEvolved = 3,
    // cards.genStartMc = 1_000_000 -> $10.00.
    expect(screen.getByText(/12\.3 dias de dados virgens/)).toBeInTheDocument();
    expect(screen.getByText(/geração 3 no ar/)).toBeInTheDocument();
    expect(screen.getByText(/\$10\.00 por geração, sempre/)).toBeInTheDocument();
  });

  it("falls back to placeholder facts when there is no snapshot yet", () => {
    render(<SobreTab snapshot={null} />);

    expect(screen.getByText(/– dias de dados virgens/)).toBeInTheDocument();
    expect(screen.getByText(/geração – no ar/)).toBeInTheDocument();
    // No snapshot -> the $100_000_000 fallback seed -> $1000.00.
    expect(screen.getByText(/\$1000\.00 por geração, sempre/)).toBeInTheDocument();
  });

  it("is scale-invariant: a fixture with a $1000.00 genStartMc renders that exact amount, not a hardcoded $100/$10", () => {
    const bigBankrollSnapshot: PalcoSnapshot = {
      ...fixtureSnapshot,
      cards: { ...fixtureSnapshot.cards, genStartMc: 100_000_000 },
    };

    render(<SobreTab snapshot={bigBankrollSnapshot} />);

    expect(screen.getByText(/\$1000\.00 por geração, sempre/)).toBeInTheDocument();
    expect(screen.queryByText(/\$10\.00 por geração, sempre/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\$100 por geração, sempre/)).not.toBeInTheDocument();
  });
});
