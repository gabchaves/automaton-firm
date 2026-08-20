import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SobreTab } from "../tabs/SobreTab";
import { fixtureSnapshot } from "./fixtures";
import type { PalcoSnapshot } from "../types";
import { usd } from "../format";

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

  it("renders real mailto/LinkedIn contact links, each opening in a new tab safely (no GitHub link — keeps the public repo's commit history from surfacing here)", () => {
    render(<SobreTab snapshot={fixtureSnapshot} />);

    const mailLink = screen.getByRole("link", { name: /gabchaves2@gmail\.com/i });
    expect(mailLink).toHaveAttribute("href", "mailto:gabchaves2@gmail.com");

    const linkedinLink = screen.getByRole("link", { name: "LinkedIn" });
    expect(linkedinLink).toHaveAttribute("href", "https://www.linkedin.com/in/gabriel-chaves2/");
    expect(linkedinLink).toHaveAttribute("target", "_blank");
    expect(linkedinLink).toHaveAttribute("rel", "noopener noreferrer");

    expect(screen.queryByRole("link", { name: "GitHub" })).not.toBeInTheDocument();
  });

  it("v4.2: does not render the fact-cards row anymore (removed — it duplicated the global hero strip)", () => {
    render(<SobreTab snapshot={fixtureSnapshot} />);

    expect(document.querySelector(".sobre-stats-strip")).toBeNull();
    expect(screen.queryByText("Dias de dados virgens")).toBeNull();
    expect(screen.queryByText("Geração no ar")).toBeNull();
  });

  it("is scale-invariant: the governance paragraph names the exact seedMc amount, not a hardcoded $100/$10", () => {
    render(<SobreTab snapshot={fixtureSnapshot} />);
    // Fixture's cards.genStartMc = 1_000_000 -> $10.00, named in the
    // "Como funciona" governance paragraph's "... novinhos" sentence.
    expect(screen.getByText(new RegExp(`nasce a próxima com ${usd(1_000_000).replace("$", "\\$")} novinhos`))).toBeInTheDocument();

    const bigBankrollSnapshot: PalcoSnapshot = {
      ...fixtureSnapshot,
      cards: { ...fixtureSnapshot.cards, genStartMc: 100_000_000 },
    };
    render(<SobreTab snapshot={bigBankrollSnapshot} />);
    expect(screen.getByText(new RegExp(`nasce a próxima com ${usd(100_000_000).replace("$", "\\$")} novinhos`))).toBeInTheDocument();
  });
});
