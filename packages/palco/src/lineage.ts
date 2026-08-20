import type { PalcoSnapshot } from "./types";

export type Employee = PalcoSnapshot["org"]["employees"][number];

/**
 * Human-readable lineage line for an employee — mutação de {parentName} /
 * contratação externa / geração evoluída (seedNote fallback). Extracted
 * from the org graph's original inline `lineageTitle` (v3 plan Task 3) so
 * the Empresa profile drawer (v3.1) can reuse the exact same wording
 * instead of duplicating the branch logic. EmpresaRoster's row (v4.3 —
 * the graph is gone, this renders as plain visible text now, not a hover
 * tooltip) prefixes this with "↳ "; the drawer renders it plain.
 *
 * Returns undefined for the control (random) cohort, which never carries a
 * bred lineage narrative — same as the original.
 */
export function lineageLine(employee: Employee): string | undefined {
  if (employee.cohort === "random") return undefined;
  if (employee.parentTraderId !== null) {
    return `mutação de ${employee.parentName ?? "um trader anterior"}`;
  }
  if (employee.seedNote === "fresh") return "contratação externa (genoma novo)";
  return `geração evoluída — ${employee.seedNote}`;
}
