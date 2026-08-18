import { TabView, TabPanel } from "primereact/tabview";
import { useSnapshot } from "./useSnapshot";
import { usd } from "./format";
import { PregaoTab } from "./tabs/PregaoTab";
import { GeracoesTab } from "./tabs/GeracoesTab";
import { LeaderboardTab } from "./tabs/LeaderboardTab";
import { MuralTab } from "./tabs/MuralTab";

const VIRGIN_DAYS_GATE = 90;
const DEFAULT_EQUITY_MC = 1_000_000; // $10.00, matches the Motor's seed equity

export default function App() {
  const { snapshot, connected } = useSnapshot();
  const cards = snapshot?.cards;

  return (
    <div className="page">
      <header className="masthead">
        <div className="label kicker">Automaton · pesquisa de trading · dinheiro de papel</div>
        <h1>A Firma</h1>
        <p className="sub">
          Gerações de $10 operando ao vivo na Binance — contra um controle aleatório e contra
          não fazer nada.
        </p>
        <div className="live-status">
          <span className={`live-dot ${connected ? "connected" : "disconnected"}`} />
          <span className="label">{connected ? "ao vivo" : "reconectando…"}</span>
        </div>
      </header>

      <section className="hero-cards">
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

      <TabView>
        <TabPanel header="Pregão">
          <PregaoTab snapshot={snapshot} />
        </TabPanel>
        <TabPanel header="Gerações">
          <GeracoesTab snapshot={snapshot} />
        </TabPanel>
        <TabPanel header="Leaderboard">
          <LeaderboardTab snapshot={snapshot} />
        </TabPanel>
        <TabPanel header="Mural">
          <MuralTab snapshot={snapshot} />
        </TabPanel>
      </TabView>

      <footer className="honesty">
        Dinheiro real só entra em discussão se a linhagem evoluída vencer o controle aleatório E
        o não-fazer-nada por ≥ 3 meses de dados virgens ao vivo, fora da banda de ruído.
      </footer>
    </div>
  );
}
