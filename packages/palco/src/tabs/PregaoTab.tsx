import {
  Chart as ChartJS,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
} from "chart.js";
import { Line } from "react-chartjs-2";
import { motion } from "framer-motion";
import type { PalcoSnapshot } from "../types";
import { dateShort, usd, centsToUsd } from "../format";
import { initials, avatarBackground } from "../avatar";
import { moodEmoji, STAKE_MC } from "../mood";
import { NumberTicker } from "../components/NumberTicker";
import { ShineBorder } from "../components/ShineBorder";

ChartJS.register(LinearScale, PointElement, LineElement, Tooltip, Legend);

// pxpush identity chart palette — mirrors theme.css's --green/--lightgrey
// tokens (chart.js reads plain CSS color strings, not custom properties,
// so these are kept in sync by hand).
const FIRM_GREEN = "#0f0";
const MUTED_TEXT = "#71737d";
const BASELINE_HAIRLINE = "hsla(0, 0%, 100%, 0.35)";
const GRID_HAIRLINE = "hsla(0, 0%, 100%, 0.08)";
const MONO_FONT = "'Geist Mono', Consolas, monospace";
// v3 plan's "right-sized Pregão": trim the trade feed down from a full
// dump to a genuinely "last N" list now that positions get their own panel.
const MAX_TRADE_ITEMS = 8;

// v4.4: the "visão geral" masthead (relocated from App.tsx's global hero
// strip) — days-virgin gate progress and the strip's stagger-in on first
// load, both transform/opacity-only per the plan's performance discipline.
const VIRGIN_DAYS_GATE = 90;
const HERO_STAGGER_DELAY_S = 0.05;
const HERO_ENTER_DURATION_S = 0.3;

function heroCardMotionProps(index: number) {
  return {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: HERO_ENTER_DURATION_S, delay: index * HERO_STAGGER_DELAY_S, ease: "easeOut" as const },
  };
}

type LeaderboardEntry = PalcoSnapshot["leaderboard"][number];

interface PregaoTabProps {
  snapshot: PalcoSnapshot | null;
}

function toPoints(series: [number, number][]): { x: number; y: number }[] {
  return series.map(([ts, mc]) => ({ x: ts, y: mc / 100_000 }));
}

/** Green/red row tint for the compact trades list, based on realizedPnlMc.
 * trade_opened rows (no pnl yet) and exact-zero pnl stay neutral. */
function pnlRowClass(item: { type: string; payload: Record<string, unknown> }): string {
  if (item.type !== "trade_closed") return "";
  const pnl = item.payload.realizedPnlMc;
  if (typeof pnl !== "number") return "";
  if (pnl > 0) return "pnl-pos";
  if (pnl < 0) return "pnl-neg";
  return "";
}

const EMPTY_WINDOW_STATS: PalcoSnapshot["pregao"]["evolved"] = {
  pnl1hMc: 0, pnl24hMc: 0, trades1h: 0, trades24h: 0, winRate24h: 0,
};

// Fallback while there's no snapshot yet — nobody traded, so the real
// byAgent24h would be empty too.
const EMPTY_BY_AGENT_24H: PalcoSnapshot["pregao"]["byAgent24h"] = [];

// Formatters for NumberTicker's non-money Pregão stat-cards (money ones
// reuse `usd` directly, same convention as App.tsx's hero strip).
function formatCount(n: number): string {
  return Math.round(n).toString();
}

function formatWinRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

// "Dados virgens" (visão geral) is the only one-decimal, non-percent,
// non-count hero number — everything else reuses `formatCount`/`usd` above.
function formatOneDecimal(n: number): string {
  return n.toFixed(1);
}

/**
 * "Visão geral" — Pregão's own masthead (v4.4, relocated from App.tsx's
 * global hero strip per user feedback: "essa faixa pode ficar so na
 * primeira tela de pregao"). Same 6 `.hero-card`s, same `NumberTicker`
 * values, same `ShineBorder` on "Recorde (pico)", same stagger-in motion —
 * content/behavior unchanged, just re-scoped to read `snapshot` instead of
 * App's `cards`/`connected`. `seedMc` is the caller's (PregaoTab's own,
 * already-computed) local — not recomputed here.
 */
function VisaoGeralStrip({
  cards,
  seedMc,
  recordEvolvedMc,
  recordShineThresholdMc,
}: {
  cards: PalcoSnapshot["cards"] | undefined;
  seedMc: number;
  recordEvolvedMc: number;
  recordShineThresholdMc: number;
}) {
  return (
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
  );
}

/** `.cohort-stat-value` is green by default (theme.css) — only adds the
 * `pnl-neg` override class when the value is negative, same red/green
 * "verde/vermelho pelo sinal" convention used everywhere else on Pregão. */
function cohortStatValueClass(mc: number): string {
  return mc < 0 ? "cohort-stat-value pnl-neg" : "cohort-stat-value";
}

