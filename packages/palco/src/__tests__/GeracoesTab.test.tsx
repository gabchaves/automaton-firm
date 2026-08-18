import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { GeracoesTab } from "../tabs/GeracoesTab";
import { fixtureSnapshot } from "./fixtures";

describe("GeracoesTab", () => {
  it("renders the current-generation summary panel with real numbers from the live evolved generation", () => {
    render(<GeracoesTab snapshot={fixtureSnapshot} />);

    expect(screen.getByText("Geração atual")).toBeInTheDocument();
    expect(screen.getByText("dias vivos")).toBeInTheDocument();
    expect(screen.getByText("pico")).toBeInTheDocument();
    expect(screen.getByText("equity agora")).toBeInTheDocument();

    // The fixture's live (ended: false) evolved generation is gen 3,
    // barsLived: 400 -> 400 * 300_000ms / 86_400_000ms = 1.4 days.
    expect(screen.getByText("1.4")).toBeInTheDocument();
  });

  it("renders one life bar per generation with the pico/dias label", () => {
    render(<GeracoesTab snapshot={fixtureSnapshot} />);

    // Gen 2 evolved: peakEquityMc 1_480_000 -> $14.80, barsLived 900 -> 3.1 dias.
    expect(screen.getByText("Geração 2 — pico $14.80 — 3.1 dias")).toBeInTheDocument();
  });

  it("marks the record-holding generation with the bell badge", () => {
    render(<GeracoesTab snapshot={fixtureSnapshot} />);

    // Gen 2 evolved's peak (1_480_000) equals cards.recordEvolvedMc in the fixture.
    const label = screen.getByText("Geração 2 — pico $14.80 — 3.1 dias");
    expect(label.closest(".life-bar-label")?.textContent).toContain("🔔");
  });

  it("marks live (unended) generations with an 'em curso' chip", () => {
    render(<GeracoesTab snapshot={fixtureSnapshot} />);

    // Gen 3 (both cohorts) is ended: false in the fixture.
    const label = screen.getByText(/Geração 3 — pico \$13\.00 — 1\.4 dias/);
    expect(label.closest(".life-bar-label")?.textContent).toContain("em curso");
  });

  it("shows the shortened v3 explainer copy", () => {
    render(<GeracoesTab snapshot={fixtureSnapshot} />);

    expect(
      screen.getByText(
        "Cada geração começa com $100. A barra mostra quanto tempo viveu; o número, o pico que alcançou. Se a seleção funciona, os picos verdes sobem.",
      ),
    ).toBeInTheDocument();
  });

  it("renders empty-state copy when there is no snapshot yet", () => {
    render(<GeracoesTab snapshot={null} />);

    expect(screen.getByText("Sem gerações ainda.")).toBeInTheDocument();
    expect(screen.getByText("nenhuma geração da firma em curso agora.")).toBeInTheDocument();
  });
});
