import { useState } from "react";
import { motion } from "framer-motion";
import { useSnapshot } from "./useSnapshot";
import { usd } from "./format";
import { NumberTicker } from "./components/NumberTicker";
import { TickerTape } from "./components/TickerTape";
import { ShineBorder } from "./components/ShineBorder";
import { Confetti } from "./components/Confetti";
import { PregaoTab } from "./tabs/PregaoTab";
import { LeaderboardTab } from "./tabs/LeaderboardTab";
import { GeracoesTab } from "./tabs/GeracoesTab";
import { EmpresaTab } from "./tabs/EmpresaTab";
import { MuralTab } from "./tabs/MuralTab";
import { SobreTab } from "./tabs/SobreTab";

const VIRGIN_DAYS_GATE = 90;
// Sane fallback while there's no snapshot yet — mirrors palco-data.ts's
// GEN_START_MC. Every real render derives the seed from
// `snapshot.cards.genStartMc` instead (see `seedMc` below), so a bankroll
// scale change never touches this file again.
const FALLBACK_GEN_START_MC = 100_000_000;

// Tab-content crossfade (Commit 1's micro-animations pass) and the hero
// strip's stagger-in on first load — both transform/opacity-only tweens,
// per the plan's performance discipline.
const TAB_CROSSFADE_DURATION_S = 0.12;
const HERO_STAGGER_DELAY_S = 0.05;
const HERO_ENTER_DURATION_S = 0.3;

function heroCardMotionProps(index: number) {
  return {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: HERO_ENTER_DURATION_S, delay: index * HERO_STAGGER_DELAY_S, ease: "easeOut" as const },
  };
}

// Formatters for NumberTicker's non-money hero numbers (money ones reuse
// `usd` directly).
function formatCount(n: number): string {
  return Math.round(n).toString();
}

function formatOneDecimal(n: number): string {
  return n.toFixed(1);
}

type Route = "pregao" | "leaderboard" | "empresa" | "geracoes" | "mural" | "sobre";

// LMArena-style ranked Leaderboard is a named product identity anchor —
// it stays alongside Empresa's org chart (ranking vs. structure), not
// replaced by it. Controller ruling, 2026-08-17.
const NAV_ITEMS: Array<{ route: Route; label: string }> = [
  { route: "pregao", label: "Pregão" },
  { route: "leaderboard", label: "Leaderboard" },
  { route: "empresa", label: "Empresa" },
  { route: "geracoes", label: "Gerações" },
  { route: "mural", label: "Mural" },
  { route: "sobre", label: "Sobre" },
];

export default function App() {
  const { snapshot, connected } = useSnapshot();
  const cards = snapshot?.cards;
  const [route, setRoute] = useState<Route>("pregao");

  // Every generation's starting bankroll — the front's single source of
  // truth for the "Não fazer nada" baseline, equity-ticker fallbacks, and
  // the ShineBorder record threshold below. Falls back only when there's
  // no snapshot yet.
  const seedMc = cards?.genStartMc ?? FALLBACK_GEN_START_MC;
  const recordEvolvedMc = cards?.recordEvolvedMc ?? 0;
  // v3.2 plan: ShineBorder lights up the "Recorde (pico)" hero card only for
  // a genuine new record ABOVE the generation's seed equity — never for the
  // seed value itself, which every fresh generation starts at.
  const recordShineThresholdMc = seedMc;

  return (
    <div className="page">
      <Confetti feed={snapshot?.feed ?? []} />

      <header className="site-header">
        <div className="nav-bar">
          <div className="wordmark">
            <span className="brand">A Firma</span>
            <span className="label kicker">Automaton · pesquisa de trading · dinheiro de papel</span>
          </div>

          <nav className="nav-links">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.route}
                type="button"
                className={route === item.route ? "nav-link active" : "nav-link"}
                aria-current={route === item.route ? "page" : undefined}
                onClick={() => setRoute(item.route)}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="nav-live">
            <span className={`live-dot ${connected ? "connected" : "disconnected"}`} />
            <span className="label">{connected ? "ao vivo" : "reconectando…"}</span>
          </div>
        </div>

        <TickerTape feed={snapshot?.feed ?? []} />

        <section className="hero-strip">
          <motion.div className="hero-card" {...heroCardMotionProps(0)}>
            <div className="label">Equity da firma</div>
            <div className="v">
              <NumberTicker value={cards?.evolvedEquityMc ?? seedMc} format={usd} />
            </div>
            <div className="d">Geração {cards?.evolvedGen ?? "–"}</div>
          </motion.div>
          <motion.div className="hero-card" {...heroCardMotionProps(1)}>
            <div className="label">Controle aleatório</div>
            <div className="v">
              <NumberTicker value={cards?.randomEquityMc ?? seedMc} format={usd} />
            </div>
            <div className="d">Geração {cards?.randomGen ?? "–"}</div>
          </motion.div>
          <motion.div className="hero-card" {...heroCardMotionProps(2)}>
            <div className="label">Não fazer nada</div>
            <div className="v">{usd(seedMc)}</div>
            <div className="d">o piso honesto</div>
          </motion.div>
          <ShineBorder active={recordEvolvedMc > recordShineThresholdMc}>
            <motion.div className="hero-card" {...heroCardMotionProps(3)}>
              <div className="label">Recorde (pico)</div>
              <div className="v">
                <NumberTicker value={recordEvolvedMc} format={usd} />
              </div>
              <div className="d">
                controle: <NumberTicker value={cards?.recordRandomMc ?? 0} format={usd} />
              </div>
            </motion.div>
          </ShineBorder>
          <motion.div className="hero-card" {...heroCardMotionProps(4)}>
            <div className="label">Gerações vividas</div>
            <div className="v">
              <NumberTicker value={cards?.gensEvolved ?? 0} format={formatCount} />{" "}
              <small>
                / <NumberTicker value={cards?.gensRandom ?? 0} format={formatCount} />
              </small>
            </div>
            <div className="d">firma / controle</div>
          </motion.div>
          <motion.div className="hero-card" {...heroCardMotionProps(5)}>
            <div className="label">Dados virgens</div>
            <div className="v">
              <NumberTicker value={cards?.virginDays ?? 0} format={formatOneDecimal} />
            </div>
            <div className="d">de {VIRGIN_DAYS_GATE} dias</div>
          </motion.div>
        </section>
      </header>

      <main className="page-content">
        {/*
          Fade-in only (no AnimatePresence/`exit`) — deliberately: with an
          exit-and-wait choreography the incoming tab's content only mounts
          once the outgoing tab's exit animation finishes, which would make
          every nav click asynchronous. React's normal synchronous
          mount/unmount on `route` changes is what the rest of this app
          (and its tests) expect; `key={route}` still replays this fade
          every time the visible tab changes, just without an exit phase.
        */}
        <motion.div
          key={route}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: TAB_CROSSFADE_DURATION_S }}
        >
          {route === "pregao" && <PregaoTab snapshot={snapshot} />}
          {route === "leaderboard" && <LeaderboardTab snapshot={snapshot} />}
          {route === "empresa" && <EmpresaTab snapshot={snapshot} />}
          {route === "geracoes" && <GeracoesTab snapshot={snapshot} />}
          {route === "mural" && <MuralTab snapshot={snapshot} />}
          {route === "sobre" && <SobreTab snapshot={snapshot} />}
        </motion.div>
      </main>

    </div>
  );
}
