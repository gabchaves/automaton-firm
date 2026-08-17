/**
 * Evidence-based HR assessment.
 *
 * HR's job is selection: turn variation into improvement by judging every
 * trader against what was achievable in the same window (a random
 * baseline), not against absolute profit. Absolute profit selects for luck
 * and for bull regimes. Activity-based rules are worse: sitting flat when
 * the baseline paid nothing was correct and profitable.
 *
 * The core rule: an `insufficient_evidence` trader is NEVER promoted and
 * NEVER retired. Being flat is penalised ONLY when the window's baseline
 * clearly paid — never merely for being flat.
 */

export type EvidenceVerdict = "outperform" | "underperform" | "insufficient_evidence";

export interface TraderEvidence {
  traderId: string;
  netCents: number; // the trader's realized result over the window
  tradesCount: number;
  baselineMedianCents: number; // what a random decider achieved on the SAME window
}

export interface HrConfig {
  minTradesForEvidence: number; // default 5 — below this we usually cannot judge
  excessBandCents: number; // default 50 — |excess| inside this band is noise
}

export interface HrAssessment {
  traderId: string;
  verdict: EvidenceVerdict;
  excessCents: number; // netCents - baselineMedianCents
  reason: string;
}

export interface HrDecision {
  promote: string[];
  retire: string[];
  hold: string[];
}

export const DEFAULT_HR_CONFIG: HrConfig = {
  minTradesForEvidence: 5,
  excessBandCents: 50,
};

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function assessTrader(ev: TraderEvidence, cfg: HrConfig = DEFAULT_HR_CONFIG): HrAssessment {
  const excessCents = ev.netCents - ev.baselineMedianCents;

  if (ev.tradesCount < cfg.minTradesForEvidence) {
    if (ev.baselineMedianCents > cfg.excessBandCents) {
      return {
        traderId: ev.traderId,
        verdict: "underperform",
        excessCents,
        reason: `Only ${ev.tradesCount} trade(s) (< ${cfg.minTradesForEvidence} required) while the window's baseline made ${usd(ev.baselineMedianCents)} (> ${usd(cfg.excessBandCents)} band) — this looks like a missed opportunity, not defensible caution.`,
      };
    }
    return {
      traderId: ev.traderId,
      verdict: "insufficient_evidence",
      excessCents,
      reason: `Only ${ev.tradesCount} trade(s) (< ${cfg.minTradesForEvidence} required) and the window's baseline made ${usd(ev.baselineMedianCents)} (<= ${usd(cfg.excessBandCents)} band) — staying flat was defensible; there is not enough evidence to judge this trader.`,
    };
  }

  if (excessCents > cfg.excessBandCents) {
    return {
      traderId: ev.traderId,
      verdict: "outperform",
      excessCents,
      reason: `Net ${usd(ev.netCents)} beat the baseline ${usd(ev.baselineMedianCents)} by ${usd(excessCents)}, clear of the ${usd(cfg.excessBandCents)} noise band.`,
    };
  }

  if (excessCents < -cfg.excessBandCents) {
    return {
      traderId: ev.traderId,
      verdict: "underperform",
      excessCents,
      reason: `Net ${usd(ev.netCents)} trailed the baseline ${usd(ev.baselineMedianCents)} by ${usd(-excessCents)}, clear of the ${usd(cfg.excessBandCents)} noise band.`,
    };
  }

  return {
    traderId: ev.traderId,
    verdict: "insufficient_evidence",
    excessCents,
    reason: `Excess of ${usd(excessCents)} against the baseline is inside the ${usd(cfg.excessBandCents)} noise band — indistinguishable from the baseline.`,
  };
}

export function rankByExcess(assessments: HrAssessment[]): HrAssessment[] {
  return [...assessments].sort((a, b) => b.excessCents - a.excessCents);
}

export function decideHrActions(assessments: HrAssessment[]): HrDecision {
  const promote = rankByExcess(assessments.filter((a) => a.verdict === "outperform")).map((a) => a.traderId);
  const retire = assessments.filter((a) => a.verdict === "underperform").map((a) => a.traderId);
  const hold = assessments.filter((a) => a.verdict === "insufficient_evidence").map((a) => a.traderId);

  return { promote, retire, hold };
}