/**
 * Windowed stats for one cohort — Task A2 of the v4 plan: "lucro na última
 * hora etc" was the user's literal ask. v4.5: collapsed from 4 boxed
 * `.hero-card`s into one compact mono line — the boxed version, repeated
 * for both cohorts on top of the 6-card "visão geral" masthead, stacked 14
 * near-identical boxes before the chart ("tem coisa demais").
 */
function CohortStatsGroup({ title, stats }: { title: string; stats: PalcoSnapshot["pregao"]["evolved"] }) {
  return (
    <div className="cohort-stats-group">
      <span className="label">{title}</span>
      <div className="cohort-stats-line">
        <span className="cohort-stat">
          <span className="cohort-stat-label">Lucro 1h</span>
          <span className={cohortStatValueClass(stats.pnl1hMc)}>
            <NumberTicker value={stats.pnl1hMc} format={usd} />
          </span>
        </span>
        <span className="cohort-stat">
          <span className="cohort-stat-label">Lucro 24h</span>
          <span className={cohortStatValueClass(stats.pnl24hMc)}>
            <NumberTicker value={stats.pnl24hMc} format={usd} />
          </span>
        </span>
        <span className="cohort-stat">
          <span className="cohort-stat-label">Trades 24h</span>
          <span className="cohort-stat-value">
            <NumberTicker value={stats.trades24h} format={formatCount} />
          </span>
        </span>
        <span className="cohort-stat">
          <span className="cohort-stat-label">Win rate 24h</span>
          <span className="cohort-stat-value">
            <NumberTicker value={stats.winRate24h} format={formatWinRate} />
          </span>
        </span>
      </div>
    </div>
  );
}

/** P&L 24h (e 1h) por agente da firma — só evolved, só quem operou nas
 * últimas 24h, ordenado por P&L 24h desc. v4.1: substitui a versão por
 * mesa a pedido do usuário ("tira mesa e troca por agente"). */
