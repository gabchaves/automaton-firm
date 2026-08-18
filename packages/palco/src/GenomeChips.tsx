import type { PalcoGenome, PalcoGeneStruct } from "./types";

interface GenomeChipsProps {
  genome: PalcoGenome;
  compact?: boolean;
}

const COMBINATOR_SENTENCE: Record<string, string> = {
  all: "entra quando todos concordam",
  majority: "entra pela maioria",
  any: "entra se qualquer um sinalizar",
};

function geneChipLabel(gene: PalcoGeneStruct): string {
  switch (gene.family) {
    case "momentum":
      return `⚡ Momentum ${gene.params.fastBars}/${gene.params.slowBars}b`;
    case "meanReversion":
      return `🎯 Reversão z>${gene.params.entryZ} (${gene.params.lookbackBars}b)`;
    case "breakout":
      return `🚪 Breakout ${gene.params.channelBars}b`;
    case "regimeFilter":
      return `🛡️ Regime SMA${gene.params.smaBars}`;
    default:
      // Defensive fallback for a genome family this UI doesn't know about
      // yet — never crash the chips row over an unrecognized family.
      return gene.family;
  }
}

/** Friendly PT chips for a trader's genome: one chip per gene, a sentence
 * chip for the combinator, and a symbol/leverage chip. Shared by the
 * Empresa org chart (compact) — see the plan's v1.1 genome-chips spec. */
export function GenomeChips({ genome, compact }: GenomeChipsProps) {
  const combinatorLabel = COMBINATOR_SENTENCE[genome.combinator] ?? genome.combinator;
  const className = compact ? "genome-chips genome-chips--compact" : "genome-chips";

  return (
    <div className={className}>
      {genome.genes.map((gene, index) => (
        <span key={`${gene.family}-${index}`} className="chip chip-gene">
          {geneChipLabel(gene)}
        </span>
      ))}
      <span className="chip chip-combinator">{combinatorLabel}</span>
      <span className="chip chip-desk">
        {genome.symbol} · {genome.leverage}x
      </span>
    </div>
  );
}
