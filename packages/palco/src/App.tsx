import { useState } from "react";
import { useSnapshot } from "./useSnapshot";
import { usd } from "./format";
import { PregaoTab } from "./tabs/PregaoTab";
import { GeracoesTab } from "./tabs/GeracoesTab";
import { EmpresaTab } from "./tabs/EmpresaTab";
import { MuralTab } from "./tabs/MuralTab";

const VIRGIN_DAYS_GATE = 90;
const DEFAULT_EQUITY_MC = 1_000_000; // $10.00, matches the Motor's seed equity

type Route = "pregao" | "empresa" | "geracoes" | "mural";

const NAV_ITEMS: Array<{ route: Route; label: string }> = [
  { route: "pregao", label: "Pregão" },
  { route: "empresa", label: "Empresa" },
  { route: "geracoes", label: "Gerações" },
  { route: "mural", label: "Mural" },
];

export default function App() {
  const { snapshot, connected } = useSnapshot();
  const cards = snapshot?.cards;
  const [route, setRoute] = useState<Route>("pregao");

  return (
    <div className="page">
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

        <section className="hero-strip">
          <div className="hero-card">
            <div className="label">Equity da firma</div>
            <div className="v">{usd(cards?.evolvedEquityMc ?? DEFAULT_EQUITY_MC)}</div>
            <div className="d">Geração {cards?.evolvedGen ?? "–"}</div>
          </div>
          <div className="hero-card">
            <div className="label">Controle aleatório</div>
            <div className="v">{usd(cards?.randomEquityMc ?? DEFAULT_EQUITY_MC)}</div>
            <div className="d">Geração {cards?.randomGen ?? "–"}</div>
          </div>
          <div className="hero-card">
            <div className="label">Não fazer nada</div>
            <div className="v">$10.00</div>
            <div className="d">o piso honesto</div>
          </div>
          <div className="hero-card">
            <div className="label">Recorde (pico)</div>
            <div className="v">{usd(cards?.recordEvolvedMc ?? 0)}</div>
            <div className="d">controle: {usd(cards?.recordRandomMc ?? 0)}</div>
          </div>
          <div className="hero-card">
            <div className="label">Gerações vividas</div>
            <div className="v">
              {cards?.gensEvolved ?? 0} <small>/ {cards?.gensRandom ?? 0}</small>
            </div>
            <div className="d">firma / controle</div>
          </div>
          <div className="hero-card">
            <div className="label">Dados virgens</div>
            <div className="v">{(cards?.virginDays ?? 0).toFixed(1)}</div>
            <div className="d">de {VIRGIN_DAYS_GATE} dias</div>
          </div>
        </section>
      </header>

      <main className="page-content">
        {route === "pregao" && <PregaoTab snapshot={snapshot} />}
        {route === "empresa" && <EmpresaTab snapshot={snapshot} />}
        {route === "geracoes" && <GeracoesTab snapshot={snapshot} />}
        {route === "mural" && <MuralTab snapshot={snapshot} />}
      </main>

      <footer className="honesty">
        <p>
          Dinheiro real só entra em discussão se a linhagem evoluída vencer o controle aleatório E
          o não-fazer-nada por ≥ 3 meses de dados virgens ao vivo, fora da banda de ruído.
        </p>
      </footer>
    </div>
  );
}