function AgentPnlTable({ rows }: { rows: PalcoSnapshot["pregao"]["byAgent24h"] }) {
  return (
    <section className="agent-pnl-panel">
      <h2 className="section-title">P&amp;L por agente</h2>
      {rows.length === 0 ? (
        <p className="empty-state">ninguém operou nas últimas 24h.</p>
      ) : (
        <table className="agent-pnl-table">
          <thead>
            <tr>
              <th>Agente</th>
              <th>1h</th>
              <th>24h</th>
              <th>Trades</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.traderId}>
                <td className="mono-bold">{row.name}</td>
                <td className={row.pnl1hMc < 0 ? "pnl-value pnl-neg" : "pnl-value pnl-pos"}>{usd(row.pnl1hMc)}</td>
                <td className={row.pnl24hMc < 0 ? "pnl-value pnl-neg" : "pnl-value pnl-pos"}>{usd(row.pnl24hMc)}</td>
                <td>{row.trades24h}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/**
 * Posições abertas — every leaderboard entry with `inPosition: true`. Only
 * the entry price is shown (mono) alongside book/mesa; there's no per-symbol
 * mark price on the snapshot to compute a live unrealized P&L from, so this
 * deliberately stops at "what we're in", not "how it's doing" — see the v3
 * plan's Task 1 note.
 */
function OpenPositionsPanel({ positions, stakeMc }: { positions: LeaderboardEntry[]; stakeMc: number }) {
  return (
    <section className="positions-panel">
      <h2 className="section-title">Posições abertas</h2>
      {positions.length === 0 ? (
        <p className="empty-state">ninguém posicionado — a firma espera sinal.</p>
      ) : (
        <ul className="positions-list">
          {positions.map((trader) => (
            <li key={trader.traderId} className="position-row">
              <span className="mini-avatar" style={{ background: avatarBackground(trader.name) }}>
                {initials(trader.name)}
              </span>
              <span className="position-who">
                <span className="position-name">
                  {trader.name}
                  <span className="mood-emoji">{moodEmoji(trader.status, trader.bookMc, stakeMc)}</span>
                </span>
                <span className="position-mesa">{`${trader.symbol} · ${trader.leverage}x`}</span>
              </span>
              <span className="position-entry" title="Preço de entrada">
                {trader.entryPriceCents !== null ? centsToUsd(trader.entryPriceCents) : "–"}
              </span>
              <span className="position-book" title="Book atual">
                {usd(trader.bookMc)}
              </span>
              <span className="chip-long">LONG</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function PregaoTab({ snapshot }: PregaoTabProps) {
  // Sane fallbacks (100_000_000 / STAKE_MC) while there's no snapshot yet;
  // every real render derives from snapshot.cards instead, so a bankroll
  // scale change never touches this file again.
  const seedMc = snapshot?.cards.genStartMc ?? 100_000_000;
  const stakeMc = snapshot?.cards.traderStartMc ?? STAKE_MC;
  const baselineUsd = seedMc / 100_000;
  const recordEvolvedMc = snapshot?.cards.recordEvolvedMc ?? 0;
  // v3.2 plan: ShineBorder lights up the "Recorde (pico)" hero card only for
  // a genuine new record ABOVE the generation's seed equity — never for the
  // seed value itself, which every fresh generation starts at.
  const recordShineThresholdMc = seedMc;
  const pregaoEvolved = snapshot?.pregao.evolved ?? EMPTY_WINDOW_STATS;
  const pregaoRandom = snapshot?.pregao.random ?? EMPTY_WINDOW_STATS;
  const byAgent24h = snapshot?.pregao.byAgent24h ?? EMPTY_BY_AGENT_24H;
  const evolvedPoints = toPoints(snapshot?.equitySeries.evolved ?? []);
  const randomPoints = toPoints(snapshot?.equitySeries.random ?? []);
  const allTs = [...evolvedPoints, ...randomPoints].map((p) => p.x);
  const minTs = allTs.length ? Math.min(...allTs) : 0;
  const maxTs = allTs.length ? Math.max(...allTs) : 1;

  const data = {
    datasets: [
      {
        label: "firma",
        data: evolvedPoints,
        borderColor: FIRM_GREEN,
        backgroundColor: FIRM_GREEN,
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.15,
      },
      {
        label: "controle aleatório",
        data: randomPoints,
        borderColor: MUTED_TEXT,
        backgroundColor: MUTED_TEXT,
        borderWidth: 1.5,
        borderDash: [4, 4],
        pointRadius: 0,
        tension: 0.15,
      },
      {
        label: `${usd(seedMc)} parado`,
        data: [
          { x: minTs, y: baselineUsd },
          { x: maxTs, y: baselineUsd },
        ],
        borderColor: BASELINE_HAIRLINE,
        borderDash: [2, 3],
        borderWidth: 1,
        pointRadius: 0,
      },
    ],
  };

  const options = {
    responsive: true,
    // The chart now lives in a height-capped panel (see .chart-frame in
    // theme.css) rather than dictating the page's height itself — the v3
    // plan's "right-sized Pregão".
    maintainAspectRatio: false,
    scales: {
      x: {
        type: "linear" as const,
        ticks: {
          callback: (value: number | string) => dateShort(Number(value)),
          color: MUTED_TEXT,
          font: { family: MONO_FONT },
        },
        grid: { color: GRID_HAIRLINE },
      },
      y: {
        ticks: { callback: (value: number | string) => `$${value}`, color: MUTED_TEXT, font: { family: MONO_FONT } },
        grid: { color: GRID_HAIRLINE },
      },
    },
    plugins: {
      legend: { labels: { color: MUTED_TEXT, font: { family: MONO_FONT } } },
    },
  };

  const trades = (snapshot?.feed ?? []).filter(
    (item) => item.type === "trade_opened" || item.type === "trade_closed",
  );
  const positions = (snapshot?.leaderboard ?? []).filter((trader) => trader.inPosition);

  return (
    <>
      {/* v4.4: "visão geral" (relocated hero strip) + the per-cohort
          windowed stats directly below it — one concentrated masthead
          panel at the top of Pregão, per the user's ask. `.pregao-overview-strip`
          is a spacing-only wrapper (theme.css) that cancels the hero
          strip's own horizontal padding, which would otherwise double up
          with `.page-content`'s now that it's nested here instead of
          App's full-bleed site-header. */}
      <div className="pregao-overview-strip">
        <VisaoGeralStrip
          cards={snapshot?.cards}
          seedMc={seedMc}
          recordEvolvedMc={recordEvolvedMc}
          recordShineThresholdMc={recordShineThresholdMc}
        />
      </div>

      <section className="pregao-stats-section">
        <CohortStatsGroup title="Firma" stats={pregaoEvolved} />
        <CohortStatsGroup title="Controle" stats={pregaoRandom} />
      </section>

      <div className="pregao-grid">
        <section className="pregao-chart-panel">
          <h2 className="section-title">Curva de equity</h2>
          <div className="chart-frame">
            <Line data={data} options={options} />
          </div>
        </section>

        <div className="pregao-side">
          <OpenPositionsPanel positions={positions} stakeMc={stakeMc} />
        </div>
      </div>

      {/* v4.1: "Últimos trades" e "P&L por agente" lado a lado — pedido
          explícito do usuário, uma fileira de duas colunas abaixo do
          gráfico em vez de empilhados na coluna estreita. */}
      <div className="pregao-bottom-grid">
        <AgentPnlTable rows={byAgent24h} />

        <section className="trades-panel">
          <h2 className="section-title">Últimos trades</h2>
          <ul className="trade-feed">
            {trades.length === 0 && <li>Sem trades ainda.</li>}
            {trades.slice(0, MAX_TRADE_ITEMS).map((item) => (
              <li key={item.id} className={pnlRowClass(item)}>
                <span className="ts">{dateShort(item.ts)}</span>
                {/*
                  Safe: item.html is produced server-side by
                  src/motor/palco-format.ts's formatEventPt, which escapes every
                  payload value through escapeHtml before interpolation. This is
                  the same trusted, pre-escaped field the Mural tab renders.
                */}
                <span dangerouslySetInnerHTML={{ __html: item.html }} />
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
