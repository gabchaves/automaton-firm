import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SobreTab } from "../tabs/SobreTab";
import { fixtureSnapshot } from "./fixtures";
import type { PalcoSnapshot } from "../types";

/** Finds the `.hero-card .v` value for a given `.hero-card .label` text —
 * the v4 Task B3 fact-strip is now a real hero-card row (see PregaoTab's
 * `.pregao-stats-strip` for the sibling pattern), not one sentence with
 * the number baked in, so tests read label + value as a pair. */
function heroCardValue(label: string): string | null | undefined {
  const labelEl = Array.from(document.querySelectorAll(".hero-card .label")).find((el) => el.textContent === label);
  const card = labelEl?.closest(".hero-card");
  return card?.querySelector(".v")?.textContent;
}

describe("SobreTab", () => {
  it("renders the builder's name and bio, with no phone number anywhere on the page", () => {
    render(<SobreTab snapshot={fixtureSnapshot} />);

    expect(screen.getByText("Gabriel Ernesto Chaves")).toBeInTheDocument();
    expect(screen.getByText(/Analista em Legal Operations na Reasset Capital/)).toBeInTheDocument();
    // Privacy ruling: no phone number is published anywhere on this page.
    expect(screen.queryByText(/98186/)).not.toBeInTheDocument();
  });

  it("gives the author a big initials avatar (v4 Task B3), same visual language as trader avatars", () => {
    render(<SobreTab snapshot={fixtureSnapshot} />);

    const avatar = document.querySelector(".sobre-author-avatar");
    expect(avatar).toBeInTheDocument();
    // avatar.ts's initials() rule: first letter of the first two words.
    expect(avatar).toHaveTextContent("GE");
    // avatarBackground() (avatar.ts) — same name-seeded background trader
    // avatars use, not a hardcoded color (jsdom normalizes the inline
    // hsl() we set to rgb(), so this just confirms a color got applied).
    expect((avatar as HTMLElement).style.background).toMatch(/^rgb\(/);
  });

  it("carries the golden rule (moved from the global footer) and puts the project first", () => {
    render(<SobreTab snapshot={fixtureSnapshot} />);

    expect(screen.getByText(/Dinheiro real só entra em discussão/)).toBeInTheDocument();
    const titles = screen.getAllByText(/^(O projeto|Quem constrói)$/).map((el) => el.textContent);
    expect(titles).toEqual(["O projeto", "Quem constrói"]);
  });

  it("splits 'O projeto' into short, mini-titled subsections instead of a wall of paragraphs (v4 Task B3)", () => {
    render(<SobreTab snapshot={fixtureSnapshot} />);

    // Same condensed copy, now organized under explicit mini-titles.
    expect(screen.getByText("O que é")).toBeInTheDocument();
    expect(screen.getByText("Como funciona")).toBeInTheDocument();
    expect(screen.getByText("Stack")).toBeInTheDocument();
    expect(screen.getByText(/darwinismo com CNPJ imaginário/)).toBeInTheDocument();
    expect(screen.getByText(/O Motor roda 24\/7 sem tomar café/)).toBeInTheDocument();
    expect(screen.getByText(/nenhuma chamada de IA no caminho crítico/)).toBeInTheDocument();
  });

  it("renders a compact 3-step 'Motor → RH → Recorde' flow strip using the existing chip/arrow language", () => {
    render(<SobreTab snapshot={fixtureSnapshot} />);

    const strip = document.querySelector(".sobre-flow-strip");
    expect(strip).toBeInTheDocument();
    const chipTexts = Array.from(strip?.querySelectorAll(".chip") ?? []).map((el) => el.textContent);
    expect(chipTexts).toEqual(["Motor", "RH", "Recorde"]);
    // Reuses genome-chips' existing `.chip-desk` styling, not a new chip look.
    expect(strip?.querySelectorAll(".chip-desk")).toHaveLength(3);
    expect(strip?.querySelectorAll(".sobre-flow-arrow")).toHaveLength(2);
  });

  it("renders the mailto contact link and LinkedIn as plain text (no phone, no LinkedIn URL)", () => {
    render(<SobreTab snapshot={fixtureSnapshot} />);

    const mailLink = screen.getByRole("link", { name: /gabchaves2@gmail\.com/i });
    expect(mailLink).toHaveAttribute("href", "mailto:gabchaves2@gmail.com");
    expect(screen.getByText(/LinkedIn/)).toBeInTheDocument();
  });

  it("renders the live virgin-days and gensEvolved facts as hero-card stat-cards (v4 Task B3)", () => {
    render(<SobreTab snapshot={fixtureSnapshot} />);

    // Fixture: cards.virginDays = 12.3, cards.gensEvolved = 3,
    // cards.genStartMc = 1_000_000 -> $10.00.
    expect(heroCardValue("Dias de dados virgens")).toBe("12.3");
    expect(heroCardValue("Geração no ar")).toBe("3");
    expect(heroCardValue("Por geração, sempre")).toBe("$10.00");
    expect(document.querySelectorAll(".sobre-stats-strip .hero-card")).toHaveLength(3);
  });

  it("falls back to placeholder facts when there is no snapshot yet", () => {
    render(<SobreTab snapshot={null} />);

    expect(heroCardValue("Dias de dados virgens")).toBe("–");
    expect(heroCardValue("Geração no ar")).toBe("–");
    // No snapshot -> the $100_000_000 fallback seed -> $1000.00.
    expect(heroCardValue("Por geração, sempre")).toBe("$1000.00");
  });

  it("is scale-invariant: a fixture with a $1000.00 genStartMc renders that exact amount, not a hardcoded $100/$10", () => {
    const bigBankrollSnapshot: PalcoSnapshot = {
      ...fixtureSnapshot,
      cards: { ...fixtureSnapshot.cards, genStartMc: 100_000_000 },
    };

    render(<SobreTab snapshot={bigBankrollSnapshot} />);

    expect(heroCardValue("Por geração, sempre")).toBe("$1000.00");
  });
});
