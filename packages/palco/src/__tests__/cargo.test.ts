import { describe, expect, it } from "vitest";
import { cargoFor, cargoForEmployee } from "../cargo";
import { fixtureSnapshot } from "./fixtures";

const BASE = { symbol: "BTCUSDT", leverage: 2 };

describe("cargoFor", () => {
  describe("random cohort (control group)", () => {
    it("returns the fixed titulo and 'no strategy' papel, plus the mesa clause", () => {
      const cargo = cargoFor({
        cohort: "random",
        parentTraderId: null,
        seedNote: "random-control",
        families: [],
        ...BASE,
      });

      expect(cargo.titulo).toBe("Trader Aleatório · Grupo de Controle");
      expect(cargo.papel).toBe(
        "Decide cara-ou-coroa a cada barra, com os mesmos limites da firma. Não tem estratégia — e é exatamente por isso que importa: é o espelho honesto contra o qual todo mundo é medido. Mesa BTCUSDT · 2x.",
      );
    });

    it("never appends a specialty sentence for random cohort, even when families are present", () => {
      // Mirrors the real fixture shape: t-rand7 (cohort "random") still has
      // a meanReversion gene in its leaderboard genome for mesa bookkeeping
      // — the papel must stay honest ("não tem estratégia") regardless.
      const cargo = cargoFor({
        cohort: "random",
        parentTraderId: null,
        seedNote: "random-control",
        families: ["meanReversion"],
        ...BASE,
      });

      expect(cargo.papel).not.toContain("Especialidade");
      expect(cargo.papel).not.toContain("Multiestrategista");
      expect(cargo.papel.endsWith("Mesa BTCUSDT · 2x.")).toBe(true);
    });
  });

  describe("trainee (HR mid-cycle replacement hire)", () => {
    it("wins over any seedNote content once parentTraderId is set", () => {
      const cargo = cargoFor({
        cohort: "evolved",
        parentTraderId: "t-ada",
        seedNote: "2 clones + 1 mutant", // would otherwise read as a mixed generation
        families: [],
        ...BASE,
      });

      expect(cargo.titulo).toBe("Trader Trainee · aposta do RH");
      expect(cargo.papel).toBe(
        "Contratado(a) no meio do ciclo como mutação do melhor genoma vivo. Tem tudo a provar — o RH está de olho. Mesa BTCUSDT · 2x.",
      );
    });
  });

  describe("no parent, seedNote-derived titulos", () => {
    it("labels an exactly-'fresh' seedNote as Júnior · contratação externa", () => {
      const cargo = cargoFor({
        cohort: "evolved",
        parentTraderId: null,
        seedNote: "fresh",
        families: [],
        ...BASE,
      });

      expect(cargo.titulo).toBe("Trader Júnior · contratação externa");
      expect(cargo.papel).toBe(
        "Genoma novo em folha, sem herança. Sangue fresco pra não deixar a firma endogâmica. Mesa BTCUSDT · 2x.",
      );
    });

    it("labels a mixed generation-level seedNote (contains '+') as Trader da Geração, without inventing a specific lineage", () => {
      const cargo = cargoFor({
        cohort: "evolved",
        parentTraderId: null,
        seedNote: "1 clone + 2 mutants + 2 fresh",
        families: [],
        ...BASE,
      });

      expect(cargo.titulo).toBe("Trader da Geração");
      expect(cargo.papel).toBe(
        "Fundador(a) desta geração — o mix exato de herança e mutação está no seedNote da geração. Mesa BTCUSDT · 2x.",
      );
    });

    it("labels a single-type 'clone' seedNote as Trader Sênior · herdeiro(a) direto(a)", () => {
      const cargo = cargoFor({
        cohort: "evolved",
        parentTraderId: null,
        seedNote: "elite-clone",
        families: [],
        ...BASE,
      });

      expect(cargo.titulo).toBe("Trader Sênior · herdeiro(a) direto(a)");
      expect(cargo.papel.startsWith("Carrega, sem mutação, o melhor genoma da geração anterior.")).toBe(true);
    });

    it("labels a single-type 'mutant' seedNote as Trader Pleno · linhagem de elite", () => {
      const cargo = cargoFor({
        cohort: "evolved",
        parentTraderId: null,
        seedNote: "mutant",
        families: [],
        ...BASE,
      });

      expect(cargo.titulo).toBe("Trader Pleno · linhagem de elite");
      expect(cargo.papel.startsWith("Evolução aplicada: genoma de elite com mutações novas.")).toBe(true);
    });

    it("falls back to Júnior · contratação externa for an unrecognized seedNote, rather than guessing", () => {
      const cargo = cargoFor({
        cohort: "evolved",
        parentTraderId: null,
        seedNote: "immigrant",
        families: [],
        ...BASE,
      });

      expect(cargo.titulo).toBe("Trader Júnior · contratação externa");
    });
  });

  describe("specialty suffix", () => {
    it("appends nothing when families is empty", () => {
      const cargo = cargoFor({
        cohort: "evolved",
        parentTraderId: null,
        seedNote: "fresh",
        families: [],
        ...BASE,
      });

      expect(cargo.papel).toBe(
        "Genoma novo em folha, sem herança. Sangue fresco pra não deixar a firma endogâmica. Mesa BTCUSDT · 2x.",
      );
    });

    it("appends the momentum sentence for a momentum-only genome", () => {
      const cargo = cargoFor({
        cohort: "evolved",
        parentTraderId: null,
        seedNote: "fresh",
        families: ["momentum"],
        ...BASE,
      });

      expect(cargo.papel).toContain(" Especialidade: momentum — surfa tendência.");
    });

    it("appends the meanReversion sentence for a meanReversion-only genome", () => {
      const cargo = cargoFor({
        cohort: "evolved",
        parentTraderId: null,
        seedNote: "fresh",
        families: ["meanReversion"],
        ...BASE,
      });

      expect(cargo.papel).toContain(" Especialidade: reversão à média — compra o exagero.");
    });

    it("appends the breakout sentence for a breakout-only genome", () => {
      const cargo = cargoFor({
        cohort: "evolved",
        parentTraderId: null,
        seedNote: "fresh",
        families: ["breakout"],
        ...BASE,
      });

      expect(cargo.papel).toContain(" Especialidade: rompimentos — caça a fuga do canal.");
    });

    it("appends the multi-strategist sentence, joined with '/', for 2+ signal families", () => {
      const cargo = cargoFor({
        cohort: "evolved",
        parentTraderId: null,
        seedNote: "fresh",
        families: ["momentum", "breakout"],
        ...BASE,
      });

      expect(cargo.papel).toContain(" Multiestrategista: combina momentum/breakout.");
    });

    it("additionally appends the regime-filter sentence when regimeFilter is present alongside a signal family", () => {
      const cargo = cargoFor({
        cohort: "evolved",
        parentTraderId: null,
        seedNote: "fresh",
        families: ["momentum", "regimeFilter"],
        ...BASE,
      });

      expect(cargo.papel).toContain(" Especialidade: momentum — surfa tendência.");
      expect(cargo.papel).toContain(" Opera sob filtro de regime — só entra com o mar calmo.");
    });

    it("appends only the regime-filter sentence when regimeFilter is the only family (no signal family)", () => {
      const cargo = cargoFor({
        cohort: "evolved",
        parentTraderId: null,
        seedNote: "fresh",
        families: ["regimeFilter"],
        ...BASE,
      });

      expect(cargo.papel).not.toContain("Especialidade");
      expect(cargo.papel).not.toContain("Multiestrategista");
      expect(cargo.papel).toContain(" Opera sob filtro de regime — só entra com o mar calmo.");
    });
  });

  describe("mesa suffix", () => {
    it("always appends 'Mesa SYMBOL · LEVERAGEx.' as the final clause, for any symbol/leverage", () => {
      const cargo = cargoFor({
        cohort: "evolved",
        parentTraderId: null,
        seedNote: "fresh",
        families: [],
        symbol: "SOLUSDT",
        leverage: 3,
      });

      expect(cargo.papel.endsWith(" Mesa SOLUSDT · 3x.")).toBe(true);
    });
  });
});

