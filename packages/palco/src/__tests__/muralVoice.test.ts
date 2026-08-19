import { describe, expect, it } from "vitest";
import { mulberry32 } from "../rng";
import { pickBody, signedUsd } from "../muralVoice";

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
    expect(first).toBe("Realizei $1.50 em BTCUSDT. Quem não realiza, sonha.");
  });

  it("picks the liquidated pool over the loss pool when payload.liquidated is true", () => {
    const body = pickBody(
      "trade_closed",
      { symbol: "SOLUSDT", realizedPnlMc: -300_000, liquidated: true },
      mulberry32(1),
    );
    expect(body).toBe("A alavancagem dá, a alavancagem tira. SOLUSDT tirou.");
  });

  it("uses a signed dollar amount for a loss", () => {
    const body = pickBody("trade_closed", { symbol: "ADAUSDT", realizedPnlMc: -120_000 }, mulberry32(1));
    expect(body).toBe("-$1.20. Prefiro chamar de 'custo de aprendizado não supervisionado'.");
  });

  it("uses a plain (unsigned) dollar amount for a win", () => {
    const body = pickBody("trade_closed", { symbol: "ETHUSDT", realizedPnlMc: 100_000 }, mulberry32(7));
    expect(body).toBe("Fechei ETHUSDT no verde: $1.00. Hoje o mercado foi gentil comigo.");
  });

  it("fills name + formatted age for trader_died", () => {
    const body = pickBody("trader_died", { name: "Zeca Prado", ageMs: 7_200_000 }, mulberry32(1));
    expect(body).toBe("Zeca Prado lutou até o último centavo. O mercado foi mais forte. 🕯️");
  });

  it("fills name + returned for trader_fired", () => {
    const body = pickBody("trader_fired", { name: "Caue Reis", returnedMc: 80_000 }, mulberry32(7));
    expect(body).toBe(
      "Comunicado do RH: encerramos o ciclo de Caue Reis. Devolveu $0.80 ao caixa. A decisão foi baseada em evidência — como sempre.",
    );
  });

  it("fills name for trader_hired", () => {
    const body = pickBody("trader_hired", { name: "Beto Nunes" }, mulberry32(4));
    expect(body).toBe("Beto Nunes entrou pra firma. Mesa nova, book zerado, esperança no máximo.");
  });

  it("fills name for trader_promoted", () => {
    const body = pickBody("trader_promoted", { name: "Ada Faria" }, mulberry32(3));
    expect(body).toBe("Promoção pra Ada Faria! Bateu o benchmark — que neste mercado é quase poesia.");
  });

  it("fills name + label for achievement", () => {
    const body = pickBody("achievement", { name: "Ada Faria", label: "Primeiro trade" }, mulberry32(47));
    expect(body).toBe("Conquista nova na parede de Ada Faria: 'Primeiro trade'.");
  });

  it("fills the formatted peak for record_broken", () => {
    const body = pickBody("record_broken", { peakEquityMc: 1_480_000 }, mulberry32(45));
    expect(body).toBe("🔔 HISTÓRICO: a firma cravou $14.80, novo recorde. Emoldurem este scrap.");
  });

  it("fills genNumber for gen_started", () => {
    const body = pickBody("gen_started", { genNumber: 3 }, mulberry32(44));
    expect(body).toBe("Geração 3 aberta. Herdaram os melhores genes — e todas as dívidas emocionais dos antecessores.");
  });

  it("fills genNumber/peak for gen_ended", () => {
    const body = pickBody("gen_ended", { genNumber: 2, peakEquityMc: 1_480_000, daysLived: 3 }, mulberry32(5));
    expect(body).toBe("A Geração 2 fecha as portas com pico de $14.80. O que era gene bom virou herança.");
  });

  it("only ever returns its single line for hr_review, regardless of seed", () => {
    const payload = { fired: 1, promoted: 2 };
    expect(pickBody("hr_review", payload, mulberry32(7))).toBe(
      "Ciclo de avaliação: 1 desligamento(s), 2 promoção(ões). O RH dormirá tranquilo — decidiu com dados.",
    );
    expect(pickBody("hr_review", payload, mulberry32(999_999))).toBe(
      "Ciclo de avaliação: 1 desligamento(s), 2 promoção(ões). O RH dormirá tranquilo — decidiu com dados.",
    );
  });

  it("returns an empty string for an unmodeled event type", () => {
    expect(pickBody("catch_up", { bars: 12 }, mulberry32(1))).toBe("");
  });
});
