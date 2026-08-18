import type { PalcoGeneStruct } from "./types";

/**
 * Readable-genome formatting for the Empresa profile drawer (v3.1 plan).
 * The genome used to render as raw outlined chips on the Leaderboard; user
 * feedback called that "too abstract" and it was removed from there (see
 * LeaderboardTab.tsx's doc comment) — this is its new home, where a
 * profile has room to spell out what the combinator and each gene actually
 * mean instead of just naming them.
 */

const COMBINATOR_PHRASE: Record<string, string> = {
  all: "entra quando todos concordam",
  majority: "entra pela maioria",
  any: "entra se qualquer um sinalizar",
};

export function combinatorPhrase(combinator: string): string {
  return COMBINATOR_PHRASE[combinator] ?? combinator;
}

/** One outlined chip per gene, PT label + its bounded params — family keys
 * mirror src/trading/genome.ts's Gene union (momentum / meanReversion /
 * breakout / regimeFilter). */
export function geneChipLabel(gene: PalcoGeneStruct): string {
  switch (gene.family) {
    case "momentum":
      return `⚡ Momentum ${gene.params.fastBars}/${gene.params.slowBars} barras`;
    case "meanReversion":
      return `🎯 Reversão z>${gene.params.entryZ} (${gene.params.lookbackBars}b)`;
    case "breakout":
      return `🚪 Breakout ${gene.params.channelBars}b`;
    case "regimeFilter":
      return `🛡️ Filtro SMA${gene.params.smaBars}`;
    default:
      return gene.family;
  }
}