describe("cargoForEmployee", () => {
  it("joins the leaderboard by traderId to derive families, matching Beto Nunes (trainee) from the shared fixture", () => {
    const beto = fixtureSnapshot.org.employees.find((employee) => employee.traderId === "t-beto");
    if (!beto) throw new Error("fixture missing t-beto");

    // Beto has no matching leaderboard row in the fixture (see EmpresaTab
    // drawer test) — cargoForEmployee must degrade to families: [] rather
    // than throwing.
    const cargo = cargoForEmployee(beto, null);

    expect(cargo.titulo).toBe("Trader Trainee · aposta do RH");
    expect(cargo.papel.endsWith("Mesa ETHUSDT · 1x.")).toBe(true);
  });

  it("extracts gene families from the matched leaderboard genome for a non-trainee employee", () => {
    const ada = fixtureSnapshot.org.employees.find((employee) => employee.traderId === "t-ada");
    const adaLeaderboard = fixtureSnapshot.leaderboard.find((entry) => entry.traderId === "t-ada");
    if (!ada || !adaLeaderboard) throw new Error("fixture missing t-ada");

    // Ada's fixture genome is momentum + breakout — 2 signal families.
    const cargo = cargoForEmployee(ada, adaLeaderboard);

    expect(cargo.titulo).toBe("Trader Júnior · contratação externa"); // seedNote "fresh"
    expect(cargo.papel).toContain(" Multiestrategista: combina momentum/breakout.");
  });
});
