import {
  Chart as ChartJS,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
} from "chart.js";
import { Line } from "react-chartjs-2";
import type { PalcoSnapshot } from "../types";
import { dateShort, usd, centsToUsd } from "../format";
import { initials, avatarBackground } from "../avatar";
import { moodEmoji } from "../mood";

ChartJS.register(LinearScale, PointElement, LineElement, Tooltip, Legend);

// pxpush identity chart palette — mirrors theme.css's --green/--lightgrey
// tokens (chart.js reads plain CSS color strings, not custom properties,
// so these are kept in sync by hand).
const FIRM_GREEN = "#0f0";
const MUTED_TEXT = "#71737d";
const BASELINE_HAIRLINE = "hsla(0, 0%, 100%, 0.35)";
const GRID_HAIRLINE = "hsla(0, 0%, 100%, 0.08)";
const MONO_FONT = "'Geist Mono', Consolas, monospace";
const BASELINE_USD = 100;
// v3 plan's "right-sized Pregão": trim the trade feed down from a full
// dump to a genuinely "last N" list now that positions get their own panel.
const MAX_TRADE_ITEMS = 8;

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

/**
 * Posições abertas — every leaderboard entry with `inPosition: true`. Only
 * the entry price is shown (mono) alongside book/mesa; there's no per-symbol
 * mark price on the snapshot to compute a live unrealized P&L from, so this
 * deliberately stops at "what we're in", not "how it's doing" — see the v3
 * plan's Task 1 note.
 */
function OpenPositionsPanel({ positions }: { positions: LeaderboardEntry[] }) {
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
                  <span className="mood-emoji">{moodEmoji(trader.status, trader.bookMc)}</span>
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
        label: "$100 parado",
        data: [
          { x: minTs, y: BASELINE_USD },
          { x: maxTs, y: BASELINE_USD },
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
    <div className="pregao-grid">
      <section className="pregao-chart-panel">
        <h2 className="section-title">Curva de equity</h2>
        <div className="chart-frame">
          <Line data={data} options={options} />
        </div>
      </section>

      <div className="pregao-side">
        <OpenPositionsPanel positions={positions} />

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
    </div>
  );
}
