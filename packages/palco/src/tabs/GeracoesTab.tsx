import { motion } from "framer-motion";
import type { PalcoSnapshot } from "../types";
import { usd } from "../format";

type Generation = PalcoSnapshot["generations"][number];

interface GeracoesTabProps {
  snapshot: PalcoSnapshot | null;
}

// 5-minute bars — same constant as src/motor/feed.ts's BAR_MS. Not exposed
// on PalcoSnapshot.generations, so "dias vividos" is approximated from
// barsLived instead of a real elapsed-time field.
const BAR_MS = 300_000;
const MS_PER_DAY = 86_400_000;

// Staggered grow-in per the v3 plan's Task 4 spec: 40ms per bar, 400ms tween.
const STAGGER_DELAY_S = 0.04;
const BAR_GROW_DURATION_S = 0.4;
const MIN_BAR_WIDTH_PCT = 2; // keep a visible sliver even for a very young generation

const EXPLAINER =
  "Cada geração começa com $100. A barra mostra quanto tempo viveu; o número, o pico que alcançou. Se a seleção funciona, os picos verdes sobem.";

function daysLivedFrom(barsLived: number): string {
  return ((barsLived * BAR_MS) / MS_PER_DAY).toFixed(1);
}

function barLabel(gen: Generation): string {
  return `Geração ${gen.genNumber} — pico ${usd(gen.peakEquityMc)} — ${daysLivedFrom(gen.barsLived)} dias`;
}

interface LifeBarProps {
  gen: Generation;
  recordMc: number;
  maxBarsLived: number;
  index: number;
}

/** One horizontal "vida" bar: length proportional to days lived (relative
 * to the longest-lived generation on the page), firm green / control grey,
 * a 🔔 badge when this generation holds its cohort's record, and a pulsing
 * "em curso" chip while still live. */
function LifeBar({ gen, recordMc, maxBarsLived, index }: LifeBarProps) {
  const widthPct = maxBarsLived > 0 ? Math.max(MIN_BAR_WIDTH_PCT, (gen.barsLived / maxBarsLived) * 100) : 0;
  const isRecord = recordMc > 0 && gen.peakEquityMc === recordMc;
  const fillClass = gen.cohort === "evolved" ? "life-bar-fill life-bar-firm" : "life-bar-fill life-bar-control";

  return (
    <div className="life-bar-row">
      <div className="life-bar-track">
        <motion.div
          className={fillClass}
          initial={{ width: 0 }}
          animate={{ width: `${widthPct}%` }}
          transition={{ duration: BAR_GROW_DURATION_S, delay: index * STAGGER_DELAY_S, ease: "easeOut" }}
        />
      </div>
      <div className="life-bar-label">
        <span>{barLabel(gen)}</span>
        {isRecord && <span className="gen-record-badge"> 🔔</span>}
        {!gen.ended && <span className="status-chip status-live pulse-chip"> em curso</span>}
      </div>
    </div>
  );
}

export function GeracoesTab({ snapshot }: GeracoesTabProps) {
  const generations = snapshot?.generations ?? [];
  const cards = snapshot?.cards;

  const genNumbersDesc = Array.from(new Set(generations.map((g) => g.genNumber))).sort((a, b) => b - a);
  const evolvedByGen = new Map(generations.filter((g) => g.cohort === "evolved").map((g) => [g.genNumber, g]));
  const randomByGen = new Map(generations.filter((g) => g.cohort === "random").map((g) => [g.genNumber, g]));
  const maxBarsLived = generations.reduce((max, g) => Math.max(max, g.barsLived), 0);

  // Newest generation first; firm (evolved) then control (random) per
  // genNumber so the two land side by side in the 2-column grid below.
  const lifeBarEntries: Generation[] = genNumbersDesc.flatMap((n) => {
    const pair: Generation[] = [];
    const evolvedGen = evolvedByGen.get(n);
    const randomGen = randomByGen.get(n);
    if (evolvedGen) pair.push(evolvedGen);
    if (randomGen) pair.push(randomGen);
    return pair;
  });

  const liveEvolvedGen = generations.find((g) => g.cohort === "evolved" && !g.ended);
  const recordEvolvedMc = cards?.recordEvolvedMc ?? 0;
  const currentProgressPct =
    liveEvolvedGen && recordEvolvedMc > 0 ? Math.min(100, (liveEvolvedGen.peakEquityMc / recordEvolvedMc) * 100) : 0;

  return (
    <div>
      <h2 className="section-title">Geração atual</h2>
      <section className="gen-current-panel">
        {liveEvolvedGen ? (
          <>
            <div className="gen-current-stats">
              <div className="gen-stat">
                <span className="gen-stat-value">{daysLivedFrom(liveEvolvedGen.barsLived)}</span>
                <span className="label">dias vivos</span>
              </div>
              <div className="gen-stat">
                <span className="gen-stat-value">{usd(liveEvolvedGen.peakEquityMc)}</span>
                <span className="label">pico</span>
              </div>
              <div className="gen-stat">
                <span className="gen-stat-value">{usd(cards?.evolvedEquityMc ?? 0)}</span>
                <span className="label">equity agora</span>
              </div>
            </div>
            <div className="gen-progress">
              <div className="gen-progress-fill" style={{ width: `${currentProgressPct}%` }} />
            </div>
            <div className="gen-progress-caption label">
              {currentProgressPct.toFixed(0)}% do recorde ({usd(recordEvolvedMc)})
            </div>
          </>
        ) : (
          <p className="empty-state">nenhuma geração da firma em curso agora.</p>
        )}
      </section>

      <p className="gen-explainer">{EXPLAINER}</p>

      <h2 className="section-title">Todas as gerações</h2>
      <div className="gen-life-grid">
        {lifeBarEntries.length === 0 && <p>Sem gerações ainda.</p>}
        {lifeBarEntries.map((gen, index) => (
          <LifeBar
            key={`${gen.cohort}-${gen.genNumber}`}
            gen={gen}
            recordMc={gen.cohort === "evolved" ? (cards?.recordEvolvedMc ?? 0) : (cards?.recordRandomMc ?? 0)}
            maxBarsLived={maxBarsLived}
            index={index}
          />
        ))}
      </div>
    </div>
  );
}
