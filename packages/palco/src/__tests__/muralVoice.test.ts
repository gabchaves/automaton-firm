import { describe, expect, it } from "vitest";
import { mulberry32 } from "../rng";
import { pickBody, signedUsd, poolSizeFor } from "../muralVoice";

// v4 plan Task B2: every pool must carry >= 4 variants so a run of posts
// doesn't repeat within a week; v4.6 raised the floor to >= 6 after user
// feedback that posts were repeating too visibly. `poolSizeFor`
// (muralVoice.ts) samples every pick index directly instead of this file
// hardcoding each pool's literal line count, which would drift the moment a
// line's wording changes.
const MODELED_TYPES = [
  "trade_closed",
  "trader_died",
  "trader_fired",
  "trader_rotated",
  "trader_hired",
  "trader_promoted",
  "achievement",
  "record_broken",
  "gen_started",
  "gen_ended",
  "hr_review",
];

/** `poolSizeFor`'s representative payload for "trade_closed" only exercises
 * its win branch (positive realizedPnlMc, not liquidated) — trade_closed
 * actually has THREE independent pools (liquidated / win / loss) behind one
 * builder, so the liquidated and loss branches get their own direct checks
 * here using the same 12-probe sampling technique (12 probes gives full
 * coverage up to a 10-item pool — the largest pool as of v4.6 — whereas 8
 * would undercount it). */
function samplePoolSize(type: string, payload: Record<string, unknown>, probes = 12): number {
  const seen = new Set<string>();
  for (let i = 0; i < probes; i++) {
    const fraction = (i + 0.5) / probes;
    seen.add(pickBody(type, payload, () => fraction));
  }
  return seen.size;
}

describe("pool sizes (v4 Task B2, floor raised in v4.6)", () => {
  it.each(MODELED_TYPES)("has at least 6 variants for %s", (type) => {
    expect(poolSizeFor(type)).toBeGreaterThanOrEqual(6);
  });

  it("has at least 6 variants for trade_closed's liquidated branch", () => {
    const size = samplePoolSize("trade_closed", { symbol: "BTCUSDT", realizedPnlMc: -50_000, liquidated: true });
    expect(size).toBeGreaterThanOrEqual(6);
  });

  it("has at least 6 variants for trade_closed's loss branch", () => {
    const size = samplePoolSize("trade_closed", { symbol: "BTCUSDT", realizedPnlMc: -50_000 });
    expect(size).toBeGreaterThanOrEqual(6);
  });
});

describe("signedUsd", () => {
  it("keeps the $ before a positive amount", () => {
    expect(signedUsd(150_000)).toBe("$1.50");
  });

  it("puts the minus sign before the $ for a negative amount", () => {
    expect(signedUsd(-120_000)).toBe("-$1.20");
  });
});

describe("pickBody", () => {
  it("is deterministic: the same seed always picks the same line, forever", () => {
    const payload = { symbol: "BTCUSDT", realizedPnlMc: 150_000 };
    const first = pickBody("trade_closed", payload, mulberry32(999));
    const second = pickBody("trade_closed", payload, mulberry32(999));
    expect(first).toBe(second);
    // v4.6 pool expansion (10 win variants): mulberry32(999)'s first draw
    // shifts index again — same seed, same eternal joke, just a different
    // index now that the pool is bigger.
    expect(first).toBe("Saiu com $1.50 de BTCUSDT. A planilha do RH vai adorar essa linha.");
  });

  it("picks the liquidated pool over the loss pool when payload.liquidated is true", () => {
    const body = pickBody(
      "trade_closed",
      { symbol: "SOLUSDT", realizedPnlMc: -300_000, liquidated: true },
      mulberry32(1),
    );
    expect(body).toBe("Rekt em SOLUSDT. O mercado não lê currículo genético.");
  });

  it("uses a signed dollar amount for a loss", () => {
    const body = pickBody("trade_closed", { symbol: "ADAUSDT", realizedPnlMc: -120_000 }, mulberry32(1));
    // v4.6 pool expansion (10 loss variants) shifts mulberry32(1)'s draw to
    // a different index than before the round — same determinism
    // guarantee, new pool size.
    expect(body).toBe("Perda de -$1.20 em ADAUSDT. O genoma anota e segue — evidência é evidência.");
  });

  it("uses a plain (unsigned) dollar amount for a win", () => {
    const body = pickBody("trade_closed", { symbol: "ETHUSDT", realizedPnlMc: 100_000 }, mulberry32(7));
    expect(body).toBe("Fechei ETHUSDT no verde: $1.00. Hoje o mercado foi gentil comigo.");
  });

  it("fills name + formatted age for trader_died", () => {
    const body = pickBody("trader_died", { name: "Zeca Prado", ageMs: 7_200_000 }, mulberry32(1));
    expect(body).toBe("Zeca Prado não resistiu a 2.0h de volatilidade. Os pêsames já saem em nome da seleção natural.");
  });

  it("fills name + returned for trader_fired", () => {
    const body = pickBody("trader_fired", { name: "Caue Reis", returnedMc: 80_000 }, mulberry32(7));
    expect(body).toBe(
      "Comunicado do RH: encerramos o ciclo de Caue Reis. Devolveu $0.80 ao caixa. A decisão foi baseada em evidência — como sempre.",
    );
  });

  it("fills name for trader_hired", () => {
    const body = pickBody("trader_hired", { name: "Beto Nunes" }, mulberry32(4));
    expect(body).toBe("Chegou Beto Nunes: mesa nova, planilha de avaliação já de olho.");
  });

  it("fills name for trader_promoted", () => {
    const body = pickBody("trader_promoted", { name: "Ada Faria" }, mulberry32(3));
    expect(body).toBe("Ada Faria vira case de sucesso do ciclo. Sem festa, só resultado.");
  });

  it("fills name + label for achievement", () => {
    const body = pickBody("achievement", { name: "Ada Faria", label: "Primeiro trade" }, mulberry32(47));
    expect(body).toBe("Placar atualizado: Ada Faria garantiu 'Primeiro trade'.");
  });

  it("fills the formatted peak for record_broken", () => {
    const body = pickBody("record_broken", { peakEquityMc: 1_480_000 }, mulberry32(45));
    expect(body).toBe("🔔 HISTÓRICO: a firma cravou $14.80, novo recorde. Emoldurem este scrap.");
  });

  it("fills genNumber for gen_started", () => {
    const body = pickBody("gen_started", { genNumber: 3 }, mulberry32(44));
    expect(body).toBe("Abertura da Geração 3: livro contábil zerado, esperança no talo.");
  });

  it("fills genNumber/peak for gen_ended", () => {
    const body = pickBody("gen_ended", { genNumber: 2, peakEquityMc: 1_480_000, daysLived: 3 }, mulberry32(5));
    expect(body).toBe("Encerrada a Geração 2, pico $14.80. A próxima já herdou o que deu certo.");
  });

  it("fills fired/promoted counts for hr_review, deterministically for a given seed", () => {
    const payload = { fired: 1, promoted: 2 };
    const first = pickBody("hr_review", payload, mulberry32(7));
    const second = pickBody("hr_review", payload, mulberry32(7));
    expect(first).toBe(second);
    expect(first).toBe(
      "Ciclo de avaliação: 1 desligamento(s), 2 promoção(ões). O RH dormirá tranquilo — decidiu com dados.",
    );
  });

  it("returns an empty string for an unmodeled event type", () => {
    expect(pickBody("catch_up", { bars: 12 }, mulberry32(1))).toBe("");
  });
});
