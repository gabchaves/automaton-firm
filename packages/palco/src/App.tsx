import { useState } from "react";
import { motion } from "framer-motion";
import { useSnapshot } from "./useSnapshot";
import { TickerTape } from "./components/TickerTape";
import { Confetti } from "./components/Confetti";
import { PregaoTab } from "./tabs/PregaoTab";
import { LeaderboardTab } from "./tabs/LeaderboardTab";
import { GeracoesTab } from "./tabs/GeracoesTab";
import { EmpresaTab } from "./tabs/EmpresaTab";
import { MuralTab } from "./tabs/MuralTab";
import { SobreTab } from "./tabs/SobreTab";

// Tab-content crossfade (Commit 1's micro-animations pass) — the only
// looping/tween motion left at this level now that the hero strip (and its
// own stagger-in) moved into PregaoTab as its "visão geral" panel (v4.4).
const TAB_CROSSFADE_DURATION_S = 0.12;

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
  const [route, setRoute] = useState<Route>("pregao");

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
