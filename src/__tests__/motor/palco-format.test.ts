import { describe, expect, test } from "vitest";
import { escapeHtml, formatEventPt, usdFromMc } from "../../motor/palco-format.js";

describe("usdFromMc", () => {
  test("pins: 967000 -> $9.67", () => {
    expect(usdFromMc(967_000)).toBe("$9.67");
  });

  test("pins: -5000 -> $-0.05", () => {
    expect(usdFromMc(-5000)).toBe("$-0.05");
  });
});

describe("escapeHtml", () => {
  test("escapes & < > \" '", () => {
    expect(escapeHtml(`& < > " '`)).toBe("&amp; &lt; &gt; &quot; &#39;");
  });
});

describe("formatEventPt", () => {
  test("trade_opened", () => {
    const html = formatEventPt("trade_opened", { symbol: "BTCUSDT", priceCents: 6_500_000, notionalMc: 500_000, feeMc: 100 });
    expect(html).toBe("abriu BTCUSDT · notional $5.00");
  });

  test("trade_closed (not liquidated)", () => {
    const html = formatEventPt("trade_closed", { symbol: "ETHUSDT", priceCents: 300_000, realizedPnlMc: 10_000, feeMc: 50, liquidated: false });
    expect(html).toBe("fechou ETHUSDT · P&L $0.10");
  });

  test("trade_closed (liquidated)", () => {
    const html = formatEventPt("trade_closed", { symbol: "ETHUSDT", priceCents: 300_000, realizedPnlMc: -25_000, feeMc: 50, liquidated: true });
    expect(html).toBe("fechou ETHUSDT · P&L $-0.25 · LIQUIDADO");
  });

  test("trader_hired", () => {
    const html = formatEventPt("trader_hired", { name: "Ana Faria", slot: 2, stakeMc: 200_000, parentTraderId: null });
    expect(html).toBe("🤝 <strong>Ana Faria</strong> contratado(a) · slot 2 · stake $2.00");
  });

  test("trader_fired", () => {
    const html = formatEventPt("trader_fired", { name: "Bento Alves", reason: "underperform", returnedMc: 150_000 });
    expect(html).toBe("📦 <strong>Bento Alves</strong> demitido(a) · devolveu $1.50<br><small>underperform</small>");
  });

  test("trader_rotated", () => {
    const html = formatEventPt("trader_rotated", {
      name: "Fê Ramos",
      reason: "Rotação por falta de evidência: 5 dias sem gerar trades avaliáveis. Sem julgamento — a cadeira precisa produzir informação.",
      returnedMc: 200_000,
    });
    expect(html).toBe(
      "🔄 <strong>Fê Ramos</strong> girou a cadeira · devolveu $2.00<br><small>Rotação por falta de evidência: 5 dias sem gerar trades avaliáveis. Sem julgamento — a cadeira precisa produzir informação.</small>",
    );
  });

  test("trader_died", () => {
    const html = formatEventPt("trader_died", { name: "Caue Reis", slot: 0, ageMs: 5_400_000, bookPeakMc: 220_000 });
    expect(html).toBe("💀 <strong>Caue Reis</strong> morreu · viveu 1.5h · pico $2.20");
  });

  test("trader_promoted", () => {
    const html = formatEventPt("trader_promoted", { name: "Dora Lima", title: "Trader do Ciclo" });
    expect(html).toBe("🏆 <strong>Dora Lima</strong> promovido(a) — Trader do Ciclo");
  });

  test("achievement", () => {
    const html = formatEventPt("achievement", { key: "beat_benchmark", name: "Elis Prado", label: "Bateu o benchmark na revisão" });
    expect(html).toBe('✨ <strong>Elis Prado</strong> — "Bateu o benchmark na revisão"');
  });

  test("hr_review", () => {
    const html = formatEventPt("hr_review", { reviewed: 5, fired: 1, promoted: 1, held: 3, benchmarkCents: 12 });
    expect(html).toBe("🧾 RH: 5 avaliados · 1 demitidos · 1 promovidos · 3 mantidos · benchmark 12c");
  });

  test("gen_started", () => {
    const html = formatEventPt("gen_started", { cohort: "evolved", genNumber: 3, seedNote: "fresh" });
    expect(html).toBe("🌱 Geração 3 (evolved) começou — fresh");
  });

  test("gen_ended (new record)", () => {
    const html = formatEventPt("gen_ended", {
      cohort: "random", genNumber: 2, peakEquityMc: 1_100_000, peakAt: 0, barsLived: 10,
      daysLived: 4.2, isNewRecord: true, finalEquityMc: 0,
    });
    expect(html).toBe("⚰️ Geração 2 (random) acabou · pico $11.00 · 4.2 dias · 🔔 NOVO RECORDE");
  });

  test("gen_ended (not a new record)", () => {
    const html = formatEventPt("gen_ended", {
      cohort: "evolved", genNumber: 7, peakEquityMc: 900_000, peakAt: 0, barsLived: 5,
      daysLived: 1, isNewRecord: false, finalEquityMc: 0,
    });
    expect(html).toBe("⚰️ Geração 7 (evolved) acabou · pico $9.00 · 1 dias");
  });

  test("record_broken", () => {
    const html = formatEventPt("record_broken", { cohort: "evolved", genNumber: 5, peakEquityMc: 1_500_000, previousRecordMc: 1_480_000 });
    expect(html).toBe("🔔 RECORDE: $15.00 (evolved, gen 5) — anterior $14.80");
  });

  test("catch_up", () => {
    const html = formatEventPt("catch_up", { fromTs: 0, toTs: 100, bars: 42 });
    expect(html).toBe("⏪ catch-up de 42 barras");
  });

  test("unknown type falls back to escaped type string", () => {
    const html = formatEventPt("some_unknown_type", {});
    expect(html).toBe("some_unknown_type");
  });

  test("escapes payload strings so a <script> name renders inert", () => {
    const html = formatEventPt("trader_hired", { name: "<script>alert(1)</script>", slot: 1, stakeMc: 100 });
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});
