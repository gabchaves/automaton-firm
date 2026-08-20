import type { PalcoSnapshot } from "./types";
import type { Employee } from "./lineage";

type LeaderboardEntry = PalcoSnapshot["leaderboard"][number];

/**
 * Cargo (job title) + papel (role blurb) for one employee — the Empresa
 * tab's "who does what" layer, on top of the existing lineage narrative
 * (see lineage.ts). `titulo` is a short chip-able label; `papel` is a full
 * PT sentence explaining the role, always ending in a "Mesa SYMBOL ·
 * LEVERAGEx." clause.
 *
 * Pure and deterministic: no Date.now, no randomness, no I/O. Every branch
 * is derived only from the employee's own org record (cohort,
 * parentTraderId, seedNote, symbol, leverage) plus its genome's gene
 * families (joined from the leaderboard by traderId at the call site — see
 * `cargoForEmployee` below).
 */
export interface Cargo {
  titulo: string;
  papel: string;
}

interface CargoInput {
  cohort: string; // "evolved" | "random"
  parentTraderId: string | null; // set => HR mid-cycle replacement hire
  seedNote: string; // the trader's GENERATION seed note
  families: string[]; // genome gene families, may be empty when unknown
  symbol: string;
  leverage: number;
}

const RANDOM_PAPEL =
  "Decide cara-ou-coroa a cada barra, com os mesmos limites da firma. Não tem estratégia — e é exatamente por isso que importa: é o espelho honesto contra o qual todo mundo é medido.";

const TRAINEE_PAPEL =
  "Contratado(a) no meio do ciclo como mutação do melhor genoma vivo. Tem tudo a provar — o RH está de olho.";

const SENIOR_PAPEL = "Carrega, sem mutação, o melhor genoma da geração anterior. A régua da casa.";

const PLENO_PAPEL = "Evolução aplicada: genoma de elite com mutações novas. A aposta central da seleção.";

const JUNIOR_PAPEL = "Genoma novo em folha, sem herança. Sangue fresco pra não deixar a firma endogâmica.";

const GERACAO_PAPEL =
  "Fundador(a) desta geração — o mix exato de herança e mutação está no seedNote da geração.";

/**
 * Picks the titulo + base (un-suffixed) papel for a non-random employee,
 * ordered from most to least specific:
 *
 * 1. an HR mid-cycle replacement hire (parentTraderId set) is always a
 *    trainee, regardless of what its generation's seedNote says;
 * 2. an exactly-"fresh" seedNote is an honest single-trader signal — Júnior;
 * 3. seedNote is GENERATION-level (e.g. "1 clone + 2 mutants + 2 fresh"), so
 *    a "+" means the note mixes multiple lineage types and we can't tell
 *    which one *this* employee is — fall back to the truthful, generic
 *    "Trader da Geração" instead of guessing;
 * 4. only once the note is neither exactly "fresh" nor a mix do the
 *    substring checks for a single-type generation ("clone" / "mutant")
 *    apply;
 * 5. anything else (e.g. "immigrant") falls back to Júnior, same spirit as
 *    the "fresh" case — no invented lineage.
 */
function baseCargo(input: CargoInput): Cargo {
  if (input.cohort === "random") {
    return { titulo: "Trader Aleatório · Grupo de Controle", papel: RANDOM_PAPEL };
  }
  if (input.parentTraderId !== null) {
    return { titulo: "Trader Trainee · aposta do RH", papel: TRAINEE_PAPEL };
  }
  if (input.seedNote === "fresh") {
    return { titulo: "Trader Júnior · contratação externa", papel: JUNIOR_PAPEL };
  }
  if (input.seedNote.includes("+")) {
    return { titulo: "Trader da Geração", papel: GERACAO_PAPEL };
  }
  if (input.seedNote.includes("clone")) {
    return { titulo: "Trader Sênior · herdeiro(a) direto(a)", papel: SENIOR_PAPEL };
  }
  if (input.seedNote.includes("mutant")) {
    return { titulo: "Trader Pleno · linhagem de elite", papel: PLENO_PAPEL };
  }
  return { titulo: "Trader Júnior · contratação externa", papel: JUNIOR_PAPEL };
}

/**
 * One specialty sentence derived from the genome's gene families.
 * `regimeFilter` is a filter, not a signal, so it's excluded from the
 * momentum/meanReversion/breakout/multi-strategist count and instead always
 * appends its own trailing clause when present.
 */
function specialtySuffix(families: string[]): string {
  if (families.length === 0) return "";

  const signalFamilies = families.filter((family) => family !== "regimeFilter");
  const hasRegimeFilter = families.includes("regimeFilter");

  let sentence = "";
  if (signalFamilies.length === 1) {
    if (signalFamilies[0] === "momentum") {
      sentence = " Especialidade: momentum — surfa tendência.";
    } else if (signalFamilies[0] === "meanReversion") {
      sentence = " Especialidade: reversão à média — compra o exagero.";
    } else if (signalFamilies[0] === "breakout") {
      sentence = " Especialidade: rompimentos — caça a fuga do canal.";
    }
  } else if (signalFamilies.length >= 2) {
    sentence = ` Multiestrategista: combina ${signalFamilies.join("/")}.`;
  }

  if (hasRegimeFilter) {
    sentence += " Opera sob filtro de regime — só entra com o mar calmo.";
  }
  return sentence;
}

/**
 * Cargo (titulo) + papel (role blurb) for one employee. The random/control
 * cohort's papel is fixed on purpose ("não tem estratégia") — its genome
 * may still carry gene families for mesa bookkeeping, but appending a
 * specialty sentence to a trader who explicitly has no strategy would
 * contradict its own papel, so the specialty suffix never applies there.
 * Every papel ends with the same "Mesa SYMBOL · LEVERAGEx." clause.
 */
export function cargoFor(input: CargoInput): Cargo {
  const { titulo, papel } = baseCargo(input);
  const specialty = input.cohort === "random" ? "" : specialtySuffix(input.families);
  const mesa = ` Mesa ${input.symbol} · ${input.leverage}x.`;
  return { titulo, papel: papel + specialty + mesa };
}

/**
 * Convenience wrapper for the two call sites (EmpresaRoster's row, Empresa
 * profile drawer) that already have an `Employee` plus its matching
 * leaderboard row (or null when the generation seed has no live ranking
 * entry — same join pattern the drawer already uses for the genome
 * section). Extracts gene families from the leaderboard genome and defers
 * to `cargoFor`.
 */
export function cargoForEmployee(employee: Employee, leaderboardEntry: LeaderboardEntry | null): Cargo {
  const families = leaderboardEntry?.genome.genes.map((gene) => gene.family) ?? [];
  return cargoFor({
    cohort: employee.cohort,
    parentTraderId: employee.parentTraderId,
    seedNote: employee.seedNote,
    families,
    symbol: employee.symbol,
    leverage: employee.leverage,
  });
}
